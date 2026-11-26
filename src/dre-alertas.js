'use strict';
// Motor de regras do DRE: calcula os números e produz os alertas.
// É DETERMINÍSTICO de propósito — a IA (src/dre-ia.js) só comenta o que sai
// daqui, nunca faz contas. Mesma regra do resto do projeto ("o LLM não faz contas").

const SEV = { critica: 3, atencao: 2, info: 1 };

function pct(v) { return v == null ? null : v; }
function fmt(n) {
  return (Number(n) || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}
function fmtPct(v) {
  if (v == null) return '—';
  return (v * 100).toLocaleString('pt-BR', { maximumFractionDigits: 1 }) + '%';
}

// Piso de materialidade: ignora oscilação de troco. 1,5% do total do período,
// com mínimo de R$ 500 (período curto não vira um mar de alertas irrelevantes).
function piso(total) {
  return Math.max(500, Math.abs(total) * 0.015);
}

function todosLancamentos(dados) {
  const out = [];
  dados.grupos.forEach((g) => g.contas.forEach((c) => c.lancamentos.forEach((l) => {
    out.push({ l, grupo: g, conta: c });
  })));
  return out;
}

// ---------- regras ----------

// 1) Grupo que subiu (ou caiu) de forma material contra o período anterior e
//    contra a média das 3 janelas equivalentes.
function regraVariacaoGrupo(dados, lim) {
  const out = [];
  dados.grupos.forEach((g) => {
    const dAnt = g.total - g.anterior;
    const dMed = g.total - g.media3;
    // Só vira alerta se o reais for material E a variação relativa for sensível
    // (20%) em pelo menos uma das duas bases de comparação.
    const alta = (dMed >= lim && (g.variacaoMedia3 == null || g.variacaoMedia3 >= 0.2))
      || (dAnt >= lim && (g.variacao == null || g.variacao >= 0.2));
    const queda = dMed <= -lim && g.variacaoMedia3 != null && g.variacaoMedia3 <= -0.2;
    const delta = Math.abs(dMed) >= Math.abs(dAnt) ? dMed : dAnt;
    if (alta) {
      out.push({
        id: 'grupo-alta-' + g.id,
        severidade: Math.abs(delta) >= lim * 3 ? 'critica' : 'atencao',
        tipo: 'variacao',
        titulo: g.nome + ': alta de ' + fmt(Math.abs(delta)),
        detalhe: 'Pagou ' + fmt(g.total) + ' no período contra ' + fmt(g.anterior)
          + ' no anterior (' + fmtPct(g.variacao) + ') e média de ' + fmt(g.media3)
          + ' nas 3 janelas equivalentes (' + fmtPct(g.variacaoMedia3) + ').',
        valor: delta, grupoId: g.id,
      });
    } else if (queda) {
      out.push({
        id: 'grupo-queda-' + g.id,
        severidade: 'info',
        tipo: 'variacao',
        titulo: g.nome + ': queda de ' + fmt(Math.abs(dMed)) + ' sobre a média',
        detalhe: 'Pagou ' + fmt(g.total) + ' contra média de ' + fmt(g.media3)
          + ' (' + fmtPct(g.variacaoMedia3) + '). Vale confirmar se é economia ou pagamento que ficou para depois.',
        valor: dMed, grupoId: g.id,
      });
    }
  });
  return out;
}

// 2) Conta sem histórico nos comparativos (despesa nova).
function regraContaNova(dados, lim) {
  const out = [];
  dados.grupos.forEach((g) => g.contas.forEach((c) => {
    if (!c.nova || c.total < lim) return;
    out.push({
      id: 'conta-nova-' + g.id + '-' + c.chave,
      severidade: c.total >= lim * 3 ? 'critica' : 'atencao',
      tipo: 'nova',
      titulo: 'Despesa nova: ' + c.nome + ' (' + fmt(c.total) + ')',
      detalhe: 'A conta ' + c.codconta + ' (' + g.nome + ') não teve pagamento no período anterior '
        + 'nem nas 3 janelas equivalentes, e agora respondeu por ' + fmt(c.total)
        + ' em ' + c.qtd + ' lançamento(s).',
      valor: c.total, grupoId: g.id, contaChave: c.chave,
    });
  }));
  return out;
}

// 3) Concentração de fornecedor dentro do grupo.
function regraConcentracaoFornecedor(dados, lim) {
  const porGrupo = new Map();
  todosLancamentos(dados).forEach(({ l, grupo }) => {
    if (!porGrupo.has(grupo.id)) porGrupo.set(grupo.id, new Map());
    const m = porGrupo.get(grupo.id);
    const k = l.fornecedor;
    if (!m.has(k)) m.set(k, { fornecedor: k, total: 0, qtd: 0 });
    const f = m.get(k); f.total += l.pago; f.qtd += 1;
  });
  const out = [];
  dados.grupos.forEach((g) => {
    const m = porGrupo.get(g.id);
    if (!m || g.total <= 0) return;
    const top = Array.from(m.values()).sort((a, b) => b.total - a.total)[0];
    if (!top) return;
    const share = top.total / g.total;
    if (share < 0.5 || top.total < lim || m.size < 2) return;
    out.push({
      id: 'concentracao-' + g.id,
      severidade: share >= 0.75 ? 'atencao' : 'info',
      tipo: 'concentracao',
      titulo: fmtPct(share) + ' de ' + g.nome + ' em um só fornecedor',
      detalhe: top.fornecedor + ' recebeu ' + fmt(top.total) + ' em ' + top.qtd
        + ' lançamento(s), de ' + fmt(g.total) + ' do grupo (' + m.size + ' fornecedores no período).',
      valor: top.total, grupoId: g.id,
    });
  });
  return out;
}

// 4) Possível pagamento em duplicidade.
// Critério estreito de propósito: mesmo fornecedor, MESMA conta, MESMO valor,
// 2 ou 3 ocorrências em até 3 dias. Repetição frequente (4+ vezes, ou espalhada
// pelo mês) é rotina de caixa — ex.: 38 pagamentos de R$ 200 a "DESPESAS GERAIS
// EMPRESA" — e não deve virar alerta.
function regraDuplicidade(dados, lim) {
  const m = new Map();
  todosLancamentos(dados).forEach(({ l, grupo, conta }) => {
    if (l.pago <= 0) return;
    const k = l.origem + '|' + l.fornecedor + '|' + conta.chave + '|' + l.pago.toFixed(2);
    if (!m.has(k)) m.set(k, { origem: l.origem, fornecedor: l.fornecedor, valor: l.pago, lancs: [], grupo, conta });
    m.get(k).lancs.push(l);
  });
  const diasEntreDatas = (a, b) => Math.abs((new Date(b) - new Date(a)) / 86400000);
  const out = [];
  Array.from(m.values())
    .filter((x) => {
      if (x.lancs.length < 2 || x.lancs.length > 3) return false;
      if (x.valor * x.lancs.length < Math.max(lim / 2, 500)) return false;
      const datas = x.lancs.map((l) => l.dtpago).filter(Boolean).sort();
      return datas.length === x.lancs.length && diasEntreDatas(datas[0], datas[datas.length - 1]) <= 3;
    })
    .sort((a, b) => b.valor * b.lancs.length - a.valor * a.lancs.length)
    .slice(0, 5)
    .forEach((x) => {
      const datas = x.lancs.map((l) => l.dtpago).join(', ');
      out.push({
        id: 'dup-' + x.origem + '-' + x.conta.chave + '-' + x.valor.toFixed(2),
        severidade: 'atencao',
        tipo: 'duplicidade',
        titulo: 'Valor repetido: ' + x.fornecedor + ' ' + fmt(x.valor) + ' × ' + x.lancs.length,
        detalhe: x.lancs.length + ' pagamentos de ' + fmt(x.valor) + ' ao mesmo fornecedor ('
          + x.origem + ') em ' + datas + ', total ' + fmt(x.valor * x.lancs.length)
          + '. Lançamentos ' + x.lancs.map((l) => l.numlanc + '/' + l.prest).join(', ')
          + '. Pode ser parcela legítima — confira antes.',
        valor: x.valor * x.lancs.length, grupoId: x.grupo.id,
      });
    });
  return out;
}

// 5) Um único lançamento carregando a conta.
function regraLancamentoDominante(dados, lim) {
  const out = [];
  dados.grupos.forEach((g) => g.contas.forEach((c) => {
    if (c.qtd < 2 || c.total < lim) return;
    const maior = c.lancamentos.slice().sort((a, b) => b.pago - a.pago)[0];
    if (!maior) return;
    const share = maior.pago / c.total;
    if (share < 0.7) return;
    out.push({
      id: 'dominante-' + g.id + '-' + c.chave,
      severidade: 'info',
      tipo: 'dominante',
      titulo: fmtPct(share) + ' de ' + c.nome + ' em um lançamento',
      detalhe: 'Lançamento ' + maior.numlanc + '/' + maior.prest + ' (' + maior.origem + ', '
        + maior.fornecedor + ', ' + maior.dtpago + ') de ' + fmt(maior.pago)
        + ' de um total de ' + fmt(c.total) + ' na conta.',
      valor: maior.pago, grupoId: g.id, contaChave: c.chave,
    });
  }));
  return out.sort((a, b) => b.valor - a.valor).slice(0, 5);
}

// 6) Mesmo grupo com peso muito diferente entre as duas empresas.
function regraPesoEntreBases(dados, lim) {
  const out = [];
  const tAk = dados.ak, tJrf = dados.jrf;
  if (tAk <= 0 || tJrf <= 0) return out;
  dados.grupos.forEach((g) => {
    // grupo que só existe em uma das bases é estrutural, não é achado
    if (g.total < lim || g.ak <= 0 || g.jrf <= 0) return;
    const sAk = g.ak / tAk, sJrf = g.jrf / tJrf;
    const dif = Math.abs(sAk - sJrf);
    if (dif < 0.08) return;
    const maior = sAk > sJrf ? 'AK' : 'JRF';
    out.push({
      id: 'peso-' + g.id,
      severidade: dif >= 0.15 ? 'atencao' : 'info',
      tipo: 'comparacao',
      titulo: g.nome + ' pesa mais na ' + maior,
      detalhe: 'Na AK o grupo é ' + fmtPct(sAk) + ' da despesa (' + fmt(g.ak) + ') e na JRF '
        + fmtPct(sJrf) + ' (' + fmt(g.jrf) + ').',
      valor: Math.abs(g.ak - g.jrf), grupoId: g.id,
    });
  });
  return out.sort((a, b) => b.valor - a.valor).slice(0, 4);
}

// 7) Juros, multas e dívida de exercício anterior: sinal de aperto de caixa.
function regraCustoDeAtraso(dados, lim) {
  const alvo = /JUROS|MULTA|MORA|PROTESTO|ATRASO/i;
  let total = 0; const itens = [];
  dados.grupos.forEach((g) => g.contas.forEach((c) => {
    const ehExercAnterior = g.id === 103;
    if (!alvo.test(c.nome) && !ehExercAnterior) return;
    total += c.total;
    itens.push({ grupo: g.nome, conta: c.nome, total: c.total, qtd: c.qtd });
  }));
  if (!itens.length || total < Math.max(lim / 2, 300)) return [];
  itens.sort((a, b) => b.total - a.total);
  return [{
    id: 'custo-atraso',
    severidade: total >= lim * 2 ? 'critica' : 'atencao',
    tipo: 'caixa',
    titulo: 'Juros, multas e dívida antiga: ' + fmt(total),
    detalhe: itens.map((i) => i.conta + ' ' + fmt(i.total) + ' (' + i.qtd + ')').join('; ')
      + '. É dinheiro que sai sem gerar nada — vale cruzar com o fluxo de caixa.',
    valor: total,
  }];
}

// 8) Lançamentos que não se encaixaram no de-para dos grupos.
function regraNaoMapeados(dados) {
  if (!dados.naoMapeados || !dados.naoMapeados.length) return [];
  const total = dados.naoMapeados.reduce((s, g) => s + g.total, 0);
  return [{
    id: 'nao-mapeados',
    severidade: 'critica',
    tipo: 'dados',
    titulo: fmt(total) + ' em grupos não mapeados',
    detalhe: dados.naoMapeados.map((g) => g.origem + ' grupo ' + g.codgrupo + ' ('
      + (g.nome || 'sem nome') + ') ' + fmt(g.total)).join('; ')
      + '. Esses valores ficaram FORA do total; cadastre o de-para no config para entrarem.',
    valor: total,
  }];
}

// ---------- indicadores de apoio ----------

// Curva ABC das contas (quais contas fazem 80% da despesa).
function curvaABC(dados) {
  const contas = [];
  dados.grupos.forEach((g) => g.contas.forEach((c) => contas.push({
    grupo: g.nome, grupoId: g.id, chave: c.chave, nome: c.nome,
    total: c.total, qtd: c.qtd, ak: c.ak, jrf: c.jrf,
  })));
  contas.sort((a, b) => b.total - a.total);
  const total = contas.reduce((s, c) => s + c.total, 0);
  let acc = 0;
  contas.forEach((c) => {
    acc += c.total;
    c.acumulado = total ? acc / total : 0;
    c.classe = c.acumulado <= 0.8 ? 'A' : (c.acumulado <= 0.95 ? 'B' : 'C');
  });
  return {
    contas,
    qtdA: contas.filter((c) => c.classe === 'A').length,
    qtdTotal: contas.length,
    totalA: contas.filter((c) => c.classe === 'A').reduce((s, c) => s + c.total, 0),
  };
}

// Projeção do mês quando o período termina dentro do mês corrente.
function runRate(dados, hojeISO) {
  const fimMes = dados.fim.slice(0, 7);
  if (!hojeISO || hojeISO.slice(0, 7) !== fimMes) return null;
  const [y, m] = fimMes.split('-').map(Number);
  const diasMes = new Date(y, m, 0).getDate();
  const diaCorte = Number(dados.fim.slice(8, 10));
  if (diaCorte >= diasMes) return null;
  const porDia = dados.total / diaCorte;
  return {
    diaCorte, diasMes,
    porDia,
    projecao: porDia * diasMes,
    faltam: porDia * (diasMes - diaCorte),
  };
}

// Top fornecedores do período (visão de caixa, atravessa grupos).
function topFornecedores(dados, n) {
  const m = new Map();
  todosLancamentos(dados).forEach(({ l }) => {
    if (!m.has(l.fornecedor)) m.set(l.fornecedor, { fornecedor: l.fornecedor, total: 0, qtd: 0, ak: 0, jrf: 0 });
    const f = m.get(l.fornecedor);
    f.total += l.pago; f.qtd += 1;
    f[l.origem === 'AK' ? 'ak' : 'jrf'] += l.pago;
  });
  return Array.from(m.values()).sort((a, b) => b.total - a.total).slice(0, n || 12);
}

// ---------- orquestração ----------
function analisar(dados, opcoes) {
  const o = opcoes || {};
  const lim = piso(dados.total);
  const alertas = []
    .concat(regraNaoMapeados(dados))
    .concat(regraVariacaoGrupo(dados, lim))
    .concat(regraContaNova(dados, lim))
    .concat(regraCustoDeAtraso(dados, lim))
    .concat(regraDuplicidade(dados, lim))
    .concat(regraConcentracaoFornecedor(dados, lim))
    .concat(regraLancamentoDominante(dados, lim))
    .concat(regraPesoEntreBases(dados, lim))
    .sort((a, b) => (SEV[b.severidade] - SEV[a.severidade]) || (Math.abs(b.valor || 0) - Math.abs(a.valor || 0)));

  // tudo que é crítico ou atenção fica; o informativo é limitado para a lista
  // continuar legível (o resto está nas tabelas da página).
  const relevantes = alertas.filter((a) => a.severidade !== 'info')
    .concat(alertas.filter((a) => a.severidade === 'info').slice(0, 8));

  return {
    limiar: lim,
    alertas: relevantes,
    criticos: alertas.filter((a) => a.severidade === 'critica').length,
    abc: curvaABC(dados),
    runRate: runRate(dados, o.hoje),
    fornecedores: topFornecedores(dados, 12),
  };
}

module.exports = { analisar, curvaABC, runRate, topFornecedores, piso };
