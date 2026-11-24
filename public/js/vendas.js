document.getElementById('side').innerHTML = sidebar('vendas');

function pad2(n) { return String(n).padStart(2, '0'); }
function isoHoje() { const d = new Date(); return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()); }
function isoSegunda() {
  const d = new Date(); d.setHours(0, 0, 0, 0);
  const dow = d.getDay();
  d.setDate(d.getDate() + (dow === 0 ? -6 : 1 - dow));
  return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
}

let INI = isoSegunda();
let FIM = isoHoje();
let DADOS = null;
let GRUPO = 'entregas';      // 'entregas' | 'ceasa'  (visão de vendas)
let ABA = 'entregas';        // 'entregas' | 'ceasa' | 'plan'

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
    kpiCard('Venda bruta', g.total.vlr, g.total.qt, `${fmtNum(g.total.ped)} pedido(s)`, 'amber') +
    kpiCard('Devoluções', g.devolucao.vlr, g.devolucao.qt, 'saídas devolvidas (ED)', 'red') +
    kpiCard('Venda líquida', g.liquido.vlr, g.liquido.qt, 'bruto − devoluções', 'green');
}

// ---- Tabela de totais por produto ----
function renderProdutos(lista) {
  const tbody = document.getElementById('listaProd');
  if (!lista || !lista.length) {
    tbody.innerHTML = `<tr><td colspan="5" class="empty">Sem vendas no intervalo.</td></tr>`;
    return;
  }
  const tot = lista.reduce((s, p) => ({
    qt: s.qt + p.qt, vlr: s.vlr + p.vlr, devVlr: s.devVlr + p.devVlr, liqVlr: s.liqVlr + p.liqVlr,
  }), { qt: 0, vlr: 0, devVlr: 0, liqVlr: 0 });

  const linhas = lista.map((p) => `<tr>
      <td>${p.nome}</td>
      <td class="num">${fmtNum(Math.round(p.qt))}</td>
      <td class="num">${fmtBRL(p.vlr)}</td>
      <td class="num muted">${p.devVlr ? '− ' + fmtBRL(p.devVlr) : '—'}</td>
      <td class="num">${fmtBRL(p.liqVlr)}</td>
    </tr>`).join('');

  const rodape = `<tr class="tot">
      <td><b>Total</b></td>
      <td class="num"><b>${fmtNum(Math.round(tot.qt))}</b></td>
      <td class="num"><b>${fmtBRL(tot.vlr)}</b></td>
      <td class="num muted">${tot.devVlr ? '− ' + fmtBRL(tot.devVlr) : '—'}</td>
      <td class="num"><b>${fmtBRL(tot.liqVlr)}</b></td>
    </tr>`;

  tbody.innerHTML = linhas + rodape;
}

function renderTabela(g) {
  const serie = (g.serie || []).slice().reverse();   // mais recente no topo
  const tbody = document.getElementById('lista');
  if (!serie.length) {
    tbody.innerHTML = `<tr><td colspan="6" class="empty">Sem vendas no intervalo.</td></tr>`;
    return;
  }
  tbody.innerHTML = serie.map((p) => `<tr>
      <td>${fmtData(p.data)}</td>
      <td class="num">${fmtNum(Math.round(p.qt))}</td>
      <td class="num">${fmtBRL(p.vlr)}</td>
      <td class="num muted">${p.devVlr ? '− ' + fmtBRL(p.devVlr) : '—'}</td>
      <td class="num">${fmtBRL(p.liqVlr)}</td>
      <td class="num muted">${fmtNum(p.ped)}</td>
    </tr>`).join('');
}

function aplicarGrupo() {
  if (!DADOS) return;
  const g = DADOS.grupos[GRUPO];
  const nome = GRUPO === 'entregas' ? 'Entregas' : 'Ceasa';
  document.getElementById('prodSub').textContent = `· ${nome} · ${fmtData(DADOS.ini)} a ${fmtData(DADOS.fim)}`;
  document.getElementById('tblSub').textContent = `· ${nome}`;
  renderKpis(g);
  renderProdutos(DADOS.produtos[GRUPO]);
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

// ===================================================================
// Planejamento de compra: quantidade por produto × dia da semana,
// nas últimas semanas fechadas. Só kg — nenhum valor em R$.
// ===================================================================
let PLAN = null;                 // resposta de /api/vendas/planejamento
let PGRUPO = 'todos';            // 'todos' | 'entregas' | 'ceasa'
let PMETRICA = 'media';          // 'media' | 'mediana' | 'max'
let PVISAO = 'matriz';           // 'matriz' | 'semanas'

const CORES_PROD = ['#f59e0b', '#fbbf24', '#fb923c', '#a3e635', '#c084fc', '#5eead4', '#93c5fd'];
const HOJE_DOW = (new Date().getDay() + 6) % 7;      // 0 = segunda

const soma = (a) => a.reduce((s, x) => s + x, 0);
const media = (a) => (a.length ? soma(a) / a.length : 0);
const maxv = (a) => (a.length ? Math.max(...a) : 0);
const minv = (a) => (a.length ? Math.min(...a) : 0);
function mediana(a) {
  const s = a.slice().sort((x, y) => x - y), n = s.length;
  if (!n) return 0;
  return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2;
}
// Coeficiente de variação: o quanto aquele dia se repete de semana a semana.
function cv(a) {
  const m = media(a);
  if (!m) return 0;
  return Math.sqrt(media(a.map((x) => (x - m) ** 2))) / m;
}
const kg = (n) => fmtNum(Math.round(n));
const curto = (iso) => iso.slice(8, 10) + '/' + iso.slice(5, 7);
const nomeMetrica = () => (PMETRICA === 'media' ? 'média' : PMETRICA === 'mediana' ? 'mediana' : 'pico');
const refDe = (a) => (PMETRICA === 'media' ? media(a) : PMETRICA === 'mediana' ? mediana(a) : maxv(a));

function planM() { return PLAN.matriz[PGRUPO]; }
function planSerie(cod, i) { return (planM()[cod] || [])[i] || []; }
// Dias sem nenhuma venda em nenhum produto (tipicamente domingo) somem da tela.
function planDias() {
  return PLAN.dias.map((_, i) => i).filter((i) =>
    PLAN.produtos.some((p) => soma(planSerie(p.cod, i)) > 0));
}
function corProd(idx) { return CORES_PROD[idx % CORES_PROD.length]; }

// Heatmap relativo à própria linha: o dia mais fraco quase apaga, o mais
// pesado fica cheio — é o contraste que faz o padrão semanal saltar.
function heat(v, min, max) {
  if (!v) return 'transparent';
  const t = max > min ? (v - min) / (max - min) : 1;
  return `rgba(45,212,191,${(0.05 + Math.pow(t, 0.85) * 0.40).toFixed(3)})`;
}

function renderPlanStats(dias) {
  const porDia = dias.map((i) => soma(PLAN.produtos.map((p) => refDe(planSerie(p.cod, i)))));
  const total = soma(porDia);
  const nSem = PLAN.semanas.length;
  const totSem = PLAN.semanas.map((_, w) =>
    soma(PLAN.produtos.flatMap((p) => dias.map((i) => planSerie(p.cod, i)[w] || 0))));
  const ult = totSem[nSem - 1], ant = totSem[nSem - 2];
  const varPct = ant ? (ult / ant - 1) * 100 : 0;
  const iMax = porDia.indexOf(Math.max(...porDia));
  const iMin = porDia.indexOf(Math.min(...porDia));
  const pct = (v) => (total ? Math.round(v / total * 100) : 0);

  document.getElementById('planStats').innerHTML = `
    <div class="stat ac-teal">
      <div class="ic">▦</div>
      <div class="bd">
        <div class="lb">Semana típica</div>
        <div class="vl">${kg(total)} <small style="font-size:12px;font-weight:500;color:var(--text-dim)">kg</small></div>
        <div class="sub">${nomeMetrica()} de ${nSem} semanas</div>
      </div>
    </div>
    <div class="stat ac-amber">
      <div class="ic">▲</div>
      <div class="bd">
        <div class="lb">Dia mais pesado</div>
        <div class="vl">${PLAN.dias[dias[iMax]]} · ${kg(porDia[iMax])}</div>
        <div class="sub">${pct(porDia[iMax])}% da semana</div>
      </div>
    </div>
    <div class="stat ac-blue">
      <div class="ic">▼</div>
      <div class="bd">
        <div class="lb">Dia mais leve</div>
        <div class="vl">${PLAN.dias[dias[iMin]]} · ${kg(porDia[iMin])}</div>
        <div class="sub">${pct(porDia[iMin])}% da semana</div>
      </div>
    </div>
    <div class="stat ac-teal">
      <div class="ic">≈</div>
      <div class="bd">
        <div class="lb">Última semana</div>
        <div class="vl">${kg(ult)} <small style="font-size:12px;font-weight:500;color:var(--text-dim)">kg</small></div>
        <div class="sub">${ant ? (varPct >= 0 ? '▲ +' : '▼ ') + varPct.toFixed(1) + '% vs. anterior' : '—'}</div>
      </div>
    </div>`;
}

function renderPlanMatriz(dias) {
  const head = `<thead><tr>
      <th class="col-prod">PRODUTO</th>
      ${dias.map((i) => `<th class="${i === HOJE_DOW ? 'dia-hoje' : ''}">${PLAN.dias[i].toUpperCase()}</th>`).join('')}
      <th class="col-sem">SEMANA</th>
    </tr></thead>`;

  const linhas = PLAN.produtos.map((p, idx) => {
    const refs = dias.map((i) => refDe(planSerie(p.cod, i)));
    const comVenda = refs.filter((v) => v > 0);
    const maxL = maxv(comVenda) || 1;
    const minL = minv(comVenda.length ? comVenda : [0]);
    // Estabilidade do produto: média do CV dia a dia — diz o quanto dá para
    // confiar na referência ao fechar o pedido.
    const cvs = dias.map((i) => cv(planSerie(p.cod, i))).filter((x) => x > 0);
    const cm = media(cvs);
    const s = !cvs.length ? { cls: 'med', txt: 'sem base' }
      : cm <= 0.10 ? { cls: 'ok', txt: 'estável' }
      : cm <= 0.18 ? { cls: 'med', txt: 'oscila' } : { cls: 'alto', txt: 'instável' };

    const cels = dias.map((i, k) => {
      const serie = planSerie(p.cod, i);
      const v = refs[k];
      const mx = maxv(serie) || 1;
      const barras = serie.map((x, w) =>
        `<i class="${w === serie.length - 1 ? 'last' : ''}" style="height:${Math.max(2, Math.round(x / mx * 14))}px"></i>`).join('');
      return `<td class="cel">
        <div class="cel-in" tabindex="0" role="button" data-cod="${p.cod}" data-dia="${i}"
             style="background:${heat(v, minL, maxL)}">
          <div class="cel-v ${v ? '' : 'zero'}">${v ? kg(v) : '—'}</div>
          <div class="cel-rng">${v ? kg(minv(serie)) + '–' + kg(mx) : 'sem venda'}</div>
          <div class="spark">${barras}</div>
        </div>
      </td>`;
    }).join('');

    return `<tr>
      <td class="prod">
        <div class="prod-nome"><span class="prod-dot" style="background:${corProd(idx)}"></span>${p.nome}</div>
        <div class="prod-sub">cód. ${p.cod} · <span class="est ${s.cls}">${s.txt}</span></div>
      </td>
      ${cels}
      <td class="sem"><div class="sem-v">${kg(soma(refs))}</div><div class="sem-k">kg / semana</div></td>
    </tr>`;
  }).join('');

  const refsTot = dias.map((i) => soma(PLAN.produtos.map((p) => refDe(planSerie(p.cod, i)))));
  const totSemana = soma(refsTot);
  const rodape = `<tr class="tot-row">
    <td class="prod"><div class="prod-nome">Total por dia</div><div class="prod-sub">${nomeMetrica()} de ${PLAN.semanas.length} semanas</div></td>
    ${refsTot.map((v) => `<td class="cel"><div class="cel-in" style="background:${heat(v, minv(refsTot), maxv(refsTot))}">
      <div class="cel-v">${kg(v)}</div>
      <div class="cel-rng">${totSemana ? Math.round(v / totSemana * 100) : 0}% da semana</div>
    </div></td>`).join('')}
    <td class="sem"><div class="sem-v">${kg(totSemana)}</div><div class="sem-k">kg / semana</div></td>
  </tr>`;

  const wrap = document.getElementById('planMatriz');
  wrap.innerHTML = `<table class="mx">${head}<tbody>${linhas}${rodape}</tbody></table>`;
  wrap.querySelectorAll('.cel-in[data-cod]').forEach((c) => {
    const abrir = () => abrirDetalhe(Number(c.dataset.cod), Number(c.dataset.dia));
    c.addEventListener('click', abrir);
    c.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); abrir(); } });
  });
}

function renderPlanSemanas(dias) {
  const head = `<thead><tr>
      <th class="col-prod">SEMANA</th>
      ${dias.map((i) => `<th>${PLAN.dias[i].toUpperCase()}</th>`).join('')}
      <th>TOTAL</th>
    </tr></thead>`;

  const blocos = PLAN.produtos.map((p, idx) => {
    const linhasS = PLAN.semanas.map((s, w) => {
      const vals = dias.map((i) => planSerie(p.cod, i)[w] || 0);
      const tot = soma(vals);
      const ant = w > 0 ? soma(dias.map((i) => planSerie(p.cod, i)[w - 1] || 0)) : null;
      const d = ant ? (tot / ant - 1) * 100 : null;
      const badge = d === null ? ''
        : `<span class="delta ${d >= 0 ? 'up' : 'dn'}">${d >= 0 ? '▲' : '▼'}${Math.abs(d).toFixed(0)}%</span>`;
      return `<tr>
        <td class="wlabel"><b>S${w + 1}</b> · ${curto(s.ini)} a ${curto(s.fim)}</td>
        ${vals.map((v) => `<td>${v ? kg(v) : '<span class="muted">—</span>'}</td>`).join('')}
        <td><b>${kg(tot)}</b>${badge}</td>
      </tr>`;
    }).join('');

    const refs = dias.map((i) => refDe(planSerie(p.cod, i)));
    const linhaRef = `<tr class="media">
      <td class="wlabel">${nomeMetrica().toUpperCase()}</td>
      ${refs.map((v) => `<td>${kg(v)}</td>`).join('')}
      <td>${kg(soma(refs))}</td>
    </tr>`;

    return `<tr class="grp"><td colspan="${dias.length + 2}">
        <span class="prod-dot" style="display:inline-block;background:${corProd(idx)};margin-right:8px"></span>${p.nome}
      </td></tr>${linhasS}${linhaRef}`;
  }).join('');

  document.getElementById('planWk').innerHTML = `<table class="wk">${head}<tbody>${blocos}</tbody></table>`;
}

function abrirDetalhe(cod, i) {
  const p = PLAN.produtos.find((x) => x.cod === cod);
  const serie = planSerie(cod, i);
  const mx = maxv(serie) || 1;
  const ref = refDe(serie);
  const cvp = cv(serie);
  const s = cvp <= 0.10 ? { cls: 'ok', txt: 'estável' }
    : cvp <= 0.18 ? { cls: 'med', txt: 'oscila' } : { cls: 'alto', txt: 'instável' };
  const cobre = serie.length ? Math.round(serie.filter((v) => v <= ref).length / serie.length * 100) : 0;

  document.getElementById('ddTtl').textContent = `${p.nome} · ${PLAN.dias[i]}`;
  document.getElementById('ddSub').textContent =
    `${PLAN.semanas.length} semanas fechadas · quantidade em kg`;

  const barras = serie.map((v, w) => `
    <div class="dd-bar">
      <span class="dt">S${w + 1} · ${curto(PLAN.semanas[w].ini)}</span>
      <span class="tr"><span class="fl ${w === serie.length - 1 ? '' : 'dim'}" style="width:${Math.max(2, v / mx * 100)}%"></span></span>
      <span class="vl">${v ? kg(v) : '—'}</span>
    </div>`).join('');

  document.getElementById('ddBody').innerHTML = `
    <div class="dd-head">
      <div class="dd-big">${kg(ref)}<small>kg</small></div>
      <span class="est ${s.cls}">${s.txt}</span>
    </div>
    <div class="dd-hint">${nomeMetrica()} das semanas fechadas · variação de ${(cvp * 100).toFixed(0)}% entre elas</div>

    <div class="dd-grid">
      <div class="dd-box"><div class="dd-k">Mínimo</div><div class="dd-v">${kg(minv(serie))}</div></div>
      <div class="dd-box"><div class="dd-k">Máximo</div><div class="dd-v">${kg(mx)}</div></div>
      <div class="dd-box"><div class="dd-k">Mediana</div><div class="dd-v">${kg(mediana(serie))}</div></div>
      <div class="dd-box"><div class="dd-k">Última semana</div><div class="dd-v">${kg(serie[serie.length - 1] || 0)}</div></div>
    </div>

    <div class="dd-k" style="margin-bottom:4px">Semana a semana</div>
    <div class="dd-bars">${barras}</div>

    <div class="dd-note" style="margin-top:16px">
      Para cobrir <b>todas</b> as semanas nesse dia seriam <b>${kg(mx)} kg</b>;
      a ${nomeMetrica()} cobre ${cobre}% delas.
    </div>`;

  document.getElementById('dd').classList.add('on');
}
function fecharDetalhe() { document.getElementById('dd').classList.remove('on'); }
document.querySelectorAll('#dd [data-fechar]').forEach((b) => b.addEventListener('click', fecharDetalhe));
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') fecharDetalhe(); });

function renderPlan() {
  if (!PLAN) return;
  const dias = planDias();
  document.getElementById('planSemanas').textContent = `${PLAN.semanas.length} semanas fechadas`;
  document.getElementById('planPeriodo').textContent = `${curto(PLAN.ini)} → ${curto(PLAN.fim)}`;
  document.getElementById('planSub').textContent = `· ${nomeMetrica()} das semanas fechadas · kg`;
  if (!dias.length) {
    document.getElementById('planStats').innerHTML = '';
    document.getElementById('planMatriz').innerHTML = '<div class="empty">Sem vendas nas semanas fechadas.</div>';
    document.getElementById('planWk').innerHTML = '';
    return;
  }
  renderPlanStats(dias);
  renderPlanMatriz(dias);
  renderPlanSemanas(dias);
  document.getElementById('planMatriz').hidden = PVISAO !== 'matriz';
  document.getElementById('planWk').hidden = PVISAO !== 'semanas';
}

async function carregarPlan() {
  if (!PLAN) PLAN = await api('/api/vendas/planejamento');
  renderPlan();
}

function ligaSeg(id, fn) {
  document.querySelectorAll('#' + id + ' button').forEach((b) => {
    b.addEventListener('click', () => {
      document.querySelectorAll('#' + id + ' button').forEach((x) => x.classList.toggle('on', x === b));
      fn(b.dataset.v);
    });
  });
}
ligaSeg('segGrupo', (v) => { PGRUPO = v; renderPlan(); });
ligaSeg('segMetrica', (v) => { PMETRICA = v; renderPlan(); });
ligaSeg('segVisao', (v) => { PVISAO = v; renderPlan(); });

// ===== Troca de aba =====
function aplicarAba() {
  document.querySelectorAll('#abas button').forEach((b) => b.classList.toggle('on', b.dataset.g === ABA));
  const plan = ABA === 'plan';
  document.getElementById('viewPlan').hidden = !plan;
  document.getElementById('viewVendas').hidden = plan;
  document.getElementById('ctlDatas').hidden = plan;      // período é fixo no planejamento
  if (plan) {
    carregarPlan().catch((e) => {
      document.getElementById('planMatriz').innerHTML = `<div class="empty">Falha: ${e.message}</div>`;
    });
  } else {
    GRUPO = ABA;
    aplicarGrupo();
  }
}
document.querySelectorAll('#abas button').forEach((b) => {
  b.addEventListener('click', () => { ABA = b.dataset.g; aplicarAba(); });
});

carregar().catch((e) => { document.getElementById('kpis').innerHTML = `<div class="empty">Falha: ${e.message}</div>`; });
