// Ajusta nos itens novos: sys_class_name vazio e table_name = tabela do cliente conforme o item (mapa em work/tabelas-itens.json).
// Uso: node scripts/tabela-itens.js <saida.json> [mapa.json]
const fs = require('fs');
const [f, mf = 'work/tabelas-itens.json'] = process.argv.slice(2);
const mapa = JSON.parse(fs.readFileSync(mf, 'utf8'));
const norm = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const porNome = new Map();
for (const [tabela, nomes] of Object.entries(mapa.tabelas)) for (const n of nomes) porNome.set(norm(n), tabela);
for (const [n, t] of Object.entries(mapa.alias || {})) porNome.set(norm(n), t);
const o = JSON.parse(fs.readFileSync(f, 'utf8'));
const sem = [];
for (const n of o.itens.flatMap((i) => i.novos_itens)) {
  n.sys_class_name = '';
  const t = porNome.get(norm(n.name));
  if (t) n.table_name = t; else sem.push(n.name);
}
fs.writeFileSync(f, JSON.stringify(o, null, 2));
console.log(`${o.itens.flatMap((i) => i.novos_itens).length - sem.length} itens com tabela; sem tabela (${sem.length}): ${sem.join(' | ')}`);
