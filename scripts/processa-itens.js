// Processa um lote com UMA chamada `claude -p` por item (sem ferramentas): o pacote do item e os sets dele vão no
// prompt, o modelo devolve a spec, o script grava e valida. Com erro, reenvia só aquele item com os erros (máx. 3 vezes).
// Uso: node scripts/processa-itens.js <NN> [--saida work/specs/lote-NN] [--modelo sonnet] [--effort medium] [--paralelo 3]
//        [--correcoes 3] [--timeout-min 30] [--so <sys_id,...>] [--refazer] [--metricas work/metricas.jsonl]
//
// Cache: o prefixo fixo (scripts/prompt-item.md + skill) é o system prompt, idêntico entre itens; a parte variável
// (pacote) vem depois, na mensagem do usuário. O 1º item roda sozinho para gravar o cache; os outros em ondas.
// Retomável: item cuja spec já existe e passa no validador é pulado (use --refazer para refazer).
// Limite de uso da assinatura: para de lançar itens, avisa e sai com código 3 (rode de novo depois que renovar).
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawn, spawnSync } = require('child_process');

process.chdir(path.join(__dirname, '..'));

const args = process.argv.slice(2);
const opt = (k, def) => { const i = args.indexOf(k); return i >= 0 ? args.splice(i, 2)[1] : def; };
const flag = (k) => { const i = args.indexOf(k); return i >= 0 ? (args.splice(i, 1), true) : false; };
const refazer = flag('--refazer');
const modelo = opt('--modelo', 'sonnet');
const effort = opt('--effort'); // omitido = o padrão das configurações do usuário
const paralelo = +opt('--paralelo', 3);
const maxCorrecoes = +opt('--correcoes', 3);
// Tempo limite por chamada: itens grandes chegam a ~10 min de geração com effort high.
const timeoutMin = +opt('--timeout-min', 30);
const so = opt('--so');
const metricas = opt('--metricas', 'work/metricas.jsonl');
const [nn] = args;
if (!/^\d{2}$/.test(nn || '')) { console.error('uso: node scripts/processa-itens.js <NN> [--saida dir] [--modelo sonnet] [--paralelo 3]'); process.exit(2); }
const saida = opt('--saida', `work/specs/lote-${nn}`);
const LOTE = `work/lotes/lote-${nn}`;
const ler = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));

// Executável: no Windows o `claude` do npm é um .cmd que chama bin/claude.exe; chamamos o .exe direto (sem shell).
function claudeBin() {
  if (process.env.CLAUDE_BIN) return process.env.CLAUDE_BIN;
  if (process.platform === 'win32') {
    const exe = path.join(process.env.APPDATA || '', 'npm', 'node_modules', '@anthropic-ai', 'claude-code', 'bin', 'claude.exe');
    if (fs.existsSync(exe)) return exe;
  }
  return 'claude';
}

// ---------- prompt ----------
const skill = fs.readFileSync('.claude/skills/regras-catalogo/SKILL.md', 'utf8').replace(/^---\n[\s\S]*?\n---\n/, '');
const sistema = fs.readFileSync('scripts/prompt-item.md', 'utf8') + skill;
fs.mkdirSync(path.join(saida, '_brutos'), { recursive: true });
const sistemaArq = path.join(saida, '_brutos', 'sistema.md');
fs.writeFileSync(sistemaArq, sistema);
const sistemaSha = crypto.createHash('sha256').update(sistema).digest('hex').slice(0, 12);

function pacote(it) {
  const item = ler(path.join(LOTE, 'itens', `${it.sys_id}.json`));
  const sets = it.sets.map((id) => ler(path.join(LOTE, 'sets', `${id}.json`)));
  return [`# Pacote do item ${it.sys_id}`, JSON.stringify(item),
    ...sets.map((s) => `\n# Variable set "${s.title}" (${s.sys_id})\n${JSON.stringify(s)}`)].join('\n');
}
function correcao(pac, anterior, erros) {
  return `${pac}\n\n# Sua resposta anterior\n${anterior}\n\n# Erros do validador\n${erros.map((e) => `- ${e}`).join('\n')}\n\n` +
    'Corrija esses erros e devolva a spec completa, só o JSON.';
}

// ---------- chamada ----------
// Limite de uso da assinatura (janela de horas): não adianta tentar de novo; o script para e avisa.
// Rate limit comum (429 momentâneo) não entra aqui: esse é tratado com espera em chamarComEspera.
const LIMITE_USO = /usage limit|hit your (usage )?limit|you'?ve reached your|out of (extra )?usage|weekly limit|session limit|limite de uso|resets? (at|in) d/i;
let limite = null; // mensagem do limite de uso, quando atingido
function limiteDeUso(r) {
  if (r.j && !r.j.is_error && r.code === 0) return null;
  const txt = [r.j && r.j.result, r.j && r.j.api_error_status, r.err].filter(Boolean).join(' | ');
  return LIMITE_USO.test(txt) ? txt.slice(0, 400) : null;
}
function chamar(prompt) {
  return new Promise((resolve) => {
    const t0 = Date.now();
    // CLAUDE_BIN=<arquivo .js> roda um simulador com o node (usado para testar a parada por limite).
    const bin = claudeBin();
    const [cmd, pre] = bin.endsWith('.js') ? [process.execPath, [bin]] : [bin, []];
    const p = spawn(cmd, [...pre, '-p', '--model', modelo, '--system-prompt-file', sistemaArq, '--tools', '',
      '--strict-mcp-config', '--no-session-persistence', '--output-format', 'json', ...(effort ? ['--effort', effort] : [])], { stdio: ['pipe', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    let estourou = false;
    const timer = setTimeout(() => { estourou = true; p.kill(); }, timeoutMin * 60 * 1000);
    p.stdout.on('data', (d) => { out += d; });
    p.stderr.on('data', (d) => { err += d; });
    p.on('close', (code) => {
      clearTimeout(timer);
      let j = null;
      try { j = JSON.parse(out); } catch { /* resposta não-JSON: tratada abaixo */ }
      resolve({ code, j, err: err.trim(), ms: Date.now() - t0, estourou });
    });
    p.stdin.end(prompt);
  });
}
// Erro de API (429, sobrecarga, rede): espera e tenta de novo; não conta como rodada de correção.
async function chamarComEspera(prompt) {
  for (const espera of [0, 30, 90]) {
    if (limite) return { limite: true };
    if (espera) await new Promise((r) => setTimeout(r, espera * 1000));
    const r = await chamar(prompt);
    if (r.estourou) { console.error(`  tempo limite de ${timeoutMin} min estourado; não repito (gastaria o mesmo)`); return { estourou: true }; }
    if (r.j && !r.j.is_error) return r;
    const msg = limiteDeUso(r);
    if (msg) { limite = limite || msg; return { limite: true }; }
    console.error(`  falha na chamada (code ${r.code}): ${(r.j && (r.j.result || r.j.api_error_status)) || r.err.slice(0, 300)}`);
  }
  return null;
}

function extrairSpec(txt) {
  const s = String(txt || '').replace(/^\s*```(?:json)?\s*/, '').replace(/\s*```\s*$/, '');
  const a = s.indexOf('{');
  const b = s.lastIndexOf('}');
  if (a < 0 || b < a) throw new Error('resposta sem objeto JSON');
  return JSON.parse(s.slice(a, b + 1));
}
function validar(arq) {
  const r = spawnSync('node', ['scripts/validate-spec.js', arq], { encoding: 'utf8' });
  const erros = r.stdout.split('\n').filter((l) => l.startsWith('  - ')).map((l) => l.slice(4));
  if (r.status !== 0 && !erros.length) erros.push(r.stdout.trim().split('\n')[0] || r.stderr.trim());
  return { ok: r.status === 0, erros };
}

// ---------- item ----------
async function processar(it) {
  const arq = path.join(saida, `${it.sys_id}.json`);
  if (!refazer && fs.existsSync(arq) && validar(arq).ok) return { sys_id: it.sys_id, pulado: true, ok: true, chamadas: [] };
  if (limite) return { sys_id: it.sys_id, ok: false, pendente: true, chamadas: [] };
  const pac = pacote(it);
  const chamadas = [];
  let prompt = pac;
  for (let tentativa = 0; tentativa <= maxCorrecoes; tentativa++) {
    const r = await chamarComEspera(prompt);
    if (r && r.limite) return { sys_id: it.sys_id, ok: false, pendente: true, chamadas };
    if (r && r.estourou) return { sys_id: it.sys_id, ok: false, erros: [`tempo limite de ${timeoutMin} min`], chamadas };
    if (!r) return { sys_id: it.sys_id, ok: false, erros: ['chamada falhou 3 vezes'], chamadas };
    fs.writeFileSync(path.join(saida, '_brutos', `${it.sys_id}.t${tentativa}.json`), JSON.stringify(r.j, null, 1));
    const u = r.j.usage || {};
    const c = { tentativa, input: u.input_tokens || 0, cache_escrita: u.cache_creation_input_tokens || 0,
      cache_leitura: u.cache_read_input_tokens || 0, output: u.output_tokens || 0,
      thinking: (u.output_tokens_details || {}).thinking_tokens || 0, custo_usd: r.j.total_cost_usd || 0, ms: r.ms };
    let v;
    let resposta = r.j.result;
    try {
      const spec = extrairSpec(resposta);
      resposta = JSON.stringify(spec, null, 1);
      fs.writeFileSync(arq, resposta + '\n');
      v = validar(arq);
    } catch (e) {
      v = { ok: false, erros: [`sua resposta não é um JSON válido (${e.message})`] };
    }
    c.erros = v.erros.length;
    chamadas.push(c);
    fs.appendFileSync(metricas, JSON.stringify({ data: new Date().toISOString(), tipo: 'chamada_item', lote: nn, modelo, effort: effort || 'padrao',
      sys_id: it.sys_id, sistema_sha: sistemaSha, ...c }) + '\n');
    console.log(`  ${it.sys_id} t${tentativa}: ${v.ok ? 'OK' : `${v.erros.length} erro(s)`} | in ${c.input}+cw ${c.cache_escrita}+cr ${c.cache_leitura} out ${c.output} | $${c.custo_usd.toFixed(4)} | ${(c.ms / 1000).toFixed(0)}s`);
    if (v.ok) return { sys_id: it.sys_id, ok: true, correcoes: tentativa, chamadas };
    if (tentativa === maxCorrecoes) return { sys_id: it.sys_id, ok: false, erros: v.erros, correcoes: tentativa, chamadas };
    prompt = correcao(pac, resposta, v.erros);
  }
}

async function main() {
  const lote = ler(path.join(LOTE, 'lote.json'));
  const alvo = so ? lote.itens.filter((i) => so.split(',').includes(i.sys_id)) : lote.itens;
  console.log(`lote ${nn}: ${alvo.length} item(ns), modelo ${modelo}, effort ${effort || 'padrão'}, saída ${saida}, prompt fixo ${sistemaSha}`);
  const res = [];
  const fila = [...alvo];
  if (fila.length) res.push(await processar(fila.shift())); // sozinho: grava o cache do prefixo
  await Promise.all(Array.from({ length: Math.min(paralelo, fila.length) }, async () => {
    while (fila.length && !limite) res.push(await processar(fila.shift()));
  }));

  const soma = (k) => res.flatMap((r) => r.chamadas).reduce((a, c) => a + c[k], 0);
  const feitos = res.filter((r) => !r.pulado);
  const tot = { itens: feitos.length, pulados: res.length - feitos.length, chamadas: res.flatMap((r) => r.chamadas).length,
    input: soma('input'), cache_escrita: soma('cache_escrita'), cache_leitura: soma('cache_leitura'), output: soma('output'),
    thinking: soma('thinking'), custo_usd: +soma('custo_usd').toFixed(4), correcoes: feitos.reduce((a, r) => a + (r.correcoes || 0), 0) };
  tot.entrada_total = tot.input + tot.cache_escrita + tot.cache_leitura;
  if (feitos.length) {
    tot.entrada_por_item = Math.round(tot.entrada_total / feitos.length);
    tot.saida_por_item = Math.round(tot.output / feitos.length);
    tot.custo_por_item_usd = +(tot.custo_usd / feitos.length).toFixed(4);
  }
  fs.appendFileSync(metricas, JSON.stringify({ data: new Date().toISOString(), tipo: 'lote_itens', lote: nn, modelo, effort: effort || 'padrao', saida, sistema_sha: sistemaSha, ...tot }) + '\n');
  console.log(JSON.stringify(tot, null, 1));

  if (limite) {
    const pendentes = res.filter((r) => r.pendente).length + fila.length;
    console.log(`lote ${nn}: PARADO, limite de uso da assinatura atingido. ${pendentes} item(ns) pendente(s).
  ${limite}
` +
      '  Rode o mesmo comando depois que o limite renovar: itens já validados são pulados.');
    process.exitCode = 3;
    return;
  }
  // Lote concluído só se todas as specs existem e o lote inteiro passa no validador.
  // Com --so, confere só os itens pedidos (o lote ainda está incompleto).
  const final = so ? { status: res.every((r) => r.ok) ? 0 : 1, stdout: '' }
    : spawnSync('node', ['scripts/validate-spec.js', saida, '--lote', nn], { encoding: 'utf8' });
  const falhos = res.filter((r) => !r.ok);
  if (final.status === 0 && !falhos.length) console.log(`lote ${nn}: OK ${res.length} itens, ${tot.correcoes} rodada(s) de correção`);
  else {
    console.log(final.stdout.split('\n').slice(-3).join('\n'));
    console.log(`lote ${nn}: ERROS em ${falhos.length} item(ns): ${falhos.map((r) => r.sys_id).join(', ')}`);
    process.exitCode = 1;
  }
}
main();
