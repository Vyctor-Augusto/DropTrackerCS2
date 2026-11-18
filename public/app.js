/* Painel do Drop Tracker CS2 — JS puro, sem build. */

const $ = (sel, root = document) => root.querySelector(sel);

let state = null;
let lastWeekKey = null;
let toastTimer = null;

/* ------------------------------------------------------------------ utils */

const esc = (value) =>
  String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

const escAttr = esc;

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

const dateFmt = new Intl.DateTimeFormat('pt-BR', {
  day: '2-digit',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
});

function fmtDate(ms) {
  return dateFmt.format(new Date(ms));
}

function fmtAgo(iso) {
  if (!iso) return 'nunca';
  const diff = Date.now() - Date.parse(iso);
  if (!Number.isFinite(diff)) return 'nunca';
  if (diff < 60_000) return 'agora mesmo';
  const min = Math.floor(diff / 60_000);
  if (min < 60) return `há ${min} min`;
  const hours = Math.floor(min / 60);
  if (hours < 24) return `há ${hours} h`;
  return `há ${Math.floor(hours / 24)} d`;
}

function fmtUntil(ms) {
  if (ms <= 0) return 'agora';
  const totalMin = Math.ceil(ms / 60_000);
  const days = Math.floor(totalMin / 1440);
  const hours = Math.floor((totalMin % 1440) / 60);
  const mins = totalMin % 60;
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${mins}min`;
  return `${mins}min`;
}

function fmtMinutes(minutes) {
  if (minutes >= 1440) return `${Math.round(minutes / 1440)} dia(s)`;
  if (minutes >= 60) return `${Math.round((minutes / 60) * 10) / 10} h`;
  return `${minutes} min`;
}

function fmtWeekKey(key) {
  return `${key.slice(8, 10)}/${key.slice(5, 7)}`;
}

function iconUrl(icon) {
  return `https://community.cloudflare.steamstatic.com/economy/image/${icon}/96fx96f`;
}

function itemIconHtml(icon, { cls = 'item', style = '', alt = '', title = '', text = '?' } = {}) {
  const styleAttr = style ? ` style="${escAttr(style)}"` : '';
  const titleAttr = title ? ` title="${escAttr(title)}"` : '';
  const altAttr = ` alt="${escAttr(alt)}"`;
  if (!icon) return `<div class="${escAttr(cls)} ph"${styleAttr}${titleAttr}>${esc(text)}</div>`;
  const ph = `<div class="${escAttr(cls)} ph hidden"${styleAttr}${titleAttr}>${esc(text)}</div>`;
  const onerr =
    "this.onerror=null;" +
    "const r=+(this.dataset.r||0);" +
    "const hosts=['community.cloudflare.steamstatic.com','community.akamai.steamstatic.com','steamcommunity-a.akamaihd.net'];" +
    "if(r<hosts.length-1){this.dataset.r=r+1;this.src=this.src.replace(hosts[r],hosts[r+1]);}" +
    "else{this.classList.add('hidden');this.nextElementSibling?.classList.remove('hidden');}";
  return `<img class="${escAttr(cls)}" src="${escAttr(iconUrl(icon))}"${altAttr}${titleAttr}${styleAttr} loading="lazy" decoding="async" referrerpolicy="no-referrer" onerror="${escAttr(onerr)}">${ph}`;
}

const brlFmt = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const fmtBRL = (value) => brlFmt.format(Number.isFinite(value) ? value : 0);

function marketUrl(hash) {
  const name = String(hash || '').trim();
  if (!name) return '';
  return `https://steamcommunity.com/market/listings/730/${encodeURIComponent(name)}`;
}

function ratingStyle(text) {
  // CS Rating é inteiro; aceita "15.755", "15,755", "15755" etc.
  const digits = String(text || '').replace(/[^\d]/g, '');
  if (!digits) return { color: '#b0c3d9', bg: 'rgba(176,195,217,0.12)', border: 'rgba(176,195,217,0.28)' };
  const n = Number(digits);
  if (!Number.isFinite(n)) return { color: '#b0c3d9', bg: 'rgba(176,195,217,0.12)', border: 'rgba(176,195,217,0.28)' };
  if (n >= 30000) return { color: '#f1c40f', bg: 'rgba(241,196,15,0.14)', border: 'rgba(241,196,15,0.38)' }; // dourado
  if (n >= 25000) return { color: '#eb4b4b', bg: 'rgba(235,75,75,0.14)', border: 'rgba(235,75,75,0.38)' }; // vermelho
  if (n >= 20000) return { color: '#d32ce6', bg: 'rgba(211,44,230,0.14)', border: 'rgba(211,44,230,0.38)' }; // rosa
  if (n >= 15000) return { color: '#8847ff', bg: 'rgba(136,71,255,0.14)', border: 'rgba(136,71,255,0.38)' }; // roxo
  if (n >= 10000) return { color: '#4b69ff', bg: 'rgba(75,105,255,0.14)', border: 'rgba(75,105,255,0.38)' }; // azul
  if (n >= 5000)  return { color: '#5ec8e5', bg: 'rgba(94,200,229,0.14)', border: 'rgba(94,200,229,0.38)' }; // azul claro
  return { color: '#b0b3b8', bg: 'rgba(176,179,184,0.12)', border: 'rgba(176,179,184,0.28)' }; // cinza
}

function refDate({ resetWeekday, resetHour, resetMinute }) {
  // 2024-01-01 foi uma segunda-feira.
  const d = new Date(Date.UTC(2024, 0, 1, resetHour || 0, resetMinute || 0));
  d.setUTCDate(d.getUTCDate() + (Number(resetWeekday) - 1));
  return d;
}

function tzOffsetLabel() {
  const off = -new Date().getTimezoneOffset();
  const sign = off >= 0 ? '+' : '−';
  const abs = Math.abs(off);
  const h = String(Math.floor(abs / 60)).padStart(2, '0');
  const m = String(abs % 60).padStart(2, '0');
  return `UTC${sign}${h}:${m}`;
}

function localRuleLabel(settings) {
  try {
    return new Intl.DateTimeFormat('pt-BR', {
      weekday: 'long',
      hour: '2-digit',
      minute: '2-digit',
      timeZoneName: 'short',
    }).format(refDate(settings));
  } catch {
    return '';
  }
}

function toast(message, isError = false) {
  const el = $('#toast');
  el.textContent = message;
  el.classList.toggle('error', isError);
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 3800);
}

async function api(path, { method = 'GET', body } = {}) {
  let res;
  try {
    res = await fetch(path, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    markOffline(true);
    throw new Error('Sem conexão com o servidor local. Ele está rodando?');
  }

  let data = null;
  try {
    data = await res.json();
  } catch {
    /* resposta sem JSON */
  }

  if (res.status === 502 || res.status === 503 || res.status === 504) {
    markOffline(true);
    throw new Error(`O servidor local do app está desligado (${res.status}). Rode o iniciar.bat.`);
  }

  if (!res.ok) throw new Error(data?.error || `Erro ${res.status}`);
  markOffline(false);
  return data;
}

let offline = false;

function markOffline(isOffline) {
  offline = isOffline;
  const el = $('#offline');
  if (el) el.classList.toggle('hidden', !isOffline);
}

function setState(next) {
  state = next;
  render();
}

/* ----------------------------------------------------------------- render */

const STATUS_LABEL = { dropped: 'Dropou', not_dropped: 'Falta dropar', unknown: 'Indefinido' };
const STATUS_ALERT = {
  never: 'Sem leitura ainda',
  private: 'Inventário privado',
  ratelimit: 'Steam limitou as consultas',
  error: 'Falha ao ler o inventário',
};

function render() {
  if (!state) return;

  const local = localRuleLabel(state.settings);
  $('#ruleLine').textContent = local
    ? `Reset semanal: ${state.week.ruleLabel} · ${local}`
    : `Reset semanal: ${state.week.ruleLabel}`;

  $('#countPending').textContent = state.counts.not_dropped;
  $('#countDone').textContent = state.counts.dropped;
  $('#countUnknown').textContent = state.counts.unknown;

  $('#busy').classList.toggle('hidden', !state.poll.running);
  $('#btnRefresh').disabled = state.poll.running;

  const pollParts = [`atualiza a cada ${fmtMinutes(state.poll.minutes)}`];
  if (state.poll.lastRunAt) pollParts.push(`última leitura ${fmtAgo(state.poll.lastRunAt)}`);
  $('#pollInfo').textContent = pollParts.join(' · ');

  renderEarnings();

  const grid = $('#accounts');
  const empty = $('#empty');
  empty.classList.toggle('hidden', state.accounts.length > 0);
  grid.classList.toggle('hidden', state.accounts.length === 0);
  grid.innerHTML = state.accounts.map(cardHtml).join('');

  tick();
}

function renderEarnings() {
  const e = state.earnings;
  if (!e) return;
  $('#earnWeek').textContent = fmtBRL(e.thisWeek);
  $('#earnMonth').textContent = fmtBRL(e.thisMonth);
  $('#earnYear').textContent = fmtBRL(e.thisYear);
  $('#earnTotal').textContent = fmtBRL(e.total);

  const top = $('#earningsTop');
  const list = $('#earningsList');
  const hasAccounts = state.accounts.length > 0;
  const hasItems = e.itemCount > 0 || e.weeks.length > 0;

  top.classList.toggle('hidden', !hasAccounts && !hasItems);
  list.classList.toggle('hidden', !hasItems);

  const weeksEl = $('#earnWeeks');
  if (!e.weeks.length) {
    weeksEl.innerHTML = `<p class="muted small" style="margin:0">Nenhum item registrado ainda. Clique em "✓ Dropou" em uma conta para registrar o que caiu.</p>`;
    return;
  }

  weeksEl.innerHTML = e.weeks.slice(0, 12).map((week) => {
    const label = week.key === e.currentWeek ? `${fmtWeekKey(week.key)} (esta semana)` : fmtWeekKey(week.key);
    const items = week.items.map((item) => {
      const icon = itemIconHtml(item.icon, { cls: 'earn-item-icon' });
      const link = item.hash ? `<a href="${escAttr(marketUrl(item.hash))}" target="_blank" rel="noopener">mercado</a>` : '';
      const priceClass = item.price > 0 ? '' : ' zero';
      return `<div class="earn-item">
        ${icon}
        <div class="earn-item-main">
          <div class="earn-item-name" title="${escAttr(item.name)}">${esc(item.name)}</div>
          <div class="earn-item-sub"><span>${esc(item.accountLabel)}</span>${link}</div>
        </div>
        <span class="earn-item-price${priceClass}">${fmtBRL(item.price)}</span>
        <button class="btn sm icon danger" data-action="del-drop" data-account="${escAttr(item.accountId)}" data-week="${escAttr(week.key)}" data-item="${escAttr(item.id)}" title="Remover este item">×</button>
      </div>`;
    }).join('');
    return `<details class="earn-week" ${week.key === e.currentWeek ? 'open' : ''}>
      <summary>
        <span class="earn-week-key">${esc(label)}</span>
        <span class="earn-week-meta">${plural(week.itemCount, 'item', 'itens')}</span>
        <span class="earn-week-value">${fmtBRL(week.total)}</span>
      </summary>
      <div class="earn-items">${items}</div>
    </details>`;
  }).join('');
}

function cardHtml(a) {
  const dropState = a.drop.state;
  const cardClass =
    dropState === 'dropped' ? 'is-dropped' : dropState === 'not_dropped' ? 'is-pending' : '';

  const initials = (a.label || '?').trim().slice(0, 2).toUpperCase();
  const avatar = a.avatar
    ? `<img class="avatar" src="${escAttr(a.avatar)}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.style.display='none'">`
    : `<div class="avatar placeholder">${esc(initials)}</div>`;

  const metaBits = [`<span>${esc(a.steamId)}</span>`];
  if (a.itemCount !== null && a.itemCount !== undefined) {
    metaBits.push(`<span>${plural(a.itemCount, 'item', 'itens')}</span>`);
  }
  if (a.ranking) {
    const rs = ratingStyle(a.ranking);
    const style = `color:${rs.color};background:${rs.bg};border:1px solid ${rs.border};padding:1px 7px;border-radius:999px;font-weight:700;`;
    const inner = `🏆 ${esc(a.ranking)}`;
    const rankLabel = a.statsUrl
      ? `<a href="${escAttr(a.statsUrl)}" target="_blank" rel="noopener" data-stop-menu title="Abrir página de stats" style="${style}">${inner}</a>`
      : `<span title="Ranking (CS Rating)" style="${style}">${inner}</span>`;
    metaBits.push(rankLabel);
  }
  metaBits.push(`<span>lida ${esc(fmtAgo(a.lastCheckedAt))}</span>`);

  let alert = '';
  const statusState = a.status?.state || 'never';
  if (statusState !== 'ok') {
    const isError = statusState === 'private' || statusState === 'error';
    const label = STATUS_ALERT[statusState] || 'Aviso';
    const detail = a.status?.message ? ` ${esc(a.status.message)}` : '';
    alert = `<div class="card-alert ${isError ? 'error' : ''}"><span aria-hidden="true">⚠</span><span><strong>${esc(label)}.</strong>${detail}</span></div>`;
  } else if (dropState === 'unknown' && a.drop.reason) {
    alert = `<div class="card-alert"><span aria-hidden="true">ℹ</span><span>${esc(a.drop.reason)}</span></div>`;
  }

  const weekKeyNow = state.week.key;
  const recorded = (a.drops && a.drops[weekKeyNow]) || [];
  const recordedTotal = recorded.reduce((s, it) => s + (Number(it.price) || 0), 0);

  let items = '';
  const showItems = recorded.length > 0 ? recorded : (a.drop.items || []);
  if (showItems.length > 0) {
    const shown = showItems.slice(0, 5);
    const chips = shown
      .map((item) => itemIconHtml(item.icon, { cls: 'item', alt: item.name, title: item.name, text: (item.name || '?').slice(0, 2) }))
      .join('');
    const more =
      showItems.length > shown.length ? `<div class="item more">+${showItems.length - shown.length}</div>` : '';
    const caption = recorded.length > 0
      ? `${plural(recorded.length, 'item registrado', 'itens registrados')} nesta semana`
      : `${plural(a.drop.items.length, 'item novo', 'itens novos')} detectado(s)`;
    const valueLine = recorded.length > 0
      ? `<span class="card-value"> · estimado ${esc(fmtBRL(recordedTotal))}</span>`
      : '';
    items = `<div class="items"><span class="items-caption">${caption}${valueLine}</span>${chips}${more}</div>`;
  }

  const history = [...a.history]
    .reverse()
    .map((week) => {
      const label = `${fmtWeekKey(week.key)} — ${
        week.state === 'dropped' ? 'dropou' : week.state === 'not_dropped' ? 'não dropou' : 'sem dado'
      }${week.manual ? ' (manual)' : ''}`;
      return `<div class="hist ${week.state}${week.current ? ' current' : ''}" title="${escAttr(label)}"></div>`;
    })
    .join('');

  const manualOn = a.drop.manual;
  const dropBtnLabel = recorded.length > 0 ? `✓ Dropou (${recorded.length})` : '✓ Dropou';

  return `
    <article class="card ${cardClass}">
      <header class="card-head">
        ${avatar}
        <div class="card-id">
          <h3 title="${escAttr(a.label)}">${esc(a.label)}</h3>
          <div class="card-meta">${metaBits.join('<span class="dot">·</span>')}</div>
        </div>
        <span class="badge ${dropState}">${STATUS_LABEL[dropState]}</span>
      </header>

      ${alert}
      ${items}

      <div class="history">
        <span class="h-label">Histórico</span>
        ${history}
      </div>

      <div class="actions">
        <button class="btn sm ok ${manualOn && dropState === 'dropped' ? 'on' : ''}"
                data-action="pick-drop" data-id="${a.id}">${dropBtnLabel}</button>
        <button class="btn sm ${manualOn && dropState === 'not_dropped' ? 'on' : ''}"
                data-action="mark" data-state="not_dropped" data-id="${a.id}">✕ Não dropou</button>
        ${manualOn || recorded.length > 0 ? `<button class="btn sm ghost" data-action="mark" data-state="clear" data-id="${a.id}" title="Remover marcação e itens registrados">desfazer</button>` : ''}
        <span class="spacer"></span>
        <button class="btn sm icon" data-action="refresh" data-id="${a.id}" title="Ler o inventário agora">↻</button>
        <details class="menu">
          <summary title="Mais opções" aria-label="Mais opções">⋯</summary>
          <div class="menu-pop">
            <button data-action="rename" data-id="${a.id}">Renomear</button>
            <button data-action="set-stats" data-id="${a.id}">Definir ranking e link</button>
            <button data-action="open-profile" data-id="${a.id}">Abrir perfil na Steam</button>
            <button data-action="open-leetify" data-id="${a.id}">Ver rating no Leetify</button>
            <button data-action="open-csstats" data-id="${a.id}">Abrir página de stats</button>
            <button data-action="rebaseline" data-id="${a.id}">Recriar linha de base</button>
            <button class="danger" data-action="delete" data-id="${a.id}">Remover conta</button>
          </div>
        </details>
      </div>
    </article>
  `;
}

/* ------------------------------------------------------------------- tick */

function tick() {
  if (offline) refreshState().catch(() => {});
  if (!state) return;

  if (state.week.key !== lastWeekKey) {
    lastWeekKey = state.week.key;
    tick.fired = false;
  }

  const left = state.week.end - Date.now();
  $('#countdown').textContent = left > 0 ? fmtUntil(left) : 'resetando…';
  $('#resetDate').textContent = fmtDate(state.week.end);

  const span = state.week.end - state.week.start;
  const pct = Math.max(0, Math.min(100, ((Date.now() - state.week.start) / span) * 100));
  $('#weekbarFill').style.width = `${pct}%`;

  if (left <= 0 && !tick.fired) {
    tick.fired = true;
    refreshState().catch(() => {});
  }
}

/* ----------------------------------------------------------------- events */

const accountsEl = $('#accounts');

function closeMenus() {
  document.querySelectorAll('details.menu[open]').forEach((d) => {
    d.open = false;
  });
}

document.addEventListener('click', (e) => {
  if (e.target.closest('[data-stop-menu]')) return;
  if (!e.target.closest('.menu')) closeMenus();
});

// Ações de itens registrados (lista de ganhos, fora do grid de contas).
document.addEventListener('click', async (e) => {
  const btn = e.target.closest('[data-action="del-drop"]');
  if (!btn || btn.closest('#accounts')) return;
  const { account: accountId, week, item } = btn.dataset;
  try {
    const res = await api(`/api/accounts/${accountId}/drops/${week}/${item}`, { method: 'DELETE' });
    setState(res.state);
    toast('Item removido.');
  } catch (err) {
    toast(err.message, true);
  }
});

accountsEl.addEventListener('click', async (e) => {
  const btn = e.target.closest('[data-action]');
  if (!btn) return;

  const { action, id, state: wanted } = btn.dataset;
  const account = state?.accounts.find((a) => a.id === id);
  if (!account) return;

  closeMenus();

  try {
    if (action === 'pick-drop') {
      await openDropDialog(account);
      return;
    }

    if (action === 'del-drop') {
      const { week, item } = btn.dataset;
      const res = await api(`/api/accounts/${id}/drops/${week}/${item}`, { method: 'DELETE' });
      setState(res.state);
      toast('Item removido.');
      return;
    }

    if (action === 'mark') {
      const weekKeyNow = state.week.key;
      const recorded = (account.drops && account.drops[weekKeyNow]) || [];
      if (wanted === 'not_dropped' && recorded.length > 0) {
        const ok = window.confirm(
          `"${account.label}" tem ${plural(recorded.length, 'item registrado', 'itens registrados')} nesta semana. Marcar como "não dropou" vai remover esses itens. Continuar?`,
        );
        if (!ok) return;
      }
      if (wanted === 'clear' && recorded.length > 0) {
        const ok = window.confirm(
          `Desfazer vai remover a marcação e os ${plural(recorded.length, 'item registrado', 'itens registrados')} desta semana. Continuar?`,
        );
        if (!ok) return;
      }
      const body = wanted === 'clear' ? { state: null } : { state: wanted };
      const res = await api(`/api/accounts/${id}/mark`, { method: 'POST', body });
      setState(res.state);
      toast(
        wanted === 'clear'
          ? 'Marcação e itens removidos.'
          : wanted === 'not_dropped'
            ? `${account.label}: marcado como não dropou.`
            : `${account.label}: marcação atualizada.`,
      );
      return;
    }

    if (action === 'refresh') {
      btn.disabled = true;
      btn.textContent = '…';
      const res = await api(`/api/accounts/${id}/refresh`, { method: 'POST' });
      setState(res.state);
      const ok = res.account.status?.state === 'ok';
      toast(
        ok
          ? `${res.account.label}: leitura ok (${plural(res.account.itemCount ?? 0, 'item', 'itens')}).`
          : `${res.account.label}: ${res.account.status?.message || 'falha na leitura'}`,
        !ok,
      );
      return;
    }

    if (action === 'rename') {
      const label = window.prompt('Novo apelido para a conta:', account.label);
      if (label === null) return;
      const res = await api(`/api/accounts/${id}`, { method: 'PATCH', body: { label } });
      setState(res.state);
      toast('Apelido atualizado.');
      return;
    }

    if (action === 'open-profile') {
      window.open(account.profileUrl, '_blank', 'noopener');
      return;
    }

    if (action === 'open-leetify') {
      window.open(`https://leetify.com/app/profile/${account.steamId}`, '_blank', 'noopener');
      return;
    }

    if (action === 'open-csstats') {
      const url = account.statsUrl || `https://csstats.gg/player/${account.steamId}`;
      window.open(url, '_blank', 'noopener');
      return;
    }

    if (action === 'set-stats') {
      const ranking = window.prompt(
        'Ranking/CS Rating para exibir (ex.: 15.320, #1234). Deixe vazio para remover:',
        account.ranking || '',
      );
      if (ranking === null) return;
      const statsUrl = window.prompt(
        'Link da página de stats (ex.: CSStats/Leetify). Deixe vazio para usar o padrão:',
        account.statsUrl || '',
      );
      if (statsUrl === null) return;
      const body = { ranking: String(ranking).trim(), statsUrl: String(statsUrl).trim() };
      const res = await api(`/api/accounts/${id}`, { method: 'PATCH', body });
      setState(res.state);
      toast('Ranking e link atualizados.');
      return;
    }

    if (action === 'rebaseline') {
      const ok = window.confirm(
        `Recriar a linha de base de "${account.label}"?\n\nO histórico de itens dessa conta é apagado e a detecção recomeça do zero.`,
      );
      if (!ok) return;
      const res = await api(`/api/accounts/${id}/rebaseline`, { method: 'POST' });
      setState(res.state);
      toast('Linha de base recriada.');
      return;
    }

    if (action === 'delete') {
      const ok = window.confirm(`Remover "${account.label}" da lista?\n\nO histórico dessa conta é apagado.`);
      if (!ok) return;
      const res = await api(`/api/accounts/${id}`, { method: 'DELETE' });
      setState(res.state);
      toast('Conta removida.');
    }
  } catch (err) {
    toast(err.message, true);
  }
});

/* ----------------------------------------------------------- drop picker */

const dialogDrop = $('#dialogDrop');
let dropCtx = null; // { accountId, label, week, candidates: [], selected: Map<key, item> }

function dropKey(item) {
  return item.assetid ? `a:${item.assetid}` : `n:${item.hash || item.name}`;
}

function dropCandidatesView() {
  if (!dropCtx) return [];
  return dropCtx.candidates;
}

function renderDropList() {
  if (!dropCtx) return;
  const list = $('#dropList');
  const items = dropCandidatesView();

  if (!items.length) {
    list.innerHTML = `<div class="drop-empty">${
      $('#chkDropAll').checked
        ? 'Nenhum item encontrado no inventário desta conta.'
        : 'Nenhum item novo detectado nesta semana. Marque "Mostrar todos os itens do inventário" para escolher na mão.'
    }</div>`;
  } else {
    list.innerHTML = items.map((item) => {
      const key = dropKey(item);
      const sel = dropCtx.selected.get(key);
      const checked = sel ? 'checked' : '';
      const rowClass = sel ? 'selected' : '';
      const icon = itemIconHtml(item.icon, { cls: 'earn-item-icon' });
      const rarity = item.rarity
        ? `<span class="rarity-chip" style="${item.color ? `border-color:#${escAttr(item.color)}55;color:#${escAttr(item.color)}` : ''}">${esc(item.rarity)}</span>`
        : '';
      const type = item.type ? `<span>${esc(item.type)}</span>` : '';
      const priceVal = sel && Number.isFinite(sel.price) && sel.price > 0 ? String(sel.price).replace('.', ',') : '';
      const hint = item.price != null ? `sug.: ${fmtBRL(item.price)}` : '';
      return `<label class="drop-row ${rowClass}" data-key="${escAttr(key)}">
        <input type="checkbox" class="drop-check" data-key="${escAttr(key)}" ${checked} />
        ${icon}
        <div class="drop-row-main">
          <div class="drop-row-name" title="${escAttr(item.name)}">${esc(item.name)}</div>
          <div class="drop-row-sub">${rarity}${type}</div>
        </div>
        <input type="text" class="drop-price" inputmode="decimal" placeholder="R$ 0,00" data-key="${escAttr(key)}" value="${escAttr(priceVal)}" ${sel ? '' : 'disabled'} />
        <div class="drop-price-hint" data-hint="${escAttr(key)}">${esc(hint)}</div>
      </label>`;
    }).join('');
  }

  updateDropTotals();
}

function updateDropTotals() {
  if (!dropCtx) return;
  let count = 0;
  let total = 0;
  for (const item of dropCtx.selected.values()) {
    count += 1;
    total += Number(item.price) || 0;
  }
  $('#dropSelectedCount').textContent = String(count);
  $('#dropSelectedTotal').textContent = fmtBRL(total);
}

function parseBRLInput(text) {
  const clean = String(text || '').replace(/\u00a0/g, ' ').trim();
  if (!clean) return 0;
  // aceita "1.234,56" e "1234.56" e "12"
  const normalized = clean.replace(/[R$\s]/g, '');
  let value;
  if (normalized.includes(',')) {
    value = Number(normalized.replace(/\./g, '').replace(',', '.'));
  } else {
    value = Number(normalized);
  }
  return Number.isFinite(value) && value > 0 ? Math.round(value * 100) / 100 : 0;
}

function syncSelectedFromRow(key) {
  const row = $(`.drop-row[data-key="${CSS.escape(key)}"]`, dialogDrop);
  const check = $(`.drop-check[data-key="${CSS.escape(key)}"]`, dialogDrop);
  const priceInput = $(`.drop-price[data-key="${CSS.escape(key)}"]`, dialogDrop);
  if (!row || !check || !dropCtx) return;
  const candidate = dropCtx.candidates.find((c) => dropKey(c) === key);
  if (!candidate) return;

  if (check.checked) {
    const prev = dropCtx.selected.get(key) || {};
    const typed = parseBRLInput(priceInput.value);
    dropCtx.selected.set(key, {
      ...candidate,
      id: prev.id || candidate.recordId || undefined,
      recordId: prev.recordId || candidate.recordId || undefined,
      snapshot: Boolean(prev.snapshot || candidate.recordId),
      pricedAt: prev.pricedAt || candidate.pricedAt || null,
      price: typed || (Number(prev.price) || 0) || (Number(candidate.price) || 0),
      source: typed ? 'manual' : (prev.source || (candidate.price != null ? 'steam' : 'manual')),
    });
    row.classList.add('selected');
    priceInput.disabled = false;
  } else {
    dropCtx.selected.delete(key);
    row.classList.remove('selected');
    priceInput.disabled = true;
  }
  updateDropTotals();
}

async function loadDropCandidates(showAll) {
  if (!dropCtx) return;
  showFormError('#dropError', '');
  const list = $('#dropList');
  list.innerHTML = `<div class="drop-empty"><span class="spinner" style="display:inline-block;vertical-align:-2px;margin-right:8px"></span>Carregando itens…</div>`;
  try {
    const res = await api(`/api/accounts/${dropCtx.accountId}/candidates`, {
      method: 'POST',
      body: { week: dropCtx.week, all: Boolean(showAll) },
    });
    dropCtx.candidates = res.items || [];

    // Pre-seleciona o que já foi registrado nesta semana.
    const recorded = res.recorded || [];
    dropCtx.selected = new Map();
    const byAsset = new Map(dropCtx.candidates.map((c) => [c.assetid, c]));
    for (const rec of recorded) {
      const cand = rec.assetid ? byAsset.get(rec.assetid) : null;
      const merged = cand ? { ...cand, ...rec, recordId: rec.id } : { ...rec, recordId: rec.id };
      dropCtx.selected.set(dropKey(merged), {
        ...merged,
        id: rec.id,
        price: Number(rec.price) || 0,
        source: rec.source || 'manual',
        pricedAt: rec.pricedAt || rec.addedAt || null,
        snapshot: true, // valor já registrado (não sobrescrever automaticamente)
      });
      // Garante que item registrado aparece na lista mesmo fora do filtro atual.
      if (!cand) {
        dropCtx.candidates.push({ ...rec, recordId: rec.id });
      }
    }

    // Se não há nada registrado e estamos na visão da semana, pré-marca os detectados.
    if (recorded.length === 0 && !showAll) {
      for (const c of dropCtx.candidates) {
        dropCtx.selected.set(dropKey(c), { ...c, price: Number(c.price) || 0, source: c.price != null ? 'steam' : 'manual' });
      }
    }

    renderDropList();
  } catch (err) {
    list.innerHTML = `<div class="drop-empty">Falha ao carregar itens.</div>`;
    showFormError('#dropError', err.message);
  }
}

function renderDropSearchResults(items, message = '') {
  const box = $('#dropSearchResults');
  if (!box) return;
  if (message) {
    box.innerHTML = `<div class="drop-search-empty">${esc(message)}</div>`;
    box.classList.remove('hidden');
    return;
  }
  if (!items || !items.length) {
    box.classList.add('hidden');
    box.innerHTML = '';
    return;
  }
  box.innerHTML = items.map((item, i) => {
    const icon = itemIconHtml(item.icon, { cls: 'earn-item-icon', style: 'width:36px;height:36px' });
    const price = item.price != null ? `<span class="drop-search-price">${esc(fmtBRL(item.price))}</span>` : `<span class="muted small">sem preço</span>`;
    return `<div class="drop-search-item">
      ${icon}
      <div class="drop-row-main">
        <div class="drop-row-name" title="${escAttr(item.name)}">${esc(item.name)}</div>
        <div class="drop-row-sub">${item.type ? `<span>${esc(item.type)}</span>` : ''}</div>
      </div>
      ${price}
      <button type="button" class="btn sm ok" data-action="add-search-item" data-idx="${i}">Adicionar</button>
    </div>`;
  }).join('');
  box.dataset.items = JSON.stringify(items);
  box.classList.remove('hidden');
}

async function openDropDialog(account) {
  const week = state.week.key;
  dropCtx = { accountId: account.id, label: account.label, week, candidates: [], selected: new Map() };
  $('#dropTitle').textContent = `Itens que droparam — ${account.label}`;
  $('#dropSubtitle').textContent = `Semana ${fmtWeekKey(week)}. Marque o que caiu e confira o valor no mercado (R$).`;
  $('#chkDropAll').checked = false;
  $('#dropSearchInput').value = '';
  renderDropSearchResults(null);
  $('#btnDropSave').disabled = false;
  $('#btnDropOnlyMark').disabled = false;
  $('#btnDropPrices').disabled = false;
  showFormError('#dropError', '');
  showDialog(dialogDrop);
  await loadDropCandidates(false);
}

/* eventos do dialog de drops */
$('#chkDropAll').addEventListener('change', (e) => {
  loadDropCandidates(e.target.checked);
});

async function runDropSearch() {
  const q = String($('#dropSearchInput').value || '').trim();
  if (q.length < 2) {
    renderDropSearchResults(null, 'Digite pelo menos 2 caracteres para buscar.');
    return;
  }
  const btn = $('#btnDropSearch');
  setBusyButton(btn, true, 'Buscando…');
  showFormError('#dropError', '');
  renderDropSearchResults(null, 'Buscando na Steam…');
  try {
    const res = await api(`/api/prices/search?q=${encodeURIComponent(q)}`);
    const items = res.results || [];
    if (!items.length) renderDropSearchResults(null, 'Nenhum item encontrado na Steam para essa busca.');
    else renderDropSearchResults(items);
  } catch (err) {
    renderDropSearchResults(null);
    showFormError('#dropError', err.message);
  } finally {
    setBusyButton(btn, false);
  }
}

$('#btnDropSearch').addEventListener('click', runDropSearch);
$('#dropSearchInput').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    runDropSearch();
  }
});

$('#dropSearchResults').addEventListener('click', (e) => {
  const btn = e.target.closest('[data-action="add-search-item"]');
  if (!btn || !dropCtx) return;
  const box = $('#dropSearchResults');
  let items = [];
  try { items = JSON.parse(box.dataset.items || '[]'); } catch { items = []; }
  const item = items[Number(btn.dataset.idx)];
  if (!item) return;

  const key = dropKey(item);
  // adiciona como candidato se ainda não existe, e seleciona
  if (!dropCtx.candidates.some((c) => dropKey(c) === key)) {
    dropCtx.candidates.unshift({ ...item });
  }
  const prev = dropCtx.selected.get(key) || {};
  dropCtx.selected.set(key, {
    ...item,
    id: prev.id || undefined,
    recordId: prev.recordId || undefined,
    snapshot: Boolean(prev.snapshot),
    price: prev.price > 0 ? prev.price : (Number(item.price) || 0),
    source: item.price != null ? 'steam' : 'manual',
  });
  renderDropList();
  toast(`"${item.name}" adicionado à seleção.`);
});

$('#dropList').addEventListener('change', (e) => {
  const check = e.target.closest('.drop-check');
  if (check) syncSelectedFromRow(check.dataset.key);
});

$('#dropList').addEventListener('input', (e) => {
  const price = e.target.closest('.drop-price');
  if (!price || !dropCtx) return;
  const key = price.dataset.key;
  const sel = dropCtx.selected.get(key);
  if (sel) {
    sel.price = parseBRLInput(price.value);
    sel.source = 'manual';
    updateDropTotals();
  }
});

$('#btnDropPrices').addEventListener('click', async () => {
  if (!dropCtx) return;
  const btn = $('#btnDropPrices');
  const names = dropCandidatesView().map((c) => c.hash).filter(Boolean);
  if (!names.length) {
    toast('Nenhum item com nome de mercado para consultar.', true);
    return;
  }
  setBusyButton(btn, true, 'Buscando preços…');
  showFormError('#dropError', '');
  try {
    const res = await api('/api/prices', { method: 'POST', body: { names } });
    const prices = res.prices || {};
    let found = 0;
    for (const c of dropCtx.candidates) {
      const q = c.hash ? prices[c.hash] : null;
      if (q && q.ok) {
        c.price = q.low;
        c.median = q.median;
        found += 1;
        const sel = dropCtx.selected.get(dropKey(c));
        // Não sobrescreve valor já registrado (snapshot da semana) nem preço manual.
        if (sel && !sel.snapshot && sel.source !== 'manual') {
          sel.price = q.low;
          sel.source = 'steam';
        }
      }
    }
    renderDropList();
    toast(found > 0 ? `${plural(found, 'preço encontrado', 'preços encontrados')}.` : 'Nenhum preço encontrado agora.', found === 0);
  } catch (err) {
    showFormError('#dropError', err.message);
  } finally {
    setBusyButton(btn, false);
  }
});

$('#btnDropOnlyMark').addEventListener('click', async () => {
  if (!dropCtx) return;
  const btn = $('#btnDropOnlyMark');
  setBusyButton(btn, true, 'Salvando…');
  try {
    // Marca como dropou sem registrar itens (limpa lista da semana).
    await api(`/api/accounts/${dropCtx.accountId}/drops`, {
      method: 'POST',
      body: { week: dropCtx.week, items: [] },
    });
    const res = await api(`/api/accounts/${dropCtx.accountId}/mark`, {
      method: 'POST',
      body: { state: 'dropped', week: dropCtx.week },
    });
    dialogDrop.close();
    setState(res.state);
    toast(`${dropCtx.label}: marcado como dropou.`);
  } catch (err) {
    showFormError('#dropError', err.message);
  } finally {
    setBusyButton(btn, false);
  }
});

$('#formDrop').addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!dropCtx) return;
  const items = [...dropCtx.selected.values()].map((item) => ({
    id: item.id || item.recordId || undefined,
    assetid: item.assetid || '',
    name: item.name,
    hash: item.hash || '',
    icon: item.icon || '',
    type: item.type || '',
    rarity: item.rarity || '',
    color: item.color || '',
    price: Number(item.price) || 0,
    source: item.source || 'manual',
    pricedAt: item.pricedAt || undefined,
  }));

  if (items.length === 0) {
    showFormError('#dropError', 'Selecione pelo menos um item, ou use "Só marcar como dropou".');
    return;
  }

  const btn = $('#btnDropSave');
  setBusyButton(btn, true, 'Salvando…');
  showFormError('#dropError', '');
  try {
    const res = await api(`/api/accounts/${dropCtx.accountId}/drops`, {
      method: 'POST',
      body: { week: dropCtx.week, items },
    });
    dialogDrop.close();
    setState(res.state);
    const total = items.reduce((s, it) => s + (Number(it.price) || 0), 0);
    toast(`${plural(items.length, 'item salvo', 'itens salvos')} (${fmtBRL(total)}).`);
  } catch (err) {
    showFormError('#dropError', err.message);
  } finally {
    setBusyButton(btn, false);
  }
});

/* ------------------------------------------------------------- dialogs */

const dialogAdd = $('#dialogAdd');
const dialogSettings = $('#dialogSettings');

function showDialog(dialog) {
  if (!dialog.open) dialog.showModal();
}

document.querySelectorAll('[data-close]').forEach((btn) => {
  btn.addEventListener('click', () => btn.closest('dialog')?.close());
});

document.querySelectorAll('dialog').forEach((dialog) => {
  dialog.addEventListener('click', (e) => {
    if (e.target === dialog) dialog.close();
  });
});

function setBusyButton(button, busy, busyText) {
  if (busy) {
    button.dataset.label = button.textContent;
    button.textContent = busyText;
    button.disabled = true;
  } else {
    button.textContent = button.dataset.label || button.textContent;
    button.disabled = false;
  }
}

function showFormError(sel, message) {
  const el = $(sel);
  if (!message) {
    el.classList.add('hidden');
    el.textContent = '';
    return;
  }
  el.textContent = message;
  el.classList.remove('hidden');
}

/* adicionar conta */

function openAddDialog() {
  const form = $('#formAdd');
  form.reset();
  showFormError('#addError', '');
  setBusyButton($('#btnAddSubmit'), false);
  showDialog(dialogAdd);
  setTimeout(() => form.elements.input?.focus(), 30);
}

$('#btnAdd').addEventListener('click', openAddDialog);
$('#btnAddEmpty').addEventListener('click', openAddDialog);

$('#formAdd').addEventListener('submit', async (e) => {
  e.preventDefault();
  const form = e.currentTarget;
  const input = String(form.elements.input.value || '').trim();
  const label = String(form.elements.label.value || '').trim();

  showFormError('#addError', '');
  if (!input) {
    showFormError('#addError', 'Cole o link do perfil ou o SteamID64.');
    return;
  }

  const button = $('#btnAddSubmit');
  setBusyButton(button, true, 'Lendo inventário…');

  try {
    const res = await api('/api/accounts', { method: 'POST', body: { input, label } });
    dialogAdd.close();
    setState(res.state);
    toast(`${res.account.label} adicionada.`);
  } catch (err) {
    showFormError('#addError', err.message);
  } finally {
    setBusyButton(button, false);
  }
});

/* configurações */

function fillSettingsForm() {
  if (!state) return;
  const form = $('#formSettings');
  const select = $('#selWeekday');

  if (select.options.length === 0) {
    select.innerHTML = state.weekdays
      .map((w) => `<option value="${w.id}">${esc(w.name)}</option>`)
      .join('');
  }

  select.value = String(state.settings.resetWeekday);
  $('#inpHour').value = state.settings.resetHour;
  $('#inpMinute').value = state.settings.resetMinute;
  $('#selPoll').value = String(state.settings.pollMinutes);
  updateLocalHint();
  showFormError('#settingsError', '');
}

function updateLocalHint() {
  const weekday = Number($('#selWeekday').value);
  const hour = Number($('#inpHour').value);
  const minute = Number($('#inpMinute').value);
  const settings = { resetWeekday: weekday, resetHour: hour, resetMinute: minute };

  const utcName = state?.weekdays.find((w) => w.id === weekday)?.name || '';
  const hh = String(hour).padStart(2, '0');
  const mm = String(minute).padStart(2, '0');

  let localDay = '';
  let localTime = '';
  try {
    localDay = new Intl.DateTimeFormat('pt-BR', { weekday: 'long' }).format(refDate(settings));
    localTime = new Intl.DateTimeFormat('pt-BR', {
      hour: '2-digit',
      minute: '2-digit',
      timeZoneName: 'short',
    }).format(refDate(settings));
  } catch {
    /* fuso estranho: mostra só o UTC */
  }

  if (localDay) {
    const sameDay = localDay.toLowerCase() === utcName.toLowerCase();
    const where = sameDay ? '' : ` Cai na ${localDay} para você, porque seu fuso é ${tzOffsetLabel()}.`;
    $('#localHint').textContent = `${utcName} ${hh}:${mm} UTC = ${localDay}, ${localTime}.${where}`;
  } else {
    $('#localHint').textContent = `Horário em UTC: ${hh}:${mm}.`;
  }
}

$('#btnSettings').addEventListener('click', () => {
  fillSettingsForm();
  showDialog(dialogSettings);
});

['#selWeekday', '#inpHour', '#inpMinute'].forEach((sel) => {
  $(sel).addEventListener('input', updateLocalHint);
});

$('#formSettings').addEventListener('submit', async (e) => {
  e.preventDefault();
  const form = e.currentTarget;
  const body = {
    resetWeekday: Number(form.elements.resetWeekday.value),
    resetHour: Number(form.elements.resetHour.value),
    resetMinute: Number(form.elements.resetMinute.value),
    pollMinutes: Number(form.elements.pollMinutes.value),
  };

  try {
    const res = await api('/api/settings', { method: 'PATCH', body });
    dialogSettings.close();
    setState(res.state);
    toast('Configurações salvas.');
  } catch (err) {
    showFormError('#settingsError', err.message);
  }
});

/* ------------------------------------------------------------ atualizar tudo */

$('#btnRefresh').addEventListener('click', async () => {
  const button = $('#btnRefresh');
  button.disabled = true;
  button.textContent = 'Atualizando…';
  try {
    const res = await api('/api/refresh', { method: 'POST' });
    setState(res.state);
    toast(
      res.refreshed > 0
        ? `${plural(res.refreshed, 'conta lida', 'contas lidas')}.`
        : 'Nada para atualizar agora.',
    );
  } catch (err) {
    toast(err.message, true);
  } finally {
    button.textContent = '↻ Atualizar tudo';
    button.disabled = false;
  }
});

/* ----------------------------------------------------------------- startup */

async function refreshState() {
  const next = await api('/api/state');
  setState(next);
}

function connectEvents() {
  if (!('EventSource' in window)) return;

  const es = new EventSource('/api/events');
  let timer = null;

  es.addEventListener('message', () => {
    clearTimeout(timer);
    timer = setTimeout(() => refreshState().catch(() => {}), 400);
  });

  es.addEventListener('error', () => {
    es.close();
    setTimeout(connectEvents, 5000);
  });
}

async function boot() {
  try {
    await refreshState();
  } catch (err) {
    markOffline(true);
    toast(err.message, true);
  }
  // Atualiza preços relevantes em segundo plano sempre que o painel é aberto.
  api('/api/prices/refresh', { method: 'POST' }).catch(() => {});
  connectEvents();
  setInterval(tick, 15_000);
  setInterval(() => refreshState().catch(() => {}), 60_000);
}

boot();
