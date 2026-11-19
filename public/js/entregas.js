document.getElementById('side').innerHTML = sidebar('entregas');

let DATA = null;       // data de entrega selecionada (YYYY-MM-DD)
let DADOS = null;

// --- helper de mutação (POST/PUT/DELETE) com overlay de carregamento ---
async function send(path, method, body) {
  showLoading();
  try {
    const r = await fetch(path, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.erro || ('Erro ' + r.status));
    return j;
  } finally { hideLoading(); }
}

function diaSemana(iso) {
  if (!iso) return '';
  const [y, m, d] = iso.split('-').map(Number);
  const nomes = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];
  return nomes[new Date(y, m - 1, d).getDay()];
}

// Escapa texto para inserir com segurança no HTML (observações vêm do e-mail).
function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// Caixa de "Observações do e-mail" (corpo do e-mail), mesma info da folha.
function obsBox(observacoes) {
  const obs = (observacoes || []).map((o) => String(o || '').trim()).filter(Boolean);
  if (!obs.length) return '';
  return `<div class="obs-box">
    <div class="obs-ttl">📝 Observações do e-mail <span class="obs-hint">— conferir com o encarregado</span></div>
    ${obs.map((o) => `<div class="obs-item">• ${esc(o)}</div>`).join('')}
  </div>`;
}

// ---------------- Métricas (strip compacto) ----------------
function renderKpis() {
  const t = DADOS.totais;
  const rotasAtivas = DADOS.rotas.filter((r) => r.qtPedidos > 0).length;
  const stat = (ico, label, valor, sub, cls) => `
    <div class="stat ${cls || ''}">
      <div class="ic">${ico}</div>
      <div class="bd">
        <div class="lb">${label}</div>
        <div class="vl">${valor}</div>
        <div class="sub">${sub}</div>
      </div>
    </div>`;
  document.getElementById('kpis').innerHTML =
    stat('▦', 'Pedidos do dia', fmtNum(t.qtPedidos), `${rotasAtivas}/${DADOS.rotas.length} rota(s) com entrega`, 'ac-blue') +
    stat('📦', 'Peso total', fmtNum(t.peso) + ' kg', 'carga · todas as rotas', 'ac-teal') +
    stat('≣', 'Itens', fmtNum(t.qtItens), 'linhas de produto', '') +
    stat('$', 'Valor total', fmtBRL(t.valor), 'soma dos pedidos', 'ac-amber');
}

// ---------------- Opções de rota (para mover loja) ----------------
function opcoesRota(sel) {
  const opts = [`<option value="">— sem rota</option>`].concat(
    DADOS.rotas.map((r) => `<option value="${r.codigo}" ${r.codigo === sel ? 'selected' : ''}>Rota ${r.codigo} · ${r.nome || ''}</option>`)
  );
  return opts.join('');
}

// ---------------- Card de uma loja dentro da rota ----------------
// comMover = true mostra o seletor de rota (visão por rota); na visão geral some.
function temObservacoes(l) {
  return (l.pedidos || []).some((p) => (p.observacoes || []).length);
}
function lojaLinha(l, comMover) {
  const tem = l.qtPedidos > 0;
  const alertas = l.alertas || [];
  const alerta = alertas.length
    ? `<span class="loja-alert" title="${alertas.join(' · ').replace(/"/g, '&quot;')}">!</span>` : '';
  const clickable = tem || alertas.length;
  const meta = tem
    ? `<span class="pill pago">${fmtNum(l.qtPedidos)} ped.</span>`
      + `<span class="mi">${fmtNum(l.peso)} kg</span>`
      + `<span class="mi">${fmtNum(l.qtItens)} itens</span>`
      + (temObservacoes(l) ? `<span class="mi obs-mi">📝 obs.</span>` : '')
    : `<span class="pill proximo">sem pedido</span>`;
  const mover = comMover
    ? `<div class="loja-mover"><select class="sel rota-mov" data-cnpj="${l.cnpj}" title="Mover loja de rota">${opcoesRota(l.rota)}</select></div>`
    : '';
  return `<div class="loja-row ${clickable ? 'click' : 'vazia'}" data-cnpj="${l.cnpj}" ${clickable ? 'tabindex="0"' : ''}>
      <div class="loja-nome">${l.titulo}${alerta}</div>
      <div class="loja-valor">${tem ? fmtBRL(l.valor) : '<span class="muted">—</span>'}</div>
      <div class="loja-meta">${meta}</div>
      ${mover}
    </div>`;
}

// ---------------- Card de uma rota (caminhão) ----------------
function rotaCard(r) {
  const lojas = r.lojas.slice().sort((a, b) => (b.qtPedidos - a.qtPedidos) || a.titulo.localeCompare(b.titulo));
  const temCarga = r.qtPedidos > 0;
  const comLojas = lojas.filter((l) => l.qtPedidos > 0).length;
  return `<div class="rota-card ${temCarga ? '' : 'rota-ociosa'}">
    <div class="rota-head">
      <div class="rota-id">${r.codigo}</div>
      <div class="rota-head-main">
        <div class="rota-titulo">${r.nome || 'Rota sem nome'}</div>
        <div class="rota-resumo">${comLojas} loja(s) · ${fmtNum(r.qtPedidos)} pedido(s) · ${fmtNum(r.qtItens)} itens</div>
      </div>
      <div class="rota-acoes">
        <button class="rota-print" data-cod="${r.codigo}" title="Imprimir folha desta rota" ${temCarga ? '' : 'disabled'}>🖨</button>
        <button class="rota-edit" data-cod="${r.codigo}" data-nome="${(r.nome || '').replace(/"/g, '&quot;')}" title="Editar rota">✎</button>
      </div>
    </div>
    <div class="rota-metrics">
      <div class="rm"><span class="rm-k">Carga</span><span class="rm-v peso">${fmtNum(r.peso)} <small>kg</small></span></div>
      <div class="rm"><span class="rm-k">Valor</span><span class="rm-v">${fmtBRL(r.valor)}</span></div>
    </div>
    <div class="rota-lojas">
      ${lojas.length ? lojas.map((l) => lojaLinha(l, true)).join('') : '<div class="muted vazio-rota">Nenhuma loja nesta rota.</div>'}
    </div>
  </div>`;
}

// ---- Ligações de evento reaproveitadas pelas 3 visões ----
// Mover loja de rota (selects .rota-mov dentro de `root`).
function wireMover(root) {
  root.querySelectorAll('.rota-mov').forEach((s) => {
    s.addEventListener('click', (e) => e.stopPropagation());
    s.addEventListener('keydown', (e) => e.stopPropagation());
    s.addEventListener('change', async (e) => {
      e.stopPropagation();
      try {
        await send('/api/entregas/lojas/' + s.dataset.cnpj, 'PUT', { rota: s.value });
        await carregar();
      } catch (err) { alert('Falha ao mover loja: ' + err.message); }
    });
  });
}
// Abrir o drawer de itens ao clicar (ou Enter) numa loja com pedido.
function wireLojaRows(root) {
  root.querySelectorAll('.loja-row.click').forEach((row) => {
    const abrir = () => { const l = acharLoja(row.dataset.cnpj); if (l) abrirLoja(l); };
    row.addEventListener('click', abrir);
    row.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); abrir(); }
    });
  });
}

function renderRotas() {
  const root = document.getElementById('rotas');
  root.innerHTML = DADOS.rotas.map(rotaCard).join('');
  wireMover(root);
  wireLojaRows(root);
  // editar rota
  root.querySelectorAll('.rota-edit').forEach((b) => {
    b.addEventListener('click', () => abrirModal(b.dataset.cod, b.dataset.nome));
  });
  // imprimir folha da rota
  root.querySelectorAll('.rota-print').forEach((b) => {
    b.addEventListener('click', () => imprimirFolha(b.dataset.cod));
  });
}

// ---------------- Visão geral: todos os pedidos (sem separar por rota) ----------------
let BUSCA_GERAL = '';
// Achata todas as lojas (de todas as rotas + sem rota) que têm pedido no dia.
function lojasComPedido() {
  const todas = [];
  DADOS.rotas.forEach((r) => r.lojas.forEach((l) => { if (l.qtPedidos > 0) todas.push({ ...l, rotaNome: r.nome }); }));
  (DADOS.semRota.lojas || []).forEach((l) => { if (l.qtPedidos > 0) todas.push({ ...l, rotaNome: '' }); });
  return todas;
}
function renderGeral() {
  const root = document.getElementById('geral');
  let lojas = lojasComPedido();
  const q = BUSCA_GERAL.toLowerCase();
  if (q) lojas = lojas.filter((l) => (l.titulo || '').toLowerCase().includes(q));
  // ordena por peso desc (relevante para carregamento), depois por valor
  lojas.sort((a, b) => (b.peso - a.peso) || (b.valor - a.valor));

  const totPed = lojas.reduce((s, l) => s + l.qtPedidos, 0);
  const totPeso = lojas.reduce((s, l) => s + l.peso, 0);
  const totValor = lojas.reduce((s, l) => s + l.valor, 0);

  if (!lojas.length) {
    root.innerHTML = `<div class="panel"><div class="empty">${BUSCA_GERAL ? 'Nenhuma loja encontrada para a busca.' : 'Nenhum pedido para esta data.'}</div></div>`;
    return;
  }
  const rotaChip = (l) => l.rota
    ? `<span class="rota-chip">Rota ${l.rota}${l.rotaNome ? ' · ' + l.rotaNome : ''}</span>`
    : `<span class="rota-chip semrota">sem rota</span>`;
  const linhas = lojas.map((l) => {
    const alerta = (l.alertas && l.alertas.length)
      ? `<span class="loja-alert" title="${l.alertas.join(' · ').replace(/"/g, '&quot;')}">!</span>` : '';
    return `<tr class="click" data-cnpj="${l.cnpj}" tabindex="0">
      <td class="g-loja">${l.titulo}${alerta}</td>
      <td>${rotaChip(l)}</td>
      <td class="num">${fmtNum(l.qtPedidos)}</td>
      <td class="num">${fmtNum(l.qtItens)}</td>
      <td class="num">${fmtNum(l.peso)} kg</td>
      <td class="num">${fmtBRL(l.valor)}</td>
    </tr>`;
  }).join('');
  root.innerHTML = `
    <div class="panel">
      <div class="phead">
        <div class="ttl">Todos os pedidos <span class="muted">· ${fmtNum(lojas.length)} loja(s)</span></div>
        <div class="muted" style="font-size:12px">clique numa loja para ver os itens</div>
      </div>
      <div class="tbl-scroll">
        <table class="geral-tbl">
          <thead><tr>
            <th>LOJA</th><th>ROTA</th><th class="num">PED.</th>
            <th class="num">ITENS</th><th class="num">PESO</th><th class="num">VALOR</th>
          </tr></thead>
          <tbody>${linhas}</tbody>
          <tfoot><tr>
            <td colspan="2">Total</td>
            <td class="num">${fmtNum(totPed)}</td><td class="num"></td>
            <td class="num">${fmtNum(totPeso)} kg</td><td class="num">${fmtBRL(totValor)}</td>
          </tr></tfoot>
        </table>
      </div>
    </div>`;
  wireLojaRows(root);
  // linhas <tr class="click"> também abrem o drawer
  root.querySelectorAll('tr.click').forEach((row) => {
    const abrir = () => { const l = acharLoja(row.dataset.cnpj); if (l) abrirLoja(l); };
    row.addEventListener('click', abrir);
    row.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); abrir(); } });
  });
}

// Abre o PDF da folha de separação (todos ou de uma rota) em nova aba.
function imprimirFolha(rota) {
  let url = '/api/entregas/folha?data=' + encodeURIComponent(DADOS.data);
  if (rota) url += '&rota=' + encodeURIComponent(rota);
  window.open(url, '_blank');
}

function acharLoja(cnpj) {
  for (const r of DADOS.rotas) {
    const l = r.lojas.find((x) => x.cnpj === cnpj);
    if (l) return l;
  }
  return (DADOS.semRota.lojas || []).find((x) => x.cnpj === cnpj) || null;
}

// ---------------- Extras: sem rota + não identificados ----------------
function renderExtras() {
  let html = '';
  const sr = DADOS.semRota;
  if (sr && sr.qtLojas) {
    html += `<div class="panel"><div class="phead"><div class="ttl">Lojas sem rota <span class="muted">${sr.qtLojas}</span></div></div>
      <div class="rota-lojas">${sr.lojas.map(lojaLinha).join('')}</div></div>`;
  }
  const ni = DADOS.naoIdentificados || [];
  if (ni.length) {
    html += `<div class="panel"><div class="phead"><div class="ttl">Pedidos não identificados <span class="muted">${ni.length}</span></div>
      <div class="muted" style="font-size:12px">O centro do pedido não casou com nenhuma loja do cadastro.</div></div>
      <table><thead><tr><th>LOJA (sugerida)</th><th>CENTRO</th><th>Nº PEDIDO</th><th class="num">ITENS</th><th class="num">VALOR</th></tr></thead>
      <tbody>${ni.map((p) => `<tr><td>${p.lojaSugerida || '—'}</td><td class="muted">${p.centro || '—'}</td><td class="muted">${p.numero || '—'}</td><td class="num">${fmtNum(p.qtItens)}</td><td class="num">${fmtBRL(p.valor)}</td></tr>`).join('')}</tbody></table></div>`;
  }
  document.getElementById('extras').innerHTML = html;
  document.querySelectorAll('#extras .rota-mov').forEach((s) => {
    s.addEventListener('change', async () => {
      try { await send('/api/entregas/lojas/' + s.dataset.cnpj, 'PUT', { rota: s.value }); await carregar(); }
      catch (err) { alert('Falha ao mover loja: ' + err.message); }
    });
  });
  document.querySelectorAll('#extras .loja-row.click').forEach((row) => {
    row.addEventListener('click', () => { const l = acharLoja(row.dataset.cnpj); if (l) abrirLoja(l); });
  });
}

// ---------------- Drawer: itens da loja ----------------
function abrirLoja(l) {
  document.getElementById('dTitulo').textContent = l.titulo;
  document.getElementById('dSub').textContent =
    `Rota ${l.rota || '—'} · ${l.qtPedidos} pedido(s) · ${fmtNum(l.peso)} kg · ${fmtBRL(l.valor)} · entrega ${fmtData(DADOS.data)}`;
  const body = document.getElementById('drawerBody');
  const alertasHtml = (l.alertas && l.alertas.length)
    ? `<div class="alertas-box"><div class="alertas-ttl">⚠ Observações / conferência</div>${l.alertas.map((a) => `<div class="alerta-item">• ${a}</div>`).join('')}</div>`
    : '';
  if (!l.pedidos || !l.pedidos.length) {
    body.innerHTML = alertasHtml + `<div class="adbox pend"><b>Sem pedidos para esta data.</b></div>`;
  } else {
    body.innerHTML = alertasHtml + l.pedidos.map((p) => `
      <div class="ped-box">
        <div class="ped-head">
          <b>Pedido ${p.numero || '—'}</b>
          <span class="muted">${fmtNum(p.qtItens)} itens · ${fmtBRL(p.valor)}</span>
        </div>
        ${obsBox(p.observacoes)}
        <table class="itens">
          <thead><tr><th>PRODUTO</th><th class="num">QTDE</th><th>EMB</th><th class="num">UNIT</th><th class="num">TOTAL</th></tr></thead>
          <tbody>
            ${p.itens.map((i) => `<tr><td>${i.descricao || i.codigo}</td><td class="num">${fmtNum(i.qtde)}</td><td class="muted">${i.emb || ''}</td><td class="num">${fmtBRL(i.valorUnit)}</td><td class="num">${fmtBRL(i.valorTotal)}</td></tr>`).join('')}
            <tr class="tot"><td>Total</td><td class="num">${fmtNum(p.itens.reduce((s, i) => s + i.qtde, 0))}</td><td></td><td></td><td class="num">${fmtBRL(p.valor)}</td></tr>
          </tbody>
        </table>
      </div>`).join('');
  }
  document.getElementById('drawer').classList.add('on');
}
function fecharDrawer() { document.getElementById('drawer').classList.remove('on'); }

// ---------------- Modal de rota (criar/editar/excluir) ----------------
let MODAL_COD = null;   // null = criar; senão = editar
function abrirModal(cod, nome) {
  MODAL_COD = cod || null;
  document.getElementById('mTitulo').textContent = cod ? `Editar rota ${cod}` : 'Nova rota';
  document.getElementById('mCod').value = cod || '';
  document.getElementById('mNome').value = nome || '';
  document.getElementById('mErro').textContent = '';
  document.getElementById('mExcluir').style.display = cod ? 'inline-block' : 'none';
  document.getElementById('modal').classList.add('on');
  document.getElementById('mNome').focus();
}
function fecharModal() { document.getElementById('modal').classList.remove('on'); }

async function salvarRota() {
  const cod = document.getElementById('mCod').value.trim();
  const nome = document.getElementById('mNome').value.trim();
  if (!cod) { document.getElementById('mErro').textContent = 'Informe o código da rota.'; return; }
  try {
    if (MODAL_COD) await send('/api/entregas/rotas/' + MODAL_COD, 'PUT', { codigo: cod, nome });
    else await send('/api/entregas/rotas', 'POST', { codigo: cod, nome });
    fecharModal();
    await carregar();
  } catch (err) { document.getElementById('mErro').textContent = err.message; }
}
async function excluirRota() {
  if (!MODAL_COD) return;
  const rota = DADOS.rotas.find((r) => r.codigo === MODAL_COD);
  const n = rota ? rota.qtLojas : 0;
  const msg = n ? `Excluir a rota ${MODAL_COD}? As ${n} loja(s) dela ficarão SEM rota (não serão apagadas).`
                : `Excluir a rota ${MODAL_COD}?`;
  if (!confirm(msg)) return;
  try { await send('/api/entregas/rotas/' + MODAL_COD, 'DELETE'); fecharModal(); await carregar(); }
  catch (err) { document.getElementById('mErro').textContent = err.message; }
}

// ---------------- Datas ----------------
function montarDatas() {
  const sel = document.getElementById('dataSel');
  const ds = DADOS.datasDisponiveis || [];
  sel.innerHTML = ds.map((d) => `<option value="${d}" ${d === DADOS.data ? 'selected' : ''}>${fmtData(d)} (${diaSemana(d)})</option>`).join('')
    || `<option value="${DADOS.data}">${fmtData(DADOS.data)}</option>`;
  document.getElementById('dtEntrega').value = DADOS.data;
  document.getElementById('arq').textContent = DADOS.arquivoPedidos ? '● pedidos carregados' : '● sem arquivo de pedidos';
}

// ---------------- Troca de visão (por rota / geral) ----------------
let VISTA = 'rotas';   // 'rotas' | 'geral'
function aplicarVista() {
  const porRota = VISTA === 'rotas';
  document.getElementById('rotas').hidden = !porRota;
  document.getElementById('geral').hidden = porRota;
  document.getElementById('extras').hidden = !porRota;       // extras pertencem à visão por rota
  document.getElementById('buscaGeral').style.display = porRota ? 'none' : '';
  document.querySelectorAll('#viewSeg button').forEach((b) => {
    const on = b.dataset.v === VISTA;
    b.classList.toggle('on', on);
    b.setAttribute('aria-selected', on ? 'true' : 'false');
  });
  if (!porRota) renderGeral();
}

// ---------------- Carregar ----------------
async function carregar() {
  DADOS = await api('/api/entregas' + (DATA ? '?data=' + DATA : ''));
  DATA = DADOS.data;
  montarDatas();
  renderKpis();
  renderRotas();
  renderExtras();
  aplicarVista();
}

// eventos
document.querySelectorAll('#viewSeg button').forEach((b) => {
  b.addEventListener('click', () => { VISTA = b.dataset.v; aplicarVista(); });
});
document.getElementById('buscaGeral').addEventListener('input', (e) => {
  BUSCA_GERAL = e.target.value.trim();
  if (DADOS && VISTA === 'geral') renderGeral();
});
document.getElementById('dataSel').addEventListener('change', (e) => { DATA = e.target.value; carregar(); });
document.getElementById('dtEntrega').addEventListener('change', (e) => { if (e.target.value) { DATA = e.target.value; carregar(); } });
document.getElementById('btnImprimir').addEventListener('click', () => imprimirFolha(null));
document.getElementById('btnRotas').addEventListener('click', () => abrirModal(null, ''));
document.getElementById('drawerBg').addEventListener('click', fecharDrawer);
document.getElementById('drawerX').addEventListener('click', fecharDrawer);
document.getElementById('modalBg').addEventListener('click', fecharModal);
document.getElementById('modalX').addEventListener('click', fecharModal);
document.getElementById('mCancelar').addEventListener('click', fecharModal);
document.getElementById('mSalvar').addEventListener('click', salvarRota);
document.getElementById('mExcluir').addEventListener('click', excluirRota);
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') { fecharDrawer(); fecharModal(); } });

carregar().catch((e) => { document.getElementById('rotas').innerHTML = `<div class="empty">Falha: ${e.message}</div>`; });
