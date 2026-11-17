// Catálogo com service offerings: finaliza o novo-catalogo.json.
// Cada item novo recebe as ofertas do grupo dele (registros completos de service_offering, em `reference_choices` no mesmo formato do
// original) e `oferta_fixa` (sys_id da oferta quando o grupo tem uma só, senão null). O variable set da oferta não é alterado.
// SLA/grupo de suporte/aprovação que variam entre ofertas agrupadas vão em `observacoes_oferta` (não dividem o item).
// Uso: node scripts/oferta-finaliza.js <export.json> <plano.json> <novo-catalogo.json> <cliente> [--so-com-spec]
const fs = require('fs');
const { aplicaCategorias } = require('./categorias');

const args = process.argv.slice(2);
const soComSpec = args.includes('--so-com-spec');
const [src, planoFile, saida, cliente] = args.filter((x) => !x.startsWith('--'));
const d = JSON.parse(fs.readFileSync(src, 'utf8'));
const plano = new Map(JSON.parse(fs.readFileSync(planoFile, 'utf8')).map((p) => [p.sys_id, p]));
const itemById = new Map(d.itens.map((i) => [i.sys_id, i]));
const o = JSON.parse(fs.readFileSync(saida, 'utf8'));

let itens = o.itens;
const fora = [];
if (soComSpec) {
  fora.push(...itens.filter((i) => i.motivo === 'Sem especificação gerada.').map((i) => ({ sys_id: i.sys_id, name: i.name })));
  itens = itens.filter((i) => i.motivo !== 'Sem especificação gerada.');
}
let derivados = 0;
for (const it of itens) {
  const p = plano.get(it.sys_id);
  if (!p || p.sem_ofertas || it.status === 'analise_humana') continue;
  const rc = itemById.get(it.sys_id).reference_choices[0];
  it.novos_itens.forEach((n, k) => {
    const g = p.grupos[k];
    const ofertas = rc.options.filter((x) => g.ofertas.includes(x.sys_id));
    n.reference_choices = [{ ...rc, options: ofertas, total: ofertas.length }];
    n.oferta_fixa = ofertas.length === 1 ? ofertas[0].sys_id : null;
    n.variavel_oferta = p.variavel_oferta;
    if (Object.keys(g.variacoes).length) n.observacoes_oferta = { ofertas_agrupadas_com_valores_diferentes: g.variacoes };
    if (p.orfas) n.variaveis_orfas = p.orfas;
    if (p.tecnicas) n.variaveis_tecnicas_ocultas = p.tecnicas;
    derivados++;
  });
}
o.itens = itens;
const cats = aplicaCategorias(o, itemById); // item desmembrado: categoria nova com o nome do item, categoria antiga como pai
o.metadata.cliente = cliente;
o.metadata.fonte = src.replace(/\\/g, '/');
o.metadata.totais = {
  itens_originais: itens.length, conversacional: itens.filter((i) => i.status === 'conversacional').length, dividido: itens.filter((i) => i.status === 'dividido').length,
  analise_humana: itens.filter((i) => i.status === 'analise_humana').length, novos_itens: itens.reduce((a, i) => a + i.novos_itens.length, 0),
};
if (soComSpec) { o.metadata.parcial = true; o.metadata.itens_sem_spec = fora.length; o.metadata.descricao = `PARCIAL (piloto): ${itens.length} de ${d.itens.length} itens. ${o.metadata.descricao || ''}`.trim(); }
fs.writeFileSync(saida, JSON.stringify(o, null, 2));
console.log(`${derivados} itens novos com ofertas; ${cats.length} categorias novas${soComSpec ? `; ${fora.length} itens sem spec fora do arquivo` : ''}`);
