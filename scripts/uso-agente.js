// Soma o uso de tokens de um sub-agente a partir do transcript dele, separando o que foi lido do cache.
// Uso: node scripts/uso-agente.js <agentId | caminho.jsonl> [--lote NN] [--modelo sonnet] [--metricas work/metricas.jsonl]
//
// O transcript fica em ~/.claude/projects/<projeto>/<sessão>/subagents/agent-<agentId>.jsonl.
// ATENÇÃO: o formato é interno do Claude Code (não documentado) e pode mudar entre versões; se os campos
// sumirem, o script avisa em vez de gravar zeros.
const fs = require('fs');
const os = require('os');
const path = require('path');

const args = process.argv.slice(2);
const opt = (k) => { const i = args.indexOf(k); return i >= 0 ? args.splice(i, 2)[1] : undefined; };
const lote = opt('--lote');
const modelo = opt('--modelo');
const metricas = opt('--metricas');
const [alvo] = args;
if (!alvo) { console.error('uso: node scripts/uso-agente.js <agentId | arquivo.jsonl> [--lote NN] [--modelo m] [--metricas arq]'); process.exit(2); }

function acha(id) {
  if (fs.existsSync(alvo)) return alvo;
  const base = path.join(os.homedir(), '.claude', 'projects');
  for (const proj of fs.readdirSync(base)) {
    const pp = path.join(base, proj);
    if (!fs.statSync(pp).isDirectory()) continue;
    for (const sess of fs.readdirSync(pp)) {
      const f = path.join(pp, sess, 'subagents', `agent-${id}.jsonl`);
      if (fs.existsSync(f)) return f;
    }
  }
  return null;
}
const arq = acha(alvo);
if (!arq) { console.error(`transcript do agente ${alvo} não encontrado`); process.exit(1); }

// Cada resposta da API pode aparecer em várias linhas (uma por bloco); o usage é o mesmo: conta 1 vez por message.id.
const porMsg = new Map();
let inicio = null;
let fim = null;
for (const l of fs.readFileSync(arq, 'utf8').split('\n')) {
  if (!l.trim()) continue;
  let x;
  try { x = JSON.parse(l); } catch { continue; }
  if (x.timestamp) { inicio = inicio || x.timestamp; fim = x.timestamp; }
  const m = x.message;
  if (m && m.usage && m.id) porMsg.set(m.id, { usage: m.usage, model: m.model });
}
if (!porMsg.size) { console.error(`${arq}: nenhuma linha com message.usage (o formato do transcript mudou?)`); process.exit(1); }

const t = { chamadas: porMsg.size, input: 0, cache_escrita: 0, cache_leitura: 0, output: 0 };
const modelos = new Set();
for (const { usage: u, model } of porMsg.values()) {
  t.input += u.input_tokens || 0;
  t.cache_escrita += u.cache_creation_input_tokens || 0;
  t.cache_leitura += u.cache_read_input_tokens || 0;
  t.output += u.output_tokens || 0;
  if (model) modelos.add(model);
}
const entrada = t.input + t.cache_escrita + t.cache_leitura;
const r = {
  tipo: 'uso_agente', lote: lote || null, modelo: modelo || [...modelos].join(',') || null, modelos_api: [...modelos],
  arquivo: arq, ...t, entrada_total: entrada, pct_cache_leitura: entrada ? +(100 * t.cache_leitura / entrada).toFixed(1) : 0,
  duracao_s: inicio && fim ? Math.round((new Date(fim) - new Date(inicio)) / 1000) : null,
};
console.log(JSON.stringify(r, null, 1));
if (metricas) fs.appendFileSync(metricas, JSON.stringify({ data: new Date().toISOString(), ...r }) + '\n');
