'use strict';
require('dotenv').config();
const path = require('path');
const { spawnSync } = require('child_process');

// Resolve o caminho ABSOLUTO do python.exe. Rodando como serviço do Windows, o
// processo só enxerga o PATH do sistema; o Python instalado "só para o usuário"
// não aparece e `spawnSync('python')` falha com ENOENT. Então:
//  - se PYTHON_BIN no .env já é um caminho explícito, confia nele;
//  - senão, descobre via `py` launcher (fica em C:\Windows, visível a serviços),
//    depois pelo PATH e por fim em locais comuns de instalação.
function resolvePythonBin() {
  const env = (process.env.PYTHON_BIN || '').trim();
  if (env && (env.includes('\\') || env.includes('/') || /\.exe$/i.test(env))) {
    return env; // caminho explícito do usuário
  }
  const pegaExe = (bin, extra) => {
    try {
      const r = spawnSync(bin, (extra || []).concat(['-c', 'import sys;print(sys.executable)']),
        { encoding: 'utf-8', timeout: 8000, windowsHide: true });
      const p = (r.stdout || '').trim();
      if (!r.error && r.status === 0 && p) return p;
    } catch (_) {}
    return '';
  };
  // 1) py launcher (sempre em C:\Windows → serviços enxergam)
  let p = pegaExe('py', ['-3']);
  if (p) return p;
  // 2) nomes no PATH (resolve para o caminho absoluto, que funciona no serviço)
  for (const c of ['python', 'python3']) {
    p = pegaExe(c);
    if (p) return p;
  }
  // 3) locais comuns de instalação no Windows
  const fs = require('fs');
  const la = process.env.LOCALAPPDATA || '';
  const up = process.env.USERPROFILE || '';
  const candidatos = [
    la && path.join(la, 'Programs', 'Python', 'Python313', 'python.exe'),
    la && path.join(la, 'Programs', 'Python', 'Python312', 'python.exe'),
    up && path.join(up, 'AppData', 'Local', 'Programs', 'Python', 'Python313', 'python.exe'),
    'C:\\Python313\\python.exe',
    'C:\\Program Files\\Python313\\python.exe',
    'C:\\Program Files\\Python312\\python.exe',
  ].filter(Boolean);
  for (const c of candidatos) {
    try { if (fs.existsSync(c)) return c; } catch (_) {}
  }
  return env || 'python'; // último recurso (erro claro se não existir)
}
const PYTHON_BIN = resolvePythonBin();

// Empresas monitoradas. 'schema' é o owner das tabelas no Oracle.
const EMPRESAS = [
  {
    id: 'AK',
    nome: 'AK Hortifruti',
    cor: '#2dd4bf',           // selo (teal)
    schema: 'AKHORTIFRUTI',
    filial: '02',             // na AK só consideramos a filial 02

    user: process.env.AK_USER || 'consulta',
    password: process.env.AK_PASSWORD || '',
    connectString: process.env.AK_CONNECT || 'AK-SERVER:1521/orcl',
    jdbcUrl: process.env.AK_JDBC || 'jdbc:oracle:thin:@//AK-SERVER:1521/orcl',
  },
  {
    id: 'JRF',
    nome: 'JRF (Laranjal)',
    cor: '#f59e0b',           // selo (amber)
    schema: 'LARANJAL',
    filial: '01',             // na JRF só consideramos a filial 01

    user: process.env.JRF_USER || 'consulta',
    password: process.env.JRF_PASSWORD || '',
    connectString: process.env.JRF_CONNECT || 'DESKTOP-1MSLGLE:1521/orcl',
    jdbcUrl: process.env.JRF_JDBC || 'jdbc:oracle:thin:@//DESKTOP-1MSLGLE:1521/orcl',
  },
];

// ===== Parceiros do próprio grupo (página Vendas) =====
// São as empresas do grupo cadastradas como parceiro. O que sai para elas é
// transferência/venda interna, não venda a cliente: entra em lotes enormes e
// esporádicos (ex.: 42.500 kg de laranja num único pedido em 28/10/2026) e
// distorce as médias do planejamento. Todos estão sem CODATIV, então cairiam
// no grupo "Ceasa". Os códigos são os mesmos nas duas bases.
// Ficaram de fora de propósito: 229 (FGTS RECISORIO, não é cliente) e
// 1220 (ROSELANE RODRIGUES DE FREITAS, pessoa física que pode ser cliente real).
const PARCEIROS_INTERNOS = [
  62,    // JOSE RODRIGUES DE FREITAS ME  · O LARANJAL
  377,   // AK HORTIFRUTI LTDA            · ANNA K
  503,   // JOSE RODRIGUES DE FREITAS EPP · O LARANJAL
  1537,  // AK HORTIFRUTI LTDA            · O LARANJAL
];

// Mapeamento de colunas da tabela CPAGAR (ajuste aqui se o nome mudar).
const CPAGAR = {
  tabela: 'CPAGAR',
  col: {
    id: 'NUMLANC',
    filial: 'CODFILIAL',
    fornecedorCod: 'CODFORNEC',
    tipoParceiro: 'TIPOPARCEIRO',  // casa com PARCEIROS.TIPOPARC (PK é CODPARC+TIPOPARC)
    numNota: 'NUMNOTA',
    valor: 'VALOR',
    valorPago: 'VPAGO',
    vencimento: 'DTVENC',     // competência = mês do vencimento
    baixa: 'DTBAIXA',         // baixa
    dtpago: 'DTPAGO',         // data de pagamento
    emissao: 'DTEMISSAO',
    status: 'STATUS',
    historico: 'HISTORICO',
    prest: 'PREST',
    totPrest: 'TOTPREST',
  },
  // ATENÇÃO: STATUS (A/B) NÃO indica pago. Pago/baixado = DTBAIXA preenchida.
  statusExcluir: [],
  // Nome do fornecedor vem da PARCEIROS. PK = (CODPARC, TIPOPARC); por isso o join casa
  // CPAGAR.CODFORNEC=PARCEIROS.CODPARC E CPAGAR.TIPOPARCEIRO=PARCEIROS.TIPOPARC (evita duplicar).
  fornecedor: { tabela: 'PARCEIROS', colCod: 'CODPARC', colTipo: 'TIPOPARC', colNome: 'NOME' },
};

// ===== Página Nordestão (adiantamentos sobre o contas a receber) =====
const NORDESTAO = {
  base: 'AK', // as vendas ao Nordestão ficam na base da AK (AKHORTIFRUTI)
  // CODCLI de todas as lojas do Nordestão cadastradas no sistema
  codigos: [9, 10, 11, 12, 14, 153, 154, 208, 236, 277, 634, 748, 933, 1270, 1388, 1541, 1571],
  taxaPadrao: 2.30, // % ao mês (usada quando o arquivo não traz a taxa)
  filial: '02',     // a consulta do contas a receber considera só a filial 02 da AK
  pastaArquivos: path.join(__dirname, '..', 'adiantamentos'),
  creceber: {
    tabela: 'CRECEBER',
    col: {
      numNota: 'NUMNOTA', numVenda: 'NUMVENDA', cliente: 'CODCLI', prest: 'PREST',
      filial: 'CODFILIAL', codcob: 'CODCOB',
      emissao: 'DTEMISSAO', vencimento: 'DTVENC', valor: 'VALOR', vpago: 'VPAGO', dtpago: 'DTPAGO',
    },
    clienteTab: { tabela: 'CLIENTE', colCod: 'CODCLI', colNome: 'FANTASIA' },
  },
  movimentacao: {
    tabela: 'MOVIMENTACAO',
    col: { numVenda: 'NUMVENDA', numNota: 'NUMNOTA', codProd: 'CODPROD', qt: 'QT', punit: 'PUNIT', operacao: 'OPERACAO' },
    produtoTab: { tabela: 'PRODUTO', colCod: 'CODPROD', colNome: 'DESCRICAO' },
    operacaoVenda: 'S',
  },
};

// ===== Página Entregas (acompanhamento das entregas por caminhão/rota) =====
// Reaproveita o projeto de automação de pedidos (lojas.csv + pedidos extraídos).
const PEDIDOS_DIR = process.env.PEDIDOS_DIR || 'D:\\LARANJAL\\pedidos-automacao';
const ENTREGAS = {
  pedidosDir: PEDIDOS_DIR,
  lojasCsv: path.join(PEDIDOS_DIR, 'lojas.csv'),
  rotasCsv: path.join(PEDIDOS_DIR, 'rotas.csv'),           // cadastro de rotas (criado se faltar)
  pedidosJson: path.join(PEDIDOS_DIR, 'saida', 'pedidos_extraidos.json'),
  // Rotas que já devem existir na primeira execução (code → motorista/nome).
  rotasPadrao: [
    { codigo: '01', nome: 'Deco' },
    { codigo: '02', nome: 'Galeguinho' },
    { codigo: '03', nome: 'Naldo' },
    { codigo: '04', nome: 'Leonardo' },
  ],
};

// ===== Página Banco / Bradesco (extrato de conta corrente via API) =====
// Reaproveita o projeto "Extrato Bradesco" copiado para dentro do painel.
const BRADESCO_DIR = process.env.BRADESCO_DIR || path.join(__dirname, '..', 'extrato-bradesco');
const BRADESCO = {
  dir: BRADESCO_DIR,
  bridge: path.join(__dirname, '..', 'tools', 'extrato_bradesco.py'),
  // Payload real (fixture do sandbox) para o modo demonstração, enquanto as
  // credenciais de produção não estão liberadas e o sandbox é um stub instável.
  demoPayload: path.join(BRADESCO_DIR, 'tests', 'fixtures', 'extrato_sandbox.json'),
  // Intervalo exato que o stub do sandbox aceita (qualquer outro devolve erro).
  demoPeriodo: { inicio: '2024-11-06', fim: '2024-11-20' },
};


// ===== Página Despesas (DRE analítico) =====
// Reproduz o relatório analítico de despesas do Bspac9740 (Balancete/DRE) nas
// duas bases. Regras de apuração CONFERIDAS contra o relatório do sistema
// (AK, filial 02, 01/11 a 26/11/2026: R$ 138.131,07 em 36 lançamentos):
//   1) data considerada = DTPAGO dentro do intervalo (não é DTVENC nem DTBAIXA);
//   2) fora os desdobrados (NUMLANCDESD preenchido, CODCOB='DESD') — o lançamento
//      original é substituído pelas parcelas novas e contaria em dobro;
//   3) fora as contas com CONTA.EXIBIRBALANCETE='N' (é o que explica a ausência
//      dos grupos 8 - receitas/despesas financeiras e 101 - compensações);
//   4) valor = VPAGO (o que efetivamente saiu), não VALOR.
//
// Unificação entre as bases: os grupos 1..13 e 100..102 têm o MESMO código nas
// duas, mas 14 e 103..106 estão trocados. Por isso o de-para explícito abaixo.
// Nos grupos remapeados as contas também não casam por código (em AK 105001 é
// "aquisição de caixas plásticas" e em JRF 104001 é "manutenção predial"), então
// esses grupos usam contasPorBase: as contas das duas empresas convivem dentro
// do mesmo grupo canônico, sem fusão indevida.
const DRE = {
  tabela: 'CPAGAR',
  col: {
    id: 'NUMLANC', prest: 'PREST', totPrest: 'TOTPREST', filial: 'CODFILIAL',
    grupo: 'CODGRUPO', conta: 'CODCONTA', funcionario: 'CODFUNC',
    fornecedorCod: 'CODFORNEC', tipoParceiro: 'TIPOPARCEIRO',
    numNota: 'NUMNOTA', historico: 'HISTORICO',
    valor: 'VALOR', valorPago: 'VPAGO',
    dtpago: 'DTPAGO', vencimento: 'DTVENC', baixa: 'DTBAIXA', emissao: 'DTEMISSAO',
    desdobrado: 'NUMLANCDESD',
  },
  grupoTab: { tabela: 'GRUPO', colCod: 'CODGRUPO', colNome: 'GRUPO' },
  contaTab: { tabela: 'CONTA', colCod: 'CODCONTA', colGrupo: 'CODGRUPO', colNome: 'CONTA', colExibir: 'EXIBIRBALANCETE' },
  funcTab: { tabela: 'EMPREGADO', colCod: 'CODFUNC', colNome: 'NOME' },

  // Regras de apuração (ver comentário acima). Deixadas aqui para ficar fácil
  // afrouxar uma delas se o relatório do sistema mudar de critério.
  regras: {
    excluirDesdobrados: true,
    respeitarExibirBalancete: true,
    usarVpago: true,
  },

  // Grupos que NÃO entram no total de despesas. O 100 (fornecedores revenda) é
  // custo da mercadoria vendida, não despesa operacional — é o único grupo que
  // o relatório do sistema omite sem que nenhum campo da base o justifique.
  // Continua visível na página, num bloco próprio de referência.
  // O 114 (ajuste de estoque/inventário na JRF) também fica fora: é acerto de
  // estoque, não desembolso operacional, e entra em valores muito altos
  // (R$ 415 mil em nov/2026) que mascarariam qualquer comparação de despesa.
  gruposExcluidos: [100, 114],

  // Nome exibido quando a conta existe nas duas bases com descrições diferentes:
  // vale a da base indicada (a outra fica no título da linha do lançamento).
  preferirNomeDaBase: 'AK',

  // Sobrescreve o nome canônico de uma conta. Chave: 'grupoCanonico:codconta'.
  // Use para corrigir os cadastros com typo (ex.: 'RANSFERENCIA LUCIANO').
  contasNomes: {},

  // Lançamentos sem grupo (JRF tem alguns com CODGRUPO=0) caem aqui.
  semClassificacao: { id: -1, nome: 'SEM CLASSIFICAÇÃO' },

  // De-para dos grupos. 'de' = código do grupo em cada base.
  grupos: [
    { id: 1,   nome: 'INVESTIMENTOS/IMOBILIZADOS',                 de: { AK: 1, JRF: 1 } },
    { id: 2,   nome: 'DESPESAS DIRETORIA GERAL',                   de: { AK: 2, JRF: 2 } },
    { id: 3,   nome: 'DESPESA RECURSOS HUMANOS',                   de: { AK: 3, JRF: 3 } },
    { id: 4,   nome: 'DESPESAS COM VENDAS',                        de: { AK: 4, JRF: 4 } },
    { id: 5,   nome: 'DESPESAS COM SUPERVISORES/ESC. DE VENDA',    de: { AK: 5, JRF: 5 } },
    { id: 6,   nome: 'VERBAS/DESPESAS DEPTO COMPRAS',              de: { AK: 6, JRF: 6 } },
    { id: 7,   nome: 'DESPESAS/RECEITAS ADMINISTRATIVAS',          de: { AK: 7, JRF: 7 } },
    { id: 8,   nome: 'RECEITAS/DESPESAS FINANCEIRAS',              de: { AK: 8, JRF: 8 } },
    { id: 9,   nome: 'DESPESAS/RECEITAS TRIBUTÁRIAS',              de: { AK: 9, JRF: 9 } },
    { id: 10,  nome: 'DESPESAS/RECEITAS C/ TRANSPORTE',            de: { AK: 10, JRF: 10 } },
    { id: 11,  nome: 'DESPESAS OPERACIONAIS UNIDADE CEASA',        de: { AK: 11, JRF: 11 } },
    { id: 12,  nome: 'DESPESAS INFORMÁTICA',                       de: { AK: 12, JRF: 12 } },
    { id: 13,  nome: 'MARKETING',                                  de: { AK: 13, JRF: 13 } },
    { id: 14,  nome: 'DESPESAS COM PERDAS/AVARIAS',                de: { AK: 14 }, contasPorBase: true },
    { id: 100, nome: 'FORNECEDORES REVENDA (CMV)',                 de: { AK: 100, JRF: 100 } },
    { id: 101, nome: 'COMPENSAÇÕES/ACERTOS',                       de: { AK: 101, JRF: 101 } },
    { id: 102, nome: 'PAGAMENTO DE EMPRÉSTIMOS ADQUIRIDOS',        de: { AK: 102, JRF: 102 } },
    { id: 103, nome: 'PAGAMENTO DE DESPESAS DE EXERC. ANTERIORES', de: { AK: 103, JRF: 105 }, contasPorBase: true },
    { id: 104, nome: 'DESPESAS COM OPERAÇÃO MARACUJÁ',             de: { AK: 104, JRF: 106 }, contasPorBase: true },
    { id: 105, nome: 'DESPESAS OPERACIONAIS UNIDADE TABORDA',      de: { AK: 105, JRF: 104 }, contasPorBase: true },
    { id: 106, nome: 'PERDAS COM AVARIAS DE PRODUTOS',             de: { AK: 106, JRF: 103 }, contasPorBase: true },
    { id: 114, nome: 'AJUSTE DE ESTOQUE E INVENTÁRIO',             de: { JRF: 14 }, contasPorBase: true },
  ],

  // Modelo usado na análise com a Claude API (só comenta números já calculados).
  modeloIA: process.env.DRE_MODELO || 'claude-opus-5-5',
};

// Índice 'EMPRESA:codgrupoOrigem' -> grupo canônico. Código de grupo que não
// estiver aqui é reportado em naoMapeados[] pela página, nunca somado em silêncio.
DRE.mapaGrupos = (() => {
  const m = new Map();
  DRE.grupos.forEach((g) => {
    Object.keys(g.de || {}).forEach((emp) => m.set(emp + ':' + g.de[emp], g));
  });
  return m;
})();
DRE.grupoCanonico = (empresaId, codgrupo) =>
  DRE.mapaGrupos.get(empresaId + ':' + Number(codgrupo)) || null;
module.exports = {
  PORT: parseInt(process.env.PORT || '3300', 10),
  PYTHON_BIN,
  NORDESTAO,
  ENTREGAS,
  BRADESCO,
  USE_MOCK: String(process.env.USE_MOCK || 'true').toLowerCase() === 'true',
  // driver de acesso: 'jdbc' (Java/ojdbc, sem Instant Client) ou 'thick' (oracledb + Instant Client)
  DRIVER: (process.env.DRIVER || 'jdbc').toLowerCase(),
  JAVA_BIN: process.env.JAVA_BIN || 'C:\\Program Files\\Java\\jdk1.8.0_202\\bin\\java.exe',
  OJDBC_JAR: process.env.OJDBC_JAR || 'D:\\oracle\\product\\10.2.0\\db_1\\jdbc\\lib\\ojdbc14.jar',
  ORACLE_CLIENT_LIB_DIR: process.env.ORACLE_CLIENT_LIB_DIR || '',
  ORACLE_TNS_ADMIN: process.env.ORACLE_TNS_ADMIN || '',
  EMPRESAS,
  PARCEIROS_INTERNOS,
  CPAGAR,
  DRE,
};
