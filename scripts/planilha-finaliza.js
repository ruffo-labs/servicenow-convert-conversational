// Finaliza o novo catálogo organizado pela planilha: ofertas de cada item novo, categorias em 3 níveis e conferência de cobertura.
// Categoria do item novo: <Autoatendimento | Gestor - RH Ponta> > <Preciso de um serviço de RH | Preciso reportar um problema> > <categoria C/G da planilha>.
// Os níveis são categorias NOVAS (`categorias_novas`, com o pai pelo nome); o __text (sys_id) fica vazio até serem criadas na instância.
// Falha (não grava) se alguma oferta da planilha mapeada não estiver no item do destino dela.
// Uso: node scripts/planilha-finaliza.js <export.json> <plano.json> <mapa.json> <novo-catalogo.json> <Cliente>
const fs = require('fs');
const [src, planoF, mapaF, saida, cliente] = process.argv.slice(2);
const d = JSON.parse(fs.readFileSync(src, 'utf8'));
const plano = new Map(JSON.parse(fs.readFileSync(planoF, 'utf8')).map((p) => [p.sys_id, p]));
const mapa = JSON.parse(fs.readFileSync(mapaF, 'utf8'));
const itemById = new Map(d.itens.map((i) => [i.sys_id, i]));
const setById = new Map(d.variable_sets.map((s) => [s.sys_id, s]));
const o = JSON.parse(fs.readFileSync(saida, 'utf8'));

o.itens = o.itens.filter((i) => i.motivo !== 'Sem especificação gerada.');
const categorias = new Map();
const cat = (nome, pai) => { const caminho = [pai && pai.caminho, nome].filter(Boolean).join(' > '); if (!categorias.has(caminho)) categorias.set(caminho, { name: nome, parent: pai ? pai.name : null, caminho, parent_caminho: pai ? pai.caminho : null, itens_novos: [] }); return categorias.get(caminho); };

const noItem = new Map(); // chave do destino → ofertas no item novo
for (const it of o.itens) {
  const p = plano.get(it.sys_id);
  const rc = itemById.get(it.sys_id).reference_choices[0];
  it.novos_itens.forEach((n, k) => {
    const g = p.grupos[k];
    const todas = new Map(d.itens.flatMap((i) => ((i.reference_choices || [])[0]?.options || []).map((x) => [x.sys_id, x])));
    const ofertas = [...rc.options.filter((x) => g.ofertas.includes(x.sys_id)), ...(g.extras || []).map((id) => todas.get(id))];
    n.reference_choices = [{ ...rc, options: ofertas, total: ofertas.length }];
    n.oferta_fixa = ofertas.length === 1 ? ofertas[0].sys_id : null;
    n.variavel_oferta = p.variavel_oferta;
    if (Object.keys(g.variacoes).length) n.observacoes_oferta = { ofertas_agrupadas_com_valores_diferentes: g.variacoes };
    if (g.extras) n.ofertas_de_outro_item = g.extras.map((id) => ({ sys_id: id, name: todas.get(id).name, item_origem: todas.get(id).u_catalog_item?._display_value }));
    if (g.mantem_policies) n.formularios_misturados = `${g.grupos_formulario} formulários de oferta juntos: variável de oferta e policies condicionadas na oferta mantidas (separar por formulário fica para a etapa de IA).`;
    if (p.orfas) n.variaveis_orfas = p.orfas;
    if (p.tecnicas) n.variaveis_tecnicas_ocultas = p.tecnicas;
    // Variable set entra inteiro, com o layout dele (normal | 2across | 2down).
    for (const r of n.catalog_variable_sets) r.layout = (setById.get(r.variable_set.__text) || {}).layout || '';
    const dest = g.destino;
    const c3 = cat(dest.categoria, cat(dest.caminho[1], cat(dest.caminho[0])));
    n.category = { _display_value: dest.categoria, __text: '' };
    n.categoria_nova = true;
    n.categoria_caminho = c3.caminho;
    n.destino_planilha = { aba: dest.aba, tipo: dest.tipo, categoria: dest.categoria, item: dest.item, linhas: dest.linhas };
    // Nome final = item da planilha (o sufixo só existia para o validador, que exige nome único por item de origem).
    const velho = n.name;
    n.name = dest.item;
    (function troca(x) { if (x && typeof x === 'object') for (const [kk, v] of Object.entries(x)) { if ((kk === 'cat_item' || kk === 'catalog_item') && v && v._display_value === velho) v._display_value = n.name; else troca(v); } })(n);
    c3.itens_novos.push(n.name);
    noItem.set([dest.aba, dest.tipo, dest.categoria, dest.item].join('|'), new Set(ofertas.map((x) => x.sys_id)));
  });
}
const colide = [...new Set(o.itens.flatMap((i) => i.novos_itens).map((n) => `${n.categoria_caminho}|${n.name}`).filter((k, i, a) => a.indexOf(k) !== i))];
if (colide.length) console.log(`ATENÇÃO: nome repetido na mesma categoria: ${colide.join('; ')}`);
o.ofertas_novas = []; // não criamos oferta nova: as da planilha sem oferta no arquivo ficam em metadata.planilha.sem_oferta_no_arquivo
o.categorias_novas = [...categorias.values()].map((c) => ({ ...c, total_itens: c.itens_novos.length }));

// Cobertura: toda linha mapeada tem todas as ofertas no item do destino dela.
const faltas = [];
for (const m of mapa.filter((x) => x.oferta_ids)) {
  const tem = noItem.get([m.aba, m.tipo, m.categoria, m.item].join('|'));
  for (const id of m.oferta_ids) if (!tem || !tem.has(id)) faltas.push(`${m.aba}/${m.tipo}/${m.item}: ${m.oferta}`);
}
if (faltas.length) { console.error(`COBERTURA FALHOU (${faltas.length}):\n- ${faltas.join('\n- ')}`); process.exit(1); }

const usadas = new Set(mapa.flatMap((m) => m.oferta_ids || []));
const todas = d.itens.flatMap((i) => ((i.reference_choices || [])[0]?.options || []).map((x) => ({ ...x, item: i.name })));
const cont = {};
for (const m of mapa) cont[m.status] = (cont[m.status] || 0) + 1;
o.metadata.cliente = cliente;
o.metadata.fonte = src.replace(/\\/g, '/');
o.metadata.organizacao = 'planilha do cliente (Organograma): aba > serviço|problema > categoria > item';
o.metadata.totais = { itens_originais_usados: o.itens.length, itens_novos: o.itens.reduce((a, i) => a + i.novos_itens.length, 0), categorias_novas: o.categorias_novas.length };
o.metadata.planilha = {
  linhas: mapa.length, por_status: cont,
  ignoradas_por_decisao: mapa.filter((m) => m.status === 'ignorada').map((m) => `${m.aba}/${m.tipo}/${m.item}: ${m.oferta}`),
  sem_oferta_no_arquivo: mapa.filter((m) => m.status === 'sem_oferta').map((m) => `${m.aba}/${m.tipo}/${m.item}: ${m.oferta}`),
  ofertas_do_arquivo_fora_da_planilha: todas.filter((x) => !usadas.has(x.sys_id)).length,
};
o.metadata.descricao = 'Novo catálogo organizado pela planilha do cliente. Etapa 1: separação por destino (item de catálogo da planilha); textos provisórios, a etapa de IA os substitui.';
delete o.metadata.parcial;
fs.writeFileSync(saida, JSON.stringify(o, null, 2));
console.log(`${o.metadata.totais.itens_novos} itens novos de ${o.itens.length} itens de origem; ${o.categorias_novas.length} categorias novas; cobertura OK`);
