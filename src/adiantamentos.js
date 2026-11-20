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

// Cache curto (10s) para não reprocessar a planilha a cada requisição.
let cache = null, cacheTime = 0;
async function get() {
  if (cache && Date.now() - cacheTime < 10000) return cache;
  cache = await carregar();
  cacheTime = Date.now();
  return cache;
}
// Invalida o cache (após novo upload a planilha precisa ser relida).
function reset() { cache = null; cacheTime = 0; }

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
