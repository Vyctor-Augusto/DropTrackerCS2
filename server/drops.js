/**
 * Regra de detecção do drop.
 *
 * Ideia: guardamos o primeiro "avistamento" de cada assetid do inventário.
 * Quando aparece um assetid que a gente nunca viu, isso é item novo. Se ele
 * apareceu depois do início da semana de reset, então aquela conta dropou.
 *
 * O primeiro snapshot de uma conta é a "linha de base": tudo que já estava lá
 * não conta como drop (não dá para saber quando chegou). Nessa primeira semana
 * o estado fica "indefinido" e o botão manual resolve.
 */

import { WEEK_MS, weekStart, weekKey } from './week.js';

const MAX_ITEMS = 4000;

export function applySnapshot(account, assets, nowMs) {
  const nowIso = new Date(nowMs).toISOString();
  const isBaseline = !account.baselineAt;
  if (isBaseline) account.baselineAt = nowIso;

  const items = account.items || (account.items = {});
  let added = 0;

  for (const asset of assets) {
    const existing = items[asset.assetid];
    if (existing) {
      // Mantém nome/ícone/dados de mercado atualizados, mas preserva o
      // primeiro avistamento.
      existing.n = asset.name;
      existing.i = asset.icon;
      if (asset.hash) existing.h = asset.hash;
      if (asset.type) existing.y = asset.type;
      if (asset.rarity) existing.r = asset.rarity;
      if (asset.color) existing.c = asset.color;
      continue;
    }
    items[asset.assetid] = {
      n: asset.name,
      i: asset.icon,
      t: nowIso,
      b: isBaseline ? 1 : 0,
      h: asset.hash || '',
      y: asset.type || '',
      r: asset.rarity || '',
      c: asset.color || '',
    };
    if (!isBaseline) added += 1;
  }

  account.itemCount = assets.length;
  account.lastCheckedAt = nowIso;
  pruneItems(account);
  return { added, isBaseline };
}

function pruneItems(account) {
  const items = account.items || {};
  const entries = Object.entries(items);
  if (entries.length <= MAX_ITEMS) return;

  entries.sort((a, b) => Date.parse(b[1].t) - Date.parse(a[1].t));
  const kept = entries.slice(0, MAX_ITEMS);
  account.items = Object.fromEntries(kept);
}

export function newItemsBetween(account, startMs, endMs) {
  const out = [];
  for (const [assetid, item] of Object.entries(account.items || {})) {
    if (item.b) continue;
    const at = Date.parse(item.t);
    if (at >= startMs && at < endMs) {
      out.push({
        assetid,
        name: item.n,
        icon: item.i,
        hash: item.h || '',
        type: item.y || '',
        rarity: item.r || '',
        color: item.c || '',
        at: new Date(at).toISOString(),
      });
    }
  }
  out.sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  return out;
}

/** Todos os itens do inventário (inclusive os da linha de base), para escolher na mão. */
export function allItems(account) {
  const out = [];
  for (const [assetid, item] of Object.entries(account.items || {})) {
    out.push({
      assetid,
      name: item.n,
      icon: item.i,
      hash: item.h || '',
      type: item.y || '',
      rarity: item.r || '',
      color: item.c || '',
      at: item.t || null,
      baseline: Boolean(item.b),
    });
  }
  out.sort((a, b) => String(a.name).localeCompare(String(b.name), 'pt-BR'));
  return out;
}

/** Estado do drop da semana atual: 'dropped' | 'not_dropped' | 'unknown'. */
export function computeDropState(account, settings, nowMs = Date.now()) {
  const start = weekStart(nowMs, settings);
  const end = start + WEEK_MS;
  const key = weekKey(start);

  const manual = account.manual?.[key];
  if (manual === 'dropped' || manual === 'not_dropped') {
    return { state: manual, manual: true, items: [], since: null };
  }

  const items = newItemsBetween(account, start, end);
  if (items.length > 0) {
    return { state: 'dropped', manual: false, items, since: items[0].at };
  }

  if (!account.baselineAt) {
    return { state: 'unknown', manual: false, items: [], reason: 'Ainda não lemos esse inventário.' };
  }

  if (Date.parse(account.baselineAt) >= start) {
    return {
      state: 'unknown',
      manual: false,
      items: [],
      reason: 'Conta adicionada nesta semana: a primeira leitura não conta como drop.',
    };
  }

  return { state: 'not_dropped', manual: false, items: [], since: null };
}

/** Últimas N semanas, da mais recente para a mais antiga. */
export function buildHistory(account, settings, nowMs = Date.now(), weeks = 8) {
  const currentStart = weekStart(nowMs, settings);
  const baselineMs = account.baselineAt ? Date.parse(account.baselineAt) : null;
  const result = [];

  for (let i = 0; i < weeks; i += 1) {
    const start = currentStart - i * WEEK_MS;
    const end = start + WEEK_MS;
    const key = weekKey(start);
    const manual = account.manual?.[key];
    const items = newItemsBetween(account, start, end);

    let state = 'unknown';
    if (manual === 'dropped' || manual === 'not_dropped') {
      state = manual;
    } else if (items.length > 0) {
      state = 'dropped';
    } else if (baselineMs !== null && baselineMs < start) {
      state = 'not_dropped';
    }

    result.push({
      key,
      start,
      end,
      current: i === 0,
      state,
      manual: Boolean(manual),
      itemCount: items.length,
    });
  }

  return result;
}
