document.getElementById('side').innerHTML = sidebar('dre');

function pad2(n) { return String(n).padStart(2, '0'); }
function isoHoje() { const d = new Date(); return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()); }
function isoPrimeiroDia() { const d = new Date(); return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-01'; }

let INI = isoPrimeiroDia();   // DTPAGO a partir de
let FIM = isoHoje();          // DTPAGO até
let DADOS = null;
let EMPRESA = 'TODAS';
let BUSCA = '';
const ABERTOS = new Set();    // 'g:<id>' e 'c:<id>:<chave>'

const SEV_LABEL = { critica: 'Crítico', atencao: 'Atenção', info: 'Observação' };
const MES_CURTO = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];

// ---------- formatação ----------
function fmtPct(v, casas) {
  if (v == null || !isFinite(v)) return '—';
  return (v * 100).toLocaleString('pt-BR', { maximumFractionDigits: casas == null ? 1 : casas }) + '%';
}
function fmtVar(v) {
  if (v == null || !isFinite(v)) return '<span class="muted">—</span>';
  const cls = v > 0.001 ? 'var-up' : (v < -0.001 ? 'var-down' : 'muted');
  const sinal = v > 0 ? '+' : '';
  return `<span class="${cls}">${sinal}${fmtPct(v)}</span>`;
}
function fmtCurto(n) {
  const a = Math.abs(Number(n) || 0);
  if (a >= 1000000) return (n / 1000000).toLocaleString('pt-BR', { maximumFractionDigits: 1 }) + ' mi';
  if (a >= 1000) return (n / 1000).toLocaleString('pt-BR', { maximumFractionDigits: 0 }) + ' mil';
  return (Number(n) || 0).toLocaleString('pt-BR', { maximumFractionDigits: 0 });
}
function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
function mesLbl(mes) {
  const [y, m] = mes.split('-');
  return MES_CURTO[Number(m) - 1] + '/' + y.slice(2);
}

// ---------- recorte por empresa / busca ----------
function campoEmpresa(obj, base) {
  // base: '' (total), 'anterior', 'media3'
  if (EMPRESA === 'AK') return obj[base ? base + 'Ak' : 'ak'];
  if (EMPRESA === 'JRF') return obj[base ? base + 'Jrf' : 'jrf'];
  return obj[base || 'total'];
}

function casaBusca(l, nomeGrupo, nomeConta) {
  if (!BUSCA) return true;
  const q = BUSCA.toLowerCase();
  return [nomeGrupo, nomeConta, l.fornecedor, l.historico, l.numnota, l.funcionario, l.numlanc]
    .some((v) => String(v == null ? '' : v).toLowerCase().includes(q));
}

// Reconstrói a árvore já filtrada. Sem filtro, os totais batem com os do servidor.
function montarArvore() {
  const grupos = [];
  (DADOS.grupos || []).forEach((g) => {
    const contas = [];
    let t = 0, ak = 0, jrf = 0, n = 0;
    g.contas.forEach((c) => {
      const ls = c.lancamentos.filter((l) =>
        (EMPRESA === 'TODAS' || l.origem === EMPRESA) && casaBusca(l, g.nome, c.nome));
      if (!ls.length) return;
      let ct = 0, cak = 0, cjrf = 0;
      ls.forEach((l) => { ct += l.pago; if (l.origem === 'AK') cak += l.pago; else cjrf += l.pago; });
      contas.push({
        chave: c.chave, codconta: c.codconta, nome: c.nome, nova: c.nova,
        t: ct, ak: cak, jrf: cjrf, n: ls.length, lanc: ls,
        anterior: campoEmpresa(c, 'anterior'), media3: campoEmpresa(c, 'media3'),
      });
      t += ct; ak += cak; jrf += cjrf; n += ls.length;
    });
    if (!contas.length) return;
    contas.sort((a, b) => b.t - a.t);
    grupos.push({
      id: g.id, nome: g.nome, nomesOrigem: g.nomesOrigem, investimento: g.investimento,
      t, ak, jrf, n, contas,
      anterior: campoEmpresa(g, 'anterior'), media3: campoEmpresa(g, 'media3'),
    });
  });
  grupos.sort((a, b) => b.t - a.t);
  return grupos;
}

// ---------- KPIs ----------
function kpis(arv) {
  const total = arv.reduce((s, g) => s + g.t, 0);
  const qtd = arv.reduce((s, g) => s + g.n, 0);
  // o DRE do sistema separa investimento de despesa; a página mostra os dois
  const inv = arv.filter((g) => g.investimento).reduce((s, g) => s + g.t, 0);
  const ant = campoEmpresa(DADOS, 'totalAnterior') || 0;
  const med = campoEmpresa(DADOS, 'totalMedia3') || 0;
  const vAnt = ant ? (total - ant) / Math.abs(ant) : null;
  const vMed = med ? (total - med) / Math.abs(med) : null;
  const ak = arv.reduce((s, g) => s + g.ak, 0);
  const jrf = arv.reduce((s, g) => s + g.jrf, 0);
  // Com busca ativa o recorte não tem contrapartida nos períodos de comparação
  // (o servidor compara o período inteiro), então os cards de variação saem.
  const comparavel = !BUSCA;
  const rr = comparavel ? DADOS.analise.runRate : null;
  const crit = DADOS.analise.alertas.filter((a) => a.severidade === 'critica').length;
  const aten = DADOS.analise.alertas.filter((a) => a.severidade === 'atencao').length;

  const mini = EMPRESA === 'TODAS'
    ? `<div class="mini"><span>AK <b>${fmtBRL(ak)}</b></span><span>JRF <b>${fmtBRL(jrf)}</b></span></div>` : '';

  const cards = [
    `<div class="kpi kpi-flat">
       <div class="t"><span class="dot" style="background:var(--blue)"></span>Pago no período</div>
       <div class="v">${fmtBRL(total)}</div>
       <div class="q">${fmtNum(qtd)} lançamento(s) · ${fmtData(DADOS.ini)} a ${fmtData(DADOS.fim)}</div>
       ${inv ? `<div class="mini"><span>Despesas <b>${fmtBRL(total - inv)}</b></span><span>Investimentos <b>${fmtBRL(inv)}</b></span></div>` : ''}
       ${mini}
     </div>`,
    `<div class="kpi kpi-flat">
       <div class="t"><span class="dot" style="background:var(--violet)"></span>Período anterior</div>
       <div class="v">${comparavel ? fmtVar(vAnt) : '<span class="muted">—</span>'}</div>
       <div class="q">${comparavel
        ? `${fmtBRL(ant)} em ${fmtData(DADOS.periodoAnterior.ini)} a ${fmtData(DADOS.periodoAnterior.fim)}`
        : 'não se compara com a busca ativa'}</div>
       ${comparavel ? `<div class="mini"><span>Diferença <b>${fmtBRL(total - ant)}</b></span></div>` : ''}
     </div>`,
    `<div class="kpi kpi-flat">
       <div class="t"><span class="dot" style="background:var(--green)"></span>Média de 3 meses</div>
       <div class="v">${comparavel ? fmtVar(vMed) : '<span class="muted">—</span>'}</div>
       <div class="q">${comparavel
        ? `média de ${fmtBRL(med)} nas 3 janelas equivalentes`
        : 'não se compara com a busca ativa'}</div>
       ${comparavel ? `<div class="mini"><span>Diferença <b>${fmtBRL(total - med)}</b></span></div>` : ''}
     </div>`,
    // a projeção é recalculada sobre o total JÁ FILTRADO (o servidor manda o
    // ritmo do período inteiro; aqui ela acompanha o filtro de empresa/busca)
    (() => {
      const porDia = rr ? total / rr.diaCorte : 0;
      return `<div class="kpi kpi-flat">
       <div class="t"><span class="dot" style="background:var(--amber)"></span>${rr ? 'Projeção do mês' : 'Ticket médio'}</div>
       <div class="v">${rr ? fmtBRL(porDia * rr.diasMes) : fmtBRL(qtd ? total / qtd : 0)}</div>
       <div class="q">${rr
        ? `${fmtBRL(porDia)}/dia · faltam ${fmtBRL(porDia * (rr.diasMes - rr.diaCorte))} para fechar ${rr.diasMes} dias`
        : `${fmtBRL(qtd ? total / qtd : 0)} por lançamento`}</div>
     </div>`;
    })(),
    `<div class="kpi kpi-flat">
       <div class="t"><span class="dot" style="background:var(--red)"></span>Pontos de atenção</div>
       <div class="v">${crit}<span class="muted" style="font-size:15px"> crítico(s)</span></div>
       <div class="q">${aten} em atenção · ${DADOS.analise.abc.qtdA} contas fazem 80% da despesa</div>
     </div>`,
  ];
  document.getElementById('kpis').innerHTML = cards.join('');
}

// ---------- gráficos (HTML/CSS, sem biblioteca) ----------
function chartGrupos(arv) {
  const top = arv.slice(0, 10);
  const max = top.length ? top[0].t : 0;
  const alvo = document.getElementById('chartGrupos');
  if (!top.length || max <= 0) { alvo.innerHTML = '<div class="empty">Sem dados no período.</div>'; return; }
  alvo.innerHTML = top.map((g) => {
    const w = (g.t / max) * 100;
    const pAk = g.t ? (g.ak / g.t) * 100 : 0;
    return `<div class="bar-row" data-g="${g.id}" title="${esc(g.nome)}">
      <div class="bar-lbl">${esc(g.nome)}</div>
      <div class="bar-track"><div class="bar" style="width:${w}%">
        <span class="seg seg-ak" style="width:${pAk}%"></span><span class="seg seg-jrf" style="width:${100 - pAk}%"></span>
      </div></div>
      <div class="bar-val">${fmtCurto(g.t)}</div>
    </div>`;
  }).join('');
  alvo.querySelectorAll('.bar-row').forEach((r) => {
    r.onclick = () => {
      ABERTOS.add('g:' + r.dataset.g);
      render();
      const el2 = document.querySelector(`tr[data-gid="${r.dataset.g}"]`);
      if (el2) el2.scrollIntoView({ behavior: 'smooth', block: 'center' });
    };
  });
}

function chartSerie() {
  const s = DADOS.serie || [];
  const alvo = document.getElementById('chartSerie');
  if (!s.length) { alvo.innerHTML = '<div class="empty">Sem histórico.</div>'; return; }
  const val = (m) => (EMPRESA === 'AK' ? m.ak : EMPRESA === 'JRF' ? m.jrf : m.total);
  const max = Math.max.apply(null, s.map(val).concat([1]));
  const ult = s[s.length - 1];
  document.getElementById('serieNota').textContent =
    'o mês corrente está parcial (até ' + fmtData(DADOS.fim) + ')';
  alvo.innerHTML = '<div class="cols">' + s.map((m, i) => {
    const h = (val(m) / max) * 100;
    const pAk = val(m) ? (m.ak / val(m)) * 100 : 0;
    const parcial = i === s.length - 1 && ult.mes === String(DADOS.fim).slice(0, 7);
    return `<div class="col" title="${mesLbl(m.mes)}: ${fmtBRL(val(m))}">
      <div class="col-v">${fmtCurto(val(m))}</div>
      <div class="col-bar ${parcial ? 'parcial' : ''}" style="height:${Math.max(h, 1)}%">
        ${EMPRESA === 'TODAS'
          ? `<div class="cseg cseg-jrf" style="height:${100 - pAk}%"></div><div class="cseg cseg-ak" style="height:${pAk}%"></div>`
          : `<div class="cseg cseg-${EMPRESA === 'AK' ? 'ak' : 'jrf'}" style="height:100%"></div>`}
      </div>
      <div class="col-lbl">${mesLbl(m.mes)}</div>
    </div>`;
  }).join('') + '</div>';
}

// ---------- alertas ----------
function renderAlertas() {
  const a = DADOS.analise.alertas || [];
  document.getElementById('alertaCont').textContent = a.length ? '· ' + a.length : '';
  document.getElementById('alertaNota').textContent = a.length
    ? (EMPRESA !== 'TODAS' ? 'as duas empresas juntas · ' : '')
      + 'piso de materialidade: ' + fmtBRL(DADOS.analise.limiar) : '';
  const alvo = document.getElementById('alertas');
  if (!a.length) {
    alvo.innerHTML = '<div class="empty">Nenhum ponto fora do padrão no período.</div>';
    return;
  }
  alvo.innerHTML = a.map((x) => `
    <div class="alerta sev-${x.severidade}" ${x.grupoId != null ? `data-g="${x.grupoId}"` : ''}>
      <div class="alerta-sev">${SEV_LABEL[x.severidade] || x.severidade}</div>
      <div class="alerta-txt">
        <div class="alerta-ttl">${esc(x.titulo)}</div>
        <div class="alerta-det">${esc(x.detalhe)}</div>
      </div>
      <div class="alerta-val">${x.valor != null ? fmtBRL(x.valor) : ''}</div>
    </div>`).join('');
  alvo.querySelectorAll('.alerta[data-g]').forEach((d) => {
    d.onclick = () => {
      ABERTOS.add('g:' + d.dataset.g);
      render();
      const tr = document.querySelector(`tr[data-gid="${d.dataset.g}"]`);
      if (tr) tr.scrollIntoView({ behavior: 'smooth', block: 'center' });
    };
  });
}

// ---------- árvore ----------
function linhaLancamentos(c) {
  return `<tr class="l-wrap"><td colspan="8">
    <table class="itens">
      <thead><tr>
        <th>EMPRESA</th><th>PAGO EM</th><th>FORNECEDOR</th><th>HISTÓRICO</th>
        <th>DOC.</th><th>FUNCIONÁRIO</th><th>VENC.</th><th class="num">VALOR</th>
      </tr></thead>
      <tbody>${c.lanc.map((l) => `<tr>
        <td><span class="emp-badge emp-${l.origem}">${l.origem}</span></td>
        <td>${fmtData(l.dtpago)}</td>
        <td>${esc(l.fornecedor)}</td>
        <td class="muted hist" title="${esc(l.historico)}">${esc(l.historico) || '—'}</td>
        <td class="muted" title="lançamento ${l.numlanc}/${esc(l.prest)}">${esc(l.numnota) || '—'}</td>
        <td class="muted">${esc(l.funcionario) || '—'}</td>
        <td class="muted">${fmtData(l.dtvenc)}</td>
        <td class="num">${fmtBRL(l.pago)}${l.difPagamento
          ? `<span class="dif-pg" title="valor do título ${fmtBRL(l.valor)} · pago ${fmtBRL(l.vpago)}">${
              l.difPagamento > 0 ? '+' : ''}${fmtBRL(l.difPagamento)}</span>` : ''}</td>
      </tr>`).join('')}
      <tr class="tot"><td colspan="7">${c.n} lançamento(s)</td><td class="num">${fmtBRL(c.t)}</td></tr>
      </tbody>
    </table>
  </td></tr>`;
}

function renderArvore(arv, total) {
  const tbody = document.getElementById('arvore');
  // com busca ativa o comparativo sai: o recorte não existe no período anterior
  const semCmp = '<span class="muted">—</span>';
  if (!arv.length) {
    tbody.innerHTML = '<tr><td colspan="8" class="empty">Nenhuma despesa para este filtro.</td></tr>';
    document.getElementById('cont').textContent = '';
    return;
  }
  const out = [];
  arv.forEach((g) => {
    const abertoG = ABERTOS.has('g:' + g.id);
    const dif = g.nomesOrigem && g.nomesOrigem.AK && g.nomesOrigem.JRF
      && g.nomesOrigem.AK !== g.nomesOrigem.JRF
      ? `<span class="tag-dif" title="AK: ${esc(g.nomesOrigem.AK)} · JRF: ${esc(g.nomesOrigem.JRF)}">nomes diferentes</span>` : '';
    out.push(`<tr class="g-row ${abertoG ? 'aberto' : ''}" data-gid="${g.id}">
      <td><span class="caret">${abertoG ? '▾' : '▸'}</span><b>${esc(g.nome)}</b>${dif}${
        g.investimento ? '<span class="tag-inv" title="o DRE do sistema lança este grupo em Investimentos, fora do Total Despesas">investimento</span>' : ''}</td>
      <td class="num ak">${g.ak ? fmtBRL(g.ak) : '<span class="muted">—</span>'}</td>
      <td class="num jrf">${g.jrf ? fmtBRL(g.jrf) : '<span class="muted">—</span>'}</td>
      <td class="num"><b>${fmtBRL(g.t)}</b></td>
      <td class="num">${fmtPct(total ? g.t / total : 0)}</td>
      <td class="num">${fmtNum(g.n)}</td>
      <td class="num">${BUSCA ? semCmp : fmtBRL(g.anterior) + ' ' + fmtVar(g.anterior ? (g.t - g.anterior) / Math.abs(g.anterior) : null)}</td>
      <td class="num">${BUSCA ? semCmp : fmtBRL(g.media3) + ' ' + fmtVar(g.media3 ? (g.t - g.media3) / Math.abs(g.media3) : null)}</td>
    </tr>`);
    if (!abertoG) return;
    g.contas.forEach((c) => {
      const abertoC = ABERTOS.has('c:' + g.id + ':' + c.chave);
      out.push(`<tr class="c-row ${abertoC ? 'aberto' : ''}" data-gid="${g.id}" data-ck="${esc(c.chave)}">
        <td class="c-nome"><span class="caret">${abertoC ? '▾' : '▸'}</span>${esc(c.nome)}
          <span class="cod">${c.codconta}</span>${c.nova ? '<span class="tag-nova">nova</span>' : ''}</td>
        <td class="num ak">${c.ak ? fmtBRL(c.ak) : '<span class="muted">—</span>'}</td>
        <td class="num jrf">${c.jrf ? fmtBRL(c.jrf) : '<span class="muted">—</span>'}</td>
        <td class="num">${fmtBRL(c.t)}</td>
        <td class="num muted">${fmtPct(g.t ? c.t / g.t : 0)}</td>
        <td class="num">${fmtNum(c.n)}</td>
        <td class="num muted">${BUSCA ? semCmp : fmtBRL(c.anterior)}</td>
        <td class="num muted">${BUSCA ? semCmp : fmtBRL(c.media3) + ' ' + fmtVar(c.media3 ? (c.t - c.media3) / Math.abs(c.media3) : null)}</td>
      </tr>`);
      if (abertoC) out.push(linhaLancamentos(c));
    });
  });
  tbody.innerHTML = out.join('');

  tbody.querySelectorAll('.g-row').forEach((tr) => {
    tr.onclick = () => {
      const k = 'g:' + tr.dataset.gid;
      if (ABERTOS.has(k)) ABERTOS.delete(k); else ABERTOS.add(k);
      render();
    };
  });
  tbody.querySelectorAll('.c-row').forEach((tr) => {
    tr.onclick = (ev) => {
      ev.stopPropagation();
      const k = 'c:' + tr.dataset.gid + ':' + tr.dataset.ck;
      if (ABERTOS.has(k)) ABERTOS.delete(k); else ABERTOS.add(k);
      render();
    };
  });

  const qtd = arv.reduce((s, g) => s + g.n, 0);
  document.getElementById('cont').textContent =
    `· ${arv.length} grupo(s), ${fmtNum(qtd)} lançamento(s), ${fmtBRL(total)}`;
}

// ---------- curva ABC e bloco fora do total ----------
function renderABC() {
  const abc = DADOS.analise.abc;
  // a curva vem do servidor, sempre sobre as duas empresas juntas
  document.getElementById('abcNota').textContent =
    `· ${abc.qtdA} de ${abc.qtdTotal} contas concentram 80% (${fmtBRL(abc.totalA)})`
    + (EMPRESA !== 'TODAS' || BUSCA ? ' · as duas empresas, sem o filtro da tela' : '');
  const linhas = abc.contas.filter((c) => c.classe === 'A');
  document.getElementById('abc').innerHTML = linhas.length
    ? linhas.map((c) => `<tr>
        <td>${esc(c.nome)}</td>
        <td class="muted">${esc(c.grupo)}</td>
        <td class="num">${fmtBRL(c.total)}</td>
        <td class="num muted">${fmtPct(c.acumulado)}</td>
        <td><span class="pill classe-${c.classe}">${c.classe}</span></td>
      </tr>`).join('')
    : '<tr><td colspan="5" class="empty">Sem dados.</td></tr>';
}

function renderFora() {
  const ex = DADOS.excluidos || [];
  const painel = document.getElementById('painelFora');
  if (!ex.length) { painel.style.display = 'none'; return; }
  painel.style.display = '';
  document.getElementById('fora').innerHTML = ex.map((g) => `<tr>
    <td>${esc(g.nome)}</td>
    <td class="num ak">${fmtBRL(g.ak)}</td>
    <td class="num jrf">${fmtBRL(g.jrf)}</td>
    <td class="num">${fmtBRL(g.total)}</td>
    <td class="num">${fmtNum(g.qtd)}</td>
  </tr>`).join('');
}

// ---------- IA ----------
function renderIA(ia) {
  const body = document.getElementById('iaBody');
  const btn = document.getElementById('iaBtn');
  if (!ia) {
    body.innerHTML = DADOS.iaDisponivel
      ? '<div class="ia-vazio">Os números e os alertas acima já estão calculados. Clique em <b>Analisar com IA</b> para a leitura escrita dos pontos críticos.</div>'
      : '<div class="ia-vazio">Para o diagnóstico escrito, configure <code>ANTHROPIC_API_KEY</code> no arquivo <code>.env</code>. A página funciona sem isso — só não gera o texto.</div>';
    btn.disabled = !DADOS.iaDisponivel;
    return;
  }
  if (!ia.ok) {
    body.innerHTML = `<div class="ia-vazio err">Não foi possível gerar a análise (${esc(ia.motivo || 'erro')}): ${esc(ia.erro || '')}</div>`;
    return;
  }
  document.getElementById('iaModelo').textContent =
    '· ' + ia.modelo + (ia.cache ? ' (em cache)' : '');
  body.innerHTML = `
    <div class="ia-resumo">${esc(ia.resumo)}</div>
    ${(ia.pontos || []).map((p) => `
      <div class="ia-ponto sev-${esc(p.severidade)}">
        <div class="ia-ponto-ttl"><span class="alerta-sev">${SEV_LABEL[p.severidade] || esc(p.severidade)}</span>${esc(p.titulo)}</div>
        <div class="ia-ponto-ev">${esc(p.evidencia)}</div>
        <div class="ia-ponto-ac"><b>O que fazer:</b> ${esc(p.acao)}</div>
      </div>`).join('')}
    ${(ia.perguntas || []).length ? `<div class="ia-perg"><b>Perguntas para fechar o diagnóstico</b><ul>${
      ia.perguntas.map((q) => `<li>${esc(q)}</li>`).join('')}</ul></div>` : ''}
    <div class="ia-rodape">Texto gerado por IA sobre os números calculados pelo painel. Confira antes de decidir.</div>`;
  btn.textContent = 'Reanalisar';
}

async function pedirIA(forcar) {
  const btn = document.getElementById('iaBtn');
  const body = document.getElementById('iaBody');
  btn.disabled = true;
  body.innerHTML = '<div class="ia-vazio">Analisando os números…</div>';
  try {
    const ia = await api(`/api/dre/analise?ini=${INI}&fim=${FIM}${forcar ? '&forcar=1' : ''}`);
    renderIA(ia);
  } catch (e) {
    body.innerHTML = `<div class="ia-vazio err">Falha ao chamar a análise: ${esc(e.message)}</div>`;
  } finally {
    btn.disabled = false;
  }
}

// ---------- CSV ----------
function baixarCSV(arv) {
  const linhas = [['GRUPO', 'CONTA', 'CODCONTA', 'EMPRESA', 'PAGO EM', 'VENCIMENTO', 'FORNECEDOR',
    'HISTORICO', 'DOCUMENTO', 'LANCAMENTO', 'FUNCIONARIO', 'VALOR', 'VALOR PAGO']];
  arv.forEach((g) => g.contas.forEach((c) => c.lanc.forEach((l) => {
    linhas.push([g.nome, c.nome, c.codconta, l.origem, l.dtpago, l.dtvenc, l.fornecedor,
      l.historico, l.numnota, l.numlanc + '/' + l.prest, l.funcionario || '',
      String(l.pago.toFixed(2)).replace('.', ','),
      l.vpago == null ? '' : String(l.vpago.toFixed(2)).replace('.', ',')]);
  })));
  const csv = linhas.map((r) => r.map((v) => {
    const s = String(v == null ? '' : v);
    return /[";\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }).join(';')).join('\r\n');
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `despesas_${INI}_a_${FIM}.csv`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

// ---------- render ----------
function render() {
  const arv = montarArvore();
  const total = arv.reduce((s, g) => s + g.t, 0);
  kpis(arv);
  renderAlertas();
  chartGrupos(arv);
  chartSerie();
  renderArvore(arv, total);
  renderABC();
  renderFora();
  window.__arv = arv;   // usado pelo botão de CSV
}

async function carregar() {
  DADOS = await api(`/api/dre?ini=${INI}&fim=${FIM}`);
  document.getElementById('modo').textContent = DADOS.modo === 'exemplo' ? '● dados de exemplo' : '● Oracle';
  document.getElementById('legend').innerHTML = legendaEmpresas(DADOS.empresas);
  document.getElementById('iaModelo').textContent = '';
  ABERTOS.clear();
  render();
  renderIA(null);
}

// ---------- controles ----------
const dtIni = document.getElementById('dtIni');
const dtFim = document.getElementById('dtFim');
dtIni.value = INI; dtFim.value = FIM;

function falha(e) {
  document.getElementById('arvore').innerHTML =
    `<tr><td colspan="8" class="empty">Falha: ${esc(e.message)}</td></tr>`;
}

document.getElementById('aplicar').addEventListener('click', () => {
  INI = dtIni.value || INI;
  FIM = dtFim.value || FIM;
  if (INI > FIM) { const t = INI; INI = FIM; FIM = t; dtIni.value = INI; dtFim.value = FIM; }
  carregar().catch(falha);
});
document.getElementById('empresaSel').addEventListener('change', (e) => {
  EMPRESA = e.target.value;
  if (DADOS) render();
});
document.getElementById('busca').addEventListener('input', (e) => {
  BUSCA = e.target.value.trim();
  if (!DADOS) return;
  // com busca ativa, abre os grupos que têm resultado
  if (BUSCA) montarArvore().forEach((g) => ABERTOS.add('g:' + g.id));
  render();
});
document.getElementById('expandir').addEventListener('click', () => {
  montarArvore().forEach((g) => {
    ABERTOS.add('g:' + g.id);
    g.contas.forEach((c) => ABERTOS.add('c:' + g.id + ':' + c.chave));
  });
  render();
});
document.getElementById('recolher').addEventListener('click', () => { ABERTOS.clear(); render(); });
document.getElementById('csv').addEventListener('click', () => baixarCSV(window.__arv || montarArvore()));
document.getElementById('iaBtn').addEventListener('click', () => pedirIA(document.getElementById('iaBtn').textContent === 'Reanalisar'));

carregar().catch(falha);
