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

// ---------------- KPIs ----------------
function renderKpis() {
  const t = DADOS.totais;
  const rotasAtivas = DADOS.rotas.filter((r) => r.qtPedidos > 0).length;
  const card = (ico, titulo, valor, qtd, cls) => `
    <div class="card ${cls || ''}">
      <div class="head"><span>${titulo}</span><span class="ico-box">${ico}</span></div>
      <div class="valor">${valor}</div>
      <div class="qtd">${qtd}</div>
    </div>`;
  document.getElementById('kpis').innerHTML =
    card('▦', 'Pedidos do dia', fmtNum(t.qtPedidos), `${rotasAtivas} de ${DADOS.rotas.length} rota(s) com entrega`, 'accent-blue') +
    card('📦', 'Peso total', fmtNum(t.peso) + ' kg', 'carga do dia · todas as rotas', '') +
    card('≣', 'Itens', fmtNum(t.qtItens), 'linhas de produto somadas', '') +
    card('$', 'Valor total', fmtBRL(t.valor), 'soma dos pedidos do dia', 'accent-amber');
}

// ---------------- Opções de rota (para mover loja) ----------------
function opcoesRota(sel) {
  const opts = [`<option value="">— sem rota</option>`].concat(
    DADOS.rotas.map((r) => `<option value="${r.codigo}" ${r.codigo === sel ? 'selected' : ''}>Rota ${r.codigo} · ${r.nome || ''}</option>`)
  );
  return opts.join('');
}

// ---------------- Card de uma loja dentro da rota ----------------
function lojaLinha(l) {
  const tem = l.qtPedidos > 0;
  const alertas = l.alertas || [];
  const selo = tem
    ? `<span class="pill pago">${l.qtPedidos} pedido(s)</span>`
    : `<span class="pill proximo">sem pedido</span>`;
  const alerta = alertas.length ? `<span class="pill vence_hoje" title="${alertas.join(' · ').replace(/"/g, '&quot;')}">!</span>` : '';
  return `<div class="loja-row ${tem || alertas.length ? 'click' : 'vazia'}" data-cnpj="${l.cnpj}">
      <div class="loja-info">
        <div class="loja-nome">${l.titulo} ${alerta}</div>
        <div class="loja-meta">${selo} ${tem ? `<span class="num">${fmtNum(l.peso)} kg</span> · <span class="num">${fmtBRL(l.valor)}</span> · ${fmtNum(l.qtItens)} itens` : ''}</div>
      </div>
      <select class="sel rota-mov" data-cnpj="${l.cnpj}" title="Mover loja de rota">${opcoesRota(l.rota)}</select>
    </div>`;
}

// ---------------- Card de uma rota (caminhão) ----------------
function rotaCard(r) {
  const lojas = r.lojas.slice().sort((a, b) => (b.qtPedidos - a.qtPedidos) || a.titulo.localeCompare(b.titulo));
  const temCarga = r.qtPedidos > 0;
  return `<div class="rota-card">
    <div class="rota-head">
      <div class="rota-head-main">
        <div class="rota-titulo">Rota ${r.codigo} <span class="muted">· ${r.nome || 'sem nome'}</span></div>
        <div class="rota-peso">📦 ${fmtNum(r.peso)} kg <span class="muted">de carga</span></div>
        <div class="rota-resumo">${fmtNum(r.qtPedidos)} pedido(s) · ${fmtNum(r.qtItens)} itens · ${fmtBRL(r.valor)}</div>
      </div>
      <div class="rota-acoes">
        <button class="rota-print" data-cod="${r.codigo}" title="Imprimir folha desta rota" ${temCarga ? '' : 'disabled'}>🖨</button>
        <button class="rota-edit" data-cod="${r.codigo}" data-nome="${(r.nome || '').replace(/"/g, '&quot;')}" title="Editar rota">✎</button>
      </div>
    </div>
    <div class="rota-lojas">
      ${lojas.length ? lojas.map(lojaLinha).join('') : '<div class="muted vazio-rota">Nenhuma loja nesta rota.</div>'}
    </div>
  </div>`;
}

function renderRotas() {
  document.getElementById('rotas').innerHTML = DADOS.rotas.map(rotaCard).join('');
  // mover loja de rota
  document.querySelectorAll('.rota-mov').forEach((s) => {
    s.addEventListener('click', (e) => e.stopPropagation());
    s.addEventListener('change', async (e) => {
      e.stopPropagation();
      try {
        await send('/api/entregas/lojas/' + s.dataset.cnpj, 'PUT', { rota: s.value });
        await carregar();
      } catch (err) { alert('Falha ao mover loja: ' + err.message); }
    });
  });
  // abrir itens da loja
  document.querySelectorAll('.loja-row.click').forEach((row) => {
    row.addEventListener('click', () => {
      const loja = acharLoja(row.dataset.cnpj);
      if (loja) abrirLoja(loja);
    });
  });
  // editar rota
  document.querySelectorAll('.rota-edit').forEach((b) => {
    b.addEventListener('click', () => abrirModal(b.dataset.cod, b.dataset.nome));
  });
  // imprimir folha da rota
  document.querySelectorAll('.rota-print').forEach((b) => {
    b.addEventListener('click', () => imprimirFolha(b.dataset.cod));
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

// ---------------- Carregar ----------------
async function carregar() {
  DADOS = await api('/api/entregas' + (DATA ? '?data=' + DATA : ''));
  DATA = DADOS.data;
  montarDatas();
  renderKpis();
  renderRotas();
  renderExtras();
}

// eventos
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
