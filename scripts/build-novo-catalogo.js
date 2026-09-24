// Monta o JSON do novo catálogo conversacional: especificações em delta (work/specs/lote-NN/<sys_id>.json) + export original.
// As specs são expandidas por expand-spec.js (base = original). Cada variável, policy e script citado é copiado completo
// do original e recebe as alterações. Referência a variável por sys_id tem precedência sobre nome.
// Uso: node scripts/build-novo-catalogo.js <pasta-specs> <input/catalog-map.json> <output/novo-catalogo.json> [output/catalog-ai-first.json]
const fs = require('fs');
const path = require('path');
const { expand, contexto, carregar, lerSpecs } = require('./expand-spec');

const [, , specDir = 'work/specs', src = 'input/catalog-map.json', outFile = 'output/novo-catalogo.json', analiseFile = 'output/catalog-ai-first.json'] = process.argv;
const base0 = carregar(src, analiseFile);
const d = base0.d;
const setById = base0.setById;
const specs = lerSpecs([specDir]).map(({ spec }) => {
  const orig = base0.itemById.get(spec.sys_id);
  return orig ? expand(spec, contexto(orig, setById), base0.a1.get(spec.sys_id)).exp : null;
}).filter(Boolean);
const specById = new Map(specs.map((s) => [s.sys_id, s]));

const clone = (x) => JSON.parse(JSON.stringify(x));
const str = (v) => (v === true ? 'true' : v === false ? 'false' : v == null ? '' : String(v));
const typeLabel = new Map();
for (const v of [...d.itens.flatMap((i) => i.catalog_variables), ...d.variable_sets.flatMap((s) => s.vs_variables)]) if (v.type_label) typeLabel.set(v.type, v.type_label);

// Template de variável nova, com as mesmas chaves do export.
const VAR_TEMPLATE = Object.fromEntries(Object.keys(d.itens.find((i) => i.catalog_variables.length).catalog_variables[0]).map((k) => [k, '']));
Object.assign(VAR_TEMPLATE, { active: 'true', mandatory: 'false', hidden: 'false', read_only: 'false', include_none: 'false', map_to_field: 'false', lookup_unique: 'false', not_available_conversation: 'false', choice_direction: 'down', sys_class_name: 'item_option_new' });
delete VAR_TEMPLATE.question_choices;

const ITEM_FIELDS = ['active', 'category', 'order', 'sc_catalogs', 'sys_class_name', 'type', 'table_name', 'redirect_url', 'view', 'flow_designer_flow', 'workflow', 'taxonomy_topic', 'script', 'post_insert_script', 'save_script'];
const OVERRIDE_BOOL = new Set(['mandatory', 'hidden', 'read_only', 'include_none', 'not_available_conversation', 'map_to_field']);

function resolveValue(varRec, value) {
  const ch = varRec && varRec.question_choices;
  if (!Array.isArray(ch)) return value;
  if (ch.some((c) => c.value === value)) return value;
  const hit = ch.find((c) => (c.text || '').trim().toLowerCase() === String(value).trim().toLowerCase());
  return hit ? hit.value : value;
}

const avisos = [];
const itensOut = [];
const totais = { conversacional: 0, dividido: 0, analise_humana: 0, sem_spec: 0, novos_itens: 0 };

for (const orig of d.itens) {
  const spec = specById.get(orig.sys_id);
  if (!spec) { totais.sem_spec++; avisos.push(`${orig.name}: sem especificação`); }
  const status = spec ? spec.status : 'analise_humana';
  totais[status]++;

  const base = { sys_id: orig.sys_id, name: orig.name, status, motivo: spec ? spec.motivo || '' : 'Sem especificação gerada.' };

  if (status === 'analise_humana' || !spec) {
    const copia = clone(orig);
    delete copia.conversational;
    delete copia.volume;
    itensOut.push({ ...base, novos_itens: [{ acao_item: 'manter', origem_sys_id: orig.sys_id, ...copia }] });
    totais.novos_itens++;
    continue;
  }

  const dividido = status === 'dividido';
  const varByName = new Map((orig.catalog_variables || []).map((v) => [v.name, v]));
  const origSets = new Map((orig.catalog_variable_sets || []).map((r) => [r.variable_set.__text, r]));
  const setVarByName = new Map([...origSets.keys()].flatMap((id) => (setById.get(id)?.vs_variables || []).map((v) => [v.name, v])));
  // Por sys_id: resolve nomes ambíguos (mesmo nome no item e num set) sem o "último vence" dos mapas por nome.
  const varById = new Map((orig.catalog_variables || []).map((v) => [v.sys_id, v]));
  const setVarById = new Map([...origSets.keys()].flatMap((id) => (setById.get(id)?.vs_variables || []).map((v) => [v.sys_id, v])));
  const policyById = new Map((orig.catalog_ui_policies || []).map((p) => [p.sys_id, p]));
  const csById = new Map((orig.catalog_client_script || []).map((c) => [c.sys_id, c]));

  const novos = spec.novos_itens.map((n) => {
    const localByName = new Map();
    const localById = new Map();
    const item = {
      acao_item: dividido ? 'criar' : 'alterar',
      sys_id: dividido ? '' : orig.sys_id,
      origem_sys_id: orig.sys_id,
      name: n.name,
      short_description: n.short_description || '',
      description: n.description || '',
      frases_exemplo: n.frases_exemplo || [],
    };
    for (const k of ITEM_FIELDS) item[k] = clone(orig[k] ?? '');
    item.make_item_non_conversational = str(n.make_item_non_conversational ?? false);
    item.turn_off_nowassist_conversation = str(n.turn_off_nowassist_conversation ?? false);

    // Variáveis
    const vars = [];
    const pushVar = (rec) => { vars.push(rec); localByName.set(rec.name, rec); if (rec.origem_sys_id) localById.set(rec.origem_sys_id, rec); };
    for (const v of n.variables || []) {
      let rec;
      if (v.name.startsWith('nova_') || !varByName.has(v.name)) {
        if (!v.nova && !v.name.startsWith('nova_')) { avisos.push(`${orig.name} → ${n.name}: variável ${v.name} não existe no original`); continue; }
        const nv = v.nova || {};
        rec = { ...clone(VAR_TEMPLATE), novo: true, name: v.name };
        for (const [k, val] of Object.entries(nv)) if (k !== 'choices') rec[k] = OVERRIDE_BOOL.has(k) ? str(val) : val;
        rec.type = str(nv.type);
        rec.type_label = typeLabel.get(rec.type) || '';
        if (Array.isArray(nv.choices)) rec.question_choices = nv.choices.map((c, i) => ({ text: c.text, value: c.value ?? c.text, order: String((i + 1) * 100), inactive: 'false', sys_id: '' }));
        rec.origem_sys_id = '';
      } else {
        const o = varByName.get(v.name);
        rec = clone(o);
        rec.origem_sys_id = o.sys_id;
        if (dividido) rec.sys_id = '';
      }
      for (const [k, val] of Object.entries(v.overrides || {})) {
        if (k === 'type') { rec.type = str(val); rec.type_label = typeLabel.get(rec.type) || rec.type_label; } else rec[k] = OVERRIDE_BOOL.has(k) ? str(val) : val;
      }
      if (v.conversational_label) rec.conversational_label = v.conversational_label;
      if (v.order != null) rec.order = String(v.order);
      rec.cat_item = { _display_value: n.name, __text: item.sys_id };
      pushVar(rec);
    }
    for (const f of n.variaveis_fixas || []) {
      const o = varByName.get(f.name);
      if (!o) { avisos.push(`${orig.name} → ${n.name}: variável fixa ${f.name} não existe`); continue; }
      const value = resolveValue(o, f.value);
      let rec = localByName.get(f.name);
      if (!rec) { rec = clone(o); rec.origem_sys_id = o.sys_id; if (dividido) rec.sys_id = ''; rec.cat_item = { _display_value: n.name, __text: item.sys_id }; pushVar(rec); }
      Object.assign(rec, { default_value: value, hidden: 'true', read_only: 'true', not_available_conversation: 'true', mandatory: 'false', valor_fixo: true });
    }
    vars.sort((a, b) => +a.order - +b.order);
    item.catalog_variables = vars;

    // Variable sets (referência)
    item.catalog_variable_sets = (n.variable_sets || []).map((r) => {
      const o = origSets.get(r.sys_id);
      return { variable_set: { _display_value: o ? o.variable_set._display_value : r.name, __text: r.sys_id }, order: String(r.order ?? (o && o.order) ?? '') };
    });

    // UI policies
    const recOf = (x) => (/^[0-9a-f]{32}$/.test(x) ? localById.get(x) || setVarById.get(x) || varById.get(x) : localByName.get(x) || setVarByName.get(x) || varByName.get(x));
    const ref = (name) => {
      const rec = recOf(name);
      if (!rec) return '';
      return rec.sys_id ? `IO:${rec.sys_id}` : '';
    };
    item.catalog_ui_policies = (n.ui_policies || []).map((p) => {
      const o = p.origem_sys_id && policyById.get(p.origem_sys_id);
      const base = o ? clone(o) : { active: 'true', applies_catalog: 'true', applies_req_item: 'false', applies_sc_task: 'false', applies_target_record: 'false', applies_to: 'item', isolate_script: 'true', order: '100', sys_class_name: 'catalog_ui_policy', ui_type: '10', va_supported: 'true', variable_set: '' };
      const conds = String(p.conditions || '').replace(/\^?EQ$/, '').split(/(\^OR|\^NQ|\^)/).filter(Boolean);
      const label = [], encoded = [];
      for (const part of conds) {
        const pre = part.match(/^[a-zA-Z0-9_]+/);
        let name = null;
        if (pre && recOf(pre[0].slice(0, 32)) && /^[0-9a-f]{32}/.test(pre[0])) name = pre[0].slice(0, 32);
        if (pre) for (let n = pre[0].length; n > 0 && !name; n--) if (recOf(pre[0].slice(0, n))) name = pre[0].slice(0, n);
        const m = name && part.slice(name.length).match(/^(!=|=|ISNOTEMPTY|ISEMPTY|NOT IN|IN|NOT LIKE|LIKE|STARTSWITH|ENDSWITH|ANYTHING)(.*)$/);
        // Sem variável conhecida (ex.: sys_id de variável ausente numa pendência humana): mantém como no original.
        if (!m) { const raw = /^[0-9a-f]{32}/.test(part) ? `IO:${part}` : part; label.push(raw); encoded.push(raw); continue; }
        let [, op, rawVal] = m;
        // "v_x!=" / "v_x=" sem valor → operadores de vazio do ServiceNow
        if (!rawVal && op === '!=') op = 'ISNOTEMPTY';
        else if (!rawVal && op === '=') op = 'ISEMPTY';
        const val = /IN$/.test(op) ? rawVal.split(',').map((x) => resolveValue(recOf(name), x)).join(',') : rawVal;
        const value = val && !/IN$/.test(op) ? resolveValue(recOf(name), val) : val;
        label.push(`IO:${recOf(name).name}${op}${value}`);
        const io = ref(name);
        encoded.push(`${io || 'IO:' + recOf(name).name}${op}${value}`);
      }
      Object.assign(base, {
        sys_id: dividido || !o ? '' : o.sys_id,
        origem_sys_id: o ? o.sys_id : '',
        short_description: p.short_description || (o && o.short_description) || '',
        on_load: str(p.on_load ?? false),
        catalog_conditions: encoded.join('') + (encoded.length ? '^EQ' : ''),
        catalog_conditions_label: label.join('') + (label.length ? '^EQ' : ''),
        catalog_item: { _display_value: n.name, __text: item.sys_id },
        va_supported: 'true',
      });
      if (p.pendencia_humana) base.pendencia_humana = p.pendencia_humana;
      base.ui_policy_actions = (p.actions || []).map((a, i) => ({ a, rec: recOf(a.variable) })).map(({ a, rec }, i) => ({
        catalog_item: { _display_value: n.name, __text: item.sys_id },
        catalog_variable: ref(a.variable) || `IO:${a.variable}`,
        variable: rec ? rec.name : a.variable,
        visible: str(a.visible ?? 'ignore'), mandatory: str(a.mandatory ?? 'ignore'), disabled: str(a.disabled ?? 'ignore'),
        cleared: str(a.cleared ?? false), value: a.value ?? '', value_action: a.value_action ?? 'ignore',
        order: String((i + 1) * 100), sys_class_name: 'catalog_ui_policy_action', sys_id: '',
        variable_set: rec && setVarById.has(rec.sys_id) ? clone(rec.variable_set) : '',
      }));
      return base;
    });

    item.catalog_client_script = (n.client_scripts_mantidos || []).map((c) => {
      const o = csById.get(c.sys_id);
      if (!o) { avisos.push(`${orig.name} → ${n.name}: client script ${c.sys_id} não existe`); return null; }
      const rec = clone(o);
      rec.origem_sys_id = o.sys_id;
      if (dividido) rec.sys_id = '';
      rec.cat_item = { _display_value: n.name, __text: item.sys_id };
      rec.ajuste_necessario = c.ajuste || '';
      return rec;
    }).filter(Boolean);
    item.conversoes = n.conversoes || [];
    item.catalog_available_for = clone(orig.catalog_available_for || []);
    item.catalog_not_available_for = clone(orig.catalog_not_available_for || []);
    item.flows_relacionados = (orig.triggered_flow_designers || []).map((f) => ({ name: f.name, sys_id: f.sys_id, trigger_condition: f.trigger_condition, ajuste: dividido ? 'Gatilho usa o item original: incluir o sys_id deste novo item na condição.' : '' }));
    return item;
  });

  totais.novos_itens += novos.length;
  itensOut.push({ ...base, variaveis_nao_utilizadas: spec.variaveis_nao_utilizadas || [], novos_itens: novos });
}

const out = {
  metadata: {
    gerado_em: new Date().toISOString(),
    fonte: src.replace(/\\/g, '/'),
    descricao: 'Novo catálogo conversacional (AI First). Cada item original tem novos_itens: 1 (alterado ou mantido) ou N (dividido). Variable sets referenciados por sys_id.',
    totais: { itens_originais: d.itens.length, ...totais },
  },
  itens: itensOut,
};
fs.mkdirSync(path.dirname(outFile), { recursive: true });
fs.writeFileSync(outFile, JSON.stringify(out, null, 2));
console.log(JSON.stringify(out.metadata.totais));
if (avisos.length) console.log(`avisos (${avisos.length}):\n- ` + avisos.join('\n- '));
