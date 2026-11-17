// Lotes autocontidos para o catálogo com service offerings: cada pasta lote-NN tem tudo que um analista (qualquer máquina) precisa.
// Uso: node scripts/oferta-lotes.js build <export.json> <plano.json> <pasta-lotes> [N-lotes=13] [--excluir <arquivo-com-sys_ids>]
//      node scripts/oferta-lotes.js check <pasta-lotes>/lote-NN     (confere os textos do lote; sai 1 se faltar algo)
//      node scripts/oferta-lotes.js status <pasta-lotes>            (andamento de todos os lotes)
// Saída do analista: <lote>/textos/<sys_id>.json. Para juntar: copie os textos de todos os lotes para uma pasta só e use oferta-specs.js specs.
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { SEM_DADO } = require('./oferta-plano');

const [, , modo, ...resto] = process.argv;
const lerJson = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));
// Custo medido no piloto (tokens por analista): ~50 mil fixos + 1,4 mil por item novo + 0,13 mil por label (+ ~0,3 mil por script, estimado).
const CUSTO = { fixo: 50000, derivado: 1400, label: 130, script: 300 };

function prompt(nn, total) {
  return `# Lote ${nn} (de ${total}): textos dos itens novos do catálogo (Assaí)
Dir: raiz do repositório. NÃO use a ferramenta Agent; trabalhe sozinho.

## Contexto
Itens de catálogo ServiceNow do Assaí para o Now Assist / Virtual Agent. Cada item tem a variável de oferta (\`service_offering\`): cada oferta mostra um formulário.
O código já agrupou as ofertas OPERACIONAIS com o MESMO formulário em "grupos". Cada grupo vira um item conversacional novo (item de 1 grupo continua um só).
O código já decidiu a estrutura: variáveis que saem, obrigatórias, policies, e já retirou as variáveis de ofertas desativadas.
Você escreve só **textos, labels e decisão sobre client scripts**. Leia as seções 4 (Variáveis, estilo do label) e 7 (Client scripts) de
\`.claude/skills/regras-catalogo/SKILL.md\`.

## Entrada
\`work/assai-op/lotes/lote-${nn}/lote.json\` lista os itens. Para cada um, leia \`work/assai-op/lotes/lote-${nn}/pacotes/<sys_id>.json\`:
name, category, descrições, sets (só nomes, não alterar), grupos [{k, ofertas (nome, sla, grupo_suporte), sai_do_formulario, passa_a_obrigatoria,
condicoes_que_continuam}], perguntas (variáveis do item que coletam dado), tecnicas_ocultas, client_scripts.

## Saída
Para cada item grave \`work/assai-op/lotes/lote-${nn}/textos/<sys_id>.json\`:
\`\`\`json
{"sys_id":"…","motivo":"1-2 frases: o que muda de formulário entre as ofertas/grupos",
 "derivados":[{"k":0,"name":"…","short_description":"…","description":"…","frases_exemplo":["…"]}],
 "labels":{"<variavel>":"…"},
 "scripts":{"<sys_id do script>":{"remover":{"outro":"…"}}},
 "pendencias":["…"]}
\`\`\`

## Regras
- **derivados**: um por grupo (mesmo k). name: o que o colaborador pediria, pt-BR, até ~70 caracteres, usando o(s) nome(s) da(s) oferta(s) do grupo; distinto entre os derivados do item.
  description: 2-4 frases de negócio dizendo quando usar e citando as ofertas do grupo. frases_exemplo: 4-5, informais e variadas. Não invente processo.
- **labels**: uma entrada para CADA item de "perguntas". Estilo da seção 4 (pt-BR, pergunta direta com "?", curta, segunda pessoa, sem "selecione/preencha/campo", nunca copie o question_text).
  Se duas variáveis parecem repetidas, diferencie pelo contexto.
- **scripts**: decida só sobre client_scripts ATIVOS (ativo = "true"); script omitido continua igual. Códigos fechados da seção 7:
  {"converter":"props|regex|default|auto_populate"}, {"remover":"sem_efeito"} ou {"remover":{"outro":"texto curto"}}, {"ajustar":["va_supported","remover_dom","ui_type_all"]}.
  - Script que só troca/limpa campo ou label conforme a oferta já é coberto pela estrutura do derivado: remover com {"outro":"…"}.
  - Script que depende de oferta desativada ou fora dos grupos (ex.: compara com sys_id fixo de oferta que não está em nenhum grupo): remover com {"outro":"oferta desativada"}.
  - Script que delega a lógica a um UI Script que não está no pacote: omita, sem pendência.
  - Em dúvida real, omita.
- **pendencias**: só decisão humana real de negócio, no máximo 3 por item (lista vazia se não houver). Não registre variável órfã nem script de oferta desativada.

## Antes de terminar
Rode \`node scripts/oferta-lotes.js check work/assai-op/lotes/lote-${nn}\` e corrija até não faltar nada. Não altere outros arquivos.
Responda só: itens gravados, total de derivados, e pendências (1 linha cada).
`;
}

if (modo === 'build') {
  const args = resto.filter((x) => !x.startsWith('--'));
  const [src, planoFile, out, alvo = '13'] = args;
  const ex = resto.indexOf('--excluir');
  const excluir = new Set(ex >= 0 ? fs.readFileSync(resto[ex + 1], 'utf8').trim().split(/\s+/) : []);
  const d = lerJson(src);
  const itemById = new Map(d.itens.map((i) => [i.sys_id, i]));
  const planos = lerJson(planoFile).filter((p) => !p.sem_ofertas && !p.sem_ofertas_validas && !excluir.has(p.sys_id));
  const itens = planos.map((p) => {
    const it = itemById.get(p.sys_id);
    const L = it.catalog_variables.filter((v) => v.active === 'true' && !SEM_DADO.has(v.type) && v.hidden !== 'true' && !(p.retirar_inativas || []).includes(v.name)).length;
    const S = it.catalog_client_script.filter((c) => c.active === 'true').length;
    return { sys_id: p.sys_id, name: p.name, derivados: p.grupos.length, labels: L, scripts: S, W: p.grupos.length * CUSTO.derivado + L * CUSTO.label + S * CUSTO.script };
  }).sort((a, b) => a.name.localeCompare(b.name, 'pt-BR')); // ordem alfabética: itens da mesma família (ex.: "Manutenção de quadro - X") ficam no mesmo lote
  const total = itens.reduce((a, i) => a + i.W, 0);
  const meta = total / +alvo;
  const lotes = [[]];
  let acc = 0;
  for (const it of itens) {
    const atual = lotes[lotes.length - 1];
    if (atual.length && acc + it.W / 2 > meta && lotes.length < +alvo) { lotes.push([]); acc = 0; } // corta quando passaria da meta
    lotes[lotes.length - 1].push(it);
    acc += it.W;
  }
  fs.mkdirSync(out, { recursive: true });
  const manifest = { gerado_em: new Date().toISOString(), fonte: src, plano: planoFile, custo_modelo: CUSTO, lotes: [] };
  lotes.forEach((its, k) => {
    const nn = String(k + 1).padStart(2, '0');
    const dir = path.join(out, `lote-${nn}`);
    fs.mkdirSync(path.join(dir, 'textos'), { recursive: true });
    const r = spawnSync(process.execPath, [path.join(__dirname, 'oferta-specs.js'), 'pacote', src, planoFile, path.join(dir, 'pacotes'), ...its.map((i) => i.sys_id)], { encoding: 'utf8' });
    if (r.status) { console.error(r.stderr); process.exit(1); }
    const W = its.reduce((a, i) => a + i.W, 0);
    fs.writeFileSync(path.join(dir, 'lote.json'), JSON.stringify({ lote: nn, itens: its }, null, 1));
    fs.writeFileSync(path.join(dir, 'PROMPT.md'), prompt(nn, String(lotes.length).padStart(2, '0')));
    manifest.lotes.push({ lote: nn, n_itens: its.length, derivados: its.reduce((a, i) => a + i.derivados, 0), labels: its.reduce((a, i) => a + i.labels, 0), scripts: its.reduce((a, i) => a + i.scripts, 0), tokens_estimados: Math.round(CUSTO.fixo + W) });
  });
  manifest.totais = { lotes: lotes.length, itens: itens.length, tokens_estimados: manifest.lotes.reduce((a, l) => a + l.tokens_estimados, 0) };
  fs.writeFileSync(path.join(out, 'manifest.json'), JSON.stringify(manifest, null, 1));
  console.table(manifest.lotes);
  console.log(JSON.stringify(manifest.totais));
} else if (modo === 'check' || modo === 'status') {
  const checa = (dir) => {
    const lote = lerJson(path.join(dir, 'lote.json'));
    const falta = [];
    let ok = 0;
    for (const it of lote.itens) {
      const f = path.join(dir, 'textos', `${it.sys_id}.json`);
      const pend = [];
      if (!fs.existsSync(f)) { falta.push(`${it.name}: sem arquivo de texto`); continue; }
      let t;
      try { t = lerJson(f); } catch (e) { falta.push(`${it.name}: JSON inválido`); continue; }
      const pk = lerJson(path.join(dir, 'pacotes', `${it.sys_id}.json`));
      for (const g of pk.grupos) {
        const dv = (t.derivados || []).find((x) => x.k === g.k);
        if (!dv || !dv.name || !dv.short_description || !dv.description || (dv.frases_exemplo || []).length < 3) pend.push(`derivado ${g.k} incompleto`);
      }
      const sem = pk.perguntas.filter((q) => !(t.labels || {})[q.name]).map((q) => q.name);
      if (sem.length) pend.push(`sem label: ${sem.slice(0, 5).join(', ')}${sem.length > 5 ? ` (+${sem.length - 5})` : ''}`);
      const ativos = new Set(pk.client_scripts.filter((c) => c.ativo === 'true' || c.ativo === true).map((c) => c.sys_id));
      for (const [id, v] of Object.entries(t.scripts || {})) {
        if (!ativos.has(id)) pend.push(`script ${id.slice(0, 8)} não é ativo do item`);
        else if (!v || typeof v !== 'object' || Object.keys(v).length !== 1 || !['converter', 'remover', 'ajustar'].includes(Object.keys(v)[0])) pend.push(`script ${id.slice(0, 8)}: decisão inválida`);
      }
      if (pend.length) falta.push(`${it.name}: ${pend.join('; ')}`); else ok++;
    }
    return { total: lote.itens.length, ok, falta };
  };
  if (modo === 'check') {
    const r = checa(resto[0]);
    console.log(`${r.ok}/${r.total} itens completos`);
    if (r.falta.length) { console.log(r.falta.map((x) => `- ${x}`).join('\n')); process.exit(1); }
  } else {
    const dirs = fs.readdirSync(resto[0]).filter((x) => /^lote-\d+$/.test(x)).sort();
    let ok = 0, total = 0;
    for (const x of dirs) { const r = checa(path.join(resto[0], x)); ok += r.ok; total += r.total; console.log(`${x}: ${r.ok}/${r.total}${r.ok === r.total ? ' ✔' : ''}`); }
    console.log(`TOTAL ${ok}/${total}`);
  }
} else {
  console.error('uso: oferta-lotes.js build|check|status ...');
  process.exit(2);
}
