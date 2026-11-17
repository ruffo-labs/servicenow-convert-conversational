// Casa cada linha da planilha (aba, tipo, categoria, item, oferta) com a oferta real do export (e portanto com o item de origem).
// Chave: nome da oferta + nome do item (o par). O nome do item na planilha pode ter perdido o sufixo "(Autoatendimento)" / "(Gestor/RH Ponta)":
// a aba desempata (Autoatendimento → item Autoatendimento; RH Ponta → item Gestor/RH Ponta). Grafia diferente é tolerada por similaridade.
// decisoes.json: { ignorar_oferta: [nome...], fixar_item: { "<oferta>": "<sys_id do item de origem>" } }
// Uso: node scripts/planilha-mapa.js <export.json> <linhas.json> <decisoes.json> <saida-mapa.json>
const fs = require('fs');
const [src, linhasF, decF, saida] = process.argv.slice(2);
const d = JSON.parse(fs.readFileSync(src, 'utf8'));
const linhas = JSON.parse(fs.readFileSync(linhasF, 'utf8'));
const dec = JSON.parse(fs.readFileSync(decF, 'utf8'));

const n = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[ªº]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
const semSufixo = (s) => n(s).replace(/ (autoatendimento|gestor rh ponta)$/, '');
const tok = (s) => new Set(n(s).split(' ').filter((w) => w.length > 1));
const jac = (a, b) => { const A = tok(a), B = tok(b); let i = 0; for (const x of A) if (B.has(x)) i++; return i / (A.size + B.size - i || 1); };
// A oferta do export às vezes ganha " - <Item>" no fim: o nome exato (com ou sem esse rabo) vale 1; semelhante, no máximo 0,94.
const simOferta = (planilha, json) => {
  const sem = json.split(' - ')[0];
  if (n(planilha) === n(json) || n(planilha) === n(sem)) return 1;
  return Math.min(0.94, Math.max(jac(planilha, json), jac(planilha, sem), n(json).startsWith(n(planilha)) || n(planilha).startsWith(n(json)) ? 0.9 : 0));
};

const ofertas = [];
for (const i of d.itens) for (const o of (i.reference_choices || [])[0]?.options || []) ofertas.push({ o, item: i });
const ignorar = new Set(dec.ignorar_oferta.map(n));
const fixar = new Map(Object.entries(dec.fixar_item).map(([k, v]) => [n(k), v]));
const sufixoAba = { autoatendimento: 'autoatendimento', rh_ponta: 'gestor rh ponta' };

const mapa = linhas.map((l) => {
  if (ignorar.has(n(l.oferta))) return { ...l, status: 'ignorada', motivo: 'decisão do cliente: não fazer nada' };
  const fix = fixar.get(n(l.oferta));
  const pontua = (x) => {
    const so = simOferta(l.oferta, x.o.name);
    const nomeItem = n(x.item.name);
    let si = Math.max(jac(semSufixo(l.item), semSufixo(x.item.name)), jac(l.item, x.o.parent?._display_value || ''));
    if (nomeItem.endsWith(sufixoAba[l.aba])) si = Math.min(1, si + 0.1);
    else if (/ (autoatendimento|gestor rh ponta)$/.test(nomeItem)) si -= 0.3;
    return { x, so, si, total: so * 0.6 + si * 0.4 };
  };
  const todas = ofertas.filter((x) => !fix || x.item.sys_id === fix).map(pontua);
  // 1º o item (nome da planilha = nome do item no export); só se nenhum item casar, procura a oferta em qualquer item.
  const doItem = todas.filter((c) => c.si >= 0.85);
  const cands = (doItem.length ? doItem : todas).sort((a, b) => b.so - a.so || b.si - a.si);
  const b = cands[0];
  const iguais = cands.filter((c) => c.so >= b.so - 1e-9 && c.si >= b.si - 1e-9);
  // Mesmo nome de oferta repetido no MESMO item: são registros distintos, entram todos (menos o desativado quando há um operacional).
  const mesmoItem = iguais.every((c) => c.x.item.sys_id === b.x.item.sys_id && n(c.x.o.name) === n(b.x.o.name));
  const vivos = iguais.filter((c) => c.x.o.operational_status === '1');
  const escolhidos = mesmoItem ? (vivos.length ? vivos : iguais) : [b];
  const base = { ...l, oferta_ids: escolhidos.map((c) => c.x.o.sys_id), oferta_json: b.x.o.name, item_origem_id: b.x.item.sys_id, item_origem: b.x.item.name, sim_oferta: +b.so.toFixed(2), sim_item: +b.si.toFixed(2) };
  if (escolhidos.length > 1) base.motivo = `${escolhidos.length} ofertas com o mesmo nome no item de origem`;
  if (fix) return { ...base, status: 'ok', motivo: 'item indicado pelo cliente' };
  if (!mesmoItem) return { ...base, status: 'revisar', motivo: `${iguais.length} candidatos empatados em itens diferentes: ${iguais.map((c) => c.x.item.name).join(' / ')}` };
  if (b.so >= 0.95 && b.si >= 0.85) return { ...base, status: 'ok' };
  if (b.so >= 0.95) return { ...base, status: 'ok', motivo: 'casou pela oferta; nome do item diferente' };
  if (b.so >= 0.5 && b.si >= 0.5) return { ...base, status: 'revisar', motivo: 'nome da oferta diferente' };
  return { ...base, status: 'sem_oferta' };
});
fs.writeFileSync(saida, JSON.stringify(mapa, null, 1));
const c = {};
for (const m of mapa) c[m.status] = (c[m.status] || 0) + 1;
console.log(JSON.stringify(c));
