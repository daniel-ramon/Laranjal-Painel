'use strict';
require('dotenv').config();
const path = require('path');

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

module.exports = {
  PORT: parseInt(process.env.PORT || '3300', 10),
  PYTHON_BIN: process.env.PYTHON_BIN || 'python',
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
  CPAGAR,
};
