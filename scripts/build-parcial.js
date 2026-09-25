// Gera um novo-catalogo PARCIAL só com os itens de alguns lotes, usando só specs que passam no validador.
// Uso: node scripts/build-parcial.js <NN-NN | NN,NN,...> [--saida output/parcial/novo-catalogo-lotes-NN-NN.json]
//   ex.: node scripts/build-parcial.js 01-06
// Itens com spec inválida ou ausente ficam de fora e são listados em metadata.pendentes_sem_spec_valida.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

process.chdir(path.join(__dirname, '..'));
const args = process.argv.slice(2);
const i = args.indexOf('--saida');
const saidaArg = i >= 0 ? args.splice(i, 2)[1] : null;
const [faixa] = args;
if (!faixa || !/^\d{2}(-\d{2}|(,\d{2})*)$/.test(faixa)) { console.error('uso: node scripts/build-parcial.js <NN-NN | NN,NN,...> [--saida arq.json]'); process.exit(2); }
const lotes = faixa.includes('-')
  ? (([a, b]) => Array.from({ length: b - a + 1 }, (_, k) => String(a + k).padStart(2, '0')))(faixa.split('-').map(Number))
  : faixa.split(',');
const saida = saidaArg || `output/parcial/novo-catalogo-lotes-${lotes[0]}-${lotes[lotes.length - 1]}.json`;
const manifest = JSON.parse(fs.readFileSync('work/lotes/manifest.json', 'utf8'));

// Specs válidas de cada lote: o validador agrupa os erros por arquivo ("<arquivo> (<nome>):" seguido de "  - erro").
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'parcial-'));
const pendentes = [];
const idsLotes = new Set();
for (const nn of lotes) {
  const l = manifest.lotes.find((x) => x.lote === nn);
  if (!l) { console.error(`lote ${nn} não existe no manifest`); process.exit(2); }
  l.itens.forEach((x) => idsLotes.add(x.sys_id));
  const dir = path.join('work', 'specs', `lote-${nn}`);
  const presentes = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith('.json')).map((f) => f.slice(0, -5)) : [];
  const comErro = new Set();
  if (presentes.length) {
    let atual = null;
    for (const linha of spawnSync('node', ['scripts/validate-spec.js', dir], { encoding: 'utf8' }).stdout.split('\n')) {
      const m = linha.match(/([0-9a-f]{32})\.json \(/);
      if (m) atual = m[1];
      else if (linha.startsWith('  - ') && atual) comErro.add(atual);
    }
  }
  fs.mkdirSync(path.join(tmp, `lote-${nn}`));
  for (const x of l.itens) {
    if (!presentes.includes(x.sys_id) || comErro.has(x.sys_id)) { pendentes.push({ sys_id: x.sys_id, name: x.name, lote: nn, motivo: presentes.includes(x.sys_id) ? 'spec com erro no validador' : 'sem spec' }); continue; }
    fs.copyFileSync(path.join(dir, `${x.sys_id}.json`), path.join(tmp, `lote-${nn}`, `${x.sys_id}.json`));
  }
}

const completo = path.join(tmp, 'completo.json');
const r = spawnSync('node', ['scripts/build-novo-catalogo.js', tmp, 'input/catalog-map.json', completo], { encoding: 'utf8' });
if (r.status !== 0) { console.error(r.stdout, r.stderr); process.exit(1); }
const c = JSON.parse(fs.readFileSync(completo, 'utf8'));
const ids = new Set([...idsLotes].filter((id) => !pendentes.some((p) => p.sys_id === id)));
const itens = c.itens.filter((x) => ids.has(x.sys_id));
const totais = { itens: itens.length, novos_itens: itens.reduce((a, x) => a + x.novos_itens.length, 0) };
for (const x of itens) totais[x.status] = (totais[x.status] || 0) + 1;
const out = {
  metadata: { ...c.metadata, descricao: `PARCIAL: lotes ${lotes.join(', ')}, só itens com spec válida. ${c.metadata.descricao}`,
    lotes, pendentes_sem_spec_valida: pendentes, totais },
  itens,
};
fs.mkdirSync(path.dirname(saida), { recursive: true });
fs.writeFileSync(saida, JSON.stringify(out, null, 2));
fs.rmSync(tmp, { recursive: true, force: true });
console.log(`${saida}: ${JSON.stringify(totais)}`);
if (pendentes.length) console.log(`de fora (${pendentes.length}): ${pendentes.map((p) => `${p.name} [lote ${p.lote}, ${p.motivo}]`).join('; ')}`);
