'use strict';
// Dados de exemplo para rodar o painel sem o banco.
// Gera títulos com vencimentos ao redor de HOJE, para popular os cards/KPIs.

const FORNECEDORES = [
  'Distribuidora Verde Folha', 'Atacado Pomar Real', 'Embalagens Nova Era',
  'Transporte Rápido Sul', 'Hortifruti Central', 'Frigorífico Boa Carne',
  'Energia & Cia', 'Água Mineral Serra', 'Papelaria União', 'Limpeza Total',
  'Banco Credi', 'Prefeitura (Tributos)', 'Cooperativa Agro', 'Gás Industrial',
];

function addDays(base, n) {
  const d = new Date(base); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() + n);
  return d;
}

function gerar(mes /* 'YYYY-MM' */) {
  const [y, m] = mes.split('-').map(Number);
  const hoje = new Date(); hoje.setHours(0, 0, 0, 0);
  const mesAtual = (hoje.getFullYear() === y && (hoje.getMonth() + 1) === m);

  // Deslocamentos de vencimento (em dias a partir de hoje) e se está pago.
  const plano = mesAtual
    ? [
        [-25, true], [-18, true], [-12, false], [-9, false], [-5, false], [-2, false],
        [0, false], [0, false], [1, false], [2, false], [3, false], [4, false],
        [6, false], [8, false], [12, false], [16, false], [20, true], [24, false],
      ]
    : [
        // mês fora do atual: distribui dentro do mês escolhido
        [2, true], [5, true], [8, false], [11, false], [14, false], [17, false],
        [20, false], [23, true], [26, false],
      ];

  const empresas = ['AK', 'JRF'];
  const linhas = [];
  let seq = 1000;

  plano.forEach((p, idx) => {
    empresas.forEach((origem, e) => {
      const base = mesAtual ? hoje : new Date(y, m - 1, 1);
      const dtvenc = mesAtual ? addDays(hoje, p[0]) : addDays(base, p[0]);
      const pago = p[1];
      const valor = Math.round((800 + ((idx * 737 + e * 1234) % 9000)) / 10) * 10
        + (origem === 'JRF' ? 55 : 0);
      const fornIdx = (idx * 2 + e) % FORNECEDORES.length;
      linhas.push({
        origem,
        numlanc: ++seq,
        filial: origem === 'AK' ? '01' : '01',
        codfornec: 100 + fornIdx,
        fornecedor: FORNECEDORES[fornIdx],
        numnota: 20000 + seq,
        valor,
        vpago: pago ? valor : 0,
        dtvenc: dtvenc.toISOString().slice(0, 10),
        dtbaixa: pago ? addDays(dtvenc, -1).toISOString().slice(0, 10) : null,
        emissao: addDays(dtvenc, -30).toISOString().slice(0, 10),
        status: pago ? 'B' : 'A',
        pago,
        historico: 'Título ' + (origem) + ' ' + FORNECEDORES[fornIdx],
      });
    });
  });

  return linhas;
}

// Gera o plano ao redor de HOJE e filtra pelos vencimentos no período [ini, fim]
// (ambos inclusivos). Serve ao filtro por data de vencimento da página de contas.
function gerarPeriodo(iniS, fimS) {
  const hoje = new Date();
  const mesHoje = hoje.getFullYear() + '-' + String(hoje.getMonth() + 1).padStart(2, '0');
  return gerar(mesHoje).filter((t) => t.dtvenc >= iniS && t.dtvenc <= fimS);
}

// ===== Despesas (DRE) =====
// Gera lançamentos pagos no intervalo pedido, com grupos e contas que existem
// no de-para do config, para a página rodar sem banco (USE_MOCK=true).
const DRE_CONTAS = [
  { emp: 'AK',  grupo: 3,   conta: 3007,   nome: 'SALARIOS',                 base: 45000, forn: 'FOLHA DE PAGAMENTOS' },
  { emp: 'JRF', grupo: 3,   conta: 3007,   nome: 'SALARIOS',                 base: 38000, forn: 'FOLHA DE PAGAMENTOS' },
  { emp: 'AK',  grupo: 3,   conta: 3012,   nome: 'VALE TRANSPORTE',          base: 2600,  forn: 'VIACAO URBANA' },
  { emp: 'AK',  grupo: 7,   conta: 7040,   nome: 'ENERGIA ELETRICA',         base: 7400,  forn: 'NEOENERGIA' },
  { emp: 'JRF', grupo: 7,   conta: 7040,   nome: 'ENERGIA ELETRICA',         base: 5100,  forn: 'NEOENERGIA' },
  { emp: 'JRF', grupo: 7,   conta: 7089,   nome: 'AGUA',                     base: 980,   forn: 'CAERN' },
  { emp: 'AK',  grupo: 10,  conta: 10022,  nome: 'COMBUSTIVEL',              base: 9800,  forn: 'POSTO CENTRAL' },
  { emp: 'JRF', grupo: 10,  conta: 10054,  nome: 'MANUTENCAO DE VEICULOS',   base: 4300,  forn: 'OFICINA DO ZE' },
  { emp: 'AK',  grupo: 2,   conta: 2008,   nome: 'CARTAO DE CREDITO',        base: 3100,  forn: 'BANCO NUBANK' },
  { emp: 'JRF', grupo: 11,  conta: 11006,  nome: 'ALUGUEL BOX CEASA',        base: 6200,  forn: 'CEASA RN' },
  { emp: 'AK',  grupo: 12,  conta: 12016,  nome: 'LICENCA DE SOFTWARE',      base: 1450,  forn: 'BELT SISTEMAS' },
  { emp: 'AK',  grupo: 1,   conta: 1006,   nome: 'AQUISICAO DE EQUIPAMENTO', base: 12500, forn: 'BANCO VOTORANTIM' },
  { emp: 'JRF', grupo: 104, conta: 104001, nome: 'MANUTENCAO PREDIAL TABORDA', base: 3300, forn: 'CONSTRUTORA LIMA' },
  { emp: 'AK',  grupo: 105, conta: 105002, nome: 'MANUTENCAO DE PREDIO',     base: 2800,  forn: 'CONSTRUTORA LIMA' },
  { emp: 'AK',  grupo: 100, conta: 100000, nome: 'COMPRA DE MERCADORIA P/ REVENDA', base: 320000, forn: 'PRODUTOR RURAL' },
  { emp: 'JRF', grupo: 100, conta: 100000, nome: 'COMPRA DE MERCADORIA P/ REVENDA', base: 410000, forn: 'PRODUTOR RURAL' },
];

function gerarDRE(iniS, fimS) {
  const nomesGrupo = {
    1: 'INVESTIMENTOS/IMOBILIZADOS', 2: 'DESPESAS DIRETORIA GERAL',
    3: 'DESPESA RECURSOS HUMANOS', 7: 'DESPESAS/RECEITAS ADMINISTRATIVAS',
    10: 'DESPESAS/RECEITAS C/TRANSPORTE', 11: 'DESPESAS OPERACIONAIS UNID CEASA',
    12: 'DESPESAS INFORMATICA', 100: 'FORNECEDORES REVENDA',
    104: 'DESPESAS OPERACIONAS UNIDADE TABORDA', 105: 'DESPESAS OPERACIONAIS UNID TABORDA',
  };
  const out = [];
  let seq = 50000;
  const fim = new Date(fimS + 'T00:00:00');
  for (let d = new Date(iniS + 'T00:00:00'); d <= fim; d.setDate(d.getDate() + 1)) {
    const dia = d.getDate();
    const iso = d.toISOString().slice(0, 10);
    const semente = d.getMonth() * 31 + dia;
    DRE_CONTAS.forEach((c, i) => {
      // cada conta paga em dias diferentes do mês, com variação suave
      if ((dia + i * 3) % (c.grupo === 100 ? 2 : 7) !== 0) return;
      const fator = 0.75 + (((semente + i * 17) % 50) / 100);
      const valor = Math.round(c.base * fator / 10) * 10 / (c.grupo === 100 ? 8 : 1);
      out.push({
        origem: c.emp, numlanc: ++seq, prest: '1', totPrest: 1,
        filial: c.emp === 'AK' ? '02' : '01',
        codgrupo: c.grupo, nomeGrupoOrigem: nomesGrupo[c.grupo] || ('GRUPO ' + c.grupo),
        codconta: c.conta, nomeContaOrigem: c.nome,
        codfornec: 100 + i, fornecedor: c.forn,
        funcionario: i % 3 === 0 ? 'NONATO' : null,
        numnota: 70000 + seq, historico: c.nome + ' ' + iso,
        valor, pago: valor,
        dtpago: iso, dtvenc: iso, emissao: iso,
      });
    });
  }
  return out;
}

module.exports = { gerar, gerarPeriodo, gerarDRE };
