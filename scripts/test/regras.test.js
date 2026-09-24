// Regras adicionadas depois do piloto 1: ocultar dado exige condição real, limite_formato, aviso de de_1a em dividido.
// Uso: node --test "scripts/test/*.test.js"
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const { expand, contexto, carregar, sempreVerdadeira } = require('../expand-spec');

process.chdir(path.join(__dirname, '..', '..'));
const base = carregar();
const run = (spec) => expand(spec, contexto(base.itemById.get(spec.sys_id), base.setById), base.a1.get(spec.sys_id));
const EXCLUSAO = '26f745881b806dd4a530426fe54bcbb2'; // set "Add new contributors" (v_employee_s_full_name...)
const FERIAS = '9869b07c1bbf1114d1abda4ce54bcb13'; // dividir, 2 derivados na 1ª análise

test('sempreVerdadeira', () => {
  for (const c of ['', 'aISEMPTY^ORaISNOTEMPTY', 'aISNOTEMPTY^ORaISEMPTY^EQ', 'a=x^ORa!=x', 'b=1^NQaISEMPTY^ORaISNOTEMPTY'])
    assert.strictEqual(sempreVerdadeira(c), true, c);
  for (const c of ['a=x', 'aISEMPTY', 'aISEMPTY^ORaISNOTEMPTY^b=1', 'a=x^ORa!=y', 'aISEMPTY^ORbISNOTEMPTY'])
    assert.strictEqual(sempreVerdadeira(c), false, c);
});

const ocultaSet = (conditions) => ({
  sys_id: EXCLUSAO, status: 'conversacional', motivo: 'teste',
  policies: { nova_oculta: { short_description: 'teste', conditions, actions: { v_employee_s_full_name: { visible: false } } } },
});

test('ocultar variável de dado com condição sempre verdadeira é erro', () => {
  const r = run(ocultaSet('v_employee_s_full_nameISNOTEMPTY^ORv_employee_s_full_nameISEMPTY'));
  assert.ok(r.erros.some((e) => /nova_oculta: oculta v_employee_s_full_name .*sempre verdadeira/.test(e)), r.erros.join('\n'));
});

test('ocultar variável de dado com condição real não é erro', () => {
  const r = run(ocultaSet('v_datesISEMPTY'));
  assert.ok(!r.erros.some((e) => /sempre verdadeira/.test(e)), r.erros.join('\n'));
});

test('limite_formato é código de divergência', () => {
  const r = run({ ...ocultaSet('v_datesISEMPTY'), divergencias: ['limite_formato'] });
  assert.ok(!r.erros.some((e) => /divergencias/.test(e)), r.erros.join('\n'));
});

test('dividido: texto copiado de derivado da 1ª análise pede de_1a', () => {
  const d = base.a1.get(FERIAS).itens_derivados;
  const spec = { sys_id: FERIAS, status: 'dividido', motivo: 'teste', itens: [{ name: d[1].nome }, { de_1a: 0, name: d[0].nome }] };
  const r = run(spec);
  assert.ok(r.avisos.some((w) => w === 'itens[0].name: igual ao derivado 1 da 1ª análise; use "de_1a": 1 e omita o texto'), r.avisos.join('\n'));
  assert.ok(r.avisos.some((w) => w === 'itens[1].name: igual ao do derivado de_1a=0 da 1ª análise, omita'), r.avisos.join('\n'));
});

// Regras do 2º piloto: opções de variável nova em {text, value}; tirar dado da conversa só se o original já tirava
// ou se a variável tem default_value.
const VAREJO = '4b499a951b84a558a530426fe54bcb84'; // v_country: oculta por policy sem condição ("EY: Hide Country")
const LATAM = 'b2fc94b81b09a5d0d1abda4ce54bcb5e'; // v_opened_by: default_value javascript:gs.getUserID()
const erroOcultar = (r) => r.erros.filter((e) => /só se o original já a tirava da conversa/.test(e));

test('nova.choices exige lista de {text, value}', () => {
  const spec = (choices) => ({ sys_id: EXCLUSAO, status: 'conversacional', motivo: 'teste',
    vars: { nova_tipo: { nova: { type: '5', question_text: 'Qual é o tipo?', order: 10, choices } } } });
  const fmt = (r) => r.erros.filter((e) => /nova\.choices/.test(e));
  assert.strictEqual(fmt(run(spec(['OP [=op]', 'TBS [=tbs]']))).length, 1);
  assert.strictEqual(fmt(run(spec([{ text: 'OP', value: 'op' }, { text: 'TBS', value: 'op' }]))).length, 1, 'value repetido');
  assert.deepStrictEqual(fmt(run(spec([{ text: 'OP', value: 'op' }, { text: 'TBS', value: 'tbs' }]))), []);
});

test('hidden/not_available_conversation em variável de dado: só se o original já tirava ou com default_value', () => {
  const com = (id, nome, props) => run({ sys_id: id, status: 'conversacional', motivo: 'teste', vars: { [nome]: { props } } });
  assert.strictEqual(erroOcultar(com(EXCLUSAO, 'v_company_s', { hidden: true })).length, 1, 'original não esconde');
  assert.strictEqual(erroOcultar(com(EXCLUSAO, 'v_company_s', { not_available_conversation: true })).length, 1, 'nac: mesma regra');
  assert.deepStrictEqual(erroOcultar(com(EXCLUSAO, 'v_company_s', { hidden: true, default_value: 'javascript:gs.getUser().getCompanyID()' })), []);
  assert.deepStrictEqual(erroOcultar(com(VAREJO, 'v_country', { hidden: true })), [], 'policy sem condição já escondia');
  assert.deepStrictEqual(erroOcultar(com(LATAM, 'v_opened_by', { hidden: true })), [], 'default_value no original');
});

// Caso do piloto em medium (Treinamentos Normativos): select_mapping_type (lista, type 5) "substituída" por
// select_which_trainings_should_be_mapped (lookup, type 18), que coleta outro dado. A substituta tem de ser nova_* ou do mesmo tipo.
const TREINAMENTOS = '0d5a7420874f3a10017d65790cbb354e';
test('substituida_por: substituta existente precisa ser do mesmo tipo; nova_* sempre pode', () => {
  const erroSubst = (remover, vars) => run({ sys_id: TREINAMENTOS, status: 'conversacional', motivo: 'teste', remover, vars })
    .erros.filter((e) => /substituida_por/.test(e));
  assert.strictEqual(erroSubst({ select_mapping_type: { substituida_por: 'select_which_trainings_should_be_mapped' } }).length, 1, 'tipo 5 → 18');
  assert.deepStrictEqual(erroSubst({ select_mapping_type: { substituida_por: 'what_is_the_request' } }), [], 'tipo 5 → 5');
  assert.deepStrictEqual(erroSubst({ select_mapping_type: { substituida_por: 'nova_modo' } },
    { nova_modo: { nova: { type: '21', question_text: 'Quais treinamentos?', order: 500 } } }), [], 'nova_*');
});
