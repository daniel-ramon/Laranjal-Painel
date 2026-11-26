'use strict';
// Diagnóstico escrito das despesas pela Claude API.
//
// Divisão de trabalho (mesma regra do resto do projeto):
//   - os NÚMEROS saem todos de src/dre.js + src/dre-alertas.js;
//   - o modelo recebe só os agregados e os alertas já calculados e escreve a
//     leitura de analista. Ele não soma, não divide e não inventa valor.
// Nada de lançamento individual é enviado: só totais por grupo/conta, os
// alertas e o top de fornecedores. Sem ANTHROPIC_API_KEY a página continua
// funcionando — fica só sem o texto.
const crypto = require('crypto');
const { DRE } = require('./config');

const ESQUEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['resumo', 'pontos', 'perguntas'],
  properties: {
    resumo: { type: 'string' },
    pontos: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['titulo', 'severidade', 'evidencia', 'acao'],
        properties: {
          titulo: { type: 'string' },
          severidade: { type: 'string', enum: ['critica', 'atencao', 'info'] },
          evidencia: { type: 'string' },
          acao: { type: 'string' },
        },
      },
    },
    perguntas: { type: 'array', items: { type: 'string' } },
  },
};

const SISTEMA = [
  'Você é um analista financeiro sênior de uma distribuidora de hortifruti com duas empresas:',
  'AK Hortifruti e JRF (Laranjal). Está lendo o relatório de despesas pagas (base CPAGAR,',
  'lançamentos baixados, agrupados por grupo e conta contábil).',
  '',
  'REGRAS OBRIGATÓRIAS:',
  '1. Você NÃO faz cálculo. Todos os números já vêm calculados no JSON. Cite apenas valores',
  '   que estão no JSON, exatamente como estão. Nunca some, divida nem estime.',
  '2. Se um dado não está no JSON, diga que não está disponível — nunca preencha a lacuna.',
  '3. Escreva em português do Brasil, direto, sem jargão de consultoria e sem floreio.',
  '4. Aponte o que merece ação, não o que é obviamente normal (folha de pagamento ser o maior',
  '   grupo de despesa não é um achado).',
  '5. Diferencie o que é fato do que é hipótese. Hipótese vem marcada como tal.',
  '6. No campo "acao" diga o que a pessoa deve conferir ou decidir, em uma frase.',
  '',
  'Entre 3 e 6 pontos, do mais relevante para o menos. O resumo tem no máximo 4 frases.',
  'As perguntas são o que você perguntaria ao financeiro para fechar o diagnóstico (até 4).',
].join('\n');

// Payload enxuto: agregados + alertas. Sem lançamento individual.
function montarPayload(dados, analise) {
  const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
  return {
    periodo: { de: dados.ini, ate: dados.fim, dias: dados.dias },
    comparacao: {
      periodoAnterior: dados.periodoAnterior,
      janelas3meses: dados.janelas3m,
    },
    totais: {
      pagoNoPeriodo: r2(dados.total),
      ak: r2(dados.ak),
      jrf: r2(dados.jrf),
      lancamentos: dados.qtd,
      ticketMedio: r2(dados.ticket),
      periodoAnterior: r2(dados.totalAnterior),
      media3Janelas: r2(dados.totalMedia3),
      variacaoVsAnterior: dados.variacao,
      variacaoVsMedia3: dados.variacaoMedia3,
    },
    projecaoDoMes: analise.runRate,
    grupos: dados.grupos.map((g) => ({
      grupo: g.nome,
      total: r2(g.total), ak: r2(g.ak), jrf: r2(g.jrf), lancamentos: g.qtd,
      participacao: g.pct,
      periodoAnterior: r2(g.anterior), media3Janelas: r2(g.media3),
      variacaoVsAnterior: g.variacao, variacaoVsMedia3: g.variacaoMedia3,
      // só as contas que importam, para o payload não explodir
      principaisContas: g.contas.slice(0, 6).map((c) => ({
        conta: c.nome, total: r2(c.total), lancamentos: c.qtd,
        periodoAnterior: r2(c.anterior), media3Janelas: r2(c.media3),
        variacaoVsMedia3: c.variacaoMedia3, semHistorico: !!c.nova,
      })),
    })),
    foraDoTotal: dados.excluidos.map((g) => ({
      grupo: g.nome, total: r2(g.total), lancamentos: g.qtd,
      motivo: 'custo de mercadoria / acerto de estoque, não é despesa operacional',
    })),
    curvaABC: {
      contasClasseA: analise.abc.qtdA,
      contasTotal: analise.abc.qtdTotal,
      totalClasseA: r2(analise.abc.totalA),
    },
    topFornecedores: analise.fornecedores.map((f) => ({
      fornecedor: f.fornecedor, total: r2(f.total), lancamentos: f.qtd,
      ak: r2(f.ak), jrf: r2(f.jrf),
    })),
    alertasDasRegras: analise.alertas.map((a) => ({
      severidade: a.severidade, tipo: a.tipo, titulo: a.titulo,
      detalhe: a.detalhe, valor: r2(a.valor),
    })),
    seriemensal: dados.serie.map((s) => ({ mes: s.mes, total: r2(s.total), ak: r2(s.ak), jrf: r2(s.jrf) })),
  };
}

// Cache em memória: a mesma pergunta sobre os mesmos números não paga duas vezes.
const CACHE = new Map();
const CACHE_MAX = 30;
function chaveCache(payload) {
  return crypto.createHash('sha1').update(JSON.stringify(payload)).digest('hex');
}

function disponivel() {
  return !!(process.env.ANTHROPIC_API_KEY || '').trim();
}

async function analisar(dados, analise, opcoes) {
  const o = opcoes || {};
  if (!disponivel()) {
    return { ok: false, motivo: 'sem-chave', erro: 'ANTHROPIC_API_KEY não configurada no .env.' };
  }

  const payload = montarPayload(dados, analise);
  const chave = chaveCache(payload);
  if (!o.forcar && CACHE.has(chave)) {
    return Object.assign({}, CACHE.get(chave), { cache: true });
  }

  let Anthropic;
  try {
    Anthropic = require('@anthropic-ai/sdk');
  } catch (e) {
    return { ok: false, motivo: 'sem-sdk', erro: 'Pacote @anthropic-ai/sdk não instalado (npm install).' };
  }

  const client = new Anthropic();
  const modelo = DRE.modeloIA;

  const pergunta = [
    'Analise as despesas pagas no período e identifique os pontos críticos.',
    'Os números abaixo já estão calculados; use-os como são.',
    '',
    'Responda em JSON com o formato:',
    '{"resumo": "...", "pontos": [{"titulo": "...", "severidade": "critica|atencao|info",',
    ' "evidencia": "...", "acao": "..."}], "perguntas": ["..."]}',
    '',
    '```json',
    JSON.stringify(payload),
    '```',
  ].join('\n');

  const basico = {
    model: modelo,
    max_tokens: 8000,
    system: SISTEMA,
    messages: [{ role: 'user', content: pergunta }],
  };
  // Opus 5.5: thinking sempre ligado (não se envia 'thinking'); a profundidade é
  // controlada pelo effort. O formato é travado por structured output.
  const completo = Object.assign({}, basico, {
    output_config: { effort: 'high', format: { type: 'json_schema', schema: ESQUEMA } },
    fallbacks: 'default',
  });
  const cabecalhos = { headers: { 'anthropic-beta': 'server-side-fallback-2026-07-01' } };

  try {
    let resp;
    try {
      resp = await client.messages.create(completo, cabecalhos);
    } catch (e1) {
      // Se a conta/modelo não aceitar structured output ou o fallback do servidor,
      // repete sem esses parâmetros — o formato do JSON também está no prompt.
      if (Anthropic.BadRequestError && e1 instanceof Anthropic.BadRequestError) {
        resp = await client.messages.create(basico);
      } else {
        throw e1;
      }
    }

    // recusa e truncamento são verificados ANTES de ler o conteúdo
    if (resp.stop_reason === 'refusal') {
      return { ok: false, motivo: 'recusa', erro: 'O modelo recusou a resposta.' };
    }
    if (resp.stop_reason === 'max_tokens') {
      return { ok: false, motivo: 'truncado', erro: 'Resposta truncada (max_tokens).' };
    }

    const texto = (resp.content || [])
      .filter((b) => b.type === 'text').map((b) => b.text).join('');
    let dadosIA;
    try {
      dadosIA = JSON.parse(texto);
    } catch (e) {
      // sem structured output o modelo pode cercar o JSON com ``` ou texto solto
      const m = texto.match(/\{[\s\S]*\}/);
      try {
        dadosIA = JSON.parse(m ? m[0] : '');
      } catch (e2) {
        return { ok: false, motivo: 'parse', erro: 'Resposta não veio em JSON válido.' };
      }
    }

    const out = {
      ok: true,
      modelo: resp.model || modelo,
      gerado: new Date().toISOString(),
      resumo: String(dadosIA.resumo || ''),
      pontos: Array.isArray(dadosIA.pontos) ? dadosIA.pontos : [],
      perguntas: Array.isArray(dadosIA.perguntas) ? dadosIA.perguntas : [],
      uso: resp.usage || null,
    };
    if (CACHE.size >= CACHE_MAX) CACHE.delete(CACHE.keys().next().value);
    CACHE.set(chave, out);
    return out;
  } catch (e) {
    const Sdk = Anthropic;
    let motivo = 'erro';
    if (Sdk.AuthenticationError && e instanceof Sdk.AuthenticationError) motivo = 'chave-invalida';
    else if (Sdk.RateLimitError && e instanceof Sdk.RateLimitError) motivo = 'limite';
    else if (Sdk.BadRequestError && e instanceof Sdk.BadRequestError) motivo = 'requisicao';
    return { ok: false, motivo, erro: String(e.message || e) };
  }
}

module.exports = { analisar, disponivel, montarPayload, ESQUEMA };
