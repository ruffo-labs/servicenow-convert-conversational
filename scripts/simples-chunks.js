// Catálogo simples (poucos scripts/policies): fatia os pacotes em N blocos enxutos para os analistas.
// Tira do pacote o que não serve para escrever texto: sets (analisados à parte), policies, scripts, flags.
// Uso: node scripts/simples-chunks.js <pasta-digests> <pasta-saida> [N=4]
const fs = require('fs');
const path = require('path');

const [, , dig, out, n = 4] = process.argv;
const index = JSON.parse(fs.readFileSync(path.join(dig, 'index.json'), 'utf8')).sort((a, b) => b.bytes_sem_sets - a.bytes_sem_sets);
const blocos = Array.from({ length: +n }, () => ({ itens: [], bytes: 0 }));
for (const x of index) {
  const b = blocos.reduce((m, c) => (c.bytes < m.bytes ? c : m));
  const p = JSON.parse(fs.readFileSync(path.join(dig, 'pacotes', `${x.sys_id}.json`), 'utf8'));
  b.itens.push({
    sys_id: p.sys_id, name: p.name, category: p.category, short_description: p.short_description, description: p.description,
    variaveis: p.variaveis, sets: p.variable_sets.map((s) => s.title),
  });
  b.bytes += x.bytes_sem_sets;
}
fs.mkdirSync(out, { recursive: true });
blocos.forEach((b, i) => fs.writeFileSync(path.join(out, `chunk-${i + 1}.json`), JSON.stringify(b.itens)));
console.log(blocos.map((b, i) => `chunk-${i + 1}: ${b.itens.length} itens, ${b.bytes} bytes`).join('\n'));
