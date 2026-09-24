// Os exemplos da skill precisam passar no validador, ficar fora do piloto e bater com os arquivos em exemplos/.
// Uso: node --test "scripts/test/*.test.js"
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..', '..');
process.chdir(ROOT);
const SKILL = '.claude/skills/regras-catalogo';
const exemplos = fs.readdirSync(path.join(SKILL, 'exemplos')).filter((f) => f.endsWith('.json'));

test('exemplos da skill passam no validador', () => {
  const r = spawnSync('node', ['scripts/validate-spec.js', path.join(SKILL, 'exemplos')], { encoding: 'utf8' });
  assert.strictEqual(r.status, 0, r.stdout);
});

test('blocos JSON do SKILL.md são iguais aos arquivos de exemplo', () => {
  const md = fs.readFileSync(path.join(SKILL, 'SKILL.md'), 'utf8');
  const blocos = [...md.matchAll(/```json\n([\s\S]*?)```/g)].map((m) => m[1]).filter((b) => /"sys_id": "[0-9a-f]{32}"/.test(b)).map((b) => JSON.parse(b));
  assert.strictEqual(blocos.length, exemplos.length);
  for (const b of blocos) assert.deepStrictEqual(b, JSON.parse(fs.readFileSync(path.join(SKILL, 'exemplos', `${b.sys_id}.json`), 'utf8')));
});

test('exemplos da skill não estão no lote piloto e são os do manifest', () => {
  const f = 'work/lotes/manifest.json';
  assert.ok(fs.existsSync(f), 'rode antes: node scripts/build-lotes.js');
  const m = JSON.parse(fs.readFileSync(f, 'utf8'));
  const ids = exemplos.map((e) => e.replace('.json', '')).sort();
  assert.deepStrictEqual(Object.values(m.exemplos_skill).sort(), ids);
  const piloto = new Set(m.lotes.find((l) => l.piloto).itens.map((x) => x.sys_id));
  for (const id of ids) assert.ok(!piloto.has(id), `${id} está no piloto`);
});
