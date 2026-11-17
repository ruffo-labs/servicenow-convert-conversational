const test = require('node:test');
const assert = require('node:assert');
const { layoutQueSai } = require('../layout');

const v = (id, type, order) => ({ sys_id: id, type, order: String(order) });
const seq = [v('b0', '12', 1), v('c1', '19', 10), v('a', '6', 11), v('s1', '24', 20), v('b', '6', 21), v('e1', '20', 30), v('b1', '12', 40), v('c2', '19', 50), v('x', '6', 51), v('s2', '24', 60), v('y', '6', 61), v('e2', '20', 70), v('b2', '12', 80), v('z', '6', 90)];

test('tudo fica: nada sai', () => assert.deepStrictEqual([...layoutQueSai(seq, new Set(['a', 'b', 'x', 'y', 'z']))], ['b0']));
test('contêiner com uma coluna vazia sai inteiro', () => {
  const sai = layoutQueSai(seq, new Set(['a', 'b', 'x', 'z']));
  for (const id of ['c2', 's2', 'e2']) assert.ok(sai.has(id), id);
  assert.ok(!sai.has('c1'));
});
test('contêiner vazio sai e pausas coladas colapsam', () => {
  const sai = layoutQueSai(seq, new Set(['a', 'b', 'z']));
  for (const id of ['c2', 's2', 'e2', 'b2']) assert.ok(sai.has(id), id); // b1 e b2 ficariam coladas: sobra a primeira
  assert.ok(!sai.has('b1'));
});
test('pausa no fim ou no início sai', () => {
  const sai = layoutQueSai(seq, new Set(['a', 'b', 'x', 'y']));
  assert.ok(sai.has('b0') && sai.has('b2'));
});
test('sem contêiner nenhum: pausas do começo e do fim saem', () => {
  const sai = layoutQueSai([v('p', '12', 1), v('q', '6', 2), v('r', '12', 3)], new Set(['q']));
  assert.deepStrictEqual([...sai].sort(), ['p', 'r']);
});
