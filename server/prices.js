/**
 * Preços do Mercado da Comunidade Steam, em reais, sem API key.
 *
 * Usa o endpoint público `market/priceoverview` (appid 730, moeda 7 = BRL).
 * Ele é bem limitado: por isso as consultas são enfileiradas com um intervalo
 * mínimo entre elas, e o resultado fica em cache em `data/prices.json`
 * (6 h quando deu certo, 8 min quando falhou, para não insistir à toa).
 *
 * Preço guardado: `low` (menor anúncio, o que você conseguiria hoje) e
 * `median` (mediana dos últimos dias). Quem decide qual usar é a interface.
 */

import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

const CURRENCY = 7; // BRL no priceoverview
const TTL_MS = 6 * 60 * 60 * 1000;
const FAIL_TTL_MS = 8 * 60 * 1000;
const GAP_MS = 550; // intervalo entre duas consultas à Steam
const TIMEOUT_MS = 8000;
const SEARCH_TIMEOUT_MS = 10000;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * "R$ 1.234,56" -> 1234.56 | "R$ 1,09" -> 1.09 | "R$ 12" -> 12
 * Devolve null quando não há número.
 */
export function parsePrice(text) {
  if (text === null || text === undefined) return null;
  const clean = String(text).replace(/\u00a0/g, ' ').trim();
  const match = clean.match(/(\d[\d.\s]*)(?:,(\d{1,2}))?/);
  if (!match) return null;
  const whole = match[1].replace(/[.\s]/g, '');
  const cents = match[2] ? match[2].padEnd(2, '0') : '00';
  const value = Number(`${whole}.${cents}`);
  return Number.isFinite(value) ? value : null;
}

export class PriceBook {
  constructor(file) {
    this.file = file;
    this.data = {};
    this.queue = Promise.resolve();
    this.lastAt = 0;
    this.saveTimer = null;
    this.saving = Promise.resolve();
  }

  async load() {
    try {
      const raw = await readFile(this.file, 'utf8');
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) this.data = parsed;
    } catch (err) {
      if (err.code !== 'ENOENT') console.warn(`[prices] não consegui ler ${this.file}: ${err.message}`);
    }
  }

  /** Entrada ainda válida do cache, ou null. */
  cached(name) {
    const entry = this.data[name];
    if (!entry || !entry.at) return null;
    const age = Date.now() - Date.parse(entry.at);
    const ttl = entry.ok ? TTL_MS : FAIL_TTL_MS;
    return Number.isFinite(age) && age >= 0 && age < ttl ? entry : null;
  }

  async quote(name) {
    const url =
      'https://steamcommunity.com/market/priceoverview/?appid=730' +
      `&currency=${CURRENCY}&market_hash_name=${encodeURIComponent(name)}`;

    let res;
    try {
      res = await fetch(url, {
        headers: { 'User-Agent': UA, Accept: 'application/json', 'Accept-Language': 'pt-BR,pt;q=0.9' },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (err) {
      return { ok: false, error: 'network', message: err.message, at: new Date().toISOString() };
    }

    const at = new Date().toISOString();
    if (res.status === 429) return { ok: false, error: 'ratelimit', at };
    if (!res.ok) return { ok: false, error: `http ${res.status}`, at };

    let data = null;
    try {
      data = await res.json();
    } catch {
      return { ok: false, error: 'parse', at };
    }

    const low = parsePrice(data?.lowest_price);
    const median = parsePrice(data?.median_price);
    if (low === null && median === null) return { ok: false, error: 'sem preço', at };

    const volume = Number(String(data?.volume || '').replace(/[^\d]/g, ''));

    return {
      ok: true,
      low: low ?? median,
      median: median ?? low,
      volume: Number.isFinite(volume) && volume > 0 ? volume : null,
      at,
    };
  }

  /** Consulta UM nome, entrando na fila global (respeita o intervalo). */
  refresh(name) {
    this.queue = this.queue.then(async () => {
      const wait = GAP_MS - (Date.now() - this.lastAt);
      if (wait > 0) await sleep(wait);
      this.lastAt = Date.now();

      const entry = await this.quote(name);
      this.data[name] = entry;
      this.persist();
      return entry;
    });
    return this.queue;
  }

  /** Devolve { nome: entrada } usando cache e buscando só o que falta/expirou. */
  async getMany(names, { max = 25 } = {}) {
    const unique = [...new Set((names || []).filter((n) => typeof n === 'string' && n.trim()))].slice(
      0,
      max,
    );

    const result = {};
    const missing = [];
    for (const name of unique) {
      const hit = this.cached(name);
      if (hit) result[name] = hit;
      else missing.push(name);
    }

    for (const name of missing) {
      result[name] = await this.refresh(name);
    }

    return result;
  }

  /** Só o que já está em cache (nunca fala com a Steam). */
  peekMany(names) {
    const result = {};
    for (const name of names || []) {
      const hit = this.cached(name);
      if (hit) result[name] = hit;
    }
    return result;
  }

  /**
   * Busca itens no Mercado da Comunidade (CS2) pelo nome.
   * Retorna resultados com hash/nome/ícone e, quando possível, preço em BRL
   * (do cache ou consultado via priceoverview para os primeiros resultados).
   */
  async search(query, { limit = 8 } = {}) {
    const q = String(query || '').trim();
    if (q.length < 2) return { results: [], total: 0 };

    const url =
      'https://steamcommunity.com/market/search/render/?norender=1&appid=730' +
      `&start=0&count=${Math.max(1, Math.min(20, limit))}` +
      `&query=${encodeURIComponent(q)}`;

    let res;
    try {
      res = await fetch(url, {
        headers: { 'User-Agent': UA, Accept: 'application/json', 'Accept-Language': 'pt-BR,pt;q=0.9' },
        signal: AbortSignal.timeout(SEARCH_TIMEOUT_MS),
      });
    } catch (err) {
      throw new Error(`Falha ao buscar na Steam: ${err.message}`);
    }
    if (!res.ok) throw new Error(`Busca na Steam falhou (HTTP ${res.status}).`);

    let data = null;
    try {
      data = await res.json();
    } catch {
      throw new Error('Resposta inválida da busca na Steam.');
    }
    if (!data?.success) throw new Error('A busca na Steam não retornou resultados válidos.');

    const raw = Array.isArray(data.results) ? data.results.slice(0, limit) : [];
    const results = raw.map((item) => {
      const desc = item.asset_description || {};
      const hash = item.hash_name || desc.market_hash_name || '';
      const color = String(desc.name_color || '').replace(/^#/, '');
      return {
        hash,
        name: hash || desc.market_name || item.name || 'Item',
        icon: desc.icon_url || '',
        type: desc.type || '',
        rarity: '',
        color,
      };
    }).filter((item) => item.hash);

    // Enriquece com preço em BRL (cache/consulta) para os resultados.
    const names = results.map((r) => r.hash);
    const priced = await this.getMany(names, { max: Math.min(10, names.length) });
    for (const item of results) {
      const qte = priced[item.hash];
      if (qte?.ok) {
        item.price = qte.low;
        item.median = qte.median;
        item.pricedAt = qte.at;
      } else {
        item.price = null;
      }
    }

    return { results, total: Number(data.total_count) || results.length };
  }

  persist() {
    clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => {
      const payload = JSON.stringify(this.data, null, 2);
      this.saving = this.saving
        .then(async () => {
          await mkdir(dirname(this.file), { recursive: true });
          const tmp = `${this.file}.tmp`;
          await writeFile(tmp, payload, 'utf8');
          await rename(tmp, this.file);
        })
        .catch((err) => console.error('[prices] falha ao salvar:', err.message));
    }, 400);
    if (this.saveTimer.unref) this.saveTimer.unref();
  }
}
