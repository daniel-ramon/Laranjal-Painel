document.getElementById('side').innerHTML = sidebar('bradesco');

function pad2(n) { return String(n).padStart(2, '0'); }
function isoHoje() { const d = new Date(); return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()); }
function isoPrimeiroDia() { const d = new Date(); return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-01'; }

let INI = isoPrimeiroDia();
let FIM = isoHoje();
let FONTE = 'demo';      // 'demo' (fixture) | 'api' (Bradesco)
let DADOS = null;
let TIPO = null;         // 'creditos' | 'debitos' | null
let ORIGEM = 'TODAS';    // 'TODAS' | 'periodo' | 'ultimos' | 'dia'
let BUSCA = '';

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
  render();
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

  modo.textContent = (d.fonte === 'demo' ? 'demonstração' : 'API ' + (d.modo || ''));
  document.getElementById('contaSub').textContent =
    `Conta ${d.conta.formatada}${d.conta.nome_cliente ? ' · ' + d.conta.nome_cliente : ''} · ${fmtData(d.periodo.inicio)} a ${fmtData(d.periodo.fim)}`;

  // Aviso quando em demonstração (dados de exemplo, período fixo do stub).
  if (d.fonte === 'demo') {
    aviso.style.display = 'block';
    aviso.className = 'aviso info';
    aviso.innerHTML = 'Modo <b>demonstração</b>: dados de exemplo do sandbox (período fixo 06–20/11/2024). '
      + 'A consulta real exige as credenciais de produção liberadas no portal Bradesco.';
  } else {
    aviso.style.display = (d.mensagens && d.mensagens.length) ? 'block' : 'none';
    aviso.className = 'aviso info';
    aviso.textContent = (d.mensagens || []).join(' · ');
  }

  // ---- KPIs: saldo atual é o destaque ----
  const anteriorSub = d.data_saldo_anterior ? ('em ' + fmtData(d.data_saldo_anterior)) : '';
  document.getElementById('kpis').innerHTML =
    kpiCard('', 'Saldo atual', d.saldo_final, 'blue', `ao fim de ${fmtData(d.periodo.fim)}`, false) +
    kpiCard('', 'Saldo anterior', d.saldo_anterior, 'amber', anteriorSub, false) +
    kpiCard('creditos', 'Créditos', d.creditos, 'green', `${fmtNum(d.lancamentos.filter(l => l.credito).length)} lanç.`, true) +
    kpiCard('debitos', 'Débitos', -Math.abs(d.debitos), 'red', `${fmtNum(d.lancamentos.filter(l => !l.credito).length)} lanç.`, true);
  document.querySelectorAll('.kpi').forEach((k) => {
    if (!k.dataset.id) { k.style.cursor = 'default'; return; }
    k.onclick = () => { TIPO = (TIPO === k.dataset.id) ? null : k.dataset.id; render(); };
  });

  // ---- Tabela de lançamentos ----
  const linhas = d.lancamentos.filter((l) => porTipo(l) && porOrigem(l) && porBusca(l));
  const tbody = document.getElementById('lista');
  if (!linhas.length) {
    tbody.innerHTML = `<tr><td colspan="6" class="empty">Nenhum lançamento para este filtro.</td></tr>`;
  } else {
    tbody.innerHTML = linhas.map((l) => {
      const compl = l.complemento ? `<div class="muted compl">${l.complemento}</div>` : '';
      const cls = l.credito ? 'credito' : 'debito';
      const saldo = l.saldo_apos != null ? fmtBRL(l.saldo_apos) : '—';
      return `<tr>
        <td>${fmtData(l.data)}</td>
        <td>${l.descricao || '—'}${compl}</td>
        <td class="muted">${l.documento || ''}</td>
        <td><span class="pill origem">${ORIGEM_LBL[l.secao] || l.secao}</span></td>
        <td class="num ${cls}">${fmtBRL(l.valor)}</td>
        <td class="num muted">${saldo}</td>
      </tr>`;
    }).join('');
  }
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
  const fonteSel = document.getElementById('fonteSel');
  dtIni.value = INI; dtFim.value = FIM;
  fonteSel.value = FONTE;

  function aplicarPeriodoDemoTravado() {
    // No modo demonstração o período é fixo (o stub só aceita 06–20/11/2024).
    const demo = FONTE === 'demo';
    dtIni.disabled = demo; dtFim.disabled = demo;
  }
  aplicarPeriodoDemoTravado();

  document.getElementById('aplicar').onclick = () => {
    INI = dtIni.value || INI;
    FIM = dtFim.value || FIM;
    carregar();
  };
  fonteSel.onchange = () => {
    FONTE = fonteSel.value;
    aplicarPeriodoDemoTravado();
    carregar();
  };
  document.getElementById('origemSel').onchange = (e) => { ORIGEM = e.target.value; render(); };
  document.getElementById('busca').oninput = (e) => { BUSCA = e.target.value; render(); };
}

initControls();
carregar();
