// Lista toda variável do item removida, substituída, unida ou tirada de um derivado, com o flow/workflow do item,
// para o time de ServiceNow conferir se o fluxo de atendimento lê essas variáveis.
// Uso: node scripts/variaveis-alteradas.js <pasta ou spec>... [--saida work/relatorios/variaveis-alteradas.csv]
const fs = require('fs');
const path = require('path');
const { expand, contexto, carregar, lerSpecs, naoColetaDado } = require('./expand-spec');

process.chdir(path.join(__dirname, '..'));
const args = process.argv.slice(2);
const i = args.indexOf('--saida');
const saida = i >= 0 ? args.splice(i, 2)[1] : 'work/relatorios/variaveis-alteradas.csv';
if (!args.length) { console.error('uso: node scripts/variaveis-alteradas.js <pasta ou spec>... [--saida arq.csv]'); process.exit(2); }

const TIPOS = { 1: 'sim/não', 2: 'texto longo', 3: 'múltipla escolha', 5: 'lista', 6: 'texto', 7: 'checkbox', 8: 'referência',
  9: 'data', 10: 'data/hora', 11: 'rótulo', 12: 'quebra', 14: 'custom', 15: 'ui page', 16: 'texto largo', 17: 'custom com rótulo',
  18: 'lista lookup', 19: 'início container', 20: 'fim container', 21: 'list collector', 23: 'html', 24: 'divisão container',
  29: 'duração', 32: 'rótulo rich text', 33: 'anexo' };
const cel = (s) => { s = String(s ?? ''); return /[;"\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
const txt = (c) => (c == null ? '' : typeof c === 'string' ? c : JSON.stringify(c));
const ref = (x) => (x && typeof x === 'object' ? x._display_value || x.__text || '' : x || '');
const fluxos = (orig) => [
  ref(orig.flow_designer_flow) && `flow: ${ref(orig.flow_designer_flow)}`,
  ref(orig.workflow) && `workflow: ${ref(orig.workflow)}`,
  ...(orig.triggered_flow_designers || []).map((f) => `flow disparado: ${f.name} (${String(f.trigger_condition || '').includes(orig.sys_id) ? 'específico do item' : 'genérico'}, ${f.status || '?'}${f.active === 'false' ? ', inativo' : ''}, ${(f.executions || {}).count ?? '?'} execuções)`),
  ...(orig.triggered_workflows || []).map((w) => `workflow disparado: ${w.name || ref(w)}${w.active === 'false' ? ' (inativo)' : ''}`),
].filter(Boolean).join('\n');

const base = carregar();
const linhas = [];
for (const { arquivo, spec } of lerSpecs(args)) {
  const orig = base.itemById.get(spec.sys_id);
  if (!orig || spec.status === 'analise_humana') continue;
  const ctx = contexto(orig, base.setById);
  const r = expand(spec, ctx, base.a1.get(spec.sys_id));
  if (r.erros.length) console.error(`${arquivo}: ${r.erros.length} erro(s) no validador; linhas podem estar incompletas`);
  const porId = new Map(ctx.own.map((v) => [v.sys_id, v]));
  const variavel = (k) => { const x = ctx.ref(k); return x.own ? x.v : null; };
  const derivados = (r.exp.novos_itens || []).map((d) => d.name);
  const fluxo = fluxos(orig);

  // "unida": duas ou mais variáveis substituídas pela mesma variável nova.
  const alvos = {};
  for (const val of Object.values(spec.remover || {})) if (val && val.substituida_por) alvos[val.substituida_por] = (alvos[val.substituida_por] || 0) + 1;
  const linha = (v, alteracao, codigo, nova, derivado) => linhas.push([orig.sys_id, orig.name, spec.status, derivados.join('\n'),
    v.name, TIPOS[v.type] || `tipo ${v.type}`, naoColetaDado(v) ? 'não' : 'sim', alteracao, codigo, nova || '',
    nova && spec.vars && spec.vars[nova] && spec.vars[nova].nova ? spec.vars[nova].nova.question_text : '', derivado, fluxo, '', '']);

  for (const [k, val] of Object.entries(spec.remover || {})) {
    const v = variavel(k);
    if (!v) continue;
    if (val && val.substituida_por) linha(v, alvos[val.substituida_por] > 1 ? 'unida' : 'substituída', 'substituida_por', val.substituida_por, 'todos');
    else if (val && val.duplicada_no_set) linha(v, 'removida (duplicada no set)', 'duplicada_no_set', val.duplicada_no_set, 'todos');
    else linha(v, 'removida', txt(val), '', 'todos');
  }
  (spec.itens || []).forEach((d, idx) => {
    for (const k of d.sem_vars || []) {
      const v = variavel(k) || porId.get(k);
      if (v) linha(v, 'fora do derivado', 'sem_vars', '', derivados[idx] || `itens[${idx}]`);
    }
  });
}
// Variáveis que coletam dado primeiro: são as que o fluxo pode ler.
linhas.sort((a, b) => (a[6] === b[6] ? 0 : a[6] === 'sim' ? -1 : 1) || a[1].localeCompare(b[1]));
fs.mkdirSync(path.dirname(saida), { recursive: true });
const cols = ['sys_id_item', 'item', 'status', 'derivados', 'variavel', 'tipo', 'coleta_dado', 'alteracao', 'codigo', 'variavel_nova',
  'pergunta_variavel_nova', 'derivado_afetado', 'flow_workflow_do_item', 'fluxo_le_variavel (sim/não)', 'observacoes_servicenow'];
fs.writeFileSync(saida, '﻿' + [cols, ...linhas].map((r) => r.map(cel).join(';')).join('\r\n') + '\r\n', 'utf8');
const dado = linhas.filter((l) => l[6] === 'sim');
console.log(`${saida}: ${linhas.length} linha(s), ${dado.length} de variável que coleta dado, ${new Set(linhas.map((l) => l[0])).size} item(ns)`);
