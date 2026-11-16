'use strict';
// Página "Entregas": acompanha as entregas de cada caminhão (rota).
// Fonte de dados = projeto pedidos-automacao (lojas.csv + saida/pedidos_extraidos.json).
// Cadastro das rotas = rotas.csv (criado com as rotas padrão se não existir).
// Mover loja de rota grava no lojas.csv; renomear/criar/excluir rota grava no rotas.csv.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { ENTREGAS, PYTHON_BIN } = require('./config');

// Fornecedor nosso (igual ao catalogo.FORNECEDOR_ACEITO do projeto pedidos-automacao).
const FORNECEDOR_ACEITO = '1004686';
function fornecedorNosso(cod) {
  return String(cod || '').replace(/\D/g, '') === FORNECEDOR_ACEITO;
}

function round2(n) { return Math.round((Number(n) || 0) * 100) / 100; }
function hojeISO() {
  const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0')
    + '-' + String(d.getDate()).padStart(2, '0');
}
// Código de rota em 2 dígitos quando numérico (igual ao que o lojas.csv guarda: '01').
function padCod(c) {
  c = String(c == null ? '' : c).trim();
  return /^\d+$/.test(c) ? c.padStart(2, '0') : c;
}

// ---------- CSV mínimo: preserva a ordem das colunas, grava UTF-8 + CRLF ----------
function parseCSV(texto) {
  texto = String(texto).replace(/^﻿/, '');
  const linhas = [];
  let campo = '', reg = [], aspas = false;
  for (let i = 0; i < texto.length; i++) {
    const c = texto[i];
    if (aspas) {
      if (c === '"') { if (texto[i + 1] === '"') { campo += '"'; i++; } else aspas = false; }
      else campo += c;
    } else if (c === '"') aspas = true;
    else if (c === ',') { reg.push(campo); campo = ''; }
    else if (c === '\n') { reg.push(campo); linhas.push(reg); reg = []; campo = ''; }
    else if (c === '\r') { /* \n fecha a linha */ }
    else campo += c;
  }
  if (campo !== '' || reg.length) { reg.push(campo); linhas.push(reg); }
  return linhas;
}
function lerCsvObj(caminho) {
  if (!fs.existsSync(caminho)) return { header: [], linhas: [] };
  const linhas = parseCSV(fs.readFileSync(caminho, 'utf8'));
  if (!linhas.length) return { header: [], linhas: [] };
  const header = linhas[0].map((h) => (h || '').trim());
  const dados = linhas.slice(1)
    .filter((r) => r.some((v) => (v || '').trim() !== ''))
    .map((r) => {
      const o = {};
      header.forEach((h, i) => { o[h] = (r[i] !== undefined ? r[i] : ''); });
      return o;
    });
  return { header, linhas: dados };
}
function escaparCampo(v) {
  v = v == null ? '' : String(v);
  return /[",\r\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v;
}
// Escrita atômica (tmp + rename) para não corromper o arquivo que o Python também lê.
function escreverCsvObj(caminho, header, linhas) {
  const out = [header.join(',')];
  for (const o of linhas) out.push(header.map((h) => escaparCampo(o[h])).join(','));
  const txt = out.join('\r\n') + '\r\n';
  const tmp = caminho + '.tmp';
  fs.writeFileSync(tmp, txt, 'utf8');
  fs.renameSync(tmp, caminho);
}

// ---------- Rotas (rotas.csv) ----------
function lerRotas() {
  let { linhas } = lerCsvObj(ENTREGAS.rotasCsv);
  if (!linhas.length) {
    linhas = ENTREGAS.rotasPadrao.map((r) => ({ codigo: r.codigo, nome: r.nome }));
    escreverCsvObj(ENTREGAS.rotasCsv, ['codigo', 'nome'], linhas);
  }
  return linhas
    .map((r) => ({ codigo: padCod(r.codigo), nome: (r.nome || '').trim() }))
    .filter((r) => r.codigo);
}
function salvarRotas(rotas) {
  escreverCsvObj(ENTREGAS.rotasCsv, ['codigo', 'nome'],
    rotas.map((r) => ({ codigo: r.codigo, nome: r.nome })));
}

// ---------- Lojas (lojas.csv) ----------
function lerLojas() {
  const { header, linhas } = lerCsvObj(ENTREGAS.lojasCsv);
  return { header, lojas: linhas };
}

// ---------- Pedidos extraídos (saida/pedidos_extraidos.json) ----------
function lerPedidos() {
  if (!fs.existsSync(ENTREGAS.pedidosJson)) return [];
  try {
    const d = JSON.parse(fs.readFileSync(ENTREGAS.pedidosJson, 'utf8'));
    return Array.isArray(d) ? d : (Array.isArray(d.pedidos) ? d.pedidos : []);
  } catch (_) { return []; }
}

function resumoPedido(p) {
  const ped = p.pedido || {};
  const itens = Array.isArray(ped.itens) ? ped.itens : [];
  const valor = itens.reduce((s, i) => s + (Number(i.valor_total) || 0), 0);
  return {
    numero: ped.numero_pedido || null,
    arquivo: p.arquivo || null,
    lojaSugerida: p.loja_sugerida || null,
    centro: p.centro_sugerido || null,
    recebimento: (p.data_recebimento || '').slice(0, 10) || null,
    sinalizado: !!p.sinalizado,
    foraRotina: !!p.entrega_fora_da_rotina,
    duplicado: !!p.duplicado,
    problemas: Array.isArray(p.problemas) ? p.problemas.length : 0,
    qtItens: itens.length,
    peso: round2(itens.reduce((s, i) => s + (Number(i.qtde) || 0), 0)),  // kg (qtde = peso)
    valor: round2(valor),
    itens: itens.map((i) => ({
      codigo: i.codigo, descricao: i.descricao, emb: i.emb,
      qtde: Number(i.qtde) || 0, valorUnit: Number(i.valor_unit) || 0,
      valorTotal: Number(i.valor_total) || 0,
    })),
  };
}

// Caixa-alta, sem acento e sem espaço dobrado (igual ao lojas.py, para casar nomes).
function norm(s) {
  return String(s || '').normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .toUpperCase().replace(/\s+/g, ' ').trim();
}
function tituloLoja(l) {
  const b = (l.bairro || '').trim();
  return b ? `${(l.nome || '').trim()} (${b})` : (l.nome || '').trim();
}

// Monta a visão do dia: rotas → lojas → pedidos.
function montar(dataISO) {
  const rotas = lerRotas();
  const { lojas } = lerLojas();
  const pedidos = lerPedidos();

  const datas = [...new Set(pedidos.map((p) => p.data_entrega).filter(Boolean))].sort();
  const data = (dataISO && /^\d{4}-\d{2}-\d{2}$/.test(dataISO)) ? dataISO
    : (datas[datas.length - 1] || hojeISO());

  // índice loja por filial (com e sem zeros à esquerda)
  const porFilial = new Map();
  lojas.forEach((l) => {
    const f = String(l.filial || '').trim();
    if (f) { porFilial.set(f, l); porFilial.set(f.replace(/^0+/, ''), l); }
  });

  // resolve a loja de um pedido (por filial/centro; fallback pelo texto da loja)
  const acharLoja = (p) => {
    const centro = String(p.centro_sugerido || '').trim();
    let loja = centro ? (porFilial.get(centro) || porFilial.get(centro.replace(/^0+/, ''))) : null;
    if (!loja) {
      const alvo = norm(p.loja_sugerida);
      if (alvo) {
        loja = lojas.find((l) => l.bairro && norm(l.bairro) && alvo.includes(norm(l.bairro)))
            || lojas.find((l) => l.nome && norm(l.nome) && alvo.includes(norm(l.nome)));
      }
    }
    return loja;
  };

  // ---- Mesma lógica do gerar_separacao.py (duplicados + fora da rotina) ----
  // 1) só o que vai ao caminhão: nosso, não duplicado, do fornecedor aceito.
  // 2) descarte por "bandeirinha": mesma loja, números diferentes, uns
  //    sinalizados e outros não -> o(s) sinalizado(s) já saíram fora da rotina.
  // 3) entrega_fora_da_rotina NÃO exclui: vira alerta na loja.
  const doDia = pedidos.filter((p) => p.data_entrega === data);
  const info = doDia.map((p) => {
    const loja = acharLoja(p);
    const ped = p.pedido || {};
    return {
      p, loja,
      key: loja ? loja.cnpj : ('*' + norm(p.loja_sugerida || p.centro_sugerido || '?')),
      numero: ped.numero_pedido || null,
      sinalizado: !!p.sinalizado,
      duplicado: !!p.duplicado,
      nosso: p.nosso === true && fornecedorNosso(ped.cod_fornecedor),
    };
  });

  // bandeirinha: por loja, mapa numero -> algum marcado?
  const marc = new Map();
  for (const it of info) {
    if (!it.nosso || it.duplicado || !it.numero) continue;
    const m = marc.get(it.key) || new Map();
    m.set(it.numero, (m.get(it.numero) || false) || it.sinalizado);
    marc.set(it.key, m);
  }
  const descartar = new Set();
  for (const [key, m] of marc) {
    if (m.size < 2) continue;
    const fora = [...m].filter(([, mk]) => mk).map(([n]) => n);
    if (!fora.length || fora.length === m.size) continue; // nada a desempatar
    fora.forEach((n) => descartar.add(key + '|' + n));
  }

  const pedPorLoja = new Map();
  const alertasLoja = new Map();
  const naoIdentificados = [];
  const addAlerta = (key, msg) => {
    const a = alertasLoja.get(key) || [];
    if (!a.includes(msg)) a.push(msg);
    alertasLoja.set(key, a);
  };
  for (const it of info) {
    if (!it.nosso) continue;                       // outro fornecedor / não nosso: fora da carga
    if (it.duplicado) {
      if (it.loja) addAlerta(it.key, `Pedido ${it.numero || '?'} repetido — ignorado na carga.`);
      continue;
    }
    if (it.numero && descartar.has(it.key + '|' + it.numero)) {
      addAlerta(it.key, `Pedido ${it.numero} está sinalizado e há outro não sinalizado desta loja — tratado como entregue fora da rotina (fora da carga).`);
      continue;
    }
    const fora = it.p.entrega_fora_da_rotina;
    if (fora) {
      addAlerta(it.key, fora.venceu === 'texto'
        ? `ENTREGA FORA DA ROTINA: a loja escreveu "${fora.texto}" — este pedido é para ${fora.usada || '?'}, não ${fora.regra || '?'}.`
        : `CONFERIR A DATA: a loja escreveu "${fora.texto}" e não deu para decidir o dia — seguindo a regra (${fora.regra || '?'}).`);
    }
    const r = resumoPedido(it.p);
    if (!it.loja) { naoIdentificados.push(r); continue; }
    if (!pedPorLoja.has(it.loja.cnpj)) pedPorLoja.set(it.loja.cnpj, []);
    pedPorLoja.get(it.loja.cnpj).push(r);
  }
  // aviso de múltiplos pedidos (quantidades somadas)
  for (const [cnpj, lst] of pedPorLoja) {
    const nums = new Set(lst.map((p) => p.numero).filter(Boolean));
    if (nums.size >= 2) {
      addAlerta(cnpj, `ATENÇÃO: ${nums.size} pedidos desta loja nesta folha — as quantidades são a SOMA; conferir se algum já saiu fora da rotina antes de carregar.`);
    }
  }

  const lojaView = (l) => {
    const peds = pedPorLoja.get(l.cnpj) || [];
    return {
      cnpj: l.cnpj, filial: l.filial, nome: (l.nome || '').trim(),
      bairro: (l.bairro || '').trim(), titulo: tituloLoja(l), rota: padCod(l.rota),
      pedidos: peds, qtPedidos: peds.length,
      qtItens: peds.reduce((s, p) => s + p.qtItens, 0),
      peso: round2(peds.reduce((s, p) => s + p.peso, 0)),
      valor: round2(peds.reduce((s, p) => s + p.valor, 0)),
      alertas: alertasLoja.get(l.cnpj) || [],
    };
  };

  const codsRegistro = new Set(rotas.map((r) => r.codigo));
  const rotasOut = rotas.map((r) => {
    const ls = lojas.filter((l) => padCod(l.rota) === r.codigo).map(lojaView);
    return resumirRota(r, ls);
  });

  // lojas cuja rota não está no cadastro (ou vazia) — ficam para atribuição
  const semRota = lojas
    .filter((l) => !codsRegistro.has(padCod(l.rota)))
    .map(lojaView);

  const totais = rotasOut.reduce((a, r) => ({
    qtPedidos: a.qtPedidos + r.qtPedidos, qtItens: a.qtItens + r.qtItens,
    peso: round2(a.peso + r.peso), valor: round2(a.valor + r.valor),
  }), { qtPedidos: 0, qtItens: 0, peso: 0, valor: 0 });

  return {
    data, datasDisponiveis: datas,
    rotas: rotasOut,
    semRota: { lojas: semRota, qtLojas: semRota.length },
    naoIdentificados,
    totais,
    arquivoPedidos: fs.existsSync(ENTREGAS.pedidosJson),
  };
}
function resumirRota(r, ls) {
  return {
    codigo: r.codigo, nome: r.nome, lojas: ls,
    qtLojas: ls.length,
    qtLojasComPedido: ls.filter((l) => l.qtPedidos > 0).length,
    qtPedidos: ls.reduce((s, l) => s + l.qtPedidos, 0),
    qtItens: ls.reduce((s, l) => s + l.qtItens, 0),
    peso: round2(ls.reduce((s, l) => s + l.peso, 0)),   // carga da rota (kg)
    valor: round2(ls.reduce((s, l) => s + l.valor, 0)),
  };
}

// Gera a folha de separação (PDF) reaproveitando o gerar_separacao.py.
// rota = null -> todos os pedidos do dia; senão só a rota informada.
// Devolve { ok, pdf?, vazio?, erro? }.
function folhaPdf(dataISO, rota) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dataISO || '')) return { ok: false, erro: 'data inválida' };
  const script = path.join(__dirname, '..', 'tools', 'folha_separacao.py');
  const nome = `folha_${dataISO}${rota ? '_rota' + padCod(rota) : ''}_${Date.now()}.pdf`;
  const saida = path.join(os.tmpdir(), nome);
  const args = [script, '--data', dataISO, '--saida', saida];
  if (rota) args.push('--rota', String(rota));
  const r = spawnSync(PYTHON_BIN, args, {
    encoding: 'utf8',
    env: Object.assign({}, process.env, { PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1' }),
  });
  if (r.status !== 0) {
    return { ok: false, erro: (r.stderr || r.stdout || 'falha ao gerar o PDF').trim() };
  }
  if ((r.stdout || '').includes('VAZIO') || !fs.existsSync(saida)) {
    return { ok: false, vazio: true };
  }
  return { ok: true, pdf: saida };
}

// ---------- Mutations ----------
function addRota({ codigo, nome }) {
  const cod = padCod(codigo);
  if (!cod) throw new Error('Código da rota é obrigatório.');
  const rotas = lerRotas();
  if (rotas.some((r) => r.codigo === cod)) throw new Error(`A rota ${cod} já existe.`);
  rotas.push({ codigo: cod, nome: (nome || '').trim() });
  rotas.sort((a, b) => a.codigo.localeCompare(b.codigo));
  salvarRotas(rotas);
  return { ok: true };
}
function editRota(codigoAtual, { codigo, nome }) {
  const alvo = padCod(codigoAtual);
  const rotas = lerRotas();
  const r = rotas.find((x) => x.codigo === alvo);
  if (!r) throw new Error(`Rota ${alvo} não encontrada.`);
  const novoCod = codigo != null && String(codigo).trim() !== '' ? padCod(codigo) : alvo;
  if (novoCod !== alvo && rotas.some((x) => x.codigo === novoCod)) {
    throw new Error(`A rota ${novoCod} já existe.`);
  }
  if (nome != null) r.nome = String(nome).trim();
  if (novoCod !== alvo) {
    r.codigo = novoCod;
    // re-aponta as lojas dessa rota no lojas.csv
    const { header, lojas } = lerLojas();
    let mudou = 0;
    lojas.forEach((l) => { if (padCod(l.rota) === alvo) { l.rota = novoCod; mudou++; } });
    if (mudou) escreverCsvObj(ENTREGAS.lojasCsv, header, lojas);
  }
  rotas.sort((a, b) => a.codigo.localeCompare(b.codigo));
  salvarRotas(rotas);
  return { ok: true };
}
function deleteRota(codigo) {
  const cod = padCod(codigo);
  const rotas = lerRotas();
  if (!rotas.some((r) => r.codigo === cod)) throw new Error(`Rota ${cod} não encontrada.`);
  // desvincula as lojas dessa rota (rota em branco), para que não sumam
  const { header, lojas } = lerLojas();
  let soltas = 0;
  lojas.forEach((l) => { if (padCod(l.rota) === cod) { l.rota = ''; soltas++; } });
  if (soltas) escreverCsvObj(ENTREGAS.lojasCsv, header, lojas);
  salvarRotas(rotas.filter((r) => r.codigo !== cod));
  return { ok: true, lojasDesvinculadas: soltas };
}
// Move uma loja (pelo CNPJ) para outra rota — grava no lojas.csv.
function moverLoja(cnpj, novaRota) {
  const alvo = String(cnpj || '').replace(/\D/g, '');
  if (!alvo) throw new Error('CNPJ inválido.');
  const nova = novaRota == null ? '' : padCod(novaRota);
  const { header, lojas } = lerLojas();
  const loja = lojas.find((l) => String(l.cnpj || '').replace(/\D/g, '') === alvo);
  if (!loja) throw new Error('Loja não encontrada.');
  loja.rota = nova;
  escreverCsvObj(ENTREGAS.lojasCsv, header, lojas);
  return { ok: true };
}

module.exports = { montar, addRota, editRota, deleteRota, moverLoja, lerRotas, folhaPdf };
