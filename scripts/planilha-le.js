// Lê as abas "Organograma - ..." da planilha do cliente e grava as linhas (uma por oferta) em JSON.
// Cada linha da aba tem um par SERVIÇO (colunas C D E) e um par PROBLEMA (G H I): catálogo/categoria, item de catálogo, oferta.
// Uso: node scripts/planilha-le.js <planilha.xlsx> <saida.json>
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const [xlsx, saida] = process.argv.slice(2);
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'xlsx-'));
execFileSync(process.platform === 'win32' ? 'C:/Windows/System32/tar.exe' : 'unzip', process.platform === 'win32' ? ['-xf', xlsx, '-C', tmp] : ['-q', xlsx, '-d', tmp]);
const x = (f) => fs.readFileSync(path.join(tmp, f), 'utf8');
const dec = (s) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
const ss = [...x('xl/sharedStrings.xml').matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => dec([...m[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((t) => t[1]).join('')));
const wb = x('xl/workbook.xml');
const rels = x('xl/_rels/workbook.xml.rels');

function aba(nome) {
  const rid = wb.match(new RegExp(`<sheet name="${nome}"[^>]*r:id="([^"]+)"`))[1];
  const alvo = rels.match(new RegExp(`<Relationship [^>]*Id="${rid}"[^>]*Target="([^"]+)"|<Relationship [^>]*Target="([^"]+)"[^>]*Id="${rid}"`));
  const rows = {};
  for (const m of x(`xl/${(alvo[1] || alvo[2]).replace(/^\//, '').replace(/^xl\//, '')}`).matchAll(/<c r="([A-Z]+)(\d+)"([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
    const v = (m[4] || '').match(/<v>([\s\S]*?)<\/v>/);
    if (v) (rows[m[2]] ??= {})[m[1]] = (/t="s"/.test(m[3]) ? ss[+v[1]] : dec(v[1])).replace(/\s+/g, ' ').trim();
  }
  return rows;
}

const linhas = [];
for (const [nome, chave] of [['Organograma - Autoatendimento', 'autoatendimento'], ['Organograma - Rh Ponta', 'rh_ponta']]) {
  const rows = aba(nome);
  for (const k of Object.keys(rows).map(Number).filter((n) => n >= 10).sort((a, b) => a - b)) {
    const r = rows[k];
    for (const [tipo, c, d, e] of [['servico', 'C', 'D', 'E'], ['problema', 'G', 'H', 'I']]) {
      if (!r[d] && !r[e]) continue;
      // Sem item na coluna D/H (só categoria e oferta): o item tem o nome da categoria.
      linhas.push({ aba: chave, tipo, linha: k, categoria: r[c] || '', item: r[d] || r[c] || '', oferta: r[e] || '', item_vazio: !r[d] || undefined });
    }
  }
}
fs.rmSync(tmp, { recursive: true, force: true });
fs.mkdirSync(path.dirname(saida), { recursive: true });
fs.writeFileSync(saida, JSON.stringify(linhas, null, 1));
const cont = {};
for (const l of linhas) cont[`${l.aba}/${l.tipo}`] = (cont[`${l.aba}/${l.tipo}`] || 0) + 1;
console.log(`${linhas.length} linhas`, JSON.stringify(cont));
