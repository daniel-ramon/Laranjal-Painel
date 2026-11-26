'use strict';
// Despesas analíticas (DRE) das duas bases, no formato grupo > conta > lançamento.
// As regras de apuração estão no bloco DRE do config.js (conferidas contra o
// relatório do Bspac9740). Aqui só se monta o SQL, agrega e compara períodos.
const { USE_MOCK, DRIVER, EMPRESAS, DRE } = require('./config');

// ---------- datas ----------
function iso(d) {
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0')
    + '-' + String(d.getDate()).padStart(2, '0');
}
function parse(s) {
  const [y, m, d] = String(s).slice(0, 10).split('-').map(Number);
  return new Date(y, m - 1, d);
}
function addDias(s, n) {
  const d = parse(s); d.setDate(d.getDate() + n); return iso(d);
}
// Desloca n meses preservando o dia; se o mês de destino não tem aquele dia,
// cai no último dia válido (31/03 - 1 mês = 28/02).
function addMeses(s, n) {
  const d = parse(s);
  const dia = d.getDate();
  d.setDate(1);
  d.setMonth(d.getMonth() + n);
  const ultimo = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  d.setDate(Math.min(dia, ultimo));
  return iso(d);
}
function diasEntre(a, b) {
  return Math.round((parse(b) - parse(a)) / 86400000) + 1; // inclusivo
}
function primeiroDiaDoMes(s) { return String(s).slice(0, 7) + '-01'; }
function mesDe(s) { return String(s).slice(0, 7); }

// ---------- SQL ----------
function montarSQL(emp) {
  const c = DRE.col;
  const T = emp.schema + '.' + DRE.tabela;
  const g = DRE.grupoTab, ct = DRE.contaTab, fu = DRE.funcTab;
  const f = { tabela: 'PARCEIROS', colCod: 'CODPARC', colTipo: 'TIPOPARC', colNome: 'NOME' };

  const campos = [
    `t.${c.id} AS NUMLANC`, `t.${c.prest} AS PREST`, `t.${c.totPrest} AS TOTPREST`,
    `t.${c.filial} AS FILIAL`, `t.${c.conta} AS CODCONTA`,
    // CODGRUPO vem vazio em alguns lançamentos (inventário na JRF). CODCONTA é
    // único por base, então o grupo é recuperado pelo cadastro da conta.
    `NVL(NULLIF(t.${c.grupo},0), ct.${ct.colGrupo}) AS CODGRUPO`,
    `t.${c.funcionario} AS CODFUNC`, `t.${c.fornecedorCod} AS CODFORNEC`,
    `t.${c.numNota} AS NUMNOTA`, `t.${c.historico} AS HISTORICO`,
    `t.${c.valor} AS VALOR`, `t.${c.valorPago} AS VPAGO`,
    `t.${c.dtpago} AS DTPAGO`, `t.${c.vencimento} AS DTVENC`, `t.${c.emissao} AS DTEMISSAO`,
    `g.${g.colNome} AS NOMEGRUPO`, `ct.${ct.colNome} AS NOMECONTA`,
    `ct.${ct.colExibir} AS EXIBIRBALANCETE`,
    `fo.${f.colNome} AS FORNECEDOR`, `fu2.${fu.colNome} AS FUNCIONARIO`,
  ];

  const joins = [
    // CODCONTA é único por base (513/513 na AK, 521/521 na JRF), então o join
    // é só por ele — casar também o CODGRUPO perderia os lançamentos sem grupo.
    `LEFT JOIN ${emp.schema}.${ct.tabela} ct ON ct.${ct.colCod} = t.${c.conta}`,
    // o GRUPO é resolvido depois da CONTA porque depende dela
    `LEFT JOIN ${emp.schema}.${g.tabela} g ON g.${g.colCod} = NVL(NULLIF(t.${c.grupo},0), ct.${ct.colGrupo})`,
    // PARCEIROS tem PK composta (CODPARC+TIPOPARC); casar o tipo evita duplicar.
    `LEFT JOIN ${emp.schema}.${f.tabela} fo ON fo.${f.colCod} = t.${c.fornecedorCod} AND fo.${f.colTipo} = t.${c.tipoParceiro}`,
    `LEFT JOIN ${emp.schema}.${fu.tabela} fu2 ON fu2.${fu.colCod} = t.${c.funcionario}`,
  ];

  let where = `WHERE t.${c.dtpago} >= TO_DATE(:ini,'YYYY-MM-DD') AND t.${c.dtpago} < TO_DATE(:fim,'YYYY-MM-DD')`;
  // Filial é constante do config (AK=02, JRF=01), não entrada do usuário.
  if (emp.filial) where += ` AND t.${c.filial} = '${String(emp.filial).replace(/'/g, "''")}'`;
  // Desdobrados: o original foi substituído pelas parcelas novas; contaria em dobro.
  if (DRE.regras.excluirDesdobrados) where += ` AND t.${c.desdobrado} IS NULL`;
  // Contas marcadas para não sair no balancete (é o que o relatório do sistema faz).
  if (DRE.regras.respeitarExibirBalancete) where += ` AND NVL(ct.${ct.colExibir},'S') <> 'N'`;

  return `SELECT ${campos.join(', ')} FROM ${T} t ${joins.join(' ')} ${where}`
    + ` ORDER BY t.${c.dtpago}, t.${c.grupo}, t.${c.conta}`;
}

async function consultar(emp, iniS, fimExclusivoS) {
  const sql = montarSQL(emp);
  if (DRIVER === 'jdbc') return require('./db-jdbc').query(emp.id, sql, iniS, fimExclusivoS);
  return require('./db').query(emp.id, sql, { ini: iniS, fim: fimExclusivoS });
}

function normalizar(origem, row) {
  const d = (v) => (v ? new Date(v).toISOString().slice(0, 10) : null);
  const vpago = row.VPAGO == null ? null : Number(row.VPAGO);
  const valor = Number(row.VALOR) || 0;
  return {
    origem,
    numlanc: Number(row.NUMLANC),
    prest: row.PREST,
    totPrest: row.TOTPREST,
    filial: row.FILIAL,
    codgrupo: Number(row.CODGRUPO) || 0,
    nomeGrupoOrigem: String(row.NOMEGRUPO || '').trim(),
    codconta: Number(row.CODCONTA) || 0,
    nomeContaOrigem: String(row.NOMECONTA || '').trim(),
    codfornec: row.CODFORNEC,
    fornecedor: String(row.FORNECEDOR || '').trim() || ('Fornecedor ' + row.CODFORNEC),
    funcionario: String(row.FUNCIONARIO || '').trim() || null,
    numnota: row.NUMNOTA,
    historico: String(row.HISTORICO || '').trim(),
    valor,
    vpago,
    // o relatório do sistema soma VALOR; VPAGO fica à vista no detalhe quando
    // difere (juros pagos a mais, desconto obtido a menos)
    pago: DRE.regras.usarVpago && vpago != null ? vpago : valor,
    difPagamento: vpago != null && Math.abs(vpago - valor) >= 0.005 ? vpago - valor : 0,
    dtpago: d(row.DTPAGO),
    dtvenc: d(row.DTVENC),
    emissao: d(row.DTEMISSAO),
  };
}

// ---------- agregação ----------
function chaveConta(grupo, lanc) {
  // Em grupo remapeado as contas das duas bases não casam por código
  // (AK 105001 = caixas plásticas; JRF 104001 = manutenção predial).
  return grupo && grupo.contasPorBase ? lanc.origem + ':' + lanc.codconta : String(lanc.codconta);
}

function nomeConta(grupo, atual, lanc) {
  const over = DRE.contasNomes[grupo.id + ':' + lanc.codconta];
  if (over) return over;
  if (!atual) return lanc.nomeContaOrigem || ('Conta ' + lanc.codconta);
  // nas contas presentes nas duas bases vale o nome da base preferida
  if (lanc.origem === DRE.preferirNomeDaBase && lanc.nomeContaOrigem) return lanc.nomeContaOrigem;
  return atual;
}

function zeros() { return { total: 0, ak: 0, jrf: 0, qtd: 0 }; }
function soma(acc, l) {
  acc.total += l.pago;
  acc[l.origem === 'AK' ? 'ak' : 'jrf'] += l.pago;
  acc.qtd += 1;
}

// Agrega lançamentos na árvore grupo > conta > lançamentos.
// detalhe=false descarta as linhas (usado nos períodos de comparação).
function agregar(lancs, detalhe) {
  const grupos = new Map();
  const naoMapeados = new Map();
  const SEM = { id: DRE.semClassificacao.id, nome: DRE.semClassificacao.nome, contasPorBase: true };

  lancs.forEach((l) => {
    let g = DRE.grupoCanonico(l.origem, l.codgrupo);
    if (!g && !l.codgrupo) g = SEM;
    if (!g) {
      // Código de grupo fora do de-para: reportado, nunca somado em silêncio.
      const k = l.origem + ':' + l.codgrupo;
      if (!naoMapeados.has(k)) {
        naoMapeados.set(k, Object.assign(
          { origem: l.origem, codgrupo: l.codgrupo, nome: l.nomeGrupoOrigem }, zeros()));
      }
      soma(naoMapeados.get(k), l);
      return;
    }
    if (!grupos.has(g.id)) {
      grupos.set(g.id, Object.assign({
        id: g.id, nome: g.nome,
        excluido: DRE.gruposExcluidos.indexOf(g.id) >= 0,
        investimento: (DRE.gruposInvestimento || []).indexOf(g.id) >= 0,
        nomesOrigem: {}, _contas: new Map(),
      }, zeros()));
    }
    const G = grupos.get(g.id);
    if (l.nomeGrupoOrigem) G.nomesOrigem[l.origem] = l.nomeGrupoOrigem;
    soma(G, l);

    const ck = chaveConta(g, l);
    if (!G._contas.has(ck)) {
      G._contas.set(ck, Object.assign({
        chave: ck, codconta: l.codconta, nome: null, lancamentos: [],
      }, zeros()));
    }
    const C = G._contas.get(ck);
    C.nome = nomeConta(g, C.nome, l);
    soma(C, l);
    if (detalhe) C.lancamentos.push(l);
  });

  const lista = Array.from(grupos.values()).map((G) => {
    const contas = Array.from(G._contas.values()).map((C) => {
      C.lancamentos.sort((a, b) =>
        (a.dtpago < b.dtpago ? -1 : a.dtpago > b.dtpago ? 1 : b.pago - a.pago));
      return C;
    }).sort((a, b) => b.total - a.total);
    delete G._contas;
    G.contas = contas;
    return G;
  }).sort((a, b) => b.total - a.total);

  return {
    grupos: lista,
    naoMapeados: Array.from(naoMapeados.values()).sort((a, b) => b.total - a.total),
  };
}

function totalDespesas(grupos) {
  return grupos.filter((g) => !g.excluido).reduce((s, g) => s + g.total, 0);
}

function variacao(atualV, baseV) {
  return baseV ? (atualV - baseV) / Math.abs(baseV) : null;
}

// ---------- API ----------
// Árvore do período [ini, fim] (inclusivos) + comparativos (período anterior de
// igual duração e média das 3 janelas equivalentes dos meses anteriores).
async function listar(iniS, fimS) {
  const dias = Math.max(1, diasEntre(iniS, fimS));
  const anterior = { ini: addDias(iniS, -dias), fim: addDias(iniS, -1) };
  const janelas3m = [1, 2, 3].map((k) => ({ ini: addMeses(iniS, -k), fim: addMeses(fimS, -k) }));
  // série mensal dos 6 meses que terminam no mês de 'fim'
  const serieIni = primeiroDiaDoMes(addMeses(primeiroDiaDoMes(fimS), -5));

  // Uma única varredura por base cobrindo tudo; os recortes são feitos aqui.
  const inicioBusca = [iniS, anterior.ini, janelas3m[2].ini, serieIni].sort()[0];
  let todos;
  if (USE_MOCK) {
    todos = require('./mock').gerarDRE(inicioBusca, fimS);
  } else {
    todos = [];
    for (const emp of EMPRESAS) {
      const rows = await consultar(emp, inicioBusca, addDias(fimS, 1));
      rows.forEach((r) => todos.push(normalizar(emp.id, r)));
    }
  }

  const noPeriodo = (p) => todos.filter((l) => l.dtpago && l.dtpago >= p.ini && l.dtpago <= p.fim);

  const atual = agregar(noPeriodo({ ini: iniS, fim: fimS }), true);
  const ant = agregar(noPeriodo(anterior), false);
  const tres = janelas3m.map((p) => agregar(noPeriodo(p), false));

  const mAnt = new Map(ant.grupos.map((g) => [g.id, g]));
  const mTres = tres.map((t) => new Map(t.grupos.map((g) => [g.id, g])));

  // soma um campo nas 3 janelas e devolve a média
  const med3 = (getter) => mTres.reduce((s, m) => s + getter(m), 0) / 3;

  atual.grupos.forEach((g) => {
    const a = mAnt.get(g.id);
    g.anterior = a ? a.total : 0;
    // quebra por empresa também nos comparativos, para o filtro AK/JRF da
    // página continuar comparando com a base certa
    g.anteriorAk = a ? a.ak : 0;
    g.anteriorJrf = a ? a.jrf : 0;
    g.media3 = med3((m) => (m.get(g.id) ? m.get(g.id).total : 0));
    g.media3Ak = med3((m) => (m.get(g.id) ? m.get(g.id).ak : 0));
    g.media3Jrf = med3((m) => (m.get(g.id) ? m.get(g.id).jrf : 0));
    g.variacao = variacao(g.total, g.anterior);
    g.variacaoMedia3 = variacao(g.total, g.media3);

    const cAnt = new Map((a ? a.contas : []).map((c) => [c.chave, c]));
    const cTres = mTres.map((m) =>
      new Map((m.get(g.id) ? m.get(g.id).contas : []).map((c) => [c.chave, c])));
    g.contas.forEach((c) => {
      const ca = cAnt.get(c.chave);
      c.anterior = ca ? ca.total : 0;
      c.anteriorAk = ca ? ca.ak : 0;
      c.anteriorJrf = ca ? ca.jrf : 0;
      const m3 = (f) => cTres.reduce((s, m) => s + (m.get(c.chave) ? f(m.get(c.chave)) : 0), 0) / 3;
      c.media3 = m3((x) => x.total);
      c.media3Ak = m3((x) => x.ak);
      c.media3Jrf = m3((x) => x.jrf);
      c.variacao = variacao(c.total, c.anterior);
      c.variacaoMedia3 = variacao(c.total, c.media3);
      c.nova = !c.anterior && !c.media3;   // conta sem histórico no comparativo
    });
  });

  const total = totalDespesas(atual.grupos);
  const totalAnterior = totalDespesas(ant.grupos);
  const totalMedia3 = tres.reduce((s, t) => s + totalDespesas(t.grupos), 0) / 3;
  const somaBase = (grupos, base) => grupos.filter((g) => !g.excluido).reduce((s, g) => s + g[base], 0);
  atual.grupos.forEach((g) => { g.pct = total ? g.total / total : 0; });

  // série mensal (só os grupos que entram na despesa)
  const meses = new Map();
  todos.forEach((l) => {
    if (!l.dtpago || l.dtpago < serieIni || l.dtpago > fimS) return;
    const g = DRE.grupoCanonico(l.origem, l.codgrupo);
    if (g && DRE.gruposExcluidos.indexOf(g.id) >= 0) return;
    const k = mesDe(l.dtpago);
    if (!meses.has(k)) meses.set(k, { mes: k, total: 0, ak: 0, jrf: 0 });
    const M = meses.get(k);
    M.total += l.pago;
    M[l.origem === 'AK' ? 'ak' : 'jrf'] += l.pago;
  });

  const incluidos = atual.grupos.filter((g) => !g.excluido);
  const excluidos = atual.grupos.filter((g) => g.excluido);
  const qtd = incluidos.reduce((s, g) => s + g.qtd, 0);

  return {
    ini: iniS, fim: fimS, dias,
    periodoAnterior: anterior,
    janelas3m,
    total,
    ak: incluidos.reduce((s, g) => s + g.ak, 0),
    jrf: incluidos.reduce((s, g) => s + g.jrf, 0),
    qtd,
    ticket: qtd ? total / qtd : 0,
    totalAnterior,
    totalAnteriorAk: somaBase(ant.grupos, 'ak'),
    totalAnteriorJrf: somaBase(ant.grupos, 'jrf'),
    totalMedia3,
    totalMedia3Ak: tres.reduce((s, t) => s + somaBase(t.grupos, 'ak'), 0) / 3,
    totalMedia3Jrf: tres.reduce((s, t) => s + somaBase(t.grupos, 'jrf'), 0) / 3,
    variacao: variacao(total, totalAnterior),
    variacaoMedia3: variacao(total, totalMedia3),
    grupos: incluidos,
    excluidos,
    naoMapeados: atual.naoMapeados,
    serie: Array.from(meses.values()).sort((a, b) => (a.mes < b.mes ? -1 : 1)),
    empresas: EMPRESAS.map((e) => ({ id: e.id, nome: e.nome, cor: e.cor })),
  };
}

module.exports = { listar, montarSQL, agregar, addDias, addMeses, diasEntre };
