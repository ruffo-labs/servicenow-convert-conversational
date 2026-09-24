// Valida as especificações do novo catálogo contra o export original.
// Uso: node scripts/validate-spec.js <spec.json> [input/catalog-map.json]
const fs = require('fs');
const [, , specFile, src = 'input/catalog-map.json'] = process.argv;
const spec = JSON.parse(fs.readFileSync(specFile, 'utf8'));
const d = JSON.parse(fs.readFileSync(src, 'utf8'));
const itemById = new Map(d.itens.map((i) => [i.sys_id, i]));
const setById = new Map(d.variable_sets.map((s) => [s.sys_id, s]));

const VISUAL = new Set(['11', '12', '19', '20', '24', '32']);
const PRESENT = new Set(['14', '15', '17']); // custom / ui page / custom with label
const STATUS = new Set(['conversacional', 'dividido', 'analise_humana']);
const isTrue = (v) => v === true || v === 'true';

// Nome da variável no início de uma condição encoded (v_xISNOTEMPTY, v_xINa,b, v_x!=1, v_x=1...):
// pega o prefixo mais longo que seja uma variável conhecida.
function condVar(cond, conhecida) {
  const m = cond.match(/^[a-zA-Z0-9_]+/);
  if (!m) return null;
  for (let n = m[0].length; n > 0; n--) { const nome = m[0].slice(0, n); if (conhecida(nome)) return nome; }
  return null;
}

let erros = 0;
const out = [];
for (const s of spec) {
  const e = [];
  const orig = itemById.get(s.sys_id);
  if (!orig) { out.push(`${s.sys_id}: sys_id não existe no export`); erros++; continue; }
  if (!STATUS.has(s.status)) e.push(`status inválido: ${s.status}`);
  const novos = s.novos_itens || [];
  if (!novos.length) e.push('novos_itens vazio');
  if (s.status === 'dividido' && novos.length < 2) e.push('status dividido com menos de 2 itens');
  if (s.status === 'conversacional' && novos.length !== 1) e.push('status conversacional deve ter 1 item');

  if (s.status !== 'analise_humana') {
    const vars = (orig.catalog_variables || []).filter((v) => v.active === 'true');
    const varByName = new Map(vars.map((v) => [v.name, v]));
    const origSets = new Map((orig.catalog_variable_sets || []).map((r) => [r.variable_set.__text, r]));
    const setVarNames = new Set([...origSets.keys()].flatMap((id) => (setById.get(id)?.vs_variables || []).map((v) => v.name)));
    const naoUsadas = new Map((s.variaveis_nao_utilizadas || []).map((x) => [x.name, x.motivo || '']));
    const usadas = new Set();
    const setsUsados = new Set();

    novos.forEach((n, k) => {
      const tag = `item[${k}] "${n.name}"`;
      if (!n.name) e.push(`${tag}: sem name`);
      if (!n.description) e.push(`${tag}: sem description`);
      if (!(n.frases_exemplo || []).length) e.push(`${tag}: sem frases_exemplo`);
      const fixas = new Set((n.variaveis_fixas || []).map((f) => f.name));
      fixas.forEach((f) => { usadas.add(f); if (!varByName.has(f)) e.push(`${tag}: variavel_fixa ${f} não existe no item`); });
      const locais = new Set([...fixas]);
      for (const v of n.variables || []) {
        locais.add(v.name);
        if (v.name.startsWith('nova_')) {
          if (!v.nova || !v.nova.type) e.push(`${tag}: ${v.name} sem definição "nova.type"`);
        } else if (!varByName.has(v.name)) {
          e.push(`${tag}: variável ${v.name} não existe no item${setVarNames.has(v.name) ? ' (é de variable set: referencie o set)' : ''}`);
          continue;
        } else usadas.add(v.name);
        const o = varByName.get(v.name) || {};
        const type = String((v.overrides && v.overrides.type) || (v.nova && v.nova.type) || o.type || '');
        const hidden = isTrue((v.overrides || {}).hidden ?? (v.nova || {}).hidden ?? o.hidden);
        const nac = isTrue((v.overrides || {}).not_available_conversation ?? o.not_available_conversation);
        if (!VISUAL.has(type) && !hidden && !nac && !fixas.has(v.name) && !v.conversational_label) e.push(`${tag}: ${v.name} é perguntada mas não tem conversational_label`);
      }
      for (const r of n.variable_sets || []) {
        if (!origSets.has(r.sys_id)) e.push(`${tag}: variable set ${r.sys_id} (${r.name}) não é do item original`);
        setsUsados.add(r.sys_id);
      }
      const conhecidas = (name) => locais.has(name) || setVarNames.has(name) || varByName.has(name);
      for (const p of n.ui_policies || []) {
        const partes = String(p.conditions || '').replace(/\^?EQ$/, '').split(/\^OR|\^NQ|\^/).filter(Boolean);
        partes.forEach((c) => { if (!condVar(c, conhecidas)) e.push(`${tag}: policy "${p.short_description}" condição "${c}" não usa variável conhecida`); });
        (p.actions || []).forEach((a) => { if (!conhecidas(a.variable)) e.push(`${tag}: policy "${p.short_description}" ação em ${a.variable}, que não existe`); });
      }
      const csIds = new Set((orig.catalog_client_script || []).map((c) => c.sys_id));
      (n.client_scripts_mantidos || []).forEach((c) => { if (!csIds.has(c.sys_id)) e.push(`${tag}: client script ${c.sys_id} não existe no item`); });
    });

    for (const v of vars) {
      if (usadas.has(v.name)) continue;
      const motivo = naoUsadas.get(v.name);
      const visual = VISUAL.has(v.type) || PRESENT.has(v.type) || v.sp_widget || v.macro;
      if (motivo === undefined) e.push(`variável ${v.name} (type ${v.type}) sumiu: coloque em algum item novo ou em variaveis_nao_utilizadas`);
      else if (!visual && !/substitu/i.test(motivo)) e.push(`variável de dado ${v.name} (type ${v.type}) não pode ser removida (só visuais ou "substituída por …")`);
    }
    for (const id of origSets.keys()) if (!setsUsados.has(id)) e.push(`variable set ${origSets.get(id).variable_set._display_value} (${id}) não está em nenhum item novo`);
  } else if (!s.motivo) e.push('analise_humana sem motivo');

  if (e.length) { erros += e.length; out.push(`${s.sys_id} ${s.name}:\n  - ${e.join('\n  - ')}`); }
}
console.log(out.join('\n') || 'OK');
console.log(`\n${spec.length} itens, ${erros} erro(s)`);
process.exit(erros ? 1 : 0);
