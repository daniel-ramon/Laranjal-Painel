document.getElementById('side').innerHTML = sidebar('contas');

let MES = getMes();
let DADOS = null;
let FILTRO = null;      // 'vencidos' | 'hoje' | 'semana' | 'pagos' | null
let EMPRESA = 'TODAS';  // 'TODAS' | 'AK' | 'JRF'
let BUSCA = '';         // texto de busca
let DATA_VENC = '';     // 'YYYY-MM-DD' | '' (filtro por data de vencimento)

const LABEL = { vencidos: 'Vencidos', hoje: 'Vencem hoje', semana: 'Vencem esta semana', pagos: 'Pagos' };
const PILL = { vencido: 'Vencido', vence_hoje: 'Vence hoje', vence_semana: 'Esta semana', proximo: 'Próximo', pago: 'Pago' };

// Retorna {qtd, valor} conforme a empresa selecionada.
function porEmpresaSel(dados) {
  if (EMPRESA === 'AK') return dados.ak;
  if (EMPRESA === 'JRF') return dados.jrf;
  return dados;
}

function kpiHtml(id, dados, cls) {
  const v = porEmpresaSel(dados);
  const mini = EMPRESA === 'TODAS'
    ? `<div class="mini"><span>AK <b>${fmtBRL(dados.ak.valor)}</b></span><span>JRF <b>${fmtBRL(dados.jrf.valor)}</b></span></div>`
    : '';
  return `
  <div class="kpi ${FILTRO === id ? 'active' : ''}" data-id="${id}">
    <div class="t"><span class="dot" style="background:var(--${cls})"></span>${LABEL[id]}</div>
    <div class="v">${fmtBRL(v.valor)}</div>
    <div class="q">${fmtNum(v.qtd)} título(s)</div>
    ${mini}
  </div>`;
}

function passaEmpresa(t) {
  return EMPRESA === 'TODAS' || t.origem === EMPRESA;
}
function passaBusca(t) {
  if (!BUSCA) return true;
  const q = BUSCA.toLowerCase();
  return (t.fornecedor || '').toLowerCase().includes(q)
    || String(t.numnota || '').toLowerCase().includes(q)
    || (t.historico || '').toLowerCase().includes(q);
}
function passaData(t) {
  return !DATA_VENC || t.dtvenc === DATA_VENC;
}

function passaFiltro(t) {
  if (!FILTRO) return true;
  if (FILTRO === 'vencidos') return t.isVencido;
  if (FILTRO === 'hoje') return t.isVenceHoje;
  if (FILTRO === 'semana') return t.isVenceSemana;
  if (FILTRO === 'pagos') return t.isPago;
  return true;
}

function render() {
  const d = DADOS;
  document.getElementById('kpis').innerHTML =
    kpiHtml('vencidos', d.kpis.vencidos, 'red') +
    kpiHtml('hoje', d.kpis.hoje, 'amber') +
    kpiHtml('semana', d.kpis.semana, 'blue') +
    kpiHtml('pagos', d.kpis.pagos, 'green');
  document.querySelectorAll('.kpi').forEach((k) => {
    k.onclick = () => { FILTRO = (FILTRO === k.dataset.id) ? null : k.dataset.id; render(); };
  });

  // ordena do vencimento mais próximo (menor dias) para o mais distante
  let linhas = d.titulos.filter((t) => passaFiltro(t) && passaEmpresa(t) && passaBusca(t) && passaData(t)).slice()
    .sort((a, b) => {
      if (a.isPago !== b.isPago) return a.isPago ? 1 : -1; // pagos por último
      return a.diasParaVenc - b.diasParaVenc || (a.dtvenc < b.dtvenc ? -1 : 1);
    });

  const tbody = document.getElementById('lista');
  if (!linhas.length) {
    tbody.innerHTML = `<tr><td colspan="9" class="empty">Nenhum título para este filtro.</td></tr>`;
  } else {
    tbody.innerHTML = linhas.map((t) => {
      const dias = t.isPago ? '—'
        : (t.diasParaVenc < 0 ? `<span class="dias-neg">${t.diasParaVenc}d</span>`
          : (t.diasParaVenc === 0 ? 'hoje' : `+${t.diasParaVenc}d`));
      return `<tr>
        <td><span class="emp-badge emp-${t.origem}">${t.origem}</span></td>
        <td>${fmtData(t.dtvenc)}</td>
        <td>${dias}</td>
        <td>${t.fornecedor}</td>
        <td class="muted hist" title="${(t.historico || '').replace(/"/g, '&quot;')}">${t.historico || '—'}</td>
        <td class="muted">${t.numnota ?? '—'}</td>
        <td class="muted">${t.filial ?? '—'}</td>
        <td><span class="pill ${t.situacao}">${PILL[t.situacao] || t.situacao}</span></td>
        <td class="num">${fmtBRL(t.valor)}</td>
      </tr>`;
    }).join('');
  }

  document.getElementById('cont').textContent = `· ${linhas.length} de ${d.titulos.length}`;
  document.getElementById('filtro').textContent = FILTRO ? `Filtro: ${LABEL[FILTRO]}` : '';
  document.getElementById('limpar').style.display = FILTRO ? 'inline' : 'none';
  document.getElementById('limpar').onclick = () => { FILTRO = null; render(); };
}

async function carregar() {
  document.getElementById('mp').replaceChildren(monthPicker(MES, (m) => {
    MES = m; setMes(m);
    DATA_VENC = ''; document.getElementById('dataVenc').value = ''; // limpa filtro de data ao trocar mês
    carregar();
  }));
  DADOS = await api('/api/contas?mes=' + MES);
  document.getElementById('modo').textContent = DADOS.modo === 'exemplo' ? '● dados de exemplo' : '● Oracle';
  document.getElementById('legend').innerHTML = legendaEmpresas(DADOS.empresas);
  render();
}

// filtros que agem sobre os dados já carregados (sem ir ao servidor)
document.getElementById('empresaSel').addEventListener('change', (e) => {
  EMPRESA = e.target.value;
  if (DADOS) render();
});
document.getElementById('busca').addEventListener('input', (e) => {
  BUSCA = e.target.value.trim();
  if (DADOS) render();
});
document.getElementById('dataVenc').addEventListener('change', (e) => {
  DATA_VENC = e.target.value; // 'YYYY-MM-DD' ou ''
  if (DATA_VENC && DATA_VENC.slice(0, 7) !== MES) {
    MES = DATA_VENC.slice(0, 7); // troca de mês automaticamente
    setMes(MES);
    carregar();                  // recarrega e chama render (mantém o filtro de data)
  } else if (DADOS) {
    render();
  }
});

carregar().catch((e) => { document.getElementById('lista').innerHTML = `<tr><td colspan="9" class="empty">Falha: ${e.message}</td></tr>`; });
