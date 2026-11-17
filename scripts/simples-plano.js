// Catálogo simples com `reference_choices` + `used_in_offers`: agrupa as opções (ofertas) de v_o_que_deseja que têm o MESMO
// formulário. 1 grupo = item inteiro (não divide). 2+ grupos = divide, um derivado por grupo.
// Uso: node scripts/simples-plano.js <export.json> <pasta-saida> [N-chunks=3] [textos-antigos-dir chunks-antigos-dir]
// Saída: plano.json (todos os itens) e split-chunks/chunk-N.json (só os itens a dividir, para os analistas escreverem os textos).
const fs = require('fs');
const path = require('path');

const SEM_DADO = new Set(['11', '12', '19', '20', '24', '32', '23']);
const INTENCAO = 'v_o_que_deseja';

// Opções (texto) da variável de intenção, na ordem do formulário.
const opcoesDe = (item) => {
  const o = item.catalog_variables.find((v) => v.name === INTENCAO);
  const ch = (o && (o.question_choices || o.reference_choices)) || [];
  if (ch.length) return ch.filter((c) => c.inactive !== 'true').sort((a, b) => +a.order - +b.order).map((c) => c.text);
  // Formato novo: as ofertas ficam no item (reference_choices[]), com a variável de intenção na lista de variáveis da entrada.
  const rc = entradaOferta(item);
  return rc ? rc.options.map((x) => x.name) : [];
};
const entradaOferta = (item) => (item.reference_choices || []).find((r) => (r.variables || []).some((v) => v.name === INTENCAO));

// Opções citadas nas condições de uma policy (`IO:v_o_que_deseja=A^ORIO:v_o_que_deseja=B`).
const opcoesDaPolicy = (p) => [...String(p.catalog_conditions_label || '').matchAll(/IO:v_o_que_deseja=([^^]*)/g)].map((m) => m[1]);

const dv = (x) => (x && typeof x === 'object' ? x._display_value || '' : x || '');

// Formato novo (ofertas no item): cada REGISTRO de oferta conta, mesmo com nome repetido (identidade = sys_id; nome + parent a distinguem).
// O formulário do registro vem da lista da planilha (custom.variaveis_formulario, por registro); sem lista, cai em used_in_offers (por nome).
function plano(item) {
  const opcoes = opcoesDe(item);
  const rcItem = entradaOferta(item);
  const dados = item.catalog_variables.filter((v) => v.active === 'true' && !SEM_DADO.has(v.type));
  const registros = rcItem
    ? rcItem.options.map((o) => ({ sys_id: o.sys_id, name: o.name, parent: dv(o.parent), lista: (o.custom && o.custom.variaveis_formulario) || [] }))
    : opcoes.map((name) => ({ sys_id: null, name, parent: '', lista: [] }));
  const varsDe = (r) => dados.filter((v) => (r.lista.length ? v.name === INTENCAO || r.lista.includes(v.name) : (v.used_in_offers || opcoes).includes(r.name))).map((v) => v.name);
  const grupos = new Map();
  for (const r of registros) {
    const vars = varsDe(r);
    const k = vars.join(',');
    if (!grupos.has(k)) grupos.set(k, { opcoes: [], registros: [], vars });
    const g = grupos.get(k);
    if (!g.opcoes.includes(r.name)) g.opcoes.push(r.name);
    g.registros.push({ sys_id: r.sys_id, name: r.name, parent: r.parent });
  }
  const lista = [...grupos.values()];
  // Variável que nenhuma oferta lista: não pode sumir (zero perda), fica em todos os grupos.
  const usadas = new Set(lista.flatMap((g) => g.vars));
  const semOferta = dados.filter((v) => !usadas.has(v.name)).map((v) => v.name);
  if (semOferta.length) for (const g of lista) g.vars = dados.filter((v) => g.vars.includes(v.name) || semOferta.includes(v.name)).map((v) => v.name);
  // mandatory que as policies davam por opção (a condição cita o texto da opção): vira prop fixa na variável do grupo.
  const policies = item.catalog_ui_policies.filter((p) => p.active === 'true');
  for (const g of lista) {
    g.mandatory = {};
    for (const p of policies) {
      if (!opcoesDaPolicy(p).some((o) => g.opcoes.includes(o))) continue;
      for (const a of p.ui_policy_actions || []) if (a.mandatory === 'true' && g.vars.includes(a.variable)) g.mandatory[a.variable] = true;
    }
    if (rcItem) g.ofertas = g.registros.map((r) => r.sys_id);
  }
  // Mesmo nome E mesmo parent: não dá para distinguir pelo texto; ficam os dois registros, sinalizados.
  const vistos = new Map();
  for (const r of registros) { const k = r.name + '@' + r.parent; vistos.set(k, (vistos.get(k) || 0) + 1); }
  const iguais = [...vistos].filter(([, n]) => n > 1).map(([k]) => k);
  return { opcoes, registros, grupos: lista, policies: policies.map((p) => p.sys_id), divide: lista.length > 1, variaveis_sem_oferta: semOferta.length ? semOferta : undefined, ofertas_mesmo_nome_e_parent: iguais.length ? iguais : undefined };
}

// Textos da rodada anterior (chunks com sys_id antigo) indexados pelo NOME original do item: o export novo trouxe sys_ids novos.
function textosAntigos(textosDir, chunksDir) {
  const lerChunks = (dir) => fs.readdirSync(dir).filter((f) => /^chunk-\d+\.json$/.test(f)).flatMap((f) => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')));
  const nomePorId = new Map(lerChunks(chunksDir).map((i) => [i.sys_id, i.name]));
  return new Map(lerChunks(textosDir).map((t) => [nomePorId.get(t.sys_id), t]));
}

module.exports = { plano, opcoesDe, entradaOferta, textosAntigos, SEM_DADO, INTENCAO };

if (require.main === module) {
  const [, , src, out, n = 3, dirTextosAntigos, dirChunksAntigos] = process.argv;
  const d = JSON.parse(fs.readFileSync(src, 'utf8'));
  // Labels já escritos na rodada anterior (por nome original do item), para o analista só completar o que falta.
  const antigos = dirTextosAntigos && dirChunksAntigos ? module.exports.textosAntigos(dirTextosAntigos, dirChunksAntigos) : new Map();
  const todos = d.itens.map((i) => ({ sys_id: i.sys_id, name: i.name, ...plano(i) }));
  const dividir = d.itens.filter((i) => todos.find((x) => x.sys_id === i.sys_id).divide);
  const blocos = Array.from({ length: +n }, () => ({ itens: [], peso: 0 }));
  for (const i of dividir.sort((a, b) => b.catalog_variables.length - a.catalog_variables.length)) {
    const p = plano(i);
    const b = blocos.reduce((m, c) => (c.peso < m.peso ? c : m));
    const existentes = (antigos.get(i.name) || {}).labels || {};
    const vars = i.catalog_variables.filter((v) => v.active === 'true' && !SEM_DADO.has(v.type));
    b.itens.push({
      sys_id: i.sys_id, name: i.name, category: i.category._display_value, short_description: i.short_description, description: i.description,
      grupos: p.grupos.map((g, k) => ({ k, opcoes: g.opcoes, ofertas: g.registros.map((r) => (r.parent ? `${r.name} (${r.parent})` : r.name)), variaveis: g.vars })),
      variaveis: vars.filter((v) => !['v_o_que_deseja', 'v_descricao', 'v_anexos'].includes(v.name)).map((v) => ({
        name: v.name, type: v.type_label, question_text: v.question_text, mandatory: v.mandatory === 'true' || undefined,
        label_existente: existentes[v.name], choices: (v.question_choices || v.reference_choices || []).slice(0, 12).map((c) => c.text) })),
    });
    b.peso += i.catalog_variables.length * p.grupos.length;
  }
  fs.mkdirSync(path.join(out, 'split-chunks'), { recursive: true });
  fs.writeFileSync(path.join(out, 'plano.json'), JSON.stringify(todos, null, 1));
  blocos.forEach((b, k) => fs.writeFileSync(path.join(out, 'split-chunks', `chunk-${k + 1}.json`), JSON.stringify(b.itens)));
  console.log(`itens: ${todos.length}, a dividir: ${dividir.length} (${todos.filter((x) => x.divide).reduce((a, x) => a + x.grupos.length, 0)} derivados), mantidos inteiros: ${todos.length - dividir.length}`);
  console.log(blocos.map((b, k) => `split-chunks/chunk-${k + 1}: ${b.itens.length} itens`).join('\n'));
}
