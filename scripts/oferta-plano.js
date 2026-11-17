// Plano por service offering (catálogos com `reference_choices` no item: ofertas reais + UI policies condicionadas na oferta).
// Para cada item: avalia, oferta por oferta, as UI policies que citam a variável de oferta e agrupa as ofertas que
// resultam no MESMO formulário (mesmos efeitos + mesmas condições residuais em outras variáveis). 1 grupo = item inteiro;
// 2+ grupos = um item novo por grupo. SLA, grupo de suporte e aprovação não dividem: só são sinalizados (variacoes).
// Semântica assumida: variável que alguma policy da oferta MOSTRA (visible=true) fica oculta nas ofertas sem essa policy
// ("reverse if false" padrão do ServiceNow, que o export não traz); as demais ficam sempre visíveis.
// Uso: node scripts/oferta-plano.js <export.json> <pasta-saida>
const fs = require('fs');
const path = require('path');

const SEM_DADO = new Set(['11', '12', '19', '20', '24', '32', '23']);
const OPS = ['ISNOTEMPTY', 'ISEMPTY', 'ANYTHING', 'NOT IN', 'NOT LIKE', 'NSAMEAS', 'SAMEAS', 'STARTSWITH', 'ENDSWITH', 'LIKE', 'IN', '!=', '>=', '<=', '=', '>', '<'];
const CAMPOS_OP = ['sla', 'support_group', 'u_has_approver', 'u_has_approver_group', 'u_approval_sequence', 'u_flow', 'u_flow_task', 'u_user_criteria'];
const dv = (x) => (x && typeof x === 'object' ? x._display_value || x.__text || '' : x || '');

// "a^ORb^c" → [[a,b],[c]] (grupos E de termos OU). `^NQ` separa consultas alternativas (OU entre elas): ver aplica().
function parseGrupos(c) {
  const grupos = [];
  for (const t of String(c || '').split('^').filter(Boolean)) {
    if (t.startsWith('OR') && grupos.length) grupos[grupos.length - 1].push(t.slice(2));
    else grupos.push([t]);
  }
  return grupos;
}
const parseCond = (c) => String(c || '').replace(/\^EQ$/, '').split('^NQ').map(parseGrupos);
function termo(raw) {
  const m = raw.match(/^IO:([0-9a-f]{32})(.*)$/);
  if (!m) return { raw, id: null };
  const op = OPS.find((o) => m[2].startsWith(o));
  return { raw, id: m[1], op, val: op ? m[2].slice(op.length) : m[2] };
}
// Valor da oferta escolhida = o (sys_id). undefined = operador que não sei avaliar.
function avalia(t, o) {
  switch (t.op) {
    case '=': return t.val !== '' && t.val === o;
    case '!=': return t.val === '' ? true : t.val !== o;
    case 'ISNOTEMPTY': case 'ANYTHING': return true;
    case 'ISEMPTY': return false;
    case 'IN': return t.val.split(',').includes(o);
    case 'NOT IN': return !t.val.split(',').includes(o);
    default: return undefined;
  }
}
// Uma consulta (grupos E/OU) com a oferta = o: { nao } | { residual } (residual '' = satisfeita só pela oferta)
function consulta(grupos, vid, o) {
  const residual = [];
  for (const g of grupos) {
    const ts = g.map(termo);
    const ofs = ts.filter((t) => t.id === vid);
    const resto = ts.filter((t) => t.id !== vid);
    let ok = false;
    for (const t of ofs) {
      const r = avalia(t, o);
      if (r === undefined) return { complexa: `operador ${t.op} na oferta` };
      if (r) ok = true;
    }
    if (ofs.length && ok) continue; // grupo satisfeito só pela oferta
    if (ofs.length && !resto.length) return { nao: true };
    residual.push(resto.map((t) => t.raw).join('^OR'));
  }
  return { residual: residual.join('^') };
}
// Efeito de uma policy sobre a oferta o: { global } | { nao } | { complexa } | { residual, especial? }
function aplica(p, vid, o) {
  const c = String(p.catalog_conditions || '');
  if (!c.includes(vid)) return { global: true };
  const alts = parseCond(c).map((g) => consulta(g, vid, o));
  const c1 = alts.find((a) => a.complexa);
  if (c1) return { complexa: c1.complexa };
  const vivas = alts.filter((a) => !a.nao);
  if (!vivas.length) return { nao: true };
  if (vivas.some((a) => a.residual === '')) return { residual: '' }; // uma alternativa vale só pela oferta
  const residual = vivas.map((a) => a.residual).join('^NQ');
  return { residual, especial: /SAMEAS|<=|>=/.test(residual) || undefined };
}

function planoItem(item, setById, filtro) {
  const rc = (item.reference_choices || [])[0];
  if (!rc || !rc.options.length) return null;
  const todas = rc.options;
  const base = planoOfertas(item, setById, rc, todas);
  if (!filtro) return base;
  rc.options = todas.filter(filtro); // só as ofertas que passam no filtro entram no plano
  let r;
  try { r = planoOfertas(item, setById, rc, todas); } finally { rc.options = todas; }
  if (r.sem_ofertas_validas) return r;
  // Variável que uma policy mostra só para ofertas fora do filtro: serviu a oferta que não vale mais, sai do catálogo novo.
  // (Órfã "de verdade", sem nenhuma oferta da lista, continua órfã: fica e é sinalizada.)
  // Órfã de verdade (a policy que a mostra aponta para oferta que nem existe mais na lista) também sai: oferta desativada/removida.
  const todasOcultas = r.orfas || [];
  r.retirar_inativas = todasOcultas.length ? todasOcultas : undefined;
  r.orfas = undefined;
  return r;
}
function planoOfertas(item, setById, rc, todas) {
  if (!rc.options.length) return { sys_id: item.sys_id, name: item.name, sem_ofertas_validas: true, ofertas_total: todas.length, grupos: [], divide: false };
  const vid = (rc.variables[0] || {}).sys_id;
  const opcoes = rc.options;
  const own = item.catalog_variables.filter((v) => v.active === 'true');
  const nomes = new Map([...own, ...item.catalog_variable_sets.flatMap((r) => ((setById.get(r.variable_set.__text) || {}).vs_variables || []))].map((v) => [v.sys_id, v.name]));
  const dados = own.filter((v) => !SEM_DADO.has(v.type));
  const polOferta = item.catalog_ui_policies.filter((p) => p.active === 'true' && String(p.catalog_conditions).includes(vid));
  const idVar = (a) => String(a.catalog_variable || '').replace(/^IO:/, '');

  // Variáveis que alguma policy da oferta mostra (ficam ocultas fora dela) e que alguma esconde.
  const mostra = new Set();
  const esconde = new Set();
  for (const p of polOferta) for (const a of p.ui_policy_actions || []) { if (a.visible === 'true') mostra.add(idVar(a)); if (a.visible === 'false') esconde.add(idVar(a)); }

  const porOferta = opcoes.map((op) => {
    const linhas = new Set();
    const pol = [];
    const complexas = [];
    for (const p of polOferta) {
      const r = aplica(p, vid, op.sys_id);
      if (r.nao || r.global) continue;
      if (r.complexa) { complexas.push({ id: p.sys_id, motivo: r.complexa }); linhas.add(`COMPLEXA:${p.sys_id}`); continue; }
      pol.push({ id: p.sys_id, residual: r.residual });
      for (const a of p.ui_policy_actions || []) linhas.add(`${idVar(a)}|${a.visible}|${a.mandatory}|${a.disabled}|${a.cleared}|${a.value_action}|${a.value}@${r.residual}`);
    }
    return { op, assinatura: [...linhas].sort().join(';'), pol, complexas };
  });

  const grupos = new Map();
  for (const x of porOferta) {
    if (!grupos.has(x.assinatura)) grupos.set(x.assinatura, []);
    grupos.get(x.assinatura).push(x);
  }
  const lista = [...grupos.values()].map((xs, k) => {
    const efeitos = new Map(); // id da variável → { visible, mandatory, disabled } das policies estáticas (sem residual)
    for (const x of xs[0].pol) {
      const p = polOferta.find((q) => q.sys_id === x.id);
      if (x.residual) continue;
      for (const a of p.ui_policy_actions || []) {
        const e = efeitos.get(idVar(a)) || {};
        if (a.visible !== 'ignore') e.visible = a.visible === 'true';
        if (a.mandatory !== 'ignore') e.mandatory = a.mandatory === 'true';
        if (a.disabled !== 'ignore') e.disabled = a.disabled === 'true';
        efeitos.set(idVar(a), e);
      }
    }
    const condicionalmenteVisivel = new Set();
    for (const x of xs[0].pol) if (x.residual) for (const a of polOferta.find((q) => q.sys_id === x.id).ui_policy_actions || []) if (a.visible === 'true') condicionalmenteVisivel.add(idVar(a));
    const visiveis = [], ocultas = [], mandatory = {}, somenteLeitura = [];
    for (const v of dados) {
      const e = efeitos.get(v.sys_id) || {};
      let vis = !(v.hidden === 'true');
      if (mostra.has(v.sys_id)) vis = e.visible === true || condicionalmenteVisivel.has(v.sys_id);
      else if (esconde.has(v.sys_id) && e.visible === false) vis = false;
      (vis ? visiveis : ocultas).push(v.name);
      if (vis && e.mandatory === true && v.mandatory !== 'true') mandatory[v.name] = true;
      if (vis && e.disabled === true && v.read_only !== 'true') somenteLeitura.push(v.name);
    }
    const variacoes = {};
    for (const c of CAMPOS_OP) { const vals = [...new Set(xs.map((x) => dv(x.op[c])))]; if (vals.length > 1) variacoes[c] = vals; }
    return {
      k, ofertas: xs.map((x) => x.op.sys_id), visiveis, ocultas, mandatory, somente_leitura: somenteLeitura,
      politicas: xs[0].pol.map((p) => ({ id: p.id, nome: polOferta.find((q) => q.sys_id === p.id).short_description, residual: p.residual || undefined })),
      complexas: xs[0].complexas, variacoes,
    };
  });
  // Ocultas só por regra de oferta (alguma policy as mostra para outras ofertas) saem do grupo. Técnicas (hidden=true, nenhuma policy
  // da oferta as mostra) e órfãs (a policy que as mostra aponta para ofertas fora da lista) ficam em todos os itens novos.
  const nomesMostra = new Set(dados.filter((v) => mostra.has(v.sys_id)).map((v) => v.name));
  const tecnicas = dados.filter((v) => v.hidden === 'true' && !mostra.has(v.sys_id)).map((v) => v.name);
  const orfas = dados.filter((v) => nomesMostra.has(v.name) && !lista.some((g) => g.visiveis.includes(v.name))).map((v) => v.name);
  for (const g of lista) g.retirar = g.ocultas.filter((n) => nomesMostra.has(n) && !orfas.includes(n));
  return {
    sys_id: item.sys_id, name: item.name, variavel_oferta: { sys_id: vid, origem: rc.variables[0].origin, set: dv(rc.variables[0].variable_set) || undefined },
    ofertas: opcoes.map((o) => ({ sys_id: o.sys_id, name: o.name, number: o.number, parent: dv(o.parent), support_group: dv(o.support_group), sla: dv(o.sla), area: o.u_area })),
    grupos: lista, divide: lista.length > 1, tecnicas: tecnicas.length ? tecnicas : undefined, orfas: orfas.length ? orfas : undefined,
    politicas_sem_oferta: item.catalog_ui_policies.filter((p) => p.active === 'true' && !String(p.catalog_conditions).includes(vid)).length,
    client_scripts: item.catalog_client_script.length,
    client_scripts_oferta: item.catalog_client_script.filter((c) => /service_offering|oferta|offering/i.test(JSON.stringify(c.script || '') + c.name)).length,
  };
}

module.exports = { planoItem, parseCond, termo, aplica, SEM_DADO };

if (require.main === module) {
  const argv = process.argv.slice(2);
  const soOperacionais = argv.includes('--so-operacionais');
  const [src, out] = argv.filter((x) => !x.startsWith('--'));
  const filtro = soOperacionais ? (o) => o.operational_status === '1' : undefined;
  const d = JSON.parse(fs.readFileSync(src, 'utf8'));
  const setById = new Map(d.variable_sets.map((s) => [s.sys_id, s]));
  const planos = d.itens.map((i) => planoItem(i, setById, filtro) || { sys_id: i.sys_id, name: i.name, sem_ofertas: true, grupos: [], divide: false });
  fs.mkdirSync(out, { recursive: true });
  fs.writeFileSync(path.join(out, 'plano.json'), JSON.stringify(planos, null, 1));
  const semValidas = planos.filter((p) => p.sem_ofertas_validas);
  const com = planos.filter((p) => !p.sem_ofertas && !p.sem_ofertas_validas);
  const dist = {};
  com.forEach((p) => { const n = p.grupos.length; const k = n >= 10 ? '10+' : n; dist[k] = (dist[k] || 0) + 1; });
  console.log(`itens: ${planos.length} (sem ofertas: ${planos.length - com.length}); a dividir: ${com.filter((p) => p.divide).length}; itens novos: ${com.reduce((a, p) => a + p.grupos.length, 0) + planos.length - com.length}${semValidas.length ? `; sem nenhuma oferta válida (vão para análise humana): ${semValidas.length}` : ''}`);
  console.log('grupos por item:', JSON.stringify(dist));
  console.log('grupos com política complexa:', com.reduce((a, p) => a + p.grupos.filter((g) => g.complexas.length).length, 0), '| itens com variável órfã:', com.filter((p) => p.orfas).length, '| variáveis retiradas por só servirem a oferta fora do filtro:', com.reduce((a, p) => a + (p.retirar_inativas || []).length, 0), 'em', com.filter((p) => p.retirar_inativas).length, 'itens |', '| com variável técnica oculta:', com.filter((p) => p.tecnicas).length);
  console.log('grupos com SLA/suporte/aprovação diferente entre as ofertas agrupadas:', com.reduce((a, p) => a + p.grupos.filter((g) => Object.keys(g.variacoes).length).length, 0));
}
