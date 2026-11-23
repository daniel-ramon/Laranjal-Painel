document.getElementById('side').innerHTML = sidebar('vendas');

function pad2(n) { return String(n).padStart(2, '0'); }
function isoHoje() { const d = new Date(); return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()); }
function isoSegunda() {
  const d = new Date(); d.setHours(0, 0, 0, 0);
  const dow = d.getDay();
  d.setDate(d.getDate() + (dow === 0 ? -6 : 1 - dow));
  return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
}
function parseISO(s) { const [y, m, d] = String(s).slice(0, 10).split('-').map(Number); return new Date(y, m - 1, d); }

let INI = isoSegunda();
let FIM = isoHoje();
let DADOS = null;
let GRUPO = 'entregas';      // 'entregas' | 'ceasa'

// Abrevia valores grandes para os eixos (R$ 90k, 1,2M; kg 27k).
function abrev(n) {
  const a = Math.abs(n);
  if (a >= 1e6) return (n / 1e6).toLocaleString('pt-BR', { maximumFractionDigits: 1 }) + 'M';
  if (a >= 1e3) return Math.round(n / 1e3) + 'k';
  return String(Math.round(n));
}

function kpiCard(titulo, valor, qtd, sub, cls) {
  return `
  <div class="kpi vkpi">
    <div class="t"><span class="dot" style="background:var(--${cls})"></span>${titulo}</div>
    <div class="v">${fmtBRL(valor)}</div>
    <div class="vq">${fmtNum(Math.round(qtd))} <span>kg</span></div>
    <div class="q">${sub || ''}</div>
  </div>`;
}

function renderKpis(g) {
  document.getElementById('kpis').innerHTML =
    kpiCard('Média diária', g.mediaDiaria.vlr, g.mediaDiaria.qt, `em ${fmtNum(g.dias)} dia(s) com venda`, 'ak') +
    kpiCard('Média semanal', g.mediaSemanal.vlr, g.mediaSemanal.qt, `em ${fmtNum(g.semanas)} semana(s)`, 'violet') +
    kpiCard('Total do intervalo', g.total.vlr, g.total.qt, `${fmtNum(g.total.ped)} pedido(s)`, 'amber');
}

// ---- Gráfico SVG (duas curvas: valor e quantidade, eixos independentes) ----
function renderChart(g) {
  const wrap = document.getElementById('chartWrap');
  const serie = g.serie || [];
  if (!serie.length) { wrap.innerHTML = `<div class="empty" style="padding:40px">Sem vendas no intervalo.</div>`; return; }

  const W = 920, H = 320, padL = 64, padR = 60, padT = 18, padB = 40;
  const plotW = W - padL - padR, plotH = H - padT - padB;
  const t0 = parseISO(INI).getTime(), t1 = parseISO(FIM).getTime();
  const span = Math.max(1, t1 - t0);
  const maxV = Math.max(1, ...serie.map((p) => p.vlr));
  const maxQ = Math.max(1, ...serie.map((p) => p.qt));
  const x = (iso) => padL + (serie.length === 1 ? plotW / 2 : ((parseISO(iso).getTime() - t0) / span) * plotW);
  const yV = (v) => padT + plotH - (v / maxV) * plotH;
  const yQ = (q) => padT + plotH - (q / maxQ) * plotH;

  const ptsV = serie.map((p) => `${x(p.data).toFixed(1)},${yV(p.vlr).toFixed(1)}`).join(' ');
  const ptsQ = serie.map((p) => `${x(p.data).toFixed(1)},${yQ(p.qt).toFixed(1)}`).join(' ');

  // grades + rótulos de valor (esq) e quantidade (dir)
  let grid = '', axisV = '', axisQ = '';
  for (let i = 0; i <= 4; i++) {
    const yy = padT + (plotH * i) / 4;
    grid += `<line x1="${padL}" y1="${yy.toFixed(1)}" x2="${W - padR}" y2="${yy.toFixed(1)}" class="cgrid"/>`;
    axisV += `<text x="${padL - 8}" y="${(yy + 4).toFixed(1)}" class="clbl clbl-v" text-anchor="end">${abrev(maxV * (1 - i / 4))}</text>`;
    axisQ += `<text x="${W - padR + 8}" y="${(yy + 4).toFixed(1)}" class="clbl clbl-q" text-anchor="start">${abrev(maxQ * (1 - i / 4))}</text>`;
  }
  // rótulos de data no eixo x (no máx ~7, sem repetir)
  const nL = Math.min(serie.length, 7);
  let xlbl = '';
  for (let i = 0; i < nL; i++) {
    const idx = Math.round((serie.length - 1) * (nL === 1 ? 0 : i / (nL - 1)));
    const p = serie[idx];
    const dd = p.data.slice(8, 10), mm = p.data.slice(5, 7);
    xlbl += `<text x="${x(p.data).toFixed(1)}" y="${H - padB + 20}" class="clbl" text-anchor="middle">${dd}/${mm}</text>`;
  }
  const dots = (pts, cls, fmt) => serie.map((p) => {
    const cx = x(p.data).toFixed(1), cy = (cls === 'c-v' ? yV(p.vlr) : yQ(p.qt)).toFixed(1);
    const tip = `${p.data.slice(8, 10)}/${p.data.slice(5, 7)} · ${fmt(p)}`;
    return `<circle cx="${cx}" cy="${cy}" r="3" class="${cls}"><title>${tip}</title></circle>`;
  }).join('');

  wrap.innerHTML = `<svg viewBox="0 0 ${W} ${H}" class="chart" preserveAspectRatio="xMidYMid meet" role="img">
    ${grid}
    <polyline points="${ptsV}" class="cline c-v" />
    <polyline points="${ptsQ}" class="cline c-q" />
    ${dots(ptsV, 'c-v', (p) => fmtBRL(p.vlr))}
    ${dots(ptsQ, 'c-q', (p) => fmtNum(Math.round(p.qt)) + ' kg')}
    ${axisV}${axisQ}${xlbl}
  </svg>`;
}

function renderTabela(g) {
  const serie = (g.serie || []).slice().reverse();   // mais recente no topo
  const tbody = document.getElementById('lista');
  if (!serie.length) {
    tbody.innerHTML = `<tr><td colspan="5" class="empty">Sem vendas no intervalo.</td></tr>`;
    return;
  }
  tbody.innerHTML = serie.map((p) => {
    const ticket = p.qt > 0 ? (p.vlr / p.qt) : 0;
    return `<tr>
      <td>${fmtData(p.data)}</td>
      <td class="num">${fmtNum(Math.round(p.qt))}</td>
      <td class="num">${fmtBRL(p.vlr)}</td>
      <td class="num muted">${fmtNum(p.ped)}</td>
      <td class="num muted">${fmtBRL(ticket)}</td>
    </tr>`;
  }).join('');
}

function aplicarGrupo() {
  const g = DADOS.grupos[GRUPO];
  document.querySelectorAll('#abas button').forEach((b) => b.classList.toggle('on', b.dataset.g === GRUPO));
  const nome = GRUPO === 'entregas' ? 'Entregas' : 'Ceasa';
  document.getElementById('chartSub').textContent = `· ${nome} · ${fmtData(DADOS.ini)} a ${fmtData(DADOS.fim)}`;
  document.getElementById('tblSub').textContent = `· ${nome}`;
  renderKpis(g);
  renderChart(g);
  renderTabela(g);
}

async function carregar() {
  document.getElementById('dtIni').value = INI;
  document.getElementById('dtFim').value = FIM;
  DADOS = await api('/api/vendas?ini=' + INI + '&fim=' + FIM);
  document.getElementById('modo').textContent = DADOS.modo === 'exemplo' ? '● dados de exemplo' : '● Oracle';
  aplicarGrupo();
}

function aplicarDatas() {
  const i = document.getElementById('dtIni').value;
  const f = document.getElementById('dtFim').value;
  if (!i || !f) return;
  if (i > f) { alert('A data inicial não pode ser maior que a final.'); return; }
  INI = i; FIM = f;
  carregar().catch((e) => { document.getElementById('kpis').innerHTML = `<div class="empty">Falha: ${e.message}</div>`; });
}

document.getElementById('aplicar').addEventListener('click', aplicarDatas);
document.getElementById('dtIni').addEventListener('change', aplicarDatas);
document.getElementById('dtFim').addEventListener('change', aplicarDatas);
document.querySelectorAll('#abas button').forEach((b) => {
  b.addEventListener('click', () => { GRUPO = b.dataset.g; if (DADOS) aplicarGrupo(); });
});

carregar().catch((e) => { document.getElementById('kpis').innerHTML = `<div class="empty">Falha: ${e.message}</div>`; });
