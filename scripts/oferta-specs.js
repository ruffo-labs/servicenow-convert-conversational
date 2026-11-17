// Catálogo com service offerings: gera (1) o pacote enxuto que o analista lê e (2) a spec delta de cada item a partir
// do plano por oferta (oferta-plano.js) + textos do analista. A estrutura (grupos, variáveis que saem, policies) é código;
// o analista escreve só textos, labels e decisão sobre client scripts.
// Uso: node scripts/oferta-specs.js pacote <export.json> <plano.json> <pasta-pacotes> <sys_id>...
//      node scripts/oferta-specs.js specs  <export.json> <plano.json> <pasta-textos> <pasta-specs>
const fs = require('fs');
const path = require('path');
const { contexto, quebrasPolicy } = require('./expand-spec');
const { SEM_DADO } = require('./oferta-plano');
const { LAYOUT, layoutQueSai } = require('./layout');

const [, , modo, src, planoFile, a, b, ...ids] = process.argv;
const d = JSON.parse(fs.readFileSync(src, 'utf8'));
const setById = new Map(d.variable_sets.map((s) => [s.sys_id, s]));
const itemById = new Map(d.itens.map((i) => [i.sys_id, i]));
const plano = new Map(JSON.parse(fs.readFileSync(planoFile, 'utf8')).map((p) => [p.sys_id, p]));
const todasOfertas = new Map(d.itens.flatMap((i) => ((i.reference_choices || [])[0]?.options || []).map((o) => [o.sys_id, o])));
const dv = (x) => (x && typeof x === 'object' ? x._display_value || x.__text || '' : x || '');
const texto = (h) => String(h || '').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
const idVar = (a) => String(a.catalog_variable || '').replace(/^IO:/, '');

// Referência a variável na spec: nome, ou sys_id quando o nome é ambíguo (item e set).
function ferramentas(item) {
  const ctx = contexto(item, setById);
  const token = new Map([...ctx.own, ...ctx.setVars.map((x) => x.v)].map((v) => [v.sys_id, ctx.ambiguos.has(v.name) ? v.sys_id : v.name]));
  const ref = (v) => token.get(v.sys_id);
  const cond = (c) => String(c || '').replace(/\^EQ$/, '').replace(/IO:([0-9a-f]{32})/g, (m, id) => token.get(id) || m);
  return { ctx, token, ref, cond };
}

// ---------- pacote para o analista ----------
if (modo === 'pacote') {
  fs.mkdirSync(a, { recursive: true });
  for (const id of [b, ...ids].filter(Boolean)) {
    const item = itemById.get(id);
    const p = plano.get(id);
    const { ctx, cond } = ferramentas(item);
    const perguntas = ctx.own.filter((v) => !SEM_DADO.has(v.type) && v.hidden !== 'true' && !(p.retirar_inativas || []).includes(v.name)).map((v) => ({
      name: v.name, type: v.type_label, question_text: texto(v.question_text), mandatory: v.mandatory === 'true' || undefined,
      default: v.default_value || undefined, reference: v.reference || undefined,
      choices: (v.question_choices || []).slice(0, 15).map((c) => c.text),
    }));
    const pacote = {
      sys_id: item.sys_id, name: item.name, category: dv(item.category), short_description: texto(item.short_description), description: texto(item.description),
      sets: ctx.sets.map(({ set }) => ({ title: set.title, perguntas: (set.vs_variables || []).filter((v) => v.active === 'true' && !SEM_DADO.has(v.type)).map((v) => v.name) })),
      grupos: p.grupos.map((g) => ({
        k: g.k, destino: g.destino && { caminho: g.destino.caminho.join(' > '), item: g.destino.item }, ofertas_de_outro_item: g.extras ? g.extras.map((x) => todasOfertas.get(x).name) : undefined, ofertas: g.ofertas.map((oid) => { const o = p.ofertas.find((x) => x.sys_id === oid) || { ...todasOfertas.get(oid), sla: dv(todasOfertas.get(oid).sla), support_group: dv(todasOfertas.get(oid).support_group) }; return { name: o.name, sla: o.sla || undefined, grupo_suporte: o.support_group || undefined }; }),
        variacoes_entre_ofertas: Object.keys(g.variacoes).length ? g.variacoes : undefined,
        sai_do_formulario: g.retirar, passa_a_obrigatoria: Object.keys(g.mandatory),
        condicoes_que_continuam: g.politicas.filter((x) => x.residual).map((x) => ({ policy: x.nome, quando: cond(x.residual) })),
      })),
      perguntas, tecnicas_ocultas: p.tecnicas, orfas: p.orfas,
      client_scripts: item.catalog_client_script.map((c) => ({ sys_id: c.sys_id, name: c.name, type: c.type, va_supported: c.va_supported, ativo: c.active, resumo: c.script && c.script.script_understanding })),
    };
    fs.writeFileSync(path.join(a, `${id}.json`), JSON.stringify(pacote, null, 1));
  }
  console.log(`pacotes em ${a}`);
  process.exit(0);
}

// ---------- spec delta ----------
const [textosDir, out] = [a, b];
fs.mkdirSync(out, { recursive: true });
const pend = [];
let n = 0;
for (const f of fs.readdirSync(textosDir).filter((x) => x.endsWith('.json'))) {
  const t = JSON.parse(fs.readFileSync(path.join(textosDir, f), 'utf8'));
  const item = itemById.get(t.sys_id);
  const p = plano.get(t.sys_id);
  if (!item || !p || p.sem_ofertas) { pend.push(`${f}: item ou plano não encontrado`); continue; }
  const { ctx, token, ref, cond } = ferramentas(item);
  // Rótulos e rich text saem de todos os itens novos. Contêiner e pausa seguem o layout de cada item novo (layout.js).
  const visuais = ctx.own.filter((v) => SEM_DADO.has(v.type) && !LAYOUT.has(v.type));
  const visualIds = new Set(visuais.map((v) => v.sys_id));
  const inativasIds = new Set(ctx.own.filter((v) => (p.retirar_inativas || []).includes(v.name)).map((v) => v.sys_id));
  const dadosRetirados = (g) => new Set([...ctx.own.filter((v) => g.retirar.includes(v.name)).map((v) => v.sys_id), ...inativasIds]);
  const dadoIds = ctx.own.filter((v) => !SEM_DADO.has(v.type)).map((v) => v.sys_id);
  const layoutSai = p.grupos.map((g) => layoutQueSai(ctx.own, new Set(dadoIds.filter((id) => !dadosRetirados(g).has(id)))));
  const layoutGlobal = new Set([...layoutSai[0]].filter((id) => layoutSai.every((x) => x.has(id)))); // layout que não sobra em nenhum item novo
  const foraGlobal = new Set([...visualIds, ...inativasIds, ...layoutGlobal]); // saem de todos os itens novos
  const retirarIds = (g) => new Set([...dadosRetirados(g), ...layoutSai[p.grupos.indexOf(g)]]);
  const vid = p.variavel_oferta.sys_id;
  // Policy cujas ações são todas sobre variável ausente o validador já remove sozinho: não citar.
  const ativas = item.catalog_ui_policies.filter((x) => x.active === 'true' && !quebrasPolicy(x, ctx).removida);
  const daOferta = ativas.filter((x) => String(x.catalog_conditions).includes(vid));
  const globais = ativas.filter((x) => !String(x.catalog_conditions).includes(vid));

  const spec = { sys_id: item.sys_id, status: p.grupos.length > 1 ? 'dividido' : 'conversacional', motivo: t.motivo, vars: {}, remover: {}, policies: {} };
  // Decisão do cliente: variável órfã, oferta desativada e script que delega a UI Script ausente não geram pendência.
  const pendencias = (t.pendencias || []).filter((x) => !/órf|desativad|UI Script|RhDefaultValidation|não aparece em nenhum grupo|pertencem a ofertas/i.test(x));
  if (pendencias.length) spec.motivo += ` Pendências: ${pendencias.join(' ')}`;
  for (const v of ctx.own) {
    if (SEM_DADO.has(v.type)) { if (!LAYOUT.has(v.type) || layoutGlobal.has(v.sys_id)) spec.remover[ref(v)] = 'visual'; continue; }
    if (inativasIds.has(v.sys_id)) { spec.remover[ref(v)] = 'oferta_inativa'; continue; }
    if (v.hidden === 'true' || v.not_available_conversation === 'true') continue;
    const label = (t.labels || {})[v.name];
    if (!label) { pend.push(`${item.name}: variável ${v.name} sem label`); continue; }
    spec.vars[ref(v)] = { label };
  }
  if (!Object.keys(spec.remover).length) delete spec.remover;

  // Policies da oferta: saem. O que elas faziam vira estrutura fixa por grupo (sem_vars, mandatory) ou policy condicional nova.
  // Destino que junta formulários diferentes (planilha-plano.js: mantem_policies) conserva as policies da oferta; os demais as perdem (sem_policies).
  const algumMantem = p.grupos.some((g) => g.mantem_policies);
  if (!algumMantem) for (const x of daOferta) spec.policies[x.sys_id] = 'remover';
  // Mantidas: só perdem as ações sobre variável que sai de todos os destinos (visual, oferta inativa).
  else for (const x of daOferta) {
    const acoes = (x.ui_policy_actions || []).filter((q) => q.catalog_variable);
    const reais = acoes.filter((q) => !foraGlobal.has(idVar(q)));
    if (reais.length === acoes.length) continue;
    const acoesNovas = acoesDelta(reais);
    spec.policies[x.sys_id] = Object.keys(acoesNovas).length ? { conditions: cond(x.catalog_conditions), actions: acoesNovas } : 'remover';
  }
  // Policies sem oferta que mexem em variável visual: mantém só as ações em variáveis reais.
  for (const x of globais) {
    const acoes = (x.ui_policy_actions || []).filter((a) => a.catalog_variable);
    const reais = acoes.filter((a) => !foraGlobal.has(idVar(a)));
    if (!(acoes.length && reais.length < acoes.length)) continue;
    // Sem condição: só fixa atributo. Vira propriedade da variável do item (o original já a escondia/obrigava sempre).
    const props = (id) => { const r = ctx.byId.get(id); return r && r.own ? r.v : null; };
    if (!String(x.catalog_conditions || '').trim() && reais.length && reais.every((r) => props(idVar(r)))) {
      for (const r of reais) {
        const v = props(idVar(r));
        const p = {};
        if (r.visible === 'false') p.hidden = true;
        if (r.mandatory !== 'ignore') p.mandatory = r.mandatory === 'true';
        if (r.disabled !== 'ignore') p.read_only = r.disabled === 'true';
        if (Object.keys(p).length) spec.vars[ref(v)] = { ...(spec.vars[ref(v)] || {}), props: { ...((spec.vars[ref(v)] || {}).props || {}), ...p } };
      }
      spec.policies[x.sys_id] = 'remover';
    } else spec.policies[x.sys_id] = reais.length ? { conditions: cond(x.catalog_conditions), actions: acoesDelta(reais) } : 'remover';
  }
  function acoesDelta(acoes) {
    const r = {};
    for (const a of acoes) {
      const k = token.get(idVar(a));
      if (!k) continue;
      const o = {};
      if (a.visible !== 'ignore') o.visible = a.visible === 'true';
      if (a.mandatory !== 'ignore') o.mandatory = a.mandatory === 'true';
      if (a.disabled !== 'ignore') o.readonly = a.disabled === 'true';
      if (a.cleared === 'true') o.clear = true;
      if (a.value_action === 'set_value') o.set = String(a.value);
      if (Object.keys(o).length) r[k] = o;
    }
    return r;
  }

  const mistas = new Set();
  const novas = []; // [{ key, k }]
  const quebradas = new Set();
  const mortas = new Set();
  p.grupos.forEach((g) => {
    const fora = retirarIds(g);
    g.politicas.filter((x) => x.residual).forEach((x, i) => {
      const orig = daOferta.find((q) => q.sys_id === x.id);
      if (!orig) return; // policy que o validador já descarta (ações só em variável ausente)
      // Condição sobre variável que não está no formulário deste grupo: nunca dispara neste item novo, então não vira policy.
      if ([...x.residual.matchAll(/IO:([0-9a-f]{32})/g)].some((m) => fora.has(m[1]) || foraGlobal.has(m[1]))) { mortas.add(x.id); return; }
      const condicao = cond(x.residual);
      // Condição sobre variável que não existe mais: no ServiceNow a policy nunca dispara, então não vira policy nova.
      if (/IO:[0-9a-f]{32}/.test(condicao)) { quebradas.add(x.id); return; }
      const acoes = acoesDelta((orig.ui_policy_actions || []).filter((a) => !fora.has(idVar(a)) && !foraGlobal.has(idVar(a))));
      if (!Object.keys(acoes).length) return;
      const key = `nova_g${g.k}_${i + 1}`;
      spec.policies[key] = { short_description: orig.short_description, conditions: condicao, actions: acoes };
      novas.push({ key, k: g.k });
    });
  });

  spec.itens = p.grupos.map((g) => {
    const tx = (t.derivados || []).find((x) => x.k === g.k);
    if (!tx) { pend.push(`${item.name}: derivado ${g.k} sem texto`); }
    const fora = retirarIds(g);
    const it = { name: tx ? tx.name : `${item.name} (${g.k})`, short_description: tx ? tx.short_description : '', description: tx ? tx.description : '', frases_exemplo: tx ? tx.frases_exemplo : [] };
    const semVars = [...g.retirar.map((nome) => ref(ctx.own.find((v) => v.name === nome))), ...[...layoutSai[p.grupos.indexOf(g)]].filter((id) => !layoutGlobal.has(id)).map((id) => ref(ctx.own.find((v) => v.sys_id === id)))];
    if (semVars.length) it.sem_vars = semVars;
    const mand = Object.keys(g.mandatory).filter((nome) => ctx.own.some((v) => v.name === nome));
    if (mand.length) it.vars = Object.fromEntries(mand.map((nome) => [ref(ctx.own.find((v) => v.name === nome)), { props: { mandatory: true } }]));
    const semPol = novas.filter((x) => x.k !== g.k).map((x) => x.key);
    if (algumMantem && !g.mantem_policies) semPol.push(...daOferta.map((x) => x.sys_id));
    const jaRemovida = (id) => spec.policies[id] === 'remover';
    // Destino que mantém as policies da oferta: sai a que age ou depende de variável que este destino não tem. Se ela também mexia
    // em variável que fica, o efeito sobre essa se perde (registrado em `mistas`, vai para o motivo da spec).
    if (g.mantem_policies) {
      for (const x of daOferta) {
        const alvos = (x.ui_policy_actions || []).map(idVar);
        const ids = [...alvos, ...[...String(x.catalog_conditions).matchAll(/IO:([0-9a-f]{32})/g)].map((m) => m[1])];
        if (!ids.some((id) => fora.has(id))) continue;
        semPol.push(x.sys_id);
        if (alvos.some((id) => !fora.has(id) && ctx.byId.has(id))) mistas.add(x.short_description);
      }
    }
    for (const x of globais.filter((y) => spec.policies[y.sys_id] !== 'remover')) {
      const envolvidas = [...(x.ui_policy_actions || []).map(idVar), ...[...String(x.catalog_conditions).matchAll(/IO:([0-9a-f]{32})/g)].map((m) => m[1])];
      if (envolvidas.some((id) => fora.has(id))) semPol.push(x.sys_id);
    }
    if (semPol.length) it.sem_policies = [...new Set(semPol)].filter((id) => !jaRemovida(id));
    if (it.sem_policies && !it.sem_policies.length) delete it.sem_policies;
    return it;
  });
  // Só scripts ativos do item aceitam decisão.
  const csAtivos = new Set(item.catalog_client_script.filter((c) => c.active === 'true').map((c) => c.sys_id));
  const scripts = Object.fromEntries(Object.entries(t.scripts || {}).filter(([id]) => csAtivos.has(id) || (pend.push(`${item.name}: decisão sobre script ${id} ignorada (inativo ou de outro item)`), false)));
  if (Object.keys(scripts).length) spec.scripts = scripts;
  if (mistas.size) spec.motivo += ` ${mistas.size} policy(ies) da oferta saíram de destinos que não têm todas as variáveis delas (efeito sobre as variáveis que ficam perdido): ${[...mistas].join('; ')}.`;
  if (quebradas.size) spec.motivo += ` ${quebradas.size} policy(ies) com condição em variável inexistente (nunca disparavam) foram descartadas.`;
  if (mortas.size) spec.motivo += ` ${mortas.size} policy(ies) condicionais descartadas em grupos onde a variável da condição não existe.`;
  if (!Object.keys(spec.policies).length) delete spec.policies;
  fs.writeFileSync(path.join(out, `${item.sys_id}.json`), JSON.stringify(spec, null, 1));
  n++;
}
console.log(`${n} specs em ${out}`);
if (pend.length) console.log(`pendências (${pend.length}):\n- ${pend.slice(0, 30).join('\n- ')}`);
