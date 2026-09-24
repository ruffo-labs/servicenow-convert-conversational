// Consolida os resultados dos lotes em output/: JSON completo, relatório Markdown e CSV resumo.
// Uso: node scripts/merge-results.js <pasta-results> <pasta-digests> <pasta-output> <nome-base>
const fs = require('fs');
const path = require('path');

const [, , resDir = 'work/results', digDir = 'work/digests', outDir = 'output', base = 'catalog-ai-first'] = process.argv;

const load = (f) => JSON.parse(fs.readFileSync(path.join(resDir, f), 'utf8'));
const files = fs.readdirSync(resDir).filter((f) => f.endsWith('.json'));
const itens = files.filter((f) => f.startsWith('batch-')).flatMap(load);
const sets = files.filter((f) => f.startsWith('sets-')).flatMap(load);

const index = JSON.parse(fs.readFileSync(path.join(digDir, 'index.json'), 'utf8'));

// Itens sem nenhuma pergunta e sem histórico são atalhos de portal (redirecionam para ADP/Workday etc.):
// volume zero é esperado. Na conversa, viram KB ou tópico de VA com link, e não devem ser desativados.
const LAYOUT = new Set(['11', '12', '19', '20', '24', '32']);
for (const i of itens) {
  if (i.recomendacao !== 'avaliar_desativacao') continue;
  const dg = JSON.parse(fs.readFileSync(path.join(digDir, 'items', `${i.sys_id}.json`), 'utf8'));
  const perguntas = dg.variaveis.filter((q) => !LAYOUT.has(q.type_code)).length + dg.variable_sets.reduce((n, s) => n + s.perguntas.length, 0);
  if (perguntas === 0 && !(dg.volume && dg.volume.total)) {
    i.recomendacao = 'substituir_por_link_kb';
    i.observacoes = [i.observacoes, 'Reclassificado: item-atalho sem perguntas (volume zero é esperado, pois não gera caso). Publicar como artigo de KB ou tópico de VA com o link, para o Now Assist responder à intenção.'].filter(Boolean).join(' ');
  }
}
const byId = new Map(itens.map((i) => [i.sys_id, i]));
const faltando = index.filter((x) => !byId.has(x.sys_id));
const meta = new Map(index.map((x) => [x.sys_id, x]));

// Patches manuais (work/patches/*.json → { sys_id: campos }): preenchem só campos vazios,
// e observacoes_extra é somado às observações.
const patchDir = path.join(path.dirname(resDir), 'patches');
if (fs.existsSync(patchDir)) {
  for (const f of fs.readdirSync(patchDir).filter((n) => n.endsWith('.json'))) {
    for (const [id, p] of Object.entries(JSON.parse(fs.readFileSync(path.join(patchDir, f), 'utf8')))) {
      const i = byId.get(id);
      if (!i) { console.warn(`patch ${f}: sys_id ${id} não encontrado`); continue; }
      for (const [k, v] of Object.entries(p)) {
        if (k === 'observacoes_extra') i.observacoes = [i.observacoes, v].filter(Boolean).join(' ');
        else if (i[k] == null || i[k] === '' || (Array.isArray(i[k]) && !i[k].length)) i[k] = v;
      }
    }
  }
}

const PRI = { alta: 0, media: 1, baixa: 2 };
itens.sort((a, b) => (PRI[a.prioridade] ?? 3) - (PRI[b.prioridade] ?? 3) || (b.volume_12m || 0) - (a.volume_12m || 0));
sets.sort((a, b) => (b.usado_por || 0) - (a.usado_por || 0));

const count = (arr, f) => arr.reduce((m, x) => ((m[f(x)] = (m[f(x)] || 0) + 1), m), {});
const resumo = {
  gerado_em: new Date().toISOString(),
  fonte: 'input/catalog-map.json',
  total_itens: itens.length,
  itens_sem_analise: faltando.map((x) => ({ sys_id: x.sys_id, name: x.name })),
  por_recomendacao: count(itens, (i) => i.recomendacao),
  por_prioridade: count(itens, (i) => i.prioridade),
  por_esforco: count(itens, (i) => i.esforco),
  itens_conversacionais_resultantes: itens.reduce((n, i) => n + (i.recomendacao === 'dividir' ? (i.itens_derivados || []).length : ['conversacional', 'conversacional_com_ajustes'].includes(i.recomendacao) ? 1 : 0), 0),
  total_variable_sets: sets.length,
  sets_por_recomendacao: count(sets, (s) => s.recomendacao),
};

fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, `${base}.json`), JSON.stringify({ resumo, itens, variable_sets: sets }, null, 2));

// CSV (abre direto no Excel: ; como separador + BOM)
const esc = (v) => `"${String(v ?? '').replace(/"/g, '""').replace(/\r?\n/g, ' ')}"`;
const cols = ['prioridade', 'recomendacao', 'esforco', 'prontidao_atual', 'volume_12m', 'tabela', 'categoria', 'nome_atual', 'nome_sugerido', 'qtd_derivados', 'derivados', 'qtd_perguntas', 'qtd_bloqueadores', 'frases_exemplo', 'justificativa', 'sys_id'];
const rows = itens.map((i) => {
  const perg = (i.perguntas || []).filter((p) => ['manter', 'alterar_tipo', 'nova'].includes(p.acao)).length;
  return [i.prioridade, i.recomendacao, i.esforco, i.prontidao_atual, i.volume_12m, i.tabela, meta.get(i.sys_id)?.category, i.nome_atual, i.nome_sugerido,
    (i.itens_derivados || []).length, (i.itens_derivados || []).map((d) => d.nome).join(' | '), perg, (i.bloqueadores || []).length,
    (i.frases_exemplo || []).join(' | '), i.justificativa, i.sys_id];
});
fs.writeFileSync(path.join(outDir, `${base}-resumo.csv`), '﻿' + [cols, ...rows].map((r) => r.map(esc).join(';')).join('\r\n'));

// Markdown
const md = [];
const tbl = (obj) => Object.entries(obj).map(([k, v]) => `| ${k} | ${v} |`).join('\n');
const cell = (s) => String(s ?? '').replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
md.push(`# Catálogo AI First — sugestões de conversão conversacional`, '',
  `Gerado em ${resumo.gerado_em.slice(0, 10)} a partir de \`${resumo.fonte}\`. Critérios: \`docs/criterios-conversacional.md\`.`, '',
  `**${resumo.total_itens} itens analisados** → **${resumo.itens_conversacionais_resultantes} itens conversacionais** propostos (contando divisões).`, '',
  '## Resumo', '', '| Recomendação | Itens |', '|---|---|', tbl(resumo.por_recomendacao), '',
  '| Prioridade | Itens |', '|---|---|', tbl(resumo.por_prioridade), '',
  '| Variable sets | Qtde |', '|---|---|', tbl(resumo.sets_por_recomendacao), '');
if (faltando.length) md.push(`> ⚠️ Sem análise: ${faltando.map((x) => x.name).join(', ')}`, '');

md.push('## Visão geral dos itens', '', '| # | Prioridade | Recomendação | Vol. 12m | Item atual | Nome sugerido |', '|---|---|---|---|---|---|');
itens.forEach((i, n) => md.push(`| ${n + 1} | ${i.prioridade} | ${i.recomendacao}${i.itens_derivados?.length ? ` (${i.itens_derivados.length})` : ''} | ${i.volume_12m ?? ''} | [${cell(i.nome_atual)}](#item-${i.sys_id}) | ${cell(i.nome_sugerido)} |`));
md.push('');

md.push('## Variable sets compartilhados', '', 'Ajustar o set resolve de uma vez todos os itens que o usam.', '');
for (const s of sets) {
  md.push(`### ${s.titulo} — usado por ${s.usado_por} item(ns)`, '', `**Recomendação:** ${s.recomendacao} · **Esforço:** ${s.esforco}`, '', s.resumo || '', '');
  if (s.bloqueadores?.length) md.push('**Bloqueadores**', '', ...s.bloqueadores.map((b) => `- \`${b.onde}\`: ${b.problema} → ${b.acao}`), '');
  if (s.perguntas?.length) md.push('| Variável | Ação | Conversational label | Obs. |', '|---|---|---|---|', ...s.perguntas.map((p) => `| \`${p.variavel}\` | ${p.acao}${p.tipo_sugerido ? ` → ${p.tipo_sugerido}` : ''} | ${cell(p.conversational_label)} | ${cell(p.obs)} |`), '');
  if (s.scripts_e_policies?.length) md.push('**Scripts / UI policies**', '', ...s.scripts_e_policies.map((x) => `- ${x.nome}: ${x.acao}${x.substituicao ? ` — ${x.substituicao}` : ''}`), '');
  if (s.observacoes) md.push(`_${s.observacoes}_`, '');
}

md.push('## Detalhe por item', '');
const perguntasTbl = (ps) => ['| # | Variável | Ação | Conversational label | Obs. |', '|---|---|---|---|---|',
  ...ps.map((p) => `| ${p.ordem ?? ''} | \`${p.variavel}\`${p.origem && p.origem !== 'item' ? ` <sub>${p.origem}</sub>` : ''} | ${p.acao ?? ''}${p.tipo_sugerido ? ` → ${p.tipo_sugerido}` : ''} | ${cell(p.conversational_label)} | ${cell(p.obs)} |`)];
for (const i of itens) {
  const m = meta.get(i.sys_id) || {};
  md.push(`<a id="item-${i.sys_id}"></a>`, `### ${i.nome_atual}`, '',
    `\`${i.sys_id}\` · ${i.tabela} · ${m.category || 'sem categoria'} · volume 12m: **${i.volume_12m ?? '-'}** · prontidão atual: **${i.prontidao_atual ?? '-'}**/100`, '',
    `**Recomendação:** ${i.recomendacao} · **Prioridade:** ${i.prioridade} · **Esforço:** ${i.esforco}`, '', i.justificativa || '', '');
  if (i.nome_sugerido) md.push(`- **Nome sugerido:** ${i.nome_sugerido}`);
  if (i.short_description_sugerida) md.push(`- **Short description:** ${i.short_description_sugerida}`);
  if (i.descricao_sugerida) md.push(`- **Descrição (base para o LLM):** ${i.descricao_sugerida}`);
  if (i.frases_exemplo?.length) md.push(`- **Frases de exemplo:** ${i.frases_exemplo.map((f) => `“${f}”`).join(' · ')}`);
  md.push('');
  if (i.bloqueadores?.length) md.push('**Bloqueadores a resolver**', '', ...i.bloqueadores.map((b) => `- \`${b.onde}\`: ${b.problema} → ${b.acao}`), '');
  if (i.perguntas?.length) md.push('**Perguntas**', '', ...perguntasTbl(i.perguntas), '');
  if (i.itens_derivados?.length) {
    md.push(`**Dividir em ${i.itens_derivados.length} itens conversacionais**`, '');
    i.itens_derivados.forEach((d, k) => {
      md.push(`${k + 1}. **${d.nome}** — ${d.short_description || ''}`, '');
      if (d.descricao) md.push(`   ${d.descricao}`, '');
      if (d.fixar) md.push(`   Fixar: \`${d.fixar}\``, '');
      if (d.frases_exemplo?.length) md.push(`   Frases: ${d.frases_exemplo.map((f) => `“${f}”`).join(' · ')}`, '');
      if (d.perguntas?.length) md.push(...d.perguntas.map((p) => `   - ${p.ordem ?? ''}. \`${p.variavel}\`: ${p.conversational_label || ''}`), '');
    });
  }
  if (i.scripts_e_policies?.length) md.push('**Scripts / UI policies**', '', ...i.scripts_e_policies.map((x) => `- ${x.nome}: ${x.acao}${x.substituicao ? ` — ${x.substituicao}` : ''}`), '');
  const c = i.configuracoes || {};
  md.push(`**Configurações:** make_item_non_conversational=${c.make_item_non_conversational ?? false}, turn_off_nowassist_conversation=${c.turn_off_nowassist_conversation ?? false}${c.outras?.length ? '; ' + c.outras.join('; ') : ''}`, '');
  if (i.observacoes) md.push(`_${i.observacoes}_`, '');
  md.push('---', '');
}
fs.writeFileSync(path.join(outDir, `${base}.md`), md.join('\n'));
console.log(JSON.stringify(resumo, null, 1));
