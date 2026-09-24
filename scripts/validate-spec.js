// Valida specs em delta (1 arquivo por item: work/specs/lote-NN/<sys_id>.json) contra o export ORIGINAL.
// Zero perda é medido sempre contra catalog-map.json, nunca contra a 1ª análise. As regras de expansão estão em expand-spec.js.
// Uso: node scripts/validate-spec.js <spec.json|pasta>... [--src input/catalog-map.json] [--analise output/catalog-ai-first.json]
//        [--metricas work/metricas.jsonl] [--lote NN]
// Sai com código 1 se houver erro. Erros saem agrupados por arquivo, para a correção reescrever só esses itens.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { expand, contexto, carregar, lerSpecs, partesCond, varDaCond, HEX } = require('./expand-spec');

const args = process.argv.slice(2);
const opt = (k, def) => { const i = args.indexOf(k); return i >= 0 ? args.splice(i, 2)[1] : def; };
const src = opt('--src', 'input/catalog-map.json');
const analiseFile = opt('--analise', 'output/catalog-ai-first.json');
const metricasFile = opt('--metricas');
const lote = opt('--lote');
if (!args.length) { console.error('uso: node scripts/validate-spec.js <spec.json|pasta>...'); process.exit(2); }

const base = carregar(src, analiseFile);
const VISUAL = new Set(['11', '12', '19', '20', '24', '32']);
const isTrue = (v) => v === true || v === 'true';

const globais = [];
const fontes = path.join('work', 'digests', 'fontes.json');
if (fs.existsSync(fontes) && fs.existsSync(analiseFile)) {
  const esperado = JSON.parse(fs.readFileSync(fontes, 'utf8')).primeira_analise?.sha256;
  const atual = crypto.createHash('sha256').update(fs.readFileSync(analiseFile)).digest('hex');
  if (esperado && esperado !== atual) globais.push(`${analiseFile} mudou desde o digest (sha256 ${atual.slice(0, 12)} ≠ ${esperado.slice(0, 12)})`);
}

let erros = 0;
let avisos = 0;
let avisosOriginal = 0; // do catálogo original (policies quebradas): não contam como erro da spec; detalhe no CSV
const stats = { total: 0, outro: 0 };
const status = {};
const out = [];
const vistos = new Map();
const specs = lerSpecs(args);

for (const { arquivo, spec } of specs) {
  const e = [];
  const orig = base.itemById.get(spec.sys_id);
  if (!orig) { out.push(`${arquivo}: sys_id ${spec.sys_id} não existe no export`); erros++; continue; }
  if (vistos.has(spec.sys_id)) e.push(`sys_id repetido (também em ${vistos.get(spec.sys_id)})`);
  vistos.set(spec.sys_id, arquivo);
  if (path.basename(arquivo, '.json') !== spec.sys_id) e.push(`arquivo deve se chamar ${spec.sys_id}.json`);

  const ctx = contexto(orig, base.setById);
  const r = expand(spec, ctx, base.a1.get(spec.sys_id));
  e.push(...r.erros);
  stats.total += r.stats.total;
  stats.outro += r.stats.outro;
  avisosOriginal += r.avisosOriginal.length;
  status[spec.status] = (status[spec.status] || 0) + 1;
  const W = r.avisos;

  if (spec.status !== 'analise_humana' && r.info.derivInfo) {
    const novos = r.exp.novos_itens;
    const { derivInfo, removidas, csFora } = r.info;
    if (spec.status === 'dividido' && novos.length < 2) e.push('status dividido com menos de 2 itens');
    if (spec.status === 'conversacional' && novos.length !== 1) e.push('status conversacional deve ter 1 item');
    const nomes = novos.map((n) => n.name);
    if (new Set(nomes).size !== nomes.length) e.push(`derivados com nome repetido: ${nomes.join(' | ')}`);

    novos.forEach((n, k) => {
      const tag = `item[${k}] "${n.name}"`;
      const info = derivInfo[k];
      if (!n.name) e.push(`${tag}: sem name`);
      if (!n.description) e.push(`${tag}: sem description`);
      if (!(n.frases_exemplo || []).length) e.push(`${tag}: sem frases_exemplo`);
      const fixas = new Set(n.variaveis_fixas.map((f) => f.name));

      // Toda variável perguntada precisa de conversational_label.
      for (const v of n.variables) {
        const o = ctx.own.find((x) => x.name === v.name) || {};
        const type = String((v.overrides && v.overrides.type) || (v.nova && v.nova.type) || o.type || '');
        const hidden = isTrue((v.overrides || {}).hidden ?? (v.nova || {}).hidden ?? o.hidden);
        const nac = isTrue((v.overrides || {}).not_available_conversation ?? o.not_available_conversation);
        if (!VISUAL.has(type) && !hidden && !nac && !fixas.has(v.name) && !v.conversational_label) e.push(`${tag}: ${v.name} é perguntada mas não tem label`);
        if (v.nova && v.order === 9999) W.push(`${tag}: ${v.name} sem nova.order (vai para o fim)`);
      }

      // Policies: condições e ações só podem citar variáveis presentes neste derivado.
      const presente = (tok) => {
        if (tok.startsWith('nova_')) return info.presentes.has(tok) || `${tok} não está neste derivado`;
        const x = ctx.ref(tok);
        if (x.erro) return x.erro;
        if (x.own) return info.presentes.has(x.v.sys_id) || `${x.v.name} foi removida deste derivado`;
        return info.setsIds.has(x.set.sys_id) || `${x.v.name} é do set "${x.set.title}", que não está neste derivado`;
      };
      const conhecida = (tok) => tok.startsWith('nova_') ? info.presentes.has(tok) : (!ctx.ref(tok).erro || ctx.ambiguos.has(tok));
      for (const p of n.ui_policies) {
        const pt = `${tag}: policy "${p.short_description}" (${p.chave})`;
        for (const parte of partesCond(p.conditions)) {
          // Condição do original sobre variável ausente: pendência humana já registrada como aviso do original.
          if (p.pendencia_humana && HEX.test(parte.slice(0, 32)) && !ctx.byId.has(parte.slice(0, 32))) continue;
          const tok = varDaCond(parte, conhecida);
          if (!tok) { e.push(`${pt}: condição "${parte}" não usa variável conhecida`); continue; }
          const ok = presente(tok);
          if (ok !== true) e.push(`${pt}: condição "${parte}": ${ok}`);
        }
        if (!p.actions.length && p.alterada) e.push(`${pt}: sem ações`);
        for (const a of p.actions) { const ok = presente(a.variable); if (ok !== true) e.push(`${pt}: ação em ${a.variable}: ${ok}`); }
      }
      // Script convertido ou removido não pode continuar ativo na saída.
      for (const c of n.client_scripts_mantidos) if (csFora.has(c.sys_id)) e.push(`${tag}: client script ${c.name} foi convertido/removido e continua na saída`);
    });

    // Zero perda: toda variável ativa do item está em algum derivado ou foi removida com código válido.
    for (const v of ctx.own) {
      if (removidas.has(v.sys_id) || derivInfo.some((x) => x.presentes.has(v.sys_id))) continue;
      e.push(`variável ${v.name} (type ${v.type}) sumiu: está em sem_vars de todos os derivados e não está em "remover"`);
    }
    for (const { set } of ctx.sets) if (!derivInfo.some((x) => x.setsIds.has(set.sys_id))) e.push(`variable set ${set.title} (${set.sys_id}) não está em nenhum derivado`);
  }

  avisos += W.length;
  if (e.length || W.length) out.push(`${arquivo} (${orig.name}):${e.map((x) => `\n  - ${x}`).join('')}${W.map((x) => `\n  ~ aviso: ${x}`).join('')}`);
  erros += e.length;
}

// Com --lote NN: todo item do lote tem spec, e nenhuma spec é de item de fora do lote.
if (lote) {
  const roteiro = path.join('work', 'lotes', `lote-${lote}`, 'lote.json');
  if (!fs.existsSync(roteiro)) { out.push(`${roteiro} não existe`); erros++; } else {
    const esperados = new Set(JSON.parse(fs.readFileSync(roteiro, 'utf8')).itens.map((x) => x.sys_id));
    for (const id of esperados) if (!vistos.has(id)) { out.push(`${id}: item do lote ${lote} sem spec (falta ${id}.json)`); erros++; }
    for (const [id, arq] of vistos) if (!esperados.has(id)) { out.push(`${arq}: item não pertence ao lote ${lote}`); erros++; }
  }
}
if (globais.length) out.unshift(...globais.map((g) => `~ aviso: ${g}`));
console.log(out.join('\n') || 'OK');
const m = { data: new Date().toISOString(), lote: lote || null, itens: specs.length, erros_spec: erros, avisos_spec: avisos, avisos_original: avisosOriginal, status, codigos: stats.total, outro: stats.outro, pct_outro: stats.total ? +(100 * stats.outro / stats.total).toFixed(1) : 0 };
console.log(`\n${specs.length} itens, ${erros} erro(s) da spec, ${avisos} aviso(s) da spec, ${avisosOriginal} aviso(s) do original (ver CSV), "outro" ${m.pct_outro}% de ${stats.total} códigos`);
if (metricasFile) fs.appendFileSync(metricasFile, JSON.stringify({ tipo: 'validacao', ...m }) + '\n');
process.exit(erros ? 1 : 0);
