document.getElementById('side').innerHTML = sidebar('nordestao');

// Datas padrão: início = 1º dia do mês corrente; fim = hoje (ambos editáveis).
function pad2(n) { return String(n).padStart(2, '0'); }
function isoHoje() { const d = new Date(); return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()); }
function isoPrimeiroDia() { const d = new Date(); return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-01'; }
let INI = isoPrimeiroDia();
let FIM = isoHoje();
let DADOS = null;
let FILTRO = null;      // 'adiantados' | 'pendentes' | null
let LOJA = 'TODAS';     // 'TODAS' | codcli
let BUSCA = '';

function porFiltro(t) {
  if (!FILTRO) return true;
  if (FILTRO === 'adiantados') return t.adiantado;
  if (FILTRO === 'pendentes') return !t.adiantado;
  return true;
}
function porLoja(t) { return LOJA === 'TODAS' || String(t.codcli) === String(LOJA); }
function porBusca(t) {
  if (!BUSCA) return true;
  const q = BUSCA.toLowerCase();
  return (t.loja || '').toLowerCase().includes(q) || String(t.numnota || '').includes(q);
}

function kpiCard(id, titulo, dados, cls, extra) {
  return `
  <div class="kpi ${FILTRO === id ? 'active' : ''}" data-id="${id}">
    <div class="t"><span class="dot" style="background:var(--${cls})"></span>${titulo}</div>
    <div class="v">${fmtBRL(dados.valor)}</div>
    <div class="q">${fmtNum(dados.qtd)} título(s)</div>
    ${extra || ''}
  </div>`;
}

function render() {
  const d = DADOS, r = d.resumo;
  document.getElementById('kpis').innerHTML =
    kpiCard('', 'Total', { valor: r.valor, qtd: r.qtd }, 'blue', '') +
    kpiCard('adiantados', 'Negociados', r.adiantados, 'green',
      `<div class="mini"><span>Recebido est. <b>${fmtBRL(r.adiantados.recebidoEst)}</b></span><span>Desc. <b>${fmtBRL(r.adiantados.descontoEst)}</b></span></div>`) +
    kpiCard('pendentes', 'Disponíveis', r.pendentes, 'amber', '');
  document.querySelectorAll('.kpi').forEach((k) => {
    if (!k.dataset.id) { k.style.cursor = 'default'; return; }
    k.onclick = () => { FILTRO = (FILTRO === k.dataset.id) ? null : k.dataset.id; render(); };
  });

  const linhas = d.titulos.filter((t) => porFiltro(t) && porLoja(t) && porBusca(t));
  const tbody = document.getElementById('lista');
  if (!linhas.length) {
    tbody.innerHTML = `<tr><td colspan="7" class="empty">Nenhum título para este filtro.</td></tr>`;
  } else {
    tbody.innerHTML = linhas.map((t, i) => {
      const suf = t.fonte === 'anterior' ? ' (anterior)' : (t.fonte === 'pago' ? ' (pago)' : '');
      const badge = t.adiantado
        ? `<span class="pill pago">Negociado${suf}</span>`
        : `<span class="pill proximo">Disponível</span>`;
      const receb = (t.adiantamento && t.adiantamento.recebidoEst != null) ? fmtBRL(t.adiantamento.recebidoEst) : '—';
      return `<tr class="click" data-i="${i}">
        <td>${t.loja}</td>
        <td class="muted">${t.numnota}</td>
        <td>${fmtData(t.emissao)}</td>
        <td>${fmtData(t.dtvenc)}</td>
        <td class="num">${fmtBRL(t.valor)}</td>
        <td>${badge}</td>
        <td class="num">${receb}</td>
      </tr>`;
    }).join('');
    tbody.querySelectorAll('tr.click').forEach((tr) => {
      tr.onclick = () => abrirDetalhe(linhas[parseInt(tr.dataset.i, 10)]);
    });
  }

  document.getElementById('cont').textContent = `· ${linhas.length} de ${d.titulos.length}`;
  document.getElementById('filtro').textContent = FILTRO ? `Filtro: ${FILTRO === 'adiantados' ? 'Negociados' : 'Disponíveis'}` : '';
  document.getElementById('limpar').style.display = FILTRO ? 'inline' : 'none';
  document.getElementById('limpar').onclick = () => { FILTRO = null; render(); };
}

function boxAdiantamento(t) {
  if (!t.adiantado) {
    return `<div class="adbox pend"><b>Título disponível (ainda não negociado).</b></div>`;
  }
  const a = t.adiantamento;
  if (!a) {
    const msg = t.fonte === 'pago'
      ? { t: 'Negociado (título com pagamento registrado).', m: 'DTPAGO preenchida no contas a receber.' }
      : { t: 'Negociado em período anterior.', m: 'Sem dados detalhados no arquivo (NUMNOTA anterior ao menor do relatório).' };
    return `<div class="adbox"><b>${msg.t}</b><div class="muted">${msg.m}</div></div>`;
  }
  const linhasArq = (a.descontoArq != null || a.valorLiquidoArq != null)
    ? `<div class="adrow"><span>Desconto (arquivo)</span><b>${fmtBRL(a.descontoArq)}</b></div>
       <div class="adrow"><span>Valor líquido (arquivo)</span><b>${fmtBRL(a.valorLiquidoArq)}</b></div>` : '';
  return `<div class="adbox ad">
    <div class="adrow"><span>Valor total da venda</span><b>${fmtBRL(t.valor)}</b></div>
    <div class="adrow"><span>Taxa de adiantamento</span><b>${(a.taxa).toLocaleString('pt-BR')}% ao mês</b></div>
    <div class="adrow"><span>Pagamento → vencimento</span><b>${fmtData(a.dataPagamento)} → ${fmtData(a.dataVencimento)} (${a.dias} dias)</b></div>
    <div class="adrow"><span>Desconto estimado</span><b>${fmtBRL(a.descontoEst)}</b></div>
    <div class="adrow total"><span>Valor efetivamente recebido</span><b>${fmtBRL(a.recebidoEst)}</b></div>
    ${linhasArq}
  </div>`;
}

async function abrirDetalhe(t) {
  document.getElementById('dTitulo').textContent = `${t.loja} · Nota ${t.numnota}`;
  document.getElementById('dSub').textContent = `Emissão ${fmtData(t.emissao)} · Venc. ${fmtData(t.dtvenc)} · Venda ${t.numvenda}`;
  const body = document.getElementById('drawerBody');
  body.innerHTML = boxAdiantamento(t) + `<div class="muted" style="margin:14px 0 8px">Itens do pedido</div><div id="itensWrap">Carregando itens…</div>`;
  document.getElementById('drawer').classList.add('on');
  try {
    const r = await api('/api/nordestao/itens?numvenda=' + t.numvenda);
    const wrap = document.getElementById('itensWrap');
    if (!r.itens.length) { wrap.innerHTML = `<div class="empty">Nenhum item encontrado.</div>`; return; }
    wrap.innerHTML = `<table class="itens">
      <thead><tr><th>PRODUTO</th><th class="num">QTD</th><th class="num">UNIT (PUNIT)</th><th class="num">TOTAL</th></tr></thead>
      <tbody>${r.itens.map((i) => `<tr>
        <td>${i.descricao}</td>
        <td class="num">${fmtNum(i.qt)}</td>
        <td class="num">${fmtBRL(i.punit)}</td>
        <td class="num">${fmtBRL(i.total)}</td>
      </tr>`).join('')}
      <tr class="tot"><td>Total dos itens</td><td></td><td></td><td class="num">${fmtBRL(r.totalItens)}</td></tr>
      </tbody></table>`;
  } catch (e) {
    document.getElementById('itensWrap').innerHTML = `<div class="empty">Falha ao carregar itens: ${e.message}</div>`;
  }
}
function fecharDetalhe() { document.getElementById('drawer').classList.remove('on'); }

function preencherLojas() {
  const sel = document.getElementById('lojaSel');
  const vistas = new Map();
  DADOS.titulos.forEach((t) => { if (!vistas.has(t.codcli)) vistas.set(t.codcli, t.loja); });
  const atual = sel.value;
  sel.innerHTML = `<option value="TODAS">Todas as lojas</option>` +
    [...vistas.entries()].sort((a, b) => a[1].localeCompare(b[1]))
      .map(([cod, nome]) => `<option value="${cod}">${nome}</option>`).join('');
  sel.value = atual && [...vistas.keys()].map(String).includes(atual) ? atual : 'TODAS';
  LOJA = sel.value;
}

async function carregar() {
  document.getElementById('dtIni').value = INI;
  document.getElementById('dtFim').value = FIM;
  DADOS = await api('/api/nordestao?ini=' + INI + '&fim=' + FIM);
  document.getElementById('modo').textContent = DADOS.modo === 'exemplo' ? '● dados de exemplo' : '● Oracle';
  const f = DADOS.fonte || {};
  document.getElementById('fonte').textContent = f.ok
    ? `● ${f.count} ref. · menor ${f.min}`
    : '● sem arquivo de adiantamento';
  preencherLojas();
  render();
}

function aplicarDatas() {
  const i = document.getElementById('dtIni').value;
  const f = document.getElementById('dtFim').value;
  if (!i || !f) return;
  if (i > f) { alert('A data inicial não pode ser maior que a final.'); return; }
  INI = i; FIM = f;
  carregar().catch((e) => { document.getElementById('lista').innerHTML = `<tr><td colspan="7" class="empty">Falha: ${e.message}</td></tr>`; });
}
document.getElementById('aplicar').addEventListener('click', aplicarDatas);
document.getElementById('dtIni').addEventListener('change', aplicarDatas);
document.getElementById('dtFim').addEventListener('change', aplicarDatas);
document.getElementById('lojaSel').addEventListener('change', (e) => { LOJA = e.target.value; if (DADOS) render(); });
document.getElementById('busca').addEventListener('input', (e) => { BUSCA = e.target.value.trim(); if (DADOS) render(); });
document.getElementById('drawerBg').addEventListener('click', fecharDetalhe);
document.getElementById('drawerX').addEventListener('click', fecharDetalhe);
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') fecharDetalhe(); });

carregar().catch((e) => { document.getElementById('lista').innerHTML = `<tr><td colspan="7" class="empty">Falha: ${e.message}</td></tr>`; });
