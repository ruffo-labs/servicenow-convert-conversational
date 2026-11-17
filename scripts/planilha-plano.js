// Plano do catálogo organizado pela planilha do cliente (em vez de pelo formulário da oferta).
// Destino = aba (Autoatendimento | RH Ponta) + tipo (serviço | problema) + categoria (C/G) + item (D/H). Cada destino vira UM item novo,
// com as ofertas que a planilha põe nele (mapa.json, de planilha-mapa.js). Item de origem com N destinos vira N itens novos.
// Estrutura por destino:
//  - destino que cai num só grupo de formulário (oferta-plano.js): como no fluxo de oferta (policies da oferta saem, estrutura fixa);
//  - destino que junta ofertas de formulários diferentes (`mantem_policies`): NÃO separa por formulário (isso fica para a etapa de IA).
//    Mantém as policies condicionadas na oferta e a variável de oferta; só sai a variável que NENHUMA oferta do destino mostra.
// Variável que só serve a ofertas fora da planilha (ex.: desativadas hoje) sai de todos os destinos (`retirar_inativas`).
// Saídas: plano.json (formato de oferta-plano.js + `destino` por grupo) e textos/<sys_id>.json PROVISÓRIOS (nome = item da planilha;
// descrição e labels do original; frases = nomes das ofertas), que a etapa de IA substitui.
// Uso: node scripts/planilha-plano.js <export.json> <mapa.json> <pasta-saida>
const fs = require('fs');
const path = require('path');
const { planoItem } = require('./oferta-plano');

const [src, mapaF, out] = process.argv.slice(2);
const d = JSON.parse(fs.readFileSync(src, 'utf8'));
const mapa = JSON.parse(fs.readFileSync(mapaF, 'utf8')).filter((m) => m.oferta_ids);
const setById = new Map(d.variable_sets.map((s) => [s.sys_id, s]));
const dv = (x) => (x && typeof x === 'object' ? x._display_value || x.__text || '' : x || '');
const texto = (h) => String(h || '').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&[a-z]+;/g, ' ').replace(/\s+/g, ' ').trim();
const CAMPOS_OP = ['sla', 'support_group', 'u_has_approver', 'u_has_approver_group', 'u_approval_sequence', 'u_flow', 'u_flow_task', 'u_user_criteria'];
const NOME_ABA = { autoatendimento: 'Autoatendimento', rh_ponta: 'Gestor - RH Ponta' };
const NOME_TIPO = { servico: 'Preciso de um serviço de RH', problema: 'Preciso reportar um problema' };

// Destino com ofertas de itens de origem diferentes (mesma categoria e mesmo item da planilha, só mudando a oferta): vira UM item,
// montado sobre o item de origem da aba (Autoatendimento → "(Autoatendimento)"; RH Ponta → "(Gestor/RH Ponta)"); as ofertas dos outros entram como `extras`.
const sufixo = { autoatendimento: '(Autoatendimento)', rh_ponta: '(Gestor/RH Ponta)' };
const destinos = new Map();
for (const m of mapa) {
  const chave = [m.aba, m.tipo, m.categoria, m.item].join('|');
  if (!destinos.has(chave)) destinos.set(chave, { aba: m.aba, tipo: m.tipo, categoria: m.categoria, item: m.item, ofertas: new Set(), linhas: [], fontes: new Map() });
  const t = destinos.get(chave);
  m.oferta_ids.forEach((o) => t.ofertas.add(o));
  t.linhas.push(m.linha);
  t.fontes.set(m.item_origem_id, (t.fontes.get(m.item_origem_id) || 0) + 1);
}
const itemById = new Map(d.itens.map((i) => [i.sys_id, i]));
const todasOfertas = new Map(d.itens.flatMap((i) => ((i.reference_choices || [])[0]?.options || []).map((o) => [o.sys_id, o])));
const porOrigem = new Map();
for (const [chave, t] of destinos) {
  const fontes = [...t.fontes.keys()];
  const primaria = fontes.find((f) => itemById.get(f).name.endsWith(sufixo[t.aba])) || fontes.sort((x, y) => t.fontes.get(y) - t.fontes.get(x))[0];
  const proprias = new Set(itemById.get(primaria).reference_choices[0].options.map((o) => o.sys_id));
  t.extras = [...t.ofertas].filter((o) => !proprias.has(o));
  if (!porOrigem.has(primaria)) porOrigem.set(primaria, new Map());
  porOrigem.get(primaria).set(chave, t);
}

const planos = [];
fs.mkdirSync(path.join(out, 'textos'), { recursive: true });
for (const [id, ds] of porOrigem) {
  const item = itemById.get(id);
  const usadas = new Set([...ds.values()].flatMap((t) => [...t.ofertas]));
  const p = planoItem(item, setById, (o) => usadas.has(o.sys_id));
  if (p.sem_ofertas_validas) { console.log(`ATENÇÃO ${item.name}: nenhuma oferta válida`); continue; }
  const opcoes = item.reference_choices[0].options;
  const grupos = [...ds.values()].map((t, k) => {
    const toc = p.grupos.filter((g) => g.ofertas.some((o) => t.ofertas.has(o)));
    const unico = toc.length === 1 && !t.extras.length;
    const ofertas = [...t.ofertas];
    const visiveis = [...new Set(toc.flatMap((g) => g.visiveis))];
    const retirar = toc[0].retirar.filter((n) => toc.every((g) => g.retirar.includes(n)));
    const variacoes = {};
    for (const c of CAMPOS_OP) { const vals = [...new Set(opcoes.filter((o) => t.ofertas.has(o.sys_id)).map((o) => dv(o[c])))]; if (vals.length > 1) variacoes[c] = vals; }
    return {
      k, ofertas, visiveis, ocultas: [...new Set(toc.flatMap((g) => g.ocultas))].filter((n) => !visiveis.includes(n)), retirar,
      mandatory: unico ? toc[0].mandatory : {}, somente_leitura: unico ? toc[0].somente_leitura : [],
      politicas: unico ? toc[0].politicas : [], complexas: toc.flatMap((g) => g.complexas), variacoes,
      mantem_policies: unico ? undefined : true, grupos_formulario: toc.length, extras: t.extras.length ? t.extras : undefined,
      destino: { aba: t.aba, tipo: t.tipo, categoria: t.categoria, item: t.item, caminho: [NOME_ABA[t.aba], NOME_TIPO[t.tipo], t.categoria], linhas: t.linhas },
    };
  });
  p.grupos = grupos;
  p.divide = grupos.length > 1;
  planos.push(p);

  // textos provisórios
  const own = item.catalog_variables.filter((v) => v.active === 'true');
  const labels = {};
  for (const v of own) { const l = v.conversational_label || texto(v.question_text); if (l) labels[v.name] = l; }
  const derivados = grupos.map((g) => {
    const ofs = g.ofertas.map((o) => todasOfertas.get(o).name);
    // Nome = item da planilha. Só ganha sufixo se o MESMO item de origem gera dois itens novos com o mesmo nome (o validador exige nomes únicos).
    const rep = (f) => grupos.filter((x) => f(x) === f(g)).length > 1;
    const nome = !rep((x) => x.destino.item) ? g.destino.item : !rep((x) => `${x.destino.item}|${x.destino.categoria}`) ? `${g.destino.item} (${g.destino.categoria})` : `${g.destino.item} (${g.destino.categoria} - ${g.destino.tipo})`;
    return {
      k: g.k, name: nome,
      short_description: texto(item.short_description) || g.destino.item, description: texto(item.description) || texto(item.short_description) || g.destino.item,
      frases_exemplo: ofs.slice(0, 5),
    };
  });
  fs.writeFileSync(path.join(out, 'textos', `${id}.json`), JSON.stringify({ sys_id: id, motivo: 'Separação pela planilha do cliente (etapa 1). Textos provisórios, a etapa de IA os substitui.', labels, derivados, scripts: {} }, null, 1));
}
fs.writeFileSync(path.join(out, 'plano.json'), JSON.stringify(planos, null, 1));
const nDest = planos.reduce((a, p) => a + p.grupos.length, 0);
console.log(`itens de origem: ${planos.length}; itens novos (destinos): ${nDest}; com formulários misturados (mantêm policies da oferta): ${planos.reduce((a, p) => a + p.grupos.filter((g) => g.mantem_policies).length, 0)}`);
