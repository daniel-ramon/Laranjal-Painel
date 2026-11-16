document.getElementById('side').innerHTML = sidebar('overview');

let MES = getMes();

function cardHtml(titulo, dados, empresas, cls, ico) {
  const ak = empresas.find((e) => e.id === 'AK') || { cor: 'var(--ak)' };
  const jrf = empresas.find((e) => e.id === 'JRF') || { cor: 'var(--jrf)' };
  return `
  <div class="card ${cls}">
    <div class="head"><span>${titulo}</span><span class="ico-box">${ico}</span></div>
    <div class="valor">${fmtBRL(dados.valor)}</div>
    <div class="qtd">${fmtNum(dados.qtd)} título(s)</div>
    <div class="split">
      <div class="chip"><div class="k"><span class="dot" style="background:${ak.cor}"></span>AK</div><div class="v">${fmtBRL(dados.ak.valor)}</div><div class="k">${dados.ak.qtd} tít.</div></div>
      <div class="chip"><div class="k"><span class="dot" style="background:${jrf.cor}"></span>JRF</div><div class="v">${fmtBRL(dados.jrf.valor)}</div><div class="k">${dados.jrf.qtd} tít.</div></div>
    </div>
  </div>`;
}

async function carregar() {
  document.getElementById('mp').replaceChildren(monthPicker(MES, (m) => { MES = m; setMes(m); carregar(); }));
  const d = await api('/api/overview?mes=' + MES);
  document.getElementById('modo').textContent = d.modo === 'exemplo' ? '● dados de exemplo' : '● Oracle';
  document.getElementById('legend').innerHTML = legendaEmpresas(d.empresas);

  document.getElementById('cards').innerHTML =
    cardHtml('Atrasados', d.cards.atrasados, d.empresas, 'accent-red', '⚠') +
    cardHtml('Vencem hoje', d.cards.vencemHoje, d.empresas, 'accent-amber', '◷') +
    cardHtml('Próximos vencimentos', d.cards.proximos, d.empresas, 'accent-blue', '→');

  const linha = (e) => {
    const c = d.cards;
    const pick = (o) => e === 'TODAS' ? o : o[e.toLowerCase()];
    const nome = e === 'AK' ? 'AK Hortifruti' : e === 'JRF' ? 'JRF (Laranjal)' : 'Consolidado';
    const cor = e === 'AK' ? 'var(--ak)' : e === 'JRF' ? 'var(--jrf)' : '#fff';
    const tot = e === 'TODAS' ? d.totalGeral : { qtd: pick(d.totalGeral).qtd, valor: pick(d.totalGeral).valor };
    return `<tr>
      <td><span class="emp-badge ${e==='TODAS'?'':'emp-'+e}" style="${e==='TODAS'?'color:#fff':''}">${nome}</span></td>
      <td class="num">${fmtNum(e==='TODAS'?d.totalGeral.qtd:pick(d.totalGeral).qtd)}</td>
      <td class="num" style="color:#fca5a5">${fmtBRL(e==='TODAS'?c.atrasados.valor:pick(c.atrasados).valor)}</td>
      <td class="num">${fmtBRL(e==='TODAS'?c.vencemHoje.valor:pick(c.vencemHoje).valor)}</td>
      <td class="num">${fmtBRL(e==='TODAS'?c.proximos.valor:pick(c.proximos).valor)}</td>
      <td class="num"><b>${fmtBRL(tot.valor)}</b></td>
    </tr>`;
  };
  document.getElementById('resumo').innerHTML = linha('AK') + linha('JRF') + linha('TODAS');
}

carregar().catch((e) => { document.getElementById('cards').innerHTML = `<div class="empty">Falha ao carregar: ${e.message}</div>`; });
