// Devolve mandatory/hidden/read_only das variáveis dos itens novos ao valor do arquivo de entrada e passa o que mudou para uma UI policy onLoad
// (sem condição) por item novo: as regras ficam só nas UI policies. Variável fixa por valor (valor_fixo) fica como está.
// Uso: node scripts/atributos-em-policy.js <entrada.json> <saida.json>
const fs = require('fs');
const [src, saida] = process.argv.slice(2);
const d = JSON.parse(fs.readFileSync(src, 'utf8'));
const o = JSON.parse(fs.readFileSync(saida, 'utf8'));
const orig = new Map(d.itens.flatMap((i) => i.catalog_variables || []).map((v) => [v.sys_id, v]));
const CAMPOS = [['mandatory', 'mandatory', 'true', 'true'], ['hidden', 'visible', 'false', 'true'], ['read_only', 'disabled', 'true', 'true']];
let vars = 0, itens = 0;
for (const n of o.itens.flatMap((i) => i.novos_itens)) {
  const acoes = new Map();
  for (const v of n.catalog_variables || []) {
    const ov = orig.get(v.origem_sys_id || v.sys_id);
    if (!ov || v.valor_fixo) continue;
    for (const [campo, acao, valorAcao, valor] of CAMPOS) {
      if (v[campo] === ov[campo]) continue;
      if (v[campo] === valor) acoes.set(v.name, { ...(acoes.get(v.name) || {}), [acao]: valorAcao });
      else console.log(`aviso: ${n.name}/${v.name}.${campo} ${ov[campo]} → ${v[campo]} (sentido contrário), só restaurado`);
      v[campo] = ov[campo];
    }
  }
  if (!acoes.size) continue;
  const ref = { _display_value: n.name, __text: n.sys_id || '' };
  const base = n.catalog_ui_policies[0] || {};
  n.catalog_ui_policies.push({
    active: 'true', applies_catalog: 'true', applies_req_item: 'false', applies_sc_task: 'false', applies_target_record: 'false', applies_to: 'item', isolate_script: 'true',
    order: '100', sys_class_name: 'catalog_ui_policy', ui_type: base.ui_type || '10', va_supported: 'true', variable_set: '', sys_id: '', origem_sys_id: '',
    short_description: 'Atributos dos campos (obrigatório, oculto, somente leitura)', on_load: 'true', catalog_conditions: '', catalog_conditions_label: '', catalog_item: ref,
    ui_policy_actions: [...acoes].map(([nome, a], k) => ({
      catalog_item: ref, catalog_variable: `IO:${n.catalog_variables.find((v) => v.name === nome).sys_id}`, variable: nome,
      visible: a.visible || 'ignore', mandatory: a.mandatory || 'ignore', disabled: a.disabled || 'ignore', cleared: 'false', value: '', value_action: 'ignore',
      order: String((k + 1) * 100), sys_class_name: 'catalog_ui_policy_action', sys_id: '', variable_set: '',
    })),
  });
  vars += acoes.size; itens++;
}
fs.writeFileSync(saida, JSON.stringify(o, null, 2));
console.log(`${vars} variáveis restauradas em ${itens} itens novos; regras na UI policy "Atributos dos campos".`);
