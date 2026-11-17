// Regra de categorias para item desmembrado: cria uma categoria nova com o NOME DO ITEM (ex.: "ABAX"), os itens novos ficam dentro
// dela e a categoria que o item tinha vira o PAI da categoria nova. Item que não se divide mantém a categoria original.
// Uso (módulo): aplicaCategorias(novoCatalogo, itemPorSysId) → altera `category` dos itens novos e grava `categorias_novas` no topo.
const dv = (x) => (x && typeof x === 'object' ? x._display_value || '' : x || '');

function aplicaCategorias(o, itemById) {
  const existentes = new Set([...itemById.values()].map((i) => dv(i.category)).filter(Boolean));
  const novas = new Map();
  for (const it of o.itens) {
    if (it.status !== 'dividido') continue;
    const orig = itemById.get(it.sys_id);
    const nome = orig.name;
    const pai = orig.category && dv(orig.category) ? orig.category : null;
    const chave = `${dv(pai)}>${nome}`;
    if (!novas.has(chave)) novas.set(chave, { name: nome, parent: pai, origem_item: { sys_id: it.sys_id, name: nome }, colide_com_categoria_existente: existentes.has(nome) || undefined, itens_novos: [] });
    for (const n of it.novos_itens) {
      n.category = { _display_value: nome, __text: '' }; // sys_id da categoria nova só existe depois de criada na instância
      n.categoria_nova = true;
      novas.get(chave).itens_novos.push(n.name);
    }
  }
  o.categorias_novas = [...novas.values()].map((c) => ({ ...c, total_itens: c.itens_novos.length }));
  return o.categorias_novas;
}

module.exports = { aplicaCategorias };
