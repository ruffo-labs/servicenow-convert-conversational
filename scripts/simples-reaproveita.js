// Catálogo simples reexportado (sys_ids novos, mesmas ofertas ou quase): reaproveita os textos dos itens divididos da rodada anterior.
// Casa item por NOME e grupo por CONJUNTO DE OFERTAS (nomes). Grupo igual = texto reaproveitado (k novo); grupo novo/alterado = pendente.
// Uso: node scripts/simples-reaproveita.js <plano-novo.json> <plano-antigo.json> <textos-split-antigos> <pasta-saida>
// Saída: <pasta-saida>/chunk-1.json (itens divididos, derivados reaproveitados) e pendentes.json (grupos que precisam de texto novo).
const fs = require('fs');
const path = require('path');

const [, , novoFile, antigoFile, splitDir, out] = process.argv;
const novo = JSON.parse(fs.readFileSync(novoFile, 'utf8'));
const antigo = new Map(JSON.parse(fs.readFileSync(antigoFile, 'utf8')).map((p) => [p.name, p]));
const textosAntigos = new Map(fs.readdirSync(splitDir).filter((f) => /^chunk-\d+\.json$/.test(f))
  .flatMap((f) => JSON.parse(fs.readFileSync(path.join(splitDir, f), 'utf8'))).map((t) => [t.sys_id, t]));
const sig = (g) => [...g.opcoes].sort().join('|');

const itens = [];
const pendentes = [];
let reaproveitados = 0;
for (const n of novo.filter((x) => x.divide)) {
  const o = antigo.get(n.name);
  const t = o && textosAntigos.get(o.sys_id);
  const derivados = [];
  const faltam = [];
  n.grupos.forEach((g, k) => {
    const repetida = n.grupos.filter((x) => sig(x) === sig(g)).length > 1; // mesmos nomes em dois grupos (parents/formulários diferentes): texto novo para distinguir
    const gAntigo = t && !repetida ? o.grupos.findIndex((x) => sig(x) === sig(g)) : -1;
    const d = gAntigo >= 0 && t.derivados.find((x) => x.k === gAntigo);
    if (d) { derivados.push({ ...d, k }); reaproveitados++; } else faltam.push(k);
  });
  itens.push({ sys_id: n.sys_id, motivo: t ? t.motivo : '', derivados, labels: t ? t.labels : {} });
  if (faltam.length) pendentes.push({ sys_id: n.sys_id, name: n.name, grupos_sem_texto: faltam.map((k) => ({ k, ofertas: n.grupos[k].opcoes })) });
}
fs.mkdirSync(out, { recursive: true });
fs.writeFileSync(path.join(out, 'chunk-1.json'), JSON.stringify(itens));
fs.writeFileSync(path.join(out, 'pendentes.json'), JSON.stringify(pendentes, null, 1));
console.log(`${itens.length} itens divididos; derivados reaproveitados: ${reaproveitados}; itens com grupo pendente: ${pendentes.length} (${pendentes.reduce((a, p) => a + p.grupos_sem_texto.length, 0)} grupos)`);
pendentes.forEach((p) => console.log(`  ${p.name}: grupos ${p.grupos_sem_texto.map((g) => g.k).join(',')}`));
