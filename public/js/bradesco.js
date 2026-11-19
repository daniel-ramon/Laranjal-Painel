document.getElementById('side').innerHTML = sidebar('bradesco');

function pad2(n) { return String(n).padStart(2, '0'); }
function isoHoje() { const d = new Date(); return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()); }
function isoPrimeiroDia() { const d = new Date(); return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-01'; }

let INI = isoPrimeiroDia();
let FIM = isoHoje();
const FONTE = 'api';     // sempre API do Bradesco (modo demonstração removido)
let DADOS = null;
let TIPO = null;         // 'creditos' | 'debitos' | null
let ORIGEM = 'TODAS';    // 'TODAS' | 'periodo' | 'ultimos' | 'dia'
let BUSCA = '';
const SEL = new Set();   // ids dos lançamentos marcados (soma flutuante)

const ORIGEM_LBL = { periodo: 'Período', ultimos: 'Últimos', dia: 'Do dia', futuro: 'Futuro' };

function porTipo(l) {
  if (!TIPO) return true;
  return TIPO === 'creditos' ? l.credito : !l.credito;
}
function porOrigem(l) { return ORIGEM === 'TODAS' || l.secao === ORIGEM; }
function porBusca(l) {
  if (!BUSCA) return true;
  const q = BUSCA.toLowerCase();
  return (l.descricao || '').toLowerCase().includes(q)
    || (l.complemento || '').toLowerCase().includes(q)
    || String(l.documento || '').includes(q);
}

function kpiCard(id, titulo, valor, cls, sub, clickable) {
  return `
  <div class="kpi ${TIPO === id ? 'active' : ''}" data-id="${clickable ? id : ''}">
    <div class="t"><span class="dot" style="background:var(--${cls})"></span>${titulo}</div>
    <div class="v">${fmtBRL(valor)}</div>
    <div class="q">${sub || ''}</div>
  </div>`;
}

async function carregar() {
  const qs = `?fonte=${FONTE}&ini=${INI}&fim=${FIM}`;
  const d = await api('/api/bradesco' + qs);
  DADOS = d;
  // id estável por lançamento (para marcar e somar entre re-renderizações)
  SEL.clear();
  (d.lancamentos || []).forEach((l, i) => { l._id = 'L' + i; });
  render();
}

// ---- Seleção de lançamentos + soma flutuante ----
function lancSelecionados() {
  return (DADOS && DADOS.lancamentos ? DADOS.lancamentos : []).filter((l) => SEL.has(l._id));
}
function atualizarSelbar() {
  const bar = document.getElementById('selbar');
  const sel = lancSelecionados();
  if (!sel.length) {
    bar.hidden = true;
    document.body.classList.remove('selbar-on');
    return;
  }
  const soma = sel.reduce((s, l) => s + (Number(l.valor) || 0), 0);
  document.getElementById('selCount').textContent = fmtNum(sel.length);
  const somaEl = document.getElementById('selSoma');
  somaEl.textContent = fmtBRL(soma);
  somaEl.className = soma < 0 ? 'neg' : 'pos';
  bar.hidden = false;
  document.body.classList.add('selbar-on');
}
// Estado do checkbox "selecionar todos" conforme as linhas visíveis.
function sincronizarSelAll(linhas) {
  const selAll = document.getElementById('selAll');
  if (!selAll) return;
  const marcadas = linhas.filter((l) => SEL.has(l._id)).length;
  selAll.checked = linhas.length > 0 && marcadas === linhas.length;
  selAll.indeterminate = marcadas > 0 && marcadas < linhas.length;
}

function render() {
  const d = DADOS;
  const aviso = document.getElementById('aviso');
  const modo = document.getElementById('modo');

  if (!d || !d.ok) {
    document.getElementById('kpis').innerHTML = '';
    document.getElementById('lista').innerHTML =
      `<tr><td colspan="6" class="empty">Não foi possível carregar o extrato.</td></tr>`;
    document.getElementById('futurosWrap').style.display = 'none';
    document.getElementById('cont').textContent = '';
    aviso.style.display = 'block';
    aviso.className = 'aviso erro';
    aviso.textContent = 'Erro: ' + ((d && d.erro) || 'desconhecido');
    modo.textContent = '';
    return;
  }

  modo.textContent = 'API ' + (d.modo || '');
  document.getElementById('contaSub').textContent =
    `Conta ${d.conta.formatada}${d.conta.nome_cliente ? ' · ' + d.conta.nome_cliente : ''} · ${fmtData(d.periodo.inicio)} a ${fmtData(d.periodo.fim)}`;

  // Mensagens que a API devolve (ex.: "CTAS0673 - CONSULTA EFETUADA COM SUCESSO").
  aviso.style.display = (d.mensagens && d.mensagens.length) ? 'block' : 'none';
  aviso.className = 'aviso info';
  aviso.textContent = (d.mensagens || []).join(' · ');

  // ---- KPIs: saldo atual é o destaque ----
  const anteriorSub = d.data_saldo_anterior ? ('em ' + fmtData(d.data_saldo_anterior)) : '';
  let kpisHtml =
    kpiCard('', 'Saldo atual', d.saldo_final, 'blue', `ao fim de ${fmtData(d.periodo.fim)}`, false) +
    kpiCard('', 'Saldo anterior', d.saldo_anterior, 'amber', anteriorSub, false) +
    kpiCard('creditos', 'Créditos', d.creditos, 'green', `${fmtNum(d.lancamentos.filter(l => l.credito).length)} lanç.`, true) +
    kpiCard('debitos', 'Débitos', -Math.abs(d.debitos), 'red', `${fmtNum(d.lancamentos.filter(l => !l.credito).length)} lanç.`, true);
  // Cheque especial disponível (produto "LIMITE A UTILIZAR" da API de Saldo).
  // Só vem no modo API; em demonstração é null e o card não aparece.
  if (d.cheque_especial_disponivel != null) {
    kpisHtml += kpiCard('', 'Cheque esp. disponível', d.cheque_especial_disponivel, 'violet', 'limite a utilizar', false);
  }
  document.getElementById('kpis').innerHTML = kpisHtml;
  document.querySelectorAll('.kpi').forEach((k) => {
    if (!k.dataset.id) { k.style.cursor = 'default'; return; }
    k.onclick = () => { TIPO = (TIPO === k.dataset.id) ? null : k.dataset.id; render(); };
  });

  // ---- Tabela de lançamentos (mais recentes no topo) ----
  // A ponte devolve os lançamentos em ordem crescente de data; invertendo,
  // o mais novo (inclusive o último do dia) fica no topo e os antigos descem.
  const linhas = d.lancamentos.filter((l) => porTipo(l) && porOrigem(l) && porBusca(l)).reverse();
  const tbody = document.getElementById('lista');
  if (!linhas.length) {
    tbody.innerHTML = `<tr><td colspan="7" class="empty">Nenhum lançamento para este filtro.</td></tr>`;
  } else {
    tbody.innerHTML = linhas.map((l) => {
      const compl = l.complemento ? `<div class="muted compl">${l.complemento}</div>` : '';
      const cls = l.credito ? 'credito' : 'debito';
      const saldo = l.saldo_apos != null ? fmtBRL(l.saldo_apos) : '—';
      const marcado = SEL.has(l._id);
      return `<tr class="${marcado ? 'sel' : ''}">
        <td class="chk"><input type="checkbox" class="selbox" data-id="${l._id}" ${marcado ? 'checked' : ''} /></td>
        <td>${fmtData(l.data)}</td>
        <td>${l.descricao || '—'}${compl}</td>
        <td class="muted">${l.documento || ''}</td>
        <td><span class="pill origem">${ORIGEM_LBL[l.secao] || l.secao}</span></td>
        <td class="num ${cls}">${fmtBRL(l.valor)}</td>
        <td class="num muted">${saldo}</td>
      </tr>`;
    }).join('');
  }
  // marca/desmarca uma linha
  tbody.querySelectorAll('.selbox').forEach((cb) => {
    cb.addEventListener('change', () => {
      if (cb.checked) SEL.add(cb.dataset.id); else SEL.delete(cb.dataset.id);
      cb.closest('tr').classList.toggle('sel', cb.checked);
      atualizarSelbar();
      sincronizarSelAll(linhas);
    });
  });
  // "selecionar todos os visíveis"
  const selAll = document.getElementById('selAll');
  selAll.onchange = () => {
    linhas.forEach((l) => { if (selAll.checked) SEL.add(l._id); else SEL.delete(l._id); });
    render();
  };
  sincronizarSelAll(linhas);
  atualizarSelbar();
  document.getElementById('cont').textContent = `· ${linhas.length} de ${d.lancamentos.length}`;
  const fLbl = TIPO ? (TIPO === 'creditos' ? 'Créditos' : 'Débitos') : '';
  document.getElementById('filtro').textContent = fLbl ? ('Filtro: ' + fLbl) : '';
  document.getElementById('limpar').style.display = TIPO ? 'inline' : 'none';
  document.getElementById('limpar').onclick = () => { TIPO = null; render(); };

  // ---- Futuros ----
  const wrap = document.getElementById('futurosWrap');
  if (d.futuros && d.futuros.length) {
    wrap.style.display = '';
    document.getElementById('contFut').textContent = `· ${d.futuros.length}`;
    document.getElementById('listaFut').innerHTML = d.futuros.map((l) => {
      const cls = l.credito ? 'credito' : 'debito';
      return `<tr>
        <td>${fmtData(l.data)}</td>
        <td>${l.descricao || '—'}</td>
        <td class="muted">${l.documento || ''}</td>
        <td class="num ${cls}">${fmtBRL(l.valor)}</td>
      </tr>`;
    }).join('');
  } else {
    wrap.style.display = 'none';
  }
}

// ---- Controles ----
function initControls() {
  const dtIni = document.getElementById('dtIni');
  const dtFim = document.getElementById('dtFim');
  dtIni.value = INI; dtFim.value = FIM;

  document.getElementById('aplicar').onclick = () => {
    INI = dtIni.value || INI;
    FIM = dtFim.value || FIM;
    carregar();
  };
  document.getElementById('origemSel').onchange = (e) => { ORIGEM = e.target.value; render(); };
  document.getElementById('busca').oninput = (e) => { BUSCA = e.target.value; render(); };
  document.getElementById('selLimpar').onclick = () => { SEL.clear(); render(); };
}

initControls();
carregar();
