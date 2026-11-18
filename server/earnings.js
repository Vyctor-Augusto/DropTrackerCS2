/**
 * Agrega os itens registrados como drop em totais por semana, mês e ano.
 *
 * A semana é a unidade do drop (mesma chave usada pelo resto do app), então o
 * mês/ano de um item é o mês/ano em que a semana dele começou. É por isso que
 * um drop de terça de manhã continua no mesmo "mês" que o resto daquela semana.
 */

import { WEEK_MS, weekKey, weekStart } from './week.js';

const round2 = (value) => Math.round(value * 100) / 100;

export function buildEarnings(accounts, settings, nowMs = Date.now()) {
  const weeks = new Map();
  let total = 0;
  let itemCount = 0;

  for (const account of accounts) {
    const drops = account.drops || {};
    for (const [key, list] of Object.entries(drops)) {
      if (!Array.isArray(list) || list.length === 0) continue;
      const start = Date.parse(`${key}T00:00:00.000Z`);
      if (!Number.isFinite(start)) continue;

      let bucket = weeks.get(key);
      if (!bucket) {
        bucket = { key, start, end: start + WEEK_MS, total: 0, itemCount: 0, items: [] };
        weeks.set(key, bucket);
      }

      for (const item of list) {
        const price = Number(item.price);
        const safePrice = Number.isFinite(price) && price > 0 ? price : 0;
        bucket.total += safePrice;
        bucket.itemCount += 1;
        bucket.items.push({
          id: item.id,
          assetid: item.assetid || '',
          name: item.name || 'Item',
          hash: item.hash || '',
          icon: item.icon || '',
          rarity: item.rarity || '',
          color: item.color || '',
          type: item.type || '',
          price: round2(safePrice),
          source: item.source || 'manual',
          addedAt: item.addedAt || null,
          accountId: account.id,
          accountLabel: account.label,
          weekKey: key,
          weekStart: start,
        });
        total += safePrice;
        itemCount += 1;
      }
    }
  }

  const weekList = [...weeks.values()]
    .map((week) => ({ ...week, total: round2(week.total) }))
    .sort((a, b) => b.start - a.start);

  const months = new Map();
  const years = new Map();
  for (const week of weekList) {
    const date = new Date(week.start);
    const monthKey = `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
    const yearKey = String(date.getUTCFullYear());

    const month = months.get(monthKey) || { key: monthKey, total: 0, itemCount: 0, weeks: 0 };
    month.total += week.total;
    month.itemCount += week.itemCount;
    month.weeks += 1;
    months.set(monthKey, month);

    const year = years.get(yearKey) || { key: yearKey, total: 0, itemCount: 0, weeks: 0 };
    year.total += week.total;
    year.itemCount += week.itemCount;
    year.weeks += 1;
    years.set(yearKey, year);
  }

  const currentWeek = weekKey(weekStart(nowMs, settings));
  const nowDate = new Date(nowMs);
  const currentMonth = `${nowDate.getUTCFullYear()}-${String(nowDate.getUTCMonth() + 1).padStart(2, '0')}`;
  const currentYear = String(nowDate.getUTCFullYear());

  const monthList = [...months.values()].map((m) => ({ ...m, total: round2(m.total) }));
  const yearList = [...years.values()].map((y) => ({ ...y, total: round2(y.total) }));

  return {
    weeks: weekList,
    months: monthList,
    years: yearList,
    total: round2(total),
    itemCount,
    thisWeek: weekList.find((w) => w.key === currentWeek)?.total || 0,
    thisMonth: monthList.find((m) => m.key === currentMonth)?.total || 0,
    thisYear: yearList.find((y) => y.key === currentYear)?.total || 0,
    currentWeek,
  };
}
