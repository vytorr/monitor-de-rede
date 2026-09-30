'use strict';

// Painel do Monitor Infantil. Tudo que vem da rede (nomes de domínio) é
// inserido como texto, nunca como HTML.

const state = {
  tab: 'overview',
  categories: {},
  devices: [],
  addresses: [],
};

const $ = (sel) => document.querySelector(sel);

function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'class') node.className = v;
    else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
    else node.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) {
    if (c == null || c === false) continue;
    node.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return node;
}

function svgIcon(id) {
  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('class', 'icon');
  const use = document.createElementNS(NS, 'use');
  use.setAttribute('href', '#' + id);
  svg.appendChild(use);
  return svg;
}

async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch(path, {
    method,
    headers: body ? { 'Content-Type': 'application/json', 'X-Monitor': '1' } : { 'X-Monitor': '1' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || res.statusText);
  return data;
}

// ---------- formatação ----------

const fmtTime = (ts) => new Date(ts).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
function fmtWhen(ts) {
  const d = new Date(ts);
  const today = new Date();
  const sameDay = d.toDateString() === today.toDateString();
  return sameDay
    ? 'hoje ' + fmtTime(ts)
    : d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }) + ' ' + fmtTime(ts);
}
function fmtMinutes(min) {
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m ? `${h} h ${m} min` : `${h} h`;
}
const catLabel = (c) => (state.categories[c] ? state.categories[c].label : c);
const isAlert = (c) => !!(state.categories[c] && state.categories[c].alert);
function deviceName(ip) {
  const d = state.devices.find((x) => x.ip === ip);
  return d && d.name ? d.name : ip;
}

function categoryTag(category) {
  return el('span', { class: 'tag' + (isAlert(category) ? ' alert' : '') }, catLabel(category));
}

function filterQuery() {
  const p = new URLSearchParams({ period: $('#f-period').value });
  if ($('#f-device').value) p.set('device', $('#f-device').value);
  if ($('#f-hidden').checked) p.set('hidden', '1');
  return p.toString();
}

// ---------- ações ----------

async function setBlocked(site, blocked) {
  const verb = blocked ? 'Bloquear' : 'Desbloquear';
  if (!confirm(`${verb} "${site}" em todos os celulares monitorados?`)) return;
  await api('/api/sites', { method: 'PATCH', body: { site, blocked } });
  refresh();
}

async function setCategory(site, category) {
  await api('/api/sites', { method: 'PATCH', body: { site, category } });
  refresh();
}

function blockButton(row) {
  return row.blocked
    ? el('button', { class: 'btn', onclick: () => setBlocked(row.site, false) }, 'Desbloquear')
    : el('button', { class: 'btn danger', onclick: () => setBlocked(row.site, true) }, 'Bloquear');
}

function categorySelect(row) {
  const select = el(
    'select',
    { 'aria-label': `Categoria de ${row.site}`, onchange: (e) => setCategory(row.site, e.target.value) },
    Object.entries(state.categories).map(([id, c]) =>
      el('option', { value: id, selected: id === row.category }, c.label)
    )
  );
  return select;
}

function siteCell(row) {
  const extra = row.sample_domain && row.sample_domain !== row.site ? row.sample_domain : null;
  return el('td', { class: 'site' }, row.site, row.blocked ? [' ', el('span', { class: 'tag blocked' }, 'bloqueado')] : null, extra && el('small', {}, extra));
}

// ---------- visão geral ----------

function renderTiles(s) {
  $('#t-minutes').textContent = fmtMinutes(s.activeMinutes);
  $('#t-sites').textContent = s.sites;
  $('#t-alerts').textContent = s.alertSites;
  $('#t-blocked').textContent = s.blocked;
  $('.tile-alert').classList.toggle('has-alerts', s.alertSites > 0);
}

function searchFilter(text) {
  const q = ($('#f-search') ? $('#f-search').value : '').trim().toLowerCase();
  if (!q) return true;
  return String(text).toLowerCase().includes(q);
}

function renderAlerts(rows) {
  const table = $('#alerts-table');
  const filtered = rows.filter((r) =>
    searchFilter(r.site) ||
    searchFilter(r.sample_domain) ||
    searchFilter(catLabel(r.category)) ||
    r.devices.some((ip) => searchFilter(deviceName(ip)))
  );
  $('#alerts-card').classList.toggle('has-alerts', rows.length > 0);
  $('#alerts-empty').hidden = rows.length > 0;
  table.hidden = filtered.length === 0;
  table.tBodies[0].replaceChildren(
    ...filtered.map((r) =>
      el('tr', { class: 'is-alert' },
        siteCell(r),
        el('td', {}, categoryTag(r.category)),
        el('td', {}, r.devices.map(deviceName).join(', ')),
        el('td', { class: 'num' }, r.minutes),
        el('td', {}, fmtWhen(r.first_seen)),
        el('td', {}, fmtWhen(r.last_seen)),
        el('td', {}, blockButton(r))
      )
    )
  );
}

function showTooltip(e, text) {
  const tip = $('#tooltip');
  tip.textContent = text;
  tip.hidden = false;
  const x = Math.min(e.clientX + 12, window.innerWidth - tip.offsetWidth - 8);
  tip.style.left = x + 'px';
  tip.style.top = e.clientY - 34 + 'px';
}
const hideTooltip = () => ($('#tooltip').hidden = true);

function renderTimeline(t) {
  const box = $('#timeline');
  const byHour = t.unit === 'hora';
  const titleEl = $('#timeline-title');
  if (titleEl) titleEl.textContent = byHour ? 'Horários de maior atividade' : 'Atividade por dia';
  const buckets = t.buckets || [];
  const label = (b) => byHour ? b.bucket.slice(11) + 'h' : (() => { const [, m, d] = b.bucket.split('-'); return `${d}/${m}`; })();
  if (!buckets.length) { box.innerHTML = '<p class="muted">Sem dados neste período.</p>'; return; }

  const n = buckets.length;
  const W = Math.max(320, Math.round(box.clientWidth || 760));
  const H = 210, padT = 12, padB = 26, padX = 8;
  const max = Math.max(1, ...buckets.map((b) => b.minutes));
  const xat = (i) => padX + (W - padX * 2) * (n <= 1 ? 0.5 : i / (n - 1));
  const yat = (v) => padT + (H - padT - padB) * (1 - v / max);
  const base = (H - padB).toFixed(1);
  const pts = buckets.map((b, i) => [xat(i), yat(b.minutes)]);
  const line = pts.map((p, i) => (i ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1)).join(' ');
  const area = `M${pts[0][0].toFixed(1)} ${base} ` + pts.map((p) => 'L' + p[0].toFixed(1) + ' ' + p[1].toFixed(1)).join(' ') + ` L${pts[n - 1][0].toFixed(1)} ${base} Z`;

  let grid = '';
  for (let g = 0; g <= 2; g++) { const yy = (padT + (H - padT - padB) * g / 2).toFixed(1); grid += `<line class="tl-grid" x1="${padX}" y1="${yy}" x2="${W - padX}" y2="${yy}"/>`; }
  const idxs = [...new Set([0, Math.floor((n - 1) / 2), n - 1])];
  let axis = '';
  for (const i of idxs) { const a = i === 0 ? 'start' : i === n - 1 ? 'end' : 'middle'; axis += `<text x="${xat(i).toFixed(1)}" y="${H - 7}" text-anchor="${a}">${label(buckets[i])}</text>`; }

  box.innerHTML =
    `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="Gráfico de atividade por ${byHour ? 'hora' : 'dia'}" style="width:100%;height:${H}px">
      <defs><linearGradient id="tlgrad" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="currentColor" stop-opacity="0.35"/>
        <stop offset="100%" stop-color="currentColor" stop-opacity="0"/>
      </linearGradient></defs>
      ${grid}
      <path class="tl-area" d="${area}" fill="url(#tlgrad)"/>
      <path class="tl-line" d="${line}"/>
      ${axis}
      <circle class="tl-dot" r="4" style="display:none"/>
      <rect class="tl-hit" x="0" y="0" width="${W}" height="${H}"/>
    </svg>`;

  const svg = box.querySelector('svg');
  const dot = box.querySelector('.tl-dot');
  const hit = box.querySelector('.tl-hit');
  hit.addEventListener('mousemove', (e) => {
    const r = svg.getBoundingClientRect();
    const relX = (e.clientX - r.left) / r.width * W;
    let i = n <= 1 ? 0 : Math.round((relX - padX) / ((W - padX * 2) / (n - 1)));
    i = Math.max(0, Math.min(n - 1, i));
    dot.setAttribute('cx', pts[i][0].toFixed(1));
    dot.setAttribute('cy', pts[i][1].toFixed(1));
    dot.style.display = '';
    showTooltip(e, `${label(buckets[i])}: ${fmtMinutes(buckets[i].minutes)}`);
  });
  hit.addEventListener('mouseleave', () => { dot.style.display = 'none'; hideTooltip(); });
}

function renderCategories(rows) {
  const box = $('#categories');
  if (!rows.length) {
    box.replaceChildren(el('p', { class: 'muted' }, 'Nenhum acesso neste período.'));
    return;
  }
  const max = Math.max(1, ...rows.map((r) => r.minutes));
  box.replaceChildren(
    ...rows.map((r) => {
      const text = `${catLabel(r.category)}: ${fmtMinutes(r.minutes)}, ${r.sites} site(s)`;
      return el('div', { class: 'hbar' + (isAlert(r.category) ? ' alert' : ''), onmousemove: (e) => showTooltip(e, text), onmouseleave: hideTooltip },
        el('span', { class: 'label', title: catLabel(r.category) }, catLabel(r.category)),
        el('div', { class: 'track' }, el('div', { class: 'fill', style: `width:${(r.minutes / max) * 100}%` })),
        el('span', { class: 'value' }, fmtMinutes(r.minutes))
      );
    })
  );
}

function renderSites(rows) {
  const tbody = $('#sites-table').tBodies[0];
  const filtered = rows.filter((r) =>
    searchFilter(r.site) ||
    searchFilter(r.sample_domain) ||
    searchFilter(catLabel(r.category)) ||
    r.devices.some((ip) => searchFilter(deviceName(ip)))
  );
  if (!filtered.length) {
    tbody.replaceChildren(el('tr', {}, el('td', { colspan: 6, class: 'muted' }, 'Nenhum site encontrado para esta busca/período.')));
    return;
  }
  tbody.replaceChildren(
    ...filtered.map((r) =>
      el('tr', { class: isAlert(r.category) ? 'is-alert' : null },
        siteCell(r),
        el('td', {}, categorySelect(r)),
        el('td', {}, r.devices.map(deviceName).join(', ')),
        el('td', { class: 'num' }, r.minutes),
        el('td', {}, fmtWhen(r.last_seen)),
        el('td', {}, blockButton(r))
      )
    )
  );
}

async function loadOverview() {
  const d = await api('/api/dashboard?' + filterQuery());
  renderTiles(d.summary);
  renderAlerts(d.alerts);
  renderTimeline(d.timeline);
  renderCategories(d.categories);
  renderSites(d.topSites);
}

// ---------- registro ----------

async function loadLive() {
  const rows = await api('/api/recent?' + filterQuery());
  const tbody = $('#live-table').tBodies[0];
  const filtered = rows.filter((r) =>
    searchFilter(r.domain) ||
    searchFilter(r.site) ||
    searchFilter(catLabel(r.category)) ||
    searchFilter(deviceName(r.client_ip))
  );
  if (!filtered.length) {
    tbody.replaceChildren(el('tr', {}, el('td', { colspan: 5, class: 'muted' }, 'Nenhum acesso registrado para este filtro.')));
    return;
  }
  tbody.replaceChildren(
    ...filtered.map((r) =>
      el('tr', { class: isAlert(r.category) ? 'is-alert' : null },
        el('td', {}, fmtWhen(r.ts)),
        el('td', {}, deviceName(r.client_ip)),
        el('td', { class: 'site' }, r.domain),
        el('td', {}, categoryTag(r.category)),
        el('td', {}, r.blocked ? el('span', { class: 'tag blocked' }, 'bloqueado') : el('span', { class: 'tag' }, 'permitido'))
      )
    )
  );
}

// ---------- aparelhos ----------

async function loadDevices() {
  state.devices = await api('/api/devices');
  const select = $('#f-device');
  const current = select.value;
  select.replaceChildren(
    el('option', { value: '' }, 'Todos os aparelhos'),
    ...state.devices.map((d) => el('option', { value: d.ip, selected: d.ip === current }, (d.name ? `${d.name} (${d.ip})` : d.ip)))
  );
  $('#no-devices').hidden = state.devices.length > 0;

  if (state.tab !== 'devices') return;
  $('#devices-table').tBodies[0].replaceChildren(
    ...(state.devices.length
      ? state.devices.map((d) => {
          const input = el('input', { type: 'text', value: d.name || '', placeholder: 'Nome para identificar', maxlength: 60 });
          const save = el('button', { class: 'btn', onclick: async () => {
            await api('/api/devices', { method: 'PATCH', body: { ip: d.ip, name: input.value } });
            loadDevices();
          } }, 'Salvar');
          const del = el('button', { class: 'row-del', title: 'Remover este aparelho e seu histórico', 'aria-label': 'Remover aparelho', onclick: () => removeDevice(d) }, svgIcon('i-trash'));
          return el('tr', {},
            el('td', {}, input, ' ', save),
            el('td', {}, d.ip),
            el('td', {}, d.mac || '—'),
            el('td', { class: 'num' }, d.queries_24h),
            el('td', {}, fmtWhen(d.last_seen)),
            el('td', {}, del)
          );
        })
      : [el('tr', {}, el('td', { colspan: 6, class: 'muted' }, 'Nenhum aparelho usou o monitor ainda.'))])
  );
}

async function removeDevice(d) {
  const nome = d.name || d.ip;
  if (!confirm(`Remover "${nome}" e todo o histórico de acessos deste aparelho?\n\nEsta ação não pode ser desfeita.`)) return;
  await api('/api/devices', { method: 'DELETE', body: { ip: d.ip } });
  loadDevices();
}

// ---------- bloqueios ----------

async function loadBlocked() {
  await loadKeywords();
  const rows = await api('/api/blocked');
  $('#blocked-empty').hidden = rows.length > 0;
  $('#blocked-table').hidden = rows.length === 0;
  $('#blocked-table').tBodies[0].replaceChildren(
    ...rows.map((r) =>
      el('tr', {}, el('td', { class: 'site' }, r.site), el('td', {}, categoryTag(r.category)),
        el('td', {}, el('button', { class: 'btn', onclick: () => setBlocked(r.site, false) }, 'Desbloquear')))
    )
  );
}

// ---------- bloqueio por palavra ----------

let keywords = [];

async function loadKeywords() {
  const c = await api('/api/config');
  keywords = Array.isArray(c.blockKeywords) ? c.blockKeywords : [];
  renderKeywords();
}

function renderKeywords() {
  const box = $('#keyword-list');
  if (!box) return;
  $('#keyword-empty').hidden = keywords.length > 0;
  box.replaceChildren(
    ...keywords.map((k) =>
      el('span', { class: 'kw-chip' }, k,
        el('button', { type: 'button', title: `Remover "${k}"`, 'aria-label': `Remover ${k}`, onclick: () => removeKeyword(k) }, '×'))
    )
  );
}

async function saveKeywords() {
  const c = await api('/api/config', { method: 'PUT', body: { blockKeywords: keywords } });
  keywords = c.blockKeywords || [];
  renderKeywords();
}

async function addKeyword(word) {
  const w = word.trim().toLowerCase();
  if (w.length < 2) return;
  if (keywords.includes(w)) return;
  keywords = [...keywords, w];
  await saveKeywords();
}

async function removeKeyword(word) {
  keywords = keywords.filter((k) => k !== word);
  await saveKeywords();
}

(function bindKeywordForm() {
  const form = document.getElementById('keyword-form');
  if (!form) return;
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const input = document.getElementById('keyword-input');
    await addKeyword(input.value);
    input.value = '';
    input.focus();
  });
})();

// ---------- configurações ----------

async function loadSettings() {
  const c = await api('/api/config');
  const f = $('#settings-form');
  f.autoBlockAlerts.checked = !!c.autoBlockAlerts;
  f.forceSafeSearch.checked = !!c.forceSafeSearch;
  f.onlineCheck.checked = !!c.onlineCheck;
  f.upstreamDns.value = (c.upstreamDns || []).join(', ');
  f.retentionDays.value = c.retentionDays || 30;
}

$('#settings-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = e.target;
  const msg = $('#settings-msg');
  msg.textContent = 'Salvando...';
  try {
    await api('/api/config', {
      method: 'PUT',
      body: {
        autoBlockAlerts: f.autoBlockAlerts.checked,
        forceSafeSearch: f.forceSafeSearch.checked,
        onlineCheck: f.onlineCheck.checked,
        upstreamDns: f.upstreamDns.value.split(','),
        retentionDays: Number(f.retentionDays.value),
      },
    });
    await loadSettings();
    msg.textContent = 'Configurações salvas com sucesso.';
    setTimeout(() => { msg.textContent = ''; }, 4000);
  } catch (err) {
    msg.textContent = 'Erro ao salvar: ' + err.message;
  }
});

// ---------- status e navegação ----------

function copyIpToClipboard(ip, btn) {
  if (!ip) return;
  navigator.clipboard.writeText(ip).then(() => {
    const html = btn.innerHTML;
    btn.innerHTML = '<svg class="icon"><use href="#i-shield-check"/></svg> Copiado!';
    setTimeout(() => { btn.innerHTML = html; }, 1800);
  }).catch(() => {
    prompt('Copie o endereço:', ip);
  });
}

async function loadStatus() {
  const pill = $('#dns-status');
  try {
    const s = await api('/api/status');
    state.categories = s.categories;
    state.addresses = s.addresses;
    const firstIp = (s.addresses[0] && s.addresses[0].address) || '127.0.0.1';
    
    document.querySelectorAll('.ip-primary').forEach((n) => (n.textContent = firstIp));

    const copyBtn = document.getElementById('btn-copy-ip-top');
    if (copyBtn) copyBtn.onclick = () => copyIpToClipboard(firstIp, copyBtn);

    const btnHotspot = document.getElementById('btn-open-hotspot');
    if (btnHotspot) {
      btnHotspot.onclick = () => {
        // Tenta abrir direto as configurações do Windows; se o navegador bloquear, mostra o caminho.
        window.location.href = 'ms-settings:network-mobilehotspot';
        setTimeout(() => {
          alert('Se a janela não abrir, vá em: Configurações do Windows > Rede e Internet > Ponto de acesso móvel, e ative a chave.');
        }, 800);
      };
    }

    // Status da conexão em tempo real
    const liveBox = document.getElementById('live-connect-status');
    const statusText = document.getElementById('connect-status-text');
    const statusSub = document.getElementById('connect-status-sub');
    if (liveBox && statusText && statusSub) {
      if (state.devices.length > 0) {
        liveBox.className = 'connect-status-box ok';
        const nomes = state.devices.map((d) => d.name || d.ip).join(', ');
        statusText.textContent = `Dispositivo conectado (${nomes})`;
        statusSub.textContent = 'O monitoramento está ativo. Acompanhe os acessos na aba "Visão geral".';
      } else {
        liveBox.className = 'connect-status-box waiting';
        statusText.textContent = 'Aguardando a conexão do dispositivo...';
        statusSub.textContent = 'Assim que o dispositivo monitorado se conectar, este indicador ficará verde.';
      }
    }

    // Considera tanto o SNI (fonte principal no modo hotspot) quanto o DNS.
    // Mostra a rede/senha do hotspot no guia, quando o programa o ligou.
    const hs = s.sni?.hotspot;
    const hsBox = document.getElementById('hs-box');
    if (hsBox) {
      if (hs && hs.hotspotOn && hs.ssid) {
        document.getElementById('hs-ssid').textContent = hs.ssid;
        document.getElementById('hs-pass').textContent = hs.passphrase || '(sem senha)';
        hsBox.hidden = false;
      } else {
        hsBox.hidden = true;
      }
    }

    const lastActivity = Math.max(s.sni?.lastAt || 0, s.dns?.lastQueryAt || 0) || null;
    pill.className = 'pill ok';
    pill.textContent = lastActivity ? `Protegendo · ${fmtTime(lastActivity)}` : 'Protegendo · aguardando';
  } catch {
    pill.className = 'pill err';
    pill.textContent = 'Monitor desligado';
  }
}

const loaders = { overview: loadOverview, live: loadLive, devices: async () => {}, blocked: loadBlocked, settings: loadSettings, setup: async () => {} };

async function refresh() {
  try {
    await loadDevices();
    await loadStatus();
    await loaders[state.tab]();
  } catch (err) {
    console.error(err);
  }
}

const TAB_TITLES = { overview: 'Visão geral', live: 'Registro ao vivo', devices: 'Aparelhos', blocked: 'Bloqueios', settings: 'Configurações', setup: 'Como configurar' };

function showTab(tab) {
  state.tab = tab;
  document.querySelectorAll('.nav-item').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.tab === tab)));
  document.querySelectorAll('.tab-panel').forEach((p) => (p.hidden = p.id !== 'tab-' + tab));
  $('#filters').hidden = !['overview', 'live'].includes(tab);
  const pt = document.getElementById('page-title');
  if (pt) pt.textContent = TAB_TITLES[tab] || '';
  closeSidebar();
  refresh();
}

document.querySelectorAll('.nav-item').forEach((b) => b.addEventListener('click', () => showTab(b.dataset.tab)));

// --- menu lateral no celular ---
function closeSidebar() {
  const sb = document.getElementById('sidebar');
  const sc = document.getElementById('sidebar-scrim');
  if (sb) sb.classList.remove('open');
  if (sc) sc.hidden = true;
}
document.getElementById('menu-toggle')?.addEventListener('click', () => {
  if (matchMedia('(max-width: 900px)').matches) {
    // Celular: abre/fecha a gaveta com o fundo escurecido.
    const sb = document.getElementById('sidebar');
    const open = sb.classList.toggle('open');
    const sc = document.getElementById('sidebar-scrim');
    if (sc) sc.hidden = !open;
  } else {
    // Desktop: recolhe/expande a barra lateral.
    document.querySelector('.app')?.classList.toggle('nav-collapsed');
  }
});
document.getElementById('sidebar-scrim')?.addEventListener('click', closeSidebar);

// --- tema claro/escuro ---
function effectiveDark() {
  const t = document.documentElement.getAttribute('data-theme');
  if (t) return t === 'dark';
  return matchMedia('(prefers-color-scheme: dark)').matches;
}
function updateThemeIcon() {
  const use = document.querySelector('#theme-toggle use');
  if (use) use.setAttribute('href', effectiveDark() ? '#i-sun' : '#i-moon');
}
function applyTheme(t) {
  if (t) document.documentElement.setAttribute('data-theme', t);
  else document.documentElement.removeAttribute('data-theme');
  updateThemeIcon();
}
(function initTheme() {
  let saved = null;
  try { saved = localStorage.getItem('mi-theme'); } catch {}
  applyTheme(saved === 'dark' || saved === 'light' ? saved : null);
})();
document.getElementById('theme-toggle')?.addEventListener('click', () => {
  const next = effectiveDark() ? 'light' : 'dark';
  try { localStorage.setItem('mi-theme', next); } catch {}
  applyTheme(next);
});
document.querySelectorAll('[data-goto]').forEach((a) =>
  a.addEventListener('click', (e) => {
    e.preventDefault();
    showTab(a.dataset.goto);
  })
);
['#f-period', '#f-device', '#f-hidden', '#f-search'].forEach((s) => {
  const el = $(s);
  if (el) el.addEventListener('input', refresh);
});

// Atualiza sozinho nas telas de acompanhamento, mas não enquanto a mãe
// está usando um campo de digitação ou seleção.
setInterval(() => {
  const active = document.activeElement;
  const busy = active && active.closest('main') && ['SELECT', 'INPUT'].includes(active.tagName);
  if (!busy && (state.tab === 'live' || state.tab === 'overview' || state.tab === 'setup')) refresh();
}, 4000);

const validTabs = ['overview', 'live', 'devices', 'blocked', 'settings', 'setup'];
const initialTab = (location.hash || '').replace('#', '');
showTab(validTabs.includes(initialTab) ? initialTab : 'overview');
