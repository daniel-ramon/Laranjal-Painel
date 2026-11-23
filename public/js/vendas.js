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
let GRUPO = 'entregas';      // 'entregas' | 'ceasa'

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
  const g = DADOS.grupos[GRUPO];
  document.querySelectorAll('#abas button').forEach((b) => b.classList.toggle('on', b.dataset.g === GRUPO));
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
document.querySelectorAll('#abas button').forEach((b) => {
  b.addEventListener('click', () => { GRUPO = b.dataset.g; if (DADOS) aplicarGrupo(); });
});

carregar().catch((e) => { document.getElementById('kpis').innerHTML = `<div class="empty">Falha: ${e.message}</div>`; });
