// Catálogo simples: finaliza o novo-catalogo.json.
// - Ofertas (service offerings) no item (`reference_choices[]`, formato novo): cada item novo recebe as ofertas do grupo dele com o registro
//   COMPLETO, inclusive `custom` (colunas da planilha: aprovações, OLA, horário, variaveis_formulario...), amarrado para exportação.
//   Grupo de uma oferta só → `oferta_fixa` (e a variável de intenção fixada com o sys_id da oferta). Outras entradas (ex.: lista de módulos)
//   ficam inteiras, desde que a variável delas exista no item novo.
// - Formato antigo (`reference_choices` dentro da variável): filtra pelo grupo, como antes.
// - `icon` não é usado: sai de todos os itens. Item desmembrado ganha categoria nova (ver categorias.js).
// - Grava cliente, fonte e a recomendação do variable set compartilhado (a spec dos itens não altera set).
// Uso: node scripts/simples-finaliza.js <export.json> <novo-catalogo.json> <cliente> [set-recomendacoes.json]
const fs = require('fs');
const { plano, INTENCAO } = require('./simples-plano');
const { aplicaCategorias } = require('./categorias');

const [, , src, saida, cliente, setsFile] = process.argv;
const d = JSON.parse(fs.readFileSync(src, 'utf8'));
const o = JSON.parse(fs.readFileSync(saida, 'utf8'));
const itens = new Map(d.itens.map((i) => [i.sys_id, i]));

let comOfertas = 0;
let filtradas = 0;
for (const it of o.itens) {
  const orig = itens.get(it.sys_id);
  it.novos_itens.forEach((n) => { delete n.icon; });
  if (it.status === 'analise_humana') continue;
  const grupos = plano(orig).grupos;
  it.novos_itens.forEach((n, k) => {
    const g = grupos[k];
    const rcs = orig.reference_choices || [];
    if (rcs.length) {
      n.reference_choices = rcs
        .map((r) => {
          const intencao = (r.variables || []).some((v) => v.name === INTENCAO);
          const options = intencao ? r.options.filter((x) => g.ofertas.includes(x.sys_id)) : r.options;
          return { ...r, options, total: options.length };
        })
        .filter((r) => (r.variables || []).some((v) => n.catalog_variables.some((x) => x.name === v.name)));
      n.oferta_fixa = g.ofertas.length === 1 ? g.ofertas[0] : null;
      const v = n.catalog_variables.find((x) => x.name === INTENCAO);
      if (v && v.valor_fixo && n.oferta_fixa) v.default_value = n.oferta_fixa; // referência: o valor é o sys_id da oferta, não o texto
      comOfertas++;
    } else if (it.status === 'dividido') {
      const v = n.catalog_variables.find((x) => x.name === INTENCAO);
      if (v && v.reference_choices) { v.reference_choices = v.reference_choices.filter((c) => g.opcoes.includes(c.text)); filtradas++; }
    }
  });
}
// Cobertura das ofertas: cada REGISTRO de oferta de serviço (sys_id; nome + parent) do original aparece em exatamente um item novo. Nenhuma oferta
// é criada por este processo; se um dia for preciso criar, entra em ofertas_novas com support_group e sla copiados da oferta de origem.
const cobertura = { entrada: 0, saida: 0, faltando: [], repetidas: [] };
for (const it of o.itens) {
  const orig = itens.get(it.sys_id);
  const rc = (orig.reference_choices || []).find((r) => r.reference_table === 'service_offering');
  if (!rc) continue;
  const esperado = rc.options.map((x) => x.sys_id);
  cobertura.entrada += esperado.length;
  const vistos = new Map();
  for (const n of it.novos_itens) for (const r of n.reference_choices || []) if (r.reference_table === 'service_offering') for (const x of r.options) vistos.set(x.sys_id, (vistos.get(x.sys_id) || 0) + 1);
  if (it.status === 'analise_humana') { cobertura.saida += esperado.length; continue; } // cópia do original, ofertas intactas
  for (const id of esperado) {
    if (!vistos.has(id)) cobertura.faltando.push(`${orig.name}: ${rc.options.find((x) => x.sys_id === id).name}`);
    else if (vistos.get(id) > 1) cobertura.repetidas.push(`${orig.name}: ${rc.options.find((x) => x.sys_id === id).name}`);
  }
  cobertura.saida += vistos.size;
  const iguais = plano(orig).ofertas_mesmo_nome_e_parent;
  if (iguais) it.ofertas_mesmo_nome_e_parent = iguais; // dois registros sem como distinguir por nome/parent: conferir com o cliente
}
if (cobertura.faltando.length || cobertura.repetidas.length) {
  console.error(`COBERTURA DAS OFERTAS COM PROBLEMA: faltando ${cobertura.faltando.length}, repetidas ${cobertura.repetidas.length}`);
  [...cobertura.faltando.map((x) => `faltando: ${x}`), ...cobertura.repetidas.map((x) => `repetida: ${x}`)].slice(0, 20).forEach((x) => console.error(`  ${x}`));
  process.exit(1);
}
o.ofertas_novas = [];
const cats = aplicaCategorias(o, itens);
o.metadata.ofertas = { service_offering_entrada: cobertura.entrada, service_offering_saida: cobertura.saida, criadas: 0, identidade: 'sys_id (nome + parent); registros com o mesmo nome e parent diferentes são ofertas distintas' };
o.metadata.cliente = cliente;
o.metadata.fonte = src.replace(/\\/g, '/');
if (setsFile) o.variable_sets_recomendacoes = JSON.parse(fs.readFileSync(setsFile, 'utf8'));
fs.writeFileSync(saida, JSON.stringify(o, null, 2));
console.log(`ofertas: ${cobertura.saida}/${cobertura.entrada} cobertas, 0 criadas; ${comOfertas} itens novos com ofertas${filtradas ? `, ${filtradas} com reference_choices filtradas (formato antigo)` : ''}; ${cats.length} categorias novas`);
