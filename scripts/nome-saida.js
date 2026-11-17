// Nome padrão de toda saída: <nome da entrada>-TOBE-YYYY-MM-DD_HH-mm-ss.json (hora local de geração). Facilita parear AS IS e TO BE.
// Ex.: input/afya-2026-10-22_16-19-33.json → output/afya-2026-10-22_16-19-33-TOBE-2026-10-22_17-05-10.json
// Uso: node scripts/nome-saida.js <arquivo-de-entrada> [pasta=output]   (imprime o caminho; use OUT=$(node scripts/nome-saida.js ...))
const path = require('path');

function nomeSaida(entrada, pasta = 'output', data = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  const ts = `${data.getFullYear()}-${p(data.getMonth() + 1)}-${p(data.getDate())}_${p(data.getHours())}-${p(data.getMinutes())}-${p(data.getSeconds())}`;
  const base = path.basename(entrada).replace(/\.json$/i, '');
  return path.join(pasta, `${base}-TOBE-${ts}.json`).replace(/\\/g, '/');
}

module.exports = { nomeSaida };

if (require.main === module) {
  const [, , entrada, pasta] = process.argv;
  if (!entrada) { console.error('uso: node scripts/nome-saida.js <arquivo-de-entrada> [pasta=output]'); process.exit(2); }
  console.log(nomeSaida(entrada, pasta));
}
