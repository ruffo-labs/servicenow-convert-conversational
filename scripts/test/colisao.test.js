// Teste dos 5 itens com nome de variável repetido entre item e set (bug do "último vence").
// Uso: node --test "scripts/test/*.test.js"
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');
const { expand, contexto, carregar } = require('../expand-spec');

const ROOT = path.join(__dirname, '..', '..');
process.chdir(ROOT);
const base = carregar();
const COLISOES = {
  '26f745881b806dd4a530426fe54bcbb2': ['formatter'],
  '55d956d71b3711d4a530426fe54bcb29': ['container_start', 'formatter'],
  '739a80251bfb5d14a530426fe54bcb2f': ['formatter'],
  '9869b07c1bbf1114d1abda4ce54bcb13': ['formatter'],
  'de3a6bbe1b4fb910a530426fe54bcb8c': ['formatter'],
};
const ITEM = '55d956d71b3711d4a530426fe54bcb29';
const ctxOf = (id) => contexto(base.itemById.get(id), base.setById);
const idDe = (ctx, nome, dono) => (dono === 'item' ? ctx.own.find((v) => v.name === nome) : ctx.setVars.find((x) => x.v.name === nome).v).sys_id;
const run = (spec) => expand(spec, ctxOf(spec.sys_id), base.a1.get(spec.sys_id));

// Spec válida do item com as duas colisões: remove os containers do item pelo sys_id e cria uma policy
// que age sobre o container_start do SET, também pelo sys_id.
function specValida() {
  const ctx = ctxOf(ITEM);
  const pol = (p) => ctx.orig.catalog_ui_policies.find((x) => x.sys_id.startsWith(p)).sys_id;
  return {
    sys_id: ITEM, status: 'conversacional', motivo: 'teste de colisão',
    remover: { [idDe(ctx, 'container_start', 'item')]: 'visual', [idDe(ctx, 'formatter', 'item')]: 'visual' },
    policies: {
      // policy original cita v_download_the_form_below_to_fill_it_out, inativa: reescrita sem ela
      [pol('f57b0c73')]: { actions: { v_what_is_the_date_of_the_medical_examination: { visible: true, mandatory: true }, v_attach_the_proof_of_scheduling_the_expertise: { visible: true, mandatory: true } } },
      nova_container_set: { short_description: 'teste', conditions: 'v_request_type=Pension Supplement', actions: { [idDe(ctx, 'container_start', 'set')]: { visible: false } } },
    },
    scripts: { [ctx.orig.catalog_client_script.find((c) => c.active === 'true').sys_id]: { converter: 'props' } },
  };
}

test('contexto marca exatamente os 5 itens com colisão', () => {
  const achados = {};
  for (const i of base.d.itens) { const c = contexto(i, base.setById); if (c.ambiguos.size) achados[i.sys_id] = [...c.ambiguos].sort(); }
  assert.deepStrictEqual(achados, COLISOES);
});

test('catalog-ai-first.json não cita os nomes em colisão nesses itens (não saiu errado)', () => {
  for (const [id, nomes] of Object.entries(COLISOES)) {
    const txt = JSON.stringify(base.a1.get(id));
    for (const n of nomes) assert.ok(!txt.includes(`"${n}"`), `${id} cita ${n}`);
  }
});

test('pacote traz sys_id só nas variáveis ambíguas', () => {
  const f = path.join('work', 'digests', 'pacotes', `${ITEM}.json`);
  assert.ok(fs.existsSync(f), 'rode antes: node scripts/build-digest.js');
  const p = JSON.parse(fs.readFileSync(f, 'utf8'));
  assert.deepStrictEqual(p.nomes_ambiguos.sort(), ['container_start', 'formatter']);
  const comId = [p, ...p.variable_sets].flatMap((s) => s.variaveis).filter((v) => v.sys_id).map((v) => v.name).sort();
  assert.deepStrictEqual(comId, ['container_start', 'container_start', 'formatter', 'formatter']);
});

test('nome ambíguo citado por nome é erro', () => {
  const s = { ...specValida(), remover: { formatter: 'visual' } };
  assert.ok(run(s).erros.some((e) => /nome ambíguo "formatter"/.test(e)));
});

test('variável de set não pode ser alterada pela spec do item', () => {
  const ctx = ctxOf(ITEM);
  const s = { ...specValida(), vars: { [idDe(ctx, 'formatter', 'set')]: { props: { hidden: true } } } };
  assert.ok(run(s).erros.some((e) => /set é compartilhado/.test(e)));
});

test('validador: spec por sys_id passa; por nome falha', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'spec-'));
  const lote = path.join(dir, 'lote-01');
  fs.mkdirSync(lote);
  fs.writeFileSync(path.join(lote, `${ITEM}.json`), JSON.stringify(specValida()));
  const ok = spawnSync('node', ['scripts/validate-spec.js', lote], { encoding: 'utf8' });
  assert.strictEqual(ok.status, 0, ok.stdout);

  const ruim = specValida();
  ruim.policies.nova_container_set.actions = { container_start: { visible: false } };
  fs.writeFileSync(path.join(lote, `${ITEM}.json`), JSON.stringify(ruim));
  const falha = spawnSync('node', ['scripts/validate-spec.js', lote], { encoding: 'utf8' });
  assert.strictEqual(falha.status, 1);
  assert.match(falha.stdout, /nome ambíguo "container_start"/);
});

test('builder: ação sobre container_start do set aponta para o sys_id do set, não do item', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'spec-'));
  fs.mkdirSync(path.join(dir, 'lote-01'));
  fs.writeFileSync(path.join(dir, 'lote-01', `${ITEM}.json`), JSON.stringify(specValida()));
  const out = path.join(dir, 'novo.json');
  execFileSync('node', ['scripts/build-novo-catalogo.js', dir, 'input/catalog-map.json', out], { encoding: 'utf8' });
  const item = JSON.parse(fs.readFileSync(out, 'utf8')).itens.find((i) => i.sys_id === ITEM).novos_itens[0];
  const ctx = ctxOf(ITEM);
  const pol = item.catalog_ui_policies.find((p) => p.short_description === 'teste');
  const a = pol.ui_policy_actions[0];
  assert.strictEqual(a.catalog_variable, `IO:${idDe(ctx, 'container_start', 'set')}`);
  assert.notStrictEqual(a.catalog_variable, `IO:${idDe(ctx, 'container_start', 'item')}`);
  assert.strictEqual(a.variable, 'container_start');
  assert.ok(a.variable_set && a.variable_set.__text, 'ação deveria marcar o variable set');
  assert.ok(!item.catalog_variables.some((v) => ['formatter', 'container_start'].includes(v.name)), 'containers do item deveriam ter saído');
  assert.ok(!item.catalog_client_script.length, 'script convertido não pode continuar');
});

test('regras de códigos', () => {
  const ctx = ctxOf(ITEM);
  const cs = ctx.orig.catalog_client_script.find((c) => c.active === 'true').sys_id;
  const err = (patch) => run({ ...specValida(), ...patch }).erros.join('\n');
  assert.match(err({ remover: { v_request_type: 'sem_uso_conversa' } }), /sem_uso_conversa só vale/);
  assert.match(err({ remover: { v_request_type: { outro: 'x' } } }), /só sai com substituida_por/);
  assert.match(err({ remover: { v_request_type: { substituida_por: 'nova_inexistente' } } }), /não existe/);
  assert.match(err({ scripts: { [cs]: { remover: 'so_desktop' } } }), /pendente/);
  assert.match(err({ scripts: { [cs]: { remover: { outro: '' } } } }), /exige texto/);
  assert.match(err({ scripts: { [cs]: { converter: 'policy:nova_nao_existe' } } }), /não existe/);
  assert.match(err({ scripts: { [cs]: { remover: { substituido_por: 'nada_disso' } } } }), /substituido_por "nada_disso" não existe/);
  assert.strictEqual(err({ scripts: { [cs]: { remover: { substituido_por: 'nova_container_set' } } } }), '');
  assert.match(err({ status: 'dividido', itens: [{ name: 'a' }, { name: 'b' }] }), /diverge da 1ª análise/);
  const ah = (extra) => run({ sys_id: ITEM, status: 'analise_humana', motivo: 'x', ...extra }).erros.join('\n');
  assert.match(ah({}), /sem "criterio"/);
  assert.match(ah({ criterio: 'nao_existe', divergencias: ['regra_negocio'] }), /fora da lista/);
  assert.match(ah({ criterio: 'formulario_complexo' }), /diverge da 1ª análise/); // 1ª análise: conversacional_com_ajustes
  assert.strictEqual(ah({ criterio: 'formulario_complexo', divergencias: ['regra_negocio'] }), '');
});

test('omissão: nova_* vai para todos os derivados e sai com sem_policies', () => {
  const s = { ...specValida(), status: 'dividido', divergencias: ['divisao_diferente'],
    itens: [{ name: 'A', description: 'a', frases_exemplo: ['a'] }, { name: 'B', description: 'b', frases_exemplo: ['b'], sem_policies: ['nova_container_set'] }] };
  const r = run(s);
  assert.deepStrictEqual(r.erros, []);
  const tem = r.exp.novos_itens.map((n) => n.ui_policies.some((p) => p.chave === 'nova_container_set'));
  assert.deepStrictEqual(tem, [true, false]);
  // variável não mencionada vai para os dois
  assert.ok(r.exp.novos_itens.every((n) => n.variables.some((v) => v.name === 'v_request_type')));
});

test('precedência de texto: spec > 1ª análise > original', () => {
  const a1 = base.a1.get(ITEM);
  const r = run(specValida());
  const n = r.exp.novos_itens[0];
  assert.strictEqual(n.name, a1.nome_sugerido);
  assert.strictEqual(n.variables.find((v) => v.name === 'v_request_type').conversational_label, a1.perguntas.find((p) => p.variavel === 'v_request_type').conversational_label);
  const r2 = run({ ...specValida(), itens: [{ name: 'Outro nome' }], divergencias: ['regra_negocio'] });
  assert.strictEqual(r2.exp.novos_itens[0].name, 'Outro nome');
  const r3 = run({ ...specValida(), itens: [{ name: a1.nome_sugerido }] });
  assert.ok(r3.avisos.some((w) => /igual ao da 1ª análise/.test(w)));
});
