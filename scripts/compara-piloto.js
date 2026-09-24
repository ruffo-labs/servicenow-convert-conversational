// Compara as specs de um lote com a 1ª análise (status, derivados/fixas, variáveis removidas)
// e gera a planilha de labels para revisão.
// A 1ª análise é gabarito de aderência, não de acerto: o pacote traz a 1ª análise e a skill manda segui-la.
// Uso: node scripts/compara-piloto.js <pasta specs> <NN> <tag> [pasta saída=work/relatorios/piloto]
//   ex.: node scripts/compara-piloto.js work/specs/_piloto/sonnet-p/lote-01 01 sonnet-p
// Saída: divergencias-<tag>-lote-NN.csv (só itens com divergência) e labels-<tag>-lote-NN.csv (para revisão).
const fs = require('fs');
const path = require('path');
const { expand, contexto, carregar, lerSpecs, naoColetaDado } = require('./expand-spec');

process.chdir(path.join(__dirname, '..'));

const [dir, nn, tag, outDir = 'work/relatorios/piloto'] = process.argv.slice(2);
if (!dir || !/^\d{2}$/.test(nn || '') || !tag) { console.error('uso: node scripts/compara-piloto.js <pasta specs> <NN> <tag> [pasta saída]'); process.exit(2); }
const base = carregar();
const lote = JSON.parse(fs.readFileSync(`work/lotes/lote-${nn}/lote.json`, 'utf8'));
const specs = new Map(lerSpecs([dir]).map(({ spec }) => [spec.sys_id, spec]));
const STATUS_1A = { conversacional: 'conversacional', conversacional_com_ajustes: 'conversacional', dividir: 'dividido',
  manter_formulario: 'analise_humana', avaliar_desativacao: 'analise_humana', substituir_por_link_kb: 'analise_humana' };
const TIPOS = { 1: 'sim/não', 2: 'texto longo', 3: 'múltipla escolha', 5: 'lista', 6: 'texto', 7: 'checkbox', 8: 'referência',
  9: 'data', 10: 'data/hora', 16: 'texto largo', 18: 'lista lookup', 21: 'list collector', 29: 'duração', 33: 'anexo',
  14: 'custom', 15: 'ui page', 17: 'custom com rótulo' };

const cel = (s) => { s = String(s ?? ''); return /[;"\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
const csv = (arq, cols, rows) => fs.writeFileSync(arq, '﻿' + [cols, ...rows].map((r) => r.map(cel).join(';')).join('\r\n') + '\r\n', 'utf8');
const txt = (c) => (c == null ? '' : typeof c === 'string' ? c : JSON.stringify(c));
const isTrue = (v) => v === true || v === 'true';

const divergencias = [];
const labels = [];
const resumo = { itens: 0, sem_spec: [], com_divergencia: 0, nao_declaradas: 0, status_igual: 0 };

for (const it of lote.itens) {
  resumo.itens++;
  const spec = specs.get(it.sys_id);
  const orig = base.itemById.get(it.sys_id);
  const a1 = base.a1.get(it.sys_id);
  if (!spec) { resumo.sem_spec.push(it.sys_id); continue; }
  const ctx = contexto(orig, base.setById);
  const own = ctx.own;
  const porNome = new Map(own.map((v) => [v.name, v]));
  const porId = new Map(own.map((v) => [v.sys_id, v]));
  const nomeDe = (k) => (porId.get(k) || porNome.get(k) || { name: k }).name;
  const r = expand(spec, ctx, a1);

  const achados = [];
  // 1. status
  const esperado = STATUS_1A[a1.recomendacao];
  if (esperado === spec.status) resumo.status_igual++;
  else achados.push(['STATUS', `modelo=${spec.status}; 1ª análise=${a1.recomendacao} (→ ${esperado})`]);

  // 2. derivados e valores fixos (só quando os dois lados geram itens)
  const der1a = a1.itens_derivados || [];
  if (spec.status !== 'analise_humana' && esperado !== 'analise_humana') {
    const nMod = spec.status === 'dividido' ? (spec.itens || []).length : 1;
    const n1a = esperado === 'dividido' ? der1a.length : 1;
    if (nMod !== n1a) achados.push(['N_DERIVADOS', `modelo=${nMod}; 1ª análise=${n1a}`]);
    if (spec.status === 'dividido' && esperado === 'dividido') {
      const conhecidas = new Set([...own.map((v) => v.name), ...ctx.setVars.map((x) => x.v.name)]);
      const fix1a = der1a.map((d) => [...String(d.fixar || '').matchAll(/([A-Za-z_]\w*)\s*=\s*([\p{L}\w.-]+(?: \p{L}+)?)/gu)]
        .filter((m) => conhecidas.has(m[1]) || porNome.has(m[1])).map((m) => `${m[1]}=${m[2]}`).sort().join(', '));
      const fixMod = (spec.itens || []).map((d) => Object.entries(d.fixas || {}).map(([k, v]) => `${nomeDe(k)}=${v}`).sort().join(', '));
      const falta = fix1a.filter((f) => !fixMod.includes(f));
      const sobra = fixMod.filter((f) => !fix1a.includes(f));
      if (falta.length || sobra.length) achados.push(['FIXAS', `1ª análise: ${fix1a.map((f) => `[${f || '—'}]`).join(' ')}; modelo: ${fixMod.map((f) => `[${f || '—'}]`).join(' ')}`]);
    }
  }

  // 3. variáveis removidas (globais). Remover variável visual não é divergência.
  if (spec.status !== 'analise_humana') {
    const remMod = new Map(Object.entries(spec.remover || {}).map(([k, c]) => [nomeDe(k), c]));
    const rem1a = new Set((a1.perguntas || []).filter((p) => p.acao === 'remover' && p.origem === 'item')
      .flatMap((p) => String(p.variavel).split(/\s*\/\s*/)).filter((n) => porNome.has(n)));
    const menos = [...rem1a].filter((n) => !remMod.has(n));
    const mais = [...remMod].filter(([n]) => !rem1a.has(n) && porNome.has(n) && !naoColetaDado(porNome.get(n)));
    if (menos.length) achados.push(['REMOVIDA_A_MENOS', `1ª análise remove e o modelo mantém: ${menos.join(', ')}`]);
    if (mais.length) achados.push(['REMOVIDA_A_MAIS', `modelo remove variável de dado: ${mais.map(([n, c]) => `${n} (${txt(c)})`).join(', ')}`]);
  }

  const decl = (spec.divergencias || []).map(txt);
  if (achados.length && !decl.length) { achados.push(['NAO_DECLARADA', 'diferença sem código em "divergencias"']); resumo.nao_declaradas++; }
  if (achados.length || decl.length) {
    resumo.com_divergencia++;
    divergencias.push([it.sys_id, it.name, a1.recomendacao, spec.status, achados.map((a) => a[0]).join(', '),
      achados.map((a) => `${a[0]}: ${a[1]}`).join('\n'), decl.join(', '), txt(spec.criterio), spec.motivo]);
  }

  // Planilha de labels: variáveis próprias perguntadas em cada derivado.
  if (spec.status === 'analise_humana') continue;
  const specLabel = (obj, nome) => { for (const [k, d] of Object.entries(obj || {})) if (nomeDe(k) === nome) return d.label ?? d.nova?.question_text; };
  (r.exp.novos_itens || []).forEach((d, i) => {
    const fixas = new Set((d.variaveis_fixas || []).map((f) => f.name));
    for (const v of d.variables) {
      const o = porNome.get(v.name);
      const tipo = o ? String(o.type) : String(v.nova?.type ?? '');
      if (o && naoColetaDado(o)) continue;
      const ov = v.overrides || {};
      if (fixas.has(v.name) || isTrue(ov.hidden ?? o?.hidden) || isTrue(ov.not_available_conversation)) continue;
      const doModelo = specLabel((spec.itens || [])[i]?.vars, v.name) ?? specLabel(spec.vars, v.name);
      const d1a = spec.status === 'dividido' ? der1a[(spec.itens || [])[i]?.de_1a ?? i] : null;
      const l1a = [...((d1a && d1a.perguntas) || []), ...(a1.perguntas || [])].find((p) => p.variavel === v.name && p.conversational_label);
      const igual1a = l1a && l1a.conversational_label === v.conversational_label;
      const origem = doModelo != null && !igual1a ? (v.name.startsWith('nova_') ? 'modelo (variável nova)' : 'modelo')
        : v.conversational_label ? '1ª análise' : 'sem label';
      labels.push([it.sys_id, it.name, d.name, v.name, TIPOS[ov.type ?? tipo] ?? `tipo ${tipo}`, o ? (o.question_text || '') : '',
        v.conversational_label || '', origem, '', '', '']);
    }
  });
}

fs.mkdirSync(outDir, { recursive: true });
csv(path.join(outDir, `divergencias-${tag}-lote-${nn}.csv`),
  ['sys_id', 'item', 'recomendacao_1a', 'status_modelo', 'codigos_comparacao', 'detalhe', 'divergencias_declaradas', 'criterio', 'motivo_modelo'], divergencias);
// modelo primeiro: são os que precisam de revisão
labels.sort((a, b) => (a[7].startsWith('modelo') ? 0 : 1) - (b[7].startsWith('modelo') ? 0 : 1));
csv(path.join(outDir, `labels-${tag}-lote-${nn}.csv`),
  ['sys_id', 'item', 'derivado', 'variavel', 'tipo', 'question_text_original', 'label', 'origem_label', 'avaliacao', 'label_ajustado', 'observacoes'], labels);
console.log(JSON.stringify({ ...resumo, labels: labels.length, labels_modelo: labels.filter((l) => l[7].startsWith('modelo')).length }, null, 1));
for (const d of divergencias) console.log(`\n## ${d[1]} (${d[2]} → ${d[3]})\n  comparação: ${d[4] || '—'}\n  ${d[5].replace(/\n/g, '\n  ')}\n  declaradas: ${d[6] || '—'}  criterio: ${d[7] || '—'}\n  motivo: ${d[8]}`);
