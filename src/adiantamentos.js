'use strict';
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { PYTHON_BIN, NORDESTAO } = require('./config');

const SCRIPT = path.join(__dirname, '..', 'tools', 'read_adiantamentos.py');

// Executa o parser Python sobre a pasta de adiantamentos e devolve o objeto.
function carregar() {
  return new Promise((resolve) => {
    const args = [SCRIPT, NORDESTAO.pastaArquivos];
    const env = Object.assign({}, process.env, { PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1' });
    const p = spawn(PYTHON_BIN, args, { windowsHide: true, env });
    let out = '', err = '';
    p.stdout.on('data', (d) => { out += d; });
    p.stderr.on('data', (d) => { err += d; });
    p.on('error', (e) => resolve({ ok: false, erro: 'Falha ao iniciar Python: ' + e.message, itens: {}, min: null, count: 0 }));
    p.on('close', () => {
      try {
        resolve(JSON.parse(out || '{}'));
      } catch (e) {
        resolve({ ok: false, erro: (err.trim() || e.message), itens: {}, min: null, count: 0 });
      }
    });
  });
}

// Assinatura da pasta: nomes + tamanho + data de modificação dos .xlsx.
// Se qualquer arquivo for adicionado, removido ou alterado (inclusive quando
// copiado na mão para a pasta), a assinatura muda e o cache é descartado — o
// reprocessamento passa a ser imediato, igual ao que o upload já fazia.
function assinaturaPasta() {
  try {
    const dir = NORDESTAO.pastaArquivos;
    const nomes = fs.readdirSync(dir)
      .filter((n) => /\.xlsx$/i.test(n) && !n.startsWith('~$'))
      .sort();
    return nomes.map((n) => {
      const st = fs.statSync(path.join(dir, n));
      return n + ':' + st.size + ':' + Math.round(st.mtimeMs);
    }).join('|');
  } catch (e) {
    return 'ERR:' + e.message;
  }
}

// Cache invalidado por mudança na pasta; TTL longo só como rede de segurança.
let cache = null, cacheSig = null, cacheTime = 0;
const TTL_MS = 5 * 60 * 1000;
async function get() {
  const sig = assinaturaPasta();
  if (cache && sig === cacheSig && Date.now() - cacheTime < TTL_MS) return cache;
  cache = await carregar();
  cacheSig = sig;
  cacheTime = Date.now();
  return cache;
}
// Invalida o cache (após novo upload a planilha precisa ser relida).
function reset() { cache = null; cacheSig = null; cacheTime = 0; }

// Salva um arquivo .xlsx enviado na pasta de adiantamentos e invalida o cache.
// Devolve o nome final gravado. Lança erro se não for .xlsx ou o buffer for vazio.
function salvar(nomeOriginal, buffer) {
  if (!buffer || !buffer.length) throw new Error('Arquivo vazio.');
  // só o nome-base, sem caminhos, e sem caracteres inválidos do Windows
  let base = path.basename(String(nomeOriginal || '')).replace(/[\\/:*?"<>|\r\n]/g, '_').trim();
  if (!base) throw new Error('Nome de arquivo inválido.');
  if (!/\.xlsx$/i.test(base)) throw new Error('Só arquivos .xlsx são aceitos.');
  const dir = NORDESTAO.pastaArquivos;
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, base), buffer);
  reset();
  return base;
}

module.exports = { get, reset, salvar };
