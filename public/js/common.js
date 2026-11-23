// Utilidades compartilhadas
const MESES = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];

function fmtBRL(n) {
  return (Number(n) || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}
function fmtNum(n) { return (Number(n) || 0).toLocaleString('pt-BR'); }
function fmtData(iso) {
  if (!iso) return '—';
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
}
function mesLabel(mes) {
  const [y, m] = mes.split('-').map(Number);
  return `${MESES[m - 1]} ${y}`;
}
function mesShift(mes, delta) {
  let [y, m] = mes.split('-').map(Number);
  m += delta;
  while (m < 1) { m += 12; y--; }
  while (m > 12) { m -= 12; y++; }
  return `${y}-${String(m).padStart(2, '0')}`;
}
function mesAtual() {
  const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
}
function getMes() {
  const u = new URLSearchParams(location.search).get('mes');
  if (u && /^\d{4}-\d{2}$/.test(u)) return u;
  try { const s = localStorage.getItem('painelcp_mes'); if (s) return s; } catch (_) {}
  return mesAtual();
}
function setMes(mes) {
  try { localStorage.setItem('painelcp_mes', mes); } catch (_) {}
  const url = new URL(location.href);
  url.searchParams.set('mes', mes);
  history.replaceState(null, '', url);
}
// ===== Overlay de carregamento (exibido durante as consultas ao banco) =====
let _loadingCount = 0;
function ensureOverlay() {
  let o = document.getElementById('loading-overlay');
  if (!o) {
    o = el(`<div id="loading-overlay" class="loading-overlay">
      <div class="loading-box">
        <div class="spinner"></div>
        <div class="loading-txt">Consultando o banco…</div>
      </div>
    </div>`);
    document.body.appendChild(o);
  }
  return o;
}
function showLoading() {
  _loadingCount++;
  ensureOverlay().classList.add('on');
}
function hideLoading() {
  _loadingCount = Math.max(0, _loadingCount - 1);
  if (_loadingCount === 0) {
    const o = document.getElementById('loading-overlay');
    if (o) o.classList.remove('on');
  }
}
async function api(path) {
  showLoading();
  try {
    const r = await fetch(path);
    if (!r.ok) throw new Error('Erro ' + r.status);
    return await r.json();
  } finally {
    hideLoading();
  }
}
function el(html) {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstChild;
}
function sidebar(active) {
  return `
  <button class="menu-btn" aria-label="Abrir menu" onclick="document.body.classList.toggle('nav-open')">☰</button>
  <div class="scrim" onclick="document.body.classList.remove('nav-open')"></div>
  <aside class="sidebar">
    <div class="brand">
      <div class="logo">OL</div>
      <div class="name"><span>O</span> <b>LARANJAL</b></div>
    </div>
    <div class="nav-label">FINANCEIRO</div>
    <nav class="nav">
      <a href="index.html" class="${active === 'overview' ? 'active' : ''}"><span class="ico">▦</span>Visão geral</a>
      <a href="contas.html" class="${active === 'contas' ? 'active' : ''}"><span class="ico">≣</span>Contas a pagar</a>
    </nav>
    <div class="nav-label">CLIENTES</div>
    <nav class="nav">
      <a href="nordestao.html" class="${active === 'nordestao' ? 'active' : ''}"><span class="ico">◧</span>Nordestão</a>
    </nav>
    <div class="nav-label">COMERCIAL</div>
    <nav class="nav">
      <a href="vendas.html" class="${active === 'vendas' ? 'active' : ''}"><span class="ico">📈</span>Vendas</a>
    </nav>
    <div class="nav-label">BANCO</div>
    <nav class="nav">
      <a href="bradesco.html" class="${active === 'bradesco' ? 'active' : ''}"><span class="ico">🏦</span>Bradesco</a>
    </nav>
    <div class="nav-label">LOGÍSTICA</div>
    <nav class="nav">
      <a href="entregas.html" class="${active === 'entregas' ? 'active' : ''}"><span class="ico">⛟</span>Entregas</a>
    </nav>
    <div class="foot">AK Hortifruti · JRF Laranjal</div>
  </aside>`;
}
function monthPicker(mes, onChange) {
  const wrap = el(`<div class="month-picker">
    <button data-d="-1">‹</button>
    <div class="lbl">${mesLabel(mes)}</div>
    <button data-d="1">›</button>
  </div>`);
  wrap.querySelectorAll('button').forEach((b) => {
    b.onclick = () => onChange(mesShift(mes, parseInt(b.dataset.d, 10)));
  });
  return wrap;
}
function legendaEmpresas(empresas) {
  return empresas.map((e) =>
    `<span><span class="dot" style="background:${e.cor}"></span>${e.nome}</span>`
  ).join('');
}
