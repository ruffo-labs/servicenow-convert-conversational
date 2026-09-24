// Agrupa os pacotes em lotes para os sub-agentes, sem repetir variable set dentro do lote.
// Uso: node scripts/build-lotes.js [work/digests] [work/lotes] [--teto 100000] [--max-itens 12] [--force]
//
// - Lote = pasta work/lotes/lote-NN/ com lote.json (itens e sets do lote), itens/<sys_id>.json (pacote com os
//   variable_sets só como referência) e sets/<sys_id>.json (cada set uma vez por lote).
// - Arquivos em JSON com quebra de linha onde o trecho passa de 1500 caracteres: a ferramenta Read corta linha
//   acima de 2000 caracteres, e indentação completa custaria +17% de bytes.
// - Teto duplo: bytes dos arquivos do lote (itens + sets únicos) e número de itens (a saída limita mais que a entrada).
// - Agrupamento guloso: o próximo item é o que mais compartilha sets com o lote atual; sem compartilhamento, o maior que cabe.
// - lote-01 = piloto: os 3 casos (pela recomendação da 1ª análise), itens com atencao (motivos diferentes),
//   pendência humana e nome ambíguo. Os exemplos da skill são escolhidos antes e NUNCA entram no piloto.
// - Decisões rápidas: itens que a 1ª análise mandou para substituir_por_link_kb (item_atalho) ou avaliar_desativacao
//   (sem_uso) recebem a spec analise_humana pelo código, em work/specs/decisoes-rapidas/, e saem dos lotes.
//   Lista para validar com o cliente: work/relatorios/decisoes-rapidas.csv.
// - Determinístico: mesma entrada → mesmos lotes. Recusa regerar se já houver spec de lote gravada (use --force).
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const args = process.argv.slice(2);
const flag = (k) => { const i = args.indexOf(k); return i >= 0 ? (args.splice(i, 1), true) : false; };
const opt = (k, def) => { const i = args.indexOf(k); return i >= 0 ? args.splice(i, 2)[1] : def; };
const force = flag('--force');
const TETO = +opt('--teto', 100000);
const MAX_ITENS = +opt('--max-itens', 12);
const [digDir = 'work/digests', outDir = 'work/lotes'] = args;
const workDir = path.dirname(outDir);
const specDir = path.join(workDir, 'specs');
const pilotoDir = path.join(specDir, '_piloto');
const CHARS_POR_TOKEN = 2.4; // medido no piloto do lote-01 (claude -p): JSON com sys_id rende ~2,4 caracteres/token

// Specs de lote (work/specs/lote-*, work/specs/_piloto/*/lote-*) ficam desalinhadas se os lotes mudarem.
const temSpecDeLote = (dir, prof) => fs.existsSync(dir) && fs.readdirSync(dir).some((d) => {
  const p = path.join(dir, d);
  if (!fs.statSync(p).isDirectory()) return false;
  return prof ? temSpecDeLote(p, prof - 1) : /^lote-d+$/.test(d) && fs.readdirSync(p).length > 0;
});
if (!force && (temSpecDeLote(specDir, 0) || temSpecDeLote(pilotoDir, 1))) {
  console.error('já há specs de lote gravadas (work/specs/lote-* ou work/specs/_piloto/*/lote-*): regerar os lotes desalinha lote-NN. Use --force se for isso mesmo.');
  process.exit(1);
}

const index = JSON.parse(fs.readFileSync(path.join(digDir, 'index.json'), 'utf8'));
const fontes = JSON.parse(fs.readFileSync(path.join(digDir, 'fontes.json'), 'utf8'));
const pacote = (id) => JSON.parse(fs.readFileSync(path.join(digDir, 'pacotes', `${id}.json`), 'utf8'));
const CASO = { conversacional: 'conversacional', conversacional_com_ajustes: 'conversacional', dividir: 'dividido', manter_formulario: 'analise_humana', avaliar_desativacao: 'analise_humana', substituir_por_link_kb: 'analise_humana' };
// JSON válido, compacto até 1500 caracteres por trecho; acima disso, um elemento/campo por linha.
function fmt(v) {
  const c = JSON.stringify(v);
  if (c === undefined || c.length <= 1500 || v === null || typeof v !== 'object') return c;
  if (Array.isArray(v)) return `[\n${v.map(fmt).join(',\n')}\n]`;
  return `{\n${Object.entries(v).filter(([, x]) => x !== undefined).map(([k, x]) => `${JSON.stringify(k)}:${fmt(x)}`).join(',\n')}\n}`;
}
const slimDe = (p) => ({ ...p, variable_sets: p.variable_sets.map((s) => ({ sys_id: s.sys_id, title: s.title, order: s.order })) });
const DECISAO_RAPIDA = { substituir_por_link_kb: 'item_atalho', avaliar_desativacao: 'sem_uso' };
const hash = (s) => crypto.createHash('sha1').update(s).digest('hex'); // ordem estável e sem viés de tamanho

const itens = index.map((x) => {
  const p = pacote(x.sys_id);
  const motivosAtencao = [...new Set((p.atencao || []).map((m) => (/custom/.test(m) ? 'custom' : /dinâm/.test(m) ? 'dinamicas' : /sets$/.test(m) ? 'sets' : /choices/.test(m) ? 'choices' : 'outro')))];
  // Bytes UTF-8 exatos dos arquivos gravados: item com os sets só como referência + cada set uma vez por lote.
  const slim = Buffer.byteLength(fmt(slimDe(p)));
  const setsB = Object.fromEntries(p.variable_sets.map((s) => [s.sys_id, Buffer.byteLength(fmt(s))]));
  return { ...x, slim, setsB, caso: CASO[x.recomendacao] || 'conversacional', motivosAtencao, ambiguo: !!p.nomes_ambiguos, h: hash(x.sys_id) };
}).sort((a, b) => a.h.localeCompare(b.h));

// Decisões rápidas: spec pelo código + CSV; o item não vai para lote.
const analise = new Map(JSON.parse(fs.readFileSync(fontes.primeira_analise.arquivo, 'utf8')).itens.map((a) => [a.sys_id, a]));
const rapidas = itens.filter((x) => DECISAO_RAPIDA[x.recomendacao]);
const rapidasDir = path.join(specDir, 'decisoes-rapidas');
fs.rmSync(rapidasDir, { recursive: true, force: true });
fs.mkdirSync(rapidasDir, { recursive: true });
const csv = (rows) => '﻿' + rows.map((r) => r.map((c) => (/[",;\n]/.test(String(c ?? '')) ? `"${String(c).replace(/"/g, '""')}"` : String(c ?? ''))).join(';')).join('\r\n');
const linhasRapidas = [['sys_id', 'item', 'criterio', 'recomendacao_1a', 'justificativa_1a', 'volume_12m']];
for (const x of rapidas) {
  const criterio = DECISAO_RAPIDA[x.recomendacao];
  fs.writeFileSync(path.join(rapidasDir, `${x.sys_id}.json`), JSON.stringify({
    sys_id: x.sys_id, status: 'analise_humana', criterio, origem: 'decisao_rapida',
    motivo: `Atribuído pelo código: a 1ª análise recomendou ${x.recomendacao}. Validar com o cliente.`,
  }, null, 1));
  linhasRapidas.push([x.sys_id, x.name, criterio, x.recomendacao, (analise.get(x.sys_id) || {}).justificativa || '', x.last_12m]);
}
fs.mkdirSync(path.join(workDir, 'relatorios'), { recursive: true });
fs.writeFileSync(path.join(workDir, 'relatorios', 'decisoes-rapidas.csv'), csv(linhasRapidas));
const nosLotes = itens.filter((x) => !DECISAO_RAPIDA[x.recomendacao]);
const custoLote = (grupo) => {
  const sets = new Map();
  let b = 0;
  for (const x of grupo) { b += x.slim; for (const [k, v] of Object.entries(x.setsB)) sets.set(k, v); }
  return b + [...sets.values()].reduce((a, v) => a + v, 0);
};
const cabe = (grupo, x) => grupo.length < MAX_ITENS && custoLote([...grupo, x]) <= TETO;

// Exemplos da skill: por caso, o menor item "limpo" (sem atenção, pendência ou nome ambíguo).
const exemplos = {};
for (const caso of ['conversacional', 'dividido', 'analise_humana']) {
  const c = nosLotes.filter((x) => x.caso === caso && !x.atencao && !x.pendencias_humanas && !x.ambiguo).sort((a, b) => a.bytes - b.bytes)[0];
  if (c) exemplos[caso] = c.sys_id;
}
const ehExemplo = new Set(Object.values(exemplos));

// Piloto: requisitos primeiro (o menor item que atende, pulando os já cobertos), depois cotas por caso com itens
// de tamanho típico (mais perto da mediana), para caber no teto sem virar um piloto só de itens fáceis.
const medianaBytes = [...nosLotes].sort((a, b) => a.bytes - b.bytes)[nosLotes.length >> 1].bytes;
const candidatos = nosLotes.filter((x) => !ehExemplo.has(x.sys_id));
const tipicos = [...candidatos].sort((a, b) => Math.abs(a.bytes - medianaBytes) - Math.abs(b.bytes - medianaBytes) || a.h.localeCompare(b.h));
const menores = [...candidatos].sort((a, b) => a.bytes - b.bytes || a.h.localeCompare(b.h));
const piloto = [];
const pegarDe = (lista, pred) => { const x = lista.find((c) => !piloto.includes(c) && pred(c) && cabe(piloto, c)); if (x) piloto.push(x); return !!x; };
const pegar = (pred) => pegarDe(tipicos, pred);
const COTA = { dividido: 3, analise_humana: 2, conversacional: MAX_ITENS };
const cota = (caso) => { while (piloto.filter((x) => x.caso === caso).length < COTA[caso] && pegar((x) => x.caso === caso)); };
const requisitos = [
  ['pendência humana', (x) => x.pendencias_humanas > 0],
  ['nome ambíguo', (x) => x.ambiguo],
  ['atenção: opções dinâmicas', (x) => x.motivosAtencao.includes('dinamicas')],
  ['atenção: custom/widget', (x) => x.motivosAtencao.includes('custom')],
  ['atenção: 5+ sets ou 40+ choices', (x) => x.motivosAtencao.includes('sets') || x.motivosAtencao.includes('choices')],
];
const faltouReq = requisitos.filter(([, pred]) => !piloto.some(pred) && !pegarDe(menores, pred)).map(([nome]) => nome);
cota('dividido');
cota('analise_humana');
cota('conversacional');
while (piloto.length < MAX_ITENS && pegar(() => true));

// Demais lotes: guloso por set compartilhado.
const resto = nosLotes.filter((x) => !piloto.includes(x));
const lotes = [piloto];
while (resto.length) {
  const g = [];
  for (;;) {
    const setsNoLote = new Set(g.flatMap((x) => Object.keys(x.sets)));
    let melhor = null;
    let melhorScore = -1;
    for (const x of resto) {
      if (!cabe(g, x)) continue;
      const comum = Object.entries(x.sets).filter(([k]) => setsNoLote.has(k)).reduce((a, [, v]) => a + v, 0);
      const score = comum * 10 + x.bytes; // compartilhar set vale mais; sem compartilhamento, o maior primeiro
      if (score > melhorScore) { melhor = x; melhorScore = score; }
    }
    if (!melhor) break;
    g.push(melhor);
    resto.splice(resto.indexOf(melhor), 1);
  }
  if (!g.length) { console.error(`item ${resto[0].sys_id} não cabe sozinho no teto (${resto[0].bytes} bytes)`); process.exit(1); }
  lotes.push(g);
}

// Grava.
fs.rmSync(outDir, { recursive: true, force: true });
fs.mkdirSync(outDir, { recursive: true });
const nn = (k) => String(k + 1).padStart(2, '0');
const resumo = lotes.map((g, k) => {
  const dir = path.join(outDir, `lote-${nn(k)}`);
  fs.mkdirSync(path.join(dir, 'itens'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'sets'), { recursive: true });
  const sets = {};
  let bytes = 0;
  let chars = 0;
  const grava = (arq, txt) => { fs.writeFileSync(path.join(dir, arq), txt); bytes += Buffer.byteLength(txt); chars += txt.length; };
  for (const x of g) {
    const p = pacote(x.sys_id);
    for (const s of p.variable_sets) sets[s.sys_id] = s;
    grava(path.join('itens', `${x.sys_id}.json`), fmt(slimDe(p)));
  }
  for (const [id, s] of Object.entries(sets)) grava(path.join('sets', `${id}.json`), fmt(s));
  // lote.json: o roteiro do sub-agente (fora da conta do teto, é pequeno)
  fs.writeFileSync(path.join(dir, 'lote.json'), JSON.stringify({
    lote: nn(k), itens: g.map((x) => ({ sys_id: x.sys_id, name: x.name, sets: Object.keys(x.sets) })), sets: Object.fromEntries(Object.entries(sets).map(([id, s]) => [id, s.title])),
  }, null, 1));
  const casos = {};
  g.forEach((x) => { casos[x.caso] = (casos[x.caso] || 0) + 1; });
  return {
    lote: nn(k), piloto: k === 0, pasta: `lote-${nn(k)}`, n_itens: g.length, bytes,
    tokens_estimados: Math.round(chars / CHARS_POR_TOKEN), sets_unicos: Object.keys(sets).length,
    bytes_sem_dedupe: g.reduce((a, x) => a + x.bytes, 0), casos,
    itens: g.map((x) => ({ sys_id: x.sys_id, name: x.name, caso: x.caso, atencao: x.motivosAtencao, pendencias_humanas: x.pendencias_humanas || undefined, ambiguo: x.ambiguo || undefined })),
  };
});
const manifest = {
  gerado_em: new Date().toISOString(),
  parametros: { teto_bytes: TETO, max_itens: MAX_ITENS, chars_por_token_estimado: CHARS_POR_TOKEN },
  fontes,
  piloto: '01', piloto_requisitos_nao_atendidos: faltouReq,
  exemplos_skill: exemplos,
  totais: {
    lotes: resumo.length, itens: nosLotes.length, decisoes_rapidas: rapidas.length, bytes: resumo.reduce((a, l) => a + l.bytes, 0), bytes_sem_dedupe: resumo.reduce((a, l) => a + l.bytes_sem_dedupe, 0),
    tokens_estimados: resumo.reduce((a, l) => a + l.tokens_estimados, 0),
  },
  lotes: resumo,
};
fs.writeFileSync(path.join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 1));

const bs = resumo.map((l) => l.bytes).sort((a, b) => a - b);
console.log(`decisões rápidas: ${rapidas.length} (fora dos lotes), lotes: ${resumo.length}, itens: ${nosLotes.length}, bytes: ${manifest.totais.bytes} (sem dedupe ${manifest.totais.bytes_sem_dedupe}), por lote: min ${bs[0]} / mediana ${bs[bs.length >> 1]} / max ${bs[bs.length - 1]}, tokens estimados: ${manifest.totais.tokens_estimados}`);
console.log(`piloto: ${resumo[0].n_itens} itens, ${resumo[0].bytes} bytes, casos ${JSON.stringify(resumo[0].casos)}${faltouReq.length ? `, requisitos não atendidos: ${faltouReq.join(', ')}` : ''}`);
console.log(`exemplos da skill (fora do piloto): ${JSON.stringify(exemplos)}`);
