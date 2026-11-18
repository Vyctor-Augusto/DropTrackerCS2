/**
 * Servidor do Drop Tracker (CS2).
 *
 * - Serve o painel em http://localhost:5179
 * - API em /api/*
 * - Atualiza os inventários sozinho de tempos em tempos
 *
 * Zero dependências: só Node 20+ (usa fetch nativo).
 */

import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import { Store } from './store.js';
import { SteamError, fetchInventory, resolveProfile } from './steam.js';
import { WEEKDAYS, WEEK_MS, describeRule, normalizeRule, weekWindow } from './week.js';
import { allItems, applySnapshot, buildHistory, computeDropState, newItemsBetween } from './drops.js';
import { PriceBook } from './prices.js';
import { buildEarnings } from './earnings.js';

const PORT = Number(process.env.PORT || 5179);
const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const PUBLIC_DIR = join(ROOT, 'public');
const DATA_FILE = join(ROOT, 'data', 'state.json');

const MIN_POLL_MINUTES = 5;
const MAX_POLL_MINUTES = 1440;
const RECHECK_COOLDOWN_MS = 10 * 60 * 1000;

const store = new Store(DATA_FILE);
const prices = new PriceBook(join(ROOT, 'data', 'prices.json'));

let refreshing = false;
let lastRunAt = null;
let nextRunAt = null;
let pollTimer = null;
const sseClients = new Set();

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------------------
// View model
// ---------------------------------------------------------------------------

function accountView(account, now) {
  const drop = computeDropState(account, store.settings, now);
  const status = account.status || { state: 'never', message: '', at: null };
  const drops = account.drops || {};
  return {
    id: account.id,
    steamId: account.steamId,
    label: account.label,
    avatar: account.avatar || '',
    note: account.note || '',
    ranking: account.ranking || '',
    statsUrl: account.statsUrl || '',
    profileUrl: `https://steamcommunity.com/profiles/${account.steamId}`,
    addedAt: account.addedAt,
    baselineAt: account.baselineAt || null,
    lastCheckedAt: account.lastCheckedAt || null,
    lastAttemptAt: account.lastAttemptAt || null,
    itemCount: account.itemCount ?? null,
    status,
    drop,
    drops,
    dropsTotal: round2(
      Object.values(drops).reduce(
        (sum, list) =>
          sum +
          (Array.isArray(list) ? list.reduce((s, item) => s + (Number(item.price) || 0), 0) : 0),
        0,
      ),
    ),
    history: buildHistory(account, store.settings, now),
  };
}

const round2 = (value) => Math.round(value * 100) / 100;

/** Só aceita chave de semana no formato AAAA-MM-DD e data real. */
function validWeekKey(value) {
  const key = String(value || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) return null;
  const ms = Date.parse(`${key}T00:00:00.000Z`);
  return Number.isFinite(ms) ? { key, start: ms, end: ms + WEEK_MS } : null;
}

function cleanDropItem(raw, previousById = new Map()) {
  const name = String(raw?.name || '').trim().slice(0, 140);
  if (!name) return null;

  const id =
    typeof raw?.id === 'string' && /^[0-9a-f-]{36}$/i.test(raw.id) ? raw.id : randomUUID();
  const prev = previousById.get(id);

  let price = Number(raw?.price);
  let value = Number.isFinite(price) && price > 0 ? Math.min(price, 10_000_000) : 0;
  let pricedAt = typeof raw?.pricedAt === 'string' ? raw.pricedAt : null;

  // Preserva o valor registrado (snapshot da semana) se o cliente não enviou
  // um preço novo/alterado explicitamente.
  if (prev && Number.isFinite(Number(prev.price)) && Number(prev.price) > 0) {
    const same = Math.round(Number(prev.price) * 100) === Math.round(value * 100);
    if (same || value === 0) {
      value = Number(prev.price);
      pricedAt = prev.pricedAt || prev.addedAt || pricedAt;
    }
  }

  return {
    id,
    assetid: String(raw?.assetid || '').slice(0, 40),
    name,
    hash: String(raw?.hash || '').trim().slice(0, 180),
    icon: String(raw?.icon || '').slice(0, 400),
    type: String(raw?.type || '').slice(0, 80),
    rarity: String(raw?.rarity || '').slice(0, 80),
    color: String(raw?.color || '').replace(/[^0-9a-fA-F]/g, '').slice(0, 6),
    price: Math.round(value * 100) / 100,
    pricedAt: pricedAt || new Date().toISOString(),
    source: raw?.source === 'steam' ? 'steam' : 'manual',
    addedAt: prev?.addedAt || new Date().toISOString(),
  };
}

const PRIORITY = { not_dropped: 0, unknown: 1, dropped: 2 };

function buildState() {
  const now = Date.now();
  const week = weekWindow(now, store.settings);
  const accounts = store.accounts
    .map((account) => accountView(account, now))
    .sort((a, b) => {
      const pa = PRIORITY[a.drop.state] ?? 3;
      const pb = PRIORITY[b.drop.state] ?? 3;
      if (pa !== pb) return pa - pb;
      return a.label.localeCompare(b.label, 'pt-BR');
    });

  const counts = { total: accounts.length, dropped: 0, not_dropped: 0, unknown: 0 };
  for (const account of accounts) {
    if (account.drop.state === 'dropped') counts.dropped += 1;
    else if (account.drop.state === 'not_dropped') counts.not_dropped += 1;
    else counts.unknown += 1;
  }

  return {
    now,
    week: { ...week, ruleLabel: describeRule(store.settings) },
    settings: { ...store.settings },
    weekdays: WEEKDAYS,
    counts,
    accounts,
    earnings: buildEarnings(store.accounts, store.settings, now),
    poll: { running: refreshing, lastRunAt, nextRunAt, minutes: store.settings.pollMinutes },
    dataFile: DATA_FILE,
  };
}

// ---------------------------------------------------------------------------
// Atualização dos inventários
// ---------------------------------------------------------------------------

function describeFailure(code) {
  switch (code) {
    case 'private':
      return 'private';
    case 'ratelimit':
      return 'ratelimit';
    case 'network':
    case 'http':
    case 'steam':
    case 'parse':
    case 'notfound':
      return 'error';
    default:
      return 'error';
  }
}

async function refreshAccount(account, { force = false } = {}) {
  if (!force && account.lastAttemptAt && Date.now() - Date.parse(account.lastAttemptAt) < RECHECK_COOLDOWN_MS) {
    return { skipped: true };
  }

  account.lastAttemptAt = new Date().toISOString();

  try {
    const assets = await fetchInventory(account.steamId);
    const { added, isBaseline } = applySnapshot(account, assets, Date.now());
    account.status = {
      state: 'ok',
      message: isBaseline
        ? 'Linha de base criada. A partir de agora itens novos contam como drop.'
        : '',
      at: new Date().toISOString(),
    };
    if (added > 0) console.log(`[drop] ${account.label}: ${added} item(ns) novo(s).`);
    return { added, isBaseline };
  } catch (err) {
    const code = err instanceof SteamError ? err.code : 'error';
    account.status = {
      state: describeFailure(code),
      message: err.message || 'Erro desconhecido ao ler o inventário.',
      at: new Date().toISOString(),
    };
    console.warn(`[drop] ${account.label}: ${err.message}`);
    return { error: err.message };
  } finally {
    await store.save();
  }
}

async function refreshAll({ force = false } = {}) {
  if (refreshing) return { busy: true, refreshed: 0 };
  refreshing = true;
  broadcast();

  let refreshed = 0;
  try {
    const accounts = [...store.accounts];
    for (let i = 0; i < accounts.length; i += 1) {
      const result = await refreshAccount(accounts[i], { force });
      if (!result.skipped) refreshed += 1;
      if (i < accounts.length - 1) await sleep(1500);
      broadcast();
    }
    lastRunAt = new Date().toISOString();
  } finally {
    refreshing = false;
    await store.flush();
    schedulePoll();
    broadcast();
  }

  return { refreshed };
}

function schedulePoll() {
  if (pollTimer) clearTimeout(pollTimer);
  const minutes = Math.min(
    MAX_POLL_MINUTES,
    Math.max(MIN_POLL_MINUTES, Number(store.settings.pollMinutes) || 180),
  );
  nextRunAt = Date.now() + minutes * 60_000;
  pollTimer = setTimeout(async () => {
    console.log(`[poll] atualizando ${store.accounts.length} conta(s)...`);
    await refreshAll({ force: true });
  }, minutes * 60_000);
  if (pollTimer.unref) pollTimer.unref();
}

function broadcast() {
  if (sseClients.size === 0) return;
  const payload = `data: ${JSON.stringify({ type: 'changed', at: Date.now() })}\n\n`;
  for (const res of sseClients) {
    try {
      res.write(payload);
    } catch {
      sseClients.delete(res);
    }
  }
}

// ---------------------------------------------------------------------------
// HTTP helpers
// ---------------------------------------------------------------------------

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
};

function sendJson(res, statusCode, body) {
  const payload = JSON.stringify(body);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  res.end(payload);
}

function sendError(res, statusCode, message) {
  sendJson(res, statusCode, { error: message });
}

async function readJson(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 100_000) throw new Error('Corpo da requisição grande demais.');
    chunks.push(chunk);
  }
  if (chunks.length === 0) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new Error('JSON inválido.');
  }
}

async function serveStatic(pathname, res) {
  const rel = pathname === '/' ? '/index.html' : decodeURIComponent(pathname);
  const safeRel = normalize(rel).replace(/^([/\\])+/, '');
  const filePath = join(PUBLIC_DIR, safeRel);

  if (!filePath.startsWith(PUBLIC_DIR + sep) && filePath !== join(PUBLIC_DIR, 'index.html')) {
    res.writeHead(403).end('Forbidden');
    return;
  }

  try {
    const body = await readFile(filePath);
    const type = MIME[extname(filePath).toLowerCase()] || 'application/octet-stream';
    res.writeHead(200, {
      'Content-Type': type,
      'Cache-Control': extname(filePath) === '.html' ? 'no-store' : 'no-cache',
    });
    res.end(body);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Not found');
  }
}

// ---------------------------------------------------------------------------
// Rotas da API
// ---------------------------------------------------------------------------

function handleEvents(req, res) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
  });
  res.write(`retry: 3000\n\n`);
  sseClients.add(res);

  const heartbeat = setInterval(() => {
    try {
      res.write(': ping\n\n');
    } catch {
      /* ignore */
    }
  }, 25_000);
  if (heartbeat.unref) heartbeat.unref();

  req.on('close', () => {
    clearInterval(heartbeat);
    sseClients.delete(res);
  });
}

async function handleApi(req, res, url) {
  const { pathname } = url;
  const method = req.method || 'GET';

  if (method === 'GET' && pathname === '/api/state') {
    sendJson(res, 200, buildState());
    return true;
  }

  if (method === 'GET' && pathname === '/api/events') {
    handleEvents(req, res);
    return true;
  }

  if (method === 'POST' && pathname === '/api/refresh') {
    const result = await refreshAll({ force: true });
    sendJson(res, 200, { ...result, state: buildState() });
    return true;
  }

  if (method === 'PATCH' && pathname === '/api/settings') {
    const body = await readJson(req);
    const rule = normalizeRule({
      resetWeekday: body.resetWeekday ?? store.settings.resetWeekday,
      resetHour: body.resetHour ?? store.settings.resetHour,
      resetMinute: body.resetMinute ?? store.settings.resetMinute,
    });
    store.settings.resetWeekday = rule.weekday;
    store.settings.resetHour = rule.hour;
    store.settings.resetMinute = rule.minute;

    if (body.pollMinutes !== undefined) {
      const minutes = Number(body.pollMinutes);
      if (!Number.isFinite(minutes)) throw new Error('pollMinutes inválido.');
      store.settings.pollMinutes = Math.min(MAX_POLL_MINUTES, Math.max(MIN_POLL_MINUTES, Math.round(minutes)));
    }

    await store.save();
    schedulePoll();
    broadcast();
    sendJson(res, 200, { state: buildState() });
    return true;
  }

  if (method === 'POST' && pathname === '/api/accounts') {
    const body = await readJson(req);
    const profile = await resolveProfile(body.input);
    if (store.accounts.some((a) => a.steamId === profile.steamId)) {
      sendError(res, 409, 'Essa conta já está na lista.');
      return true;
    }

    const account = {
      id: randomUUID(),
      steamId: profile.steamId,
      label: String(body.label || '').trim() || profile.name || `Conta ${profile.steamId.slice(-4)}`,
      avatar: profile.avatar || '',
      note: '',
      ranking: '',
      statsUrl: '',
      addedAt: new Date().toISOString(),
      baselineAt: null,
      lastCheckedAt: null,
      lastAttemptAt: null,
      itemCount: null,
      items: {},
      manual: {},
      status: { state: 'never', message: '', at: null },
    };

    store.accounts.push(account);
    await store.save();
    await refreshAccount(account, { force: true });
    broadcast();
    sendJson(res, 201, { account: accountView(account, Date.now()), state: buildState() });
    return true;
  }

  if (method === 'POST' && pathname === '/api/prices') {
    const body = await readJson(req);
    const names = Array.isArray(body.names) ? body.names.slice(0, 30) : [];
    const found = await prices.getMany(names, { max: 30 });
    sendJson(res, 200, { prices: found });
    return true;
  }

  if (method === 'GET' && pathname === '/api/prices/search') {
    const q = String(url.searchParams.get('q') || '').trim();
    if (q.length < 2) {
      sendJson(res, 200, { results: [], total: 0 });
      return true;
    }
    const result = await prices.search(q, { limit: 8 });
    sendJson(res, 200, result);
    return true;
  }

  // Atualiza preços de todos os itens relevantes (registrados + inventários).
  // Usado ao abrir o painel: roda em segundo plano e devolve logo.
  if (method === 'POST' && pathname === '/api/prices/refresh') {
    const names = new Set();
    for (const account of store.accounts) {
      for (const list of Object.values(account.drops || {})) {
        if (!Array.isArray(list)) continue;
        for (const item of list) if (item?.hash) names.add(item.hash);
      }
      for (const item of Object.values(account.items || {})) {
        if (item?.h) names.add(item.h);
      }
    }
    const all = [...names].slice(0, 400);
    // Dispara em segundo plano para não travar a abertura do painel.
    (async () => {
      try {
        await prices.getMany(all, { max: 400 });
        broadcast();
      } catch (err) {
        console.warn('[prices] refresh em segundo plano falhou:', err.message);
      }
    })();
    sendJson(res, 202, { queued: all.length });
    return true;
  }

  if (method === 'GET' && pathname === '/api/earnings') {
    sendJson(res, 200, buildEarnings(store.accounts, store.settings, Date.now()));
    return true;
  }

  /* itens registrados como drop de uma semana */
  const dropsMatch = pathname.match(
    /^\/api\/accounts\/([0-9a-f-]{36})\/drops(?:\/(\d{4}-\d{2}-\d{2})(?:\/([A-Za-z0-9-]{1,64}))?)?$/,
  );
  if (dropsMatch) {
    const account = store.accounts.find((a) => a.id === dropsMatch[1]);
    if (!account) {
      sendError(res, 404, 'Conta não encontrada.');
      return true;
    }
    if (!account.drops) account.drops = {};

    if (method === 'POST' && !dropsMatch[2]) {
      const body = await readJson(req);
      const week = validWeekKey(body.week);
      if (!week) {
        sendError(res, 400, 'Semana inválida.');
        return true;
      }
      if (!Array.isArray(body.items)) {
        sendError(res, 400, 'Lista de itens inválida.');
        return true;
      }
      if (body.items.length > 200) {
        sendError(res, 400, 'Muitos itens de uma vez (máximo 200).');
        return true;
      }

      const previous = Array.isArray(account.drops[week.key]) ? account.drops[week.key] : [];
      const previousById = new Map(previous.map((item) => [item.id, item]));
      const items = body.items.map((raw) => cleanDropItem(raw, previousById)).filter(Boolean);
      account.manual = account.manual || {};

      if (items.length === 0) {
        delete account.drops[week.key];
        delete account.manual[week.key];
      } else {
        account.drops[week.key] = items;
        account.manual[week.key] = 'dropped';
      }

      await store.save();
      broadcast();
      sendJson(res, 200, { account: accountView(account, Date.now()), state: buildState() });
      return true;
    }

    if (method === 'DELETE' && dropsMatch[2]) {
      const week = validWeekKey(dropsMatch[2]);
      if (!week) {
        sendError(res, 400, 'Semana inválida.');
        return true;
      }

      const itemId = dropsMatch[3] || null;
      const list = account.drops[week.key] || [];

      if (itemId) {
        const rest = list.filter((item) => item.id !== itemId);
        if (rest.length === list.length) {
          sendError(res, 404, 'Item não encontrado.');
          return true;
        }
        if (rest.length > 0) {
          account.drops[week.key] = rest;
        } else {
          delete account.drops[week.key];
          if (account.manual) delete account.manual[week.key];
        }
      } else {
        delete account.drops[week.key];
        if (account.manual) delete account.manual[week.key];
      }

      await store.save();
      broadcast();
      sendJson(res, 200, { state: buildState() });
      return true;
    }

    sendError(res, 400, 'Requisição não suportada.');
    return true;
  }

  const accountMatch = pathname.match(/^\/api\/accounts\/([0-9a-f-]{36})(\/[a-z-]+)?$/);
  if (accountMatch) {
    const account = store.accounts.find((a) => a.id === accountMatch[1]);
    if (!account) {
      sendError(res, 404, 'Conta não encontrada.');
      return true;
    }
    const action = accountMatch[2] || '';

    if (method === 'POST' && action === '/candidates') {
      const body = await readJson(req);
      const week = validWeekKey(body.week) || validWeekKey(weekWindow(Date.now(), store.settings).key);
      const list = body.all ? allItems(account) : newItemsBetween(account, week.start, week.end);
      const cached = prices.peekMany(list.map((item) => item.hash).filter(Boolean));

      sendJson(res, 200, {
        week: week.key,
        mode: body.all ? 'all' : 'week',
        items: list.map((item) => {
          const quote = item.hash ? cached[item.hash] : null;
          return {
            ...item,
            price: quote?.ok ? quote.low : null,
            median: quote?.ok ? quote.median : null,
            pricedAt: quote?.at || null,
          };
        }),
        recorded: account.drops?.[week.key] || [],
      });
      return true;
    }

    if (method === 'DELETE' && action === '') {
      store.data.accounts = store.accounts.filter((a) => a.id !== account.id);
      await store.save();
      broadcast();
      sendJson(res, 200, { ok: true, state: buildState() });
      return true;
    }

    if (method === 'PATCH' && action === '') {
      const body = await readJson(req);
      if (body.label !== undefined) {
        const label = String(body.label).trim().slice(0, 60);
        if (!label) throw new Error('O apelido não pode ficar vazio.');
        account.label = label;
      }
      if (body.note !== undefined) account.note = String(body.note).slice(0, 300);
      if (body.ranking !== undefined) account.ranking = String(body.ranking).trim().slice(0, 40);
      if (body.statsUrl !== undefined) {
        const url = String(body.statsUrl).trim();
        account.statsUrl = /^https?:\/\//i.test(url) ? url.slice(0, 300) : '';
      }
      await store.save();
      broadcast();
      sendJson(res, 200, { account: accountView(account, Date.now()), state: buildState() });
      return true;
    }

    if (method === 'POST' && action === '/refresh') {
      await refreshAccount(account, { force: true });
      broadcast();
      sendJson(res, 200, { account: accountView(account, Date.now()), state: buildState() });
      return true;
    }

    if (method === 'POST' && action === '/mark') {
      const body = await readJson(req);
      const week = weekWindow(Date.now(), store.settings);
      const key = typeof body.week === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(body.week) ? body.week : week.key;
      account.manual = account.manual || {};

      if (body.state === 'dropped' || body.state === 'not_dropped') {
        account.manual[key] = body.state;
        // "Não dropou" é incompatível com itens registrados naquela semana.
        if (body.state === 'not_dropped' && account.drops) delete account.drops[key];
      } else {
        delete account.manual[key];
        // "desfazer" remove também os itens registrados daquela semana.
        if (account.drops) delete account.drops[key];
      }

      await store.save();
      broadcast();
      sendJson(res, 200, { account: accountView(account, Date.now()), state: buildState() });
      return true;
    }

    if (method === 'POST' && action === '/rebaseline') {
      account.items = {};
      account.baselineAt = null;
      account.itemCount = null;
      account.status = { state: 'never', message: 'Linha de base será recriada na próxima leitura.', at: null };
      account.lastCheckedAt = null;
      account.lastAttemptAt = null;
      await store.save();
      await refreshAccount(account, { force: true });
      broadcast();
      sendJson(res, 200, { account: accountView(account, Date.now()), state: buildState() });
      return true;
    }
  }

  return false;
}

// ---------------------------------------------------------------------------
// Servidor
// ---------------------------------------------------------------------------

const server = createServer(async (req, res) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader('Content-Security-Policy', "default-src 'self'; img-src 'self' https: data:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self' https://steamcommunity.com https://*.steamstatic.com; frame-ancestors 'none'");

  const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);

  try {
    if (url.pathname.startsWith('/api/')) {
      const handled = await handleApi(req, res, url);
      if (!handled) sendError(res, 404, 'Rota não encontrada.');
      return;
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      sendError(res, 405, 'Método não permitido.');
      return;
    }
    await serveStatic(url.pathname, res);
  } catch (err) {
    if (err instanceof SteamError) {
      sendError(res, 400, err.message);
    } else {
      console.error('[server] erro interno (detalhes omitidos ao cliente):', err?.message || err);
      if (!res.headersSent) sendError(res, 500, 'Erro interno do servidor.');
    }
  }
});

async function main() {
  await store.load();
  await prices.load();
  console.log(`[store] dados em ${DATA_FILE}`);
  console.log(`[rule] reset semanal: ${describeRule(store.settings)}`);
  console.log(`[rule] atualização automática a cada ${store.settings.pollMinutes} min`);

  server.listen(PORT, () => {
    console.log('');
    console.log('  Drop Tracker CS2');
    console.log(`  → http://localhost:${PORT}`);
    console.log('');
    if (store.accounts.length === 0) {
      console.log('  Nenhuma conta ainda. Adicione pelo botão "+ Adicionar conta".');
      console.log('');
    }
  });

  if (store.accounts.length > 0) {
    setTimeout(() => {
      refreshAll({ force: false }).catch((err) => console.error('[poll] falhou:', err.message));
    }, 1500);
  }

  // Atualiza preços relevantes em segundo plano ao iniciar o app.
  const allNames = new Set();
  for (const account of store.accounts) {
    for (const list of Object.values(account.drops || {})) {
      if (!Array.isArray(list)) continue;
      for (const item of list) if (item?.hash) allNames.add(item.hash);
    }
    for (const item of Object.values(account.items || {})) {
      if (item?.h) allNames.add(item.h);
    }
  }
  if (allNames.size > 0) {
    const names = [...allNames].slice(0, 400);
    setTimeout(() => {
      prices.getMany(names, { max: 400 }).then(() => broadcast()).catch((err) => {
        console.warn('[prices] refresh inicial falhou:', err.message);
      });
    }, 4000);
  }

  schedulePoll();
}

let closing = false;
async function shutdown() {
  if (closing) return;
  closing = true;
  console.log('\n[server] salvando e saindo...');
  clearTimeout(pollTimer);
  for (const res of sseClients) {
    try {
      res.end();
    } catch {
      /* ignore */
    }
  }
  server.close();
  await store.flush();
  process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

main().catch((err) => {
  console.error('Falha ao iniciar:', err);
  process.exit(1);
});
