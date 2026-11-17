// Etapa de IA sobre a estrutura da planilha: prepara os lotes de analistas SEM dividir nada além dos destinos já definidos.
// Reaproveita da rodada anterior (AI First por formulário): labels das variáveis e decisões sobre client scripts (semente em textos/),
// e mostra no pacote o texto anterior das ofertas de cada destino (`anterior`) como referência. O analista escreve só os textos dos destinos
// (name, short_description, description, frases) e os labels que faltarem.
// Uso: node scripts/planilha-ia-prepara.js <export.json> <plano.json> <pasta-saida> <plano-anterior.json> <pasta-textos-anteriores>... [--lotes N]
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const args = process.argv.slice(2);
const li = args.indexOf('--lotes');
const N = li >= 0 ? +args.splice(li, 2)[1] : 5;
const [src, planoF, out, antPlanoF, ...antTextos] = args;
const J = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));
const plano = J(planoF).filter((p) => !p.sem_ofertas && !p.sem_ofertas_validas);
const antPlano = new Map(J(antPlanoF).map((p) => [p.sys_id, p]));
const antTexto = (id) => { for (const d of antTextos) { const f = path.join(d, `${id}.json`); if (fs.existsSync(f)) return J(f); } return null; };

const tmp = path.join(out, '_pacotes');
const r = spawnSync(process.execPath, [path.join(__dirname, 'oferta-specs.js'), 'pacote', src, planoF, tmp, ...plano.map((p) => p.sys_id)], { encoding: 'utf8' });
if (r.status) { console.error(r.stderr); process.exit(1); }

const itens = plano.map((p) => {
  const pk = J(path.join(tmp, `${p.sys_id}.json`));
  const ant = antTexto(p.sys_id);
  const ap = antPlano.get(p.sys_id);
  pk.perguntas.forEach((q) => { const l = ant && ant.labels && ant.labels[q.name]; if (l) q.label_atual = l; });
  pk.grupos.forEach((g, i) => {
    const ofs = new Set(p.grupos[i].ofertas);
    g.anterior = ap && ant ? ap.grupos.filter((x) => x.ofertas.some((o) => ofs.has(o))).map((x) => { const dv = (ant.derivados || []).find((y) => y.k === x.k); return dv && { name: dv.name, description: dv.description }; }).filter(Boolean) : [];
  });
  const faltam = pk.perguntas.filter((q) => !q.label_atual).length;
  return { sys_id: p.sys_id, name: p.name, derivados: p.grupos.length, labels_faltando: faltam, W: p.grupos.length * 1500 + faltam * 130, pk, ant };
}).sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));

const meta = itens.reduce((a, i) => a + i.W, 0) / N;
const lotes = [[]];
let acc = 0;
for (const it of itens) { if (lotes[lotes.length - 1].length && acc + it.W / 2 > meta && lotes.length < N) { lotes.push([]); acc = 0; } lotes[lotes.length - 1].push(it); acc += it.W; }

const prompt = (nn, total, dir) => `# Lote ${nn} (de ${total}): textos AI First dos itens do catálogo do Assaí, na estrutura da planilha do cliente
Dir: raiz do repositório. NÃO use a ferramenta Agent; trabalhe sozinho.

## Contexto
Itens de catálogo ServiceNow para o Now Assist / Virtual Agent. O cliente definiu a estrutura: cada "grupo" de um pacote é um ITEM NOVO do catálogo,
com o caminho de categoria dele (Autoatendimento ou Gestor - RH Ponta > Preciso de um serviço de RH ou Preciso reportar um problema > categoria) e as ofertas dele.
NÃO divida nem una grupos: a estrutura (variáveis, policies, ofertas) já está decidida pelo código. Você escreve só textos e labels.
Leia as seções 4 (Variáveis, estilo do label) e 7 (Client scripts) de \`.claude/skills/regras-catalogo/SKILL.md\`.

## Entrada
\`${dir}/lote.json\` lista os itens. Para cada um, leia \`${dir}/pacotes/<sys_id>.json\`: name, descrições originais, grupos [{k, destino (caminho e nome do item na planilha), ofertas,
ofertas_de_outro_item, anterior (textos da rodada AI First anterior das ofertas deste grupo, só referência), condicoes_que_continuam}], perguntas (com \`label_atual\` quando já existe), client_scripts.
O arquivo \`${dir}/textos/<sys_id>.json\` já vem com os labels e as decisões de script da rodada anterior. Edite-o: **não apague labels nem scripts existentes**.

## O que escrever (editando textos/<sys_id>.json)
- **derivados**: um por grupo (mesmo k): {"k":0,"name":"…","short_description":"…","description":"…","frases_exemplo":["…"]}.
  - name = exatamente o nome do item na planilha (\`destino.item\`); se o pacote tiver dois grupos com o mesmo \`destino.item\`, diferencie com o contexto entre parênteses.
  - Como o caminho é serviço ou problema, o texto deve combinar: serviço = pedido/solicitação; problema = reportar divergência, falha ou não recebimento.
  - description: 2-4 frases de negócio dizendo quando usar e citando as ofertas do grupo. short_description: 1 frase. frases_exemplo: 4-5, informais e variadas, no modo de pedir do colaborador ou gestor. Não invente processo.
  - Use \`anterior\` como base quando ele servir; reescreva para o contexto serviço/problema e para as ofertas deste grupo.
- **labels**: só os que faltarem (perguntas sem \`label_atual\`). Estilo da seção 4: pt-BR, pergunta direta com "?", curta, segunda pessoa, sem "selecione/preencha/campo", nunca copie o question_text.
- **motivo**: 1 frase (ex.: "Item da planilha: <caminho>, com N oferta(s)."). **pendencias**: só decisão humana real de negócio, no máximo 3 (lista vazia se não houver).
- **scripts**: mantenha como estão, salvo script ATIVO sem decisão que claramente já é coberto pela estrutura (então {"remover":{"outro":"…"}}). Em dúvida, omita.

## Antes de terminar
Rode \`node scripts/oferta-lotes.js check ${dir}\` e corrija até não faltar nada. Não altere outros arquivos.
Responda só: itens gravados, total de grupos, e pendências (1 linha cada).
`;

fs.mkdirSync(out, { recursive: true });
const manifest = [];
lotes.forEach((its, k) => {
  const nn = String(k + 1).padStart(2, '0');
  const dir = path.join(out, `lote-${nn}`).replace(/\\/g, '/');
  fs.mkdirSync(path.join(dir, 'pacotes'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'textos'), { recursive: true });
  for (const it of its) {
    fs.writeFileSync(path.join(dir, 'pacotes', `${it.sys_id}.json`), JSON.stringify(it.pk, null, 1));
    const a = it.ant || {};
    fs.writeFileSync(path.join(dir, 'textos', `${it.sys_id}.json`), JSON.stringify({ sys_id: it.sys_id, motivo: '', derivados: [], labels: a.labels || {}, scripts: a.scripts || {}, pendencias: [] }, null, 1));
  }
  fs.writeFileSync(path.join(dir, 'lote.json'), JSON.stringify({ lote: nn, itens: its.map(({ sys_id, name, derivados, labels_faltando }) => ({ sys_id, name, derivados, labels_faltando })) }, null, 1));
  fs.writeFileSync(path.join(dir, 'PROMPT.md'), prompt(nn, String(lotes.length).padStart(2, '0'), dir));
  manifest.push({ lote: nn, itens: its.length, grupos: its.reduce((a, i) => a + i.derivados, 0), labels_faltando: its.reduce((a, i) => a + i.labels_faltando, 0) });
});
fs.rmSync(tmp, { recursive: true, force: true });
console.table(manifest);
