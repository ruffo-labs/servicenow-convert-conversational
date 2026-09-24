// Expande a spec em delta (work/specs/lote-NN/<sys_id>.json) no schema completo que build-novo-catalogo.js consome.
// Uso: node scripts/expand-spec.js <spec.json|pasta> [saida.json] [input/catalog-map.json] [output/catalog-ai-first.json]
//
// Regras (valem também para validate-spec.js e para a skill regras-catalogo):
// - BASE = SEMPRE o catálogo original (catalog-map.json). A 1ª análise (catalog-ai-first.json) só fornece TEXTO;
//   nunca decide se uma variável, set, policy ou script existe num derivado. Zero perda é medido contra o original.
// - Omitido = mantido igual ao original, em TODOS os derivados: variável, variable set, UI policy (inclusive nova_*)
//   e client script não citados vão para todos os derivados. Um derivado só diz o que tira (sem_*) e o que fixa (fixas).
// - Precedência de textos: spec > 1ª análise > original.
//   label de variável: derivado.vars > vars (topo) > 1ª análise (derivado de_1a, depois labels gerais) > conversational_label original.
//   textos do item (name, short_description, description, frases_exemplo): spec > 1ª análise (nome_sugerido etc.,
//   ou derivados[de_1a] num dividido) > original.
// - Nome de variável ambíguo no pacote (mesmo nome no item e num set, ou em dois sets) só pode ser citado pelo sys_id.
// - Variável de set não é alterada pela spec do item (o set é compartilhado); policies podem agir sobre ela.
const fs = require('fs');
const path = require('path');

const HEX = /^[0-9a-f]{32}$/;
const VISUAL = new Set(['11', '12', '19', '20', '24', '32']); // label, break, containers, rich text label
const HTML = '23';
const PRESENT = new Set(['14', '15', '17']); // custom / ui page / custom with label
const naoColetaDado = (v) => VISUAL.has(String(v.type)) || String(v.type) === HTML;
const isTrue = (v) => v === true || v === 'true';
const temRef = (x) => !!(x && (typeof x === 'object' ? x._display_value || x.__text : x));
const apresentacao = (v) => naoColetaDado(v) || PRESENT.has(String(v.type)) || temRef(v.sp_widget) || temRef(v.macro);

// Listas fechadas. Todo campo aceita também {"outro": "<texto curto>"}.
const CODIGOS = {
  remover_var: ['visual', 'texto_movido_descricao', 'sem_uso_conversa'], // + {substituida_por}, {duplicada_no_set}
  converter: ['props', 'regex', 'default', 'auto_populate'], // + "policy:<chave>"
  remover_script: ['sem_efeito'], // + {substituido_por}
  ajustar: ['va_supported', 'remover_dom', 'ui_type_all'],
  divergencia: ['divisao_diferente', 'label_melhor', 'regra_negocio', 'erro_1a_analise', 'limite_formato'],
  analise_humana: ['item_atalho', 'formulario_complexo', 'custom_coleta_dado', 'dado_sem_destino', 'sem_uso', 'duvida_negocio'],
};
const PENDENTES = { so_desktop: 'código so_desktop pendente de decisão (uso do catálogo fora do VA); não use' };
const PROPS = new Set(['mandatory', 'hidden', 'read_only', 'default_value', 'not_available_conversation', 'type', 'include_none', 'validation_regex', 'order', 'reference_qual']);
const ACAO = { visible: 'visible', mandatory: 'mandatory', readonly: 'disabled' };
const STATUS = new Set(['conversacional', 'dividido', 'analise_humana']);
const STATUS_1A = { conversacional: 'conversacional', conversacional_com_ajustes: 'conversacional', dividir: 'dividido', manter_formulario: 'analise_humana', avaliar_desativacao: 'analise_humana', substituir_por_link_kb: 'analise_humana' };

// ---------- contexto do item original ----------
function contexto(orig, setById) {
  const act = (v) => v.active === 'true';
  const own = (orig.catalog_variables || []).filter(act);
  const refs = (orig.catalog_variable_sets || []).slice().sort((a, b) => +a.order - +b.order);
  const sets = refs.map((r) => ({ ref: r, set: setById.get(r.variable_set.__text) })).filter((x) => x.set);
  const setVars = sets.flatMap(({ set }) => (set.vs_variables || []).filter(act).map((v) => ({ v, set })));
  const count = new Map();
  for (const v of [...own, ...setVars.map((x) => x.v)]) count.set(v.name, (count.get(v.name) || 0) + 1);
  const ambiguos = new Set([...count].filter(([, n]) => n > 1).map(([k]) => k));
  const byId = new Map([...own.map((v) => [v.sys_id, { v, own: true }]), ...setVars.map((x) => [x.v.sys_id, { v: x.v, set: x.set }])]);
  // Todas as variáveis (inclusive inativas) para traduzir condições do original.
  const todas = new Map([...(orig.catalog_variables || []), ...sets.flatMap(({ set }) => set.vs_variables || [])].map((v) => [v.sys_id, v]));
  // Resolve uma referência (nome ou sys_id) → { v, own, set } | { erro }
  function ref(r) {
    if (HEX.test(r)) return byId.get(r) || { erro: `sys_id ${r} não é variável ativa do item nem dos seus sets` };
    if (ambiguos.has(r)) return { erro: `nome ambíguo "${r}" (item e set, ou dois sets): cite pelo sys_id` };
    const o = own.find((v) => v.name === r);
    if (o) return { v: o, own: true };
    const s = setVars.find((x) => x.v.name === r);
    return s ? { v: s.v, set: s.set } : { erro: `variável ${r} não existe no item nem nos seus sets` };
  }
  return { orig, own, sets, setVars, ambiguos, byId, todas, ref };
}

// Policy do ORIGINAL que cita variável ausente (inativa, apagada ou de set que o item não usa):
// - ação sobre variável ausente → removida automaticamente (aviso do original);
// - policy cujas ações eram todas sobre variáveis ausentes → removida;
// - condição com variável ausente → policy mantida e marcada como pendência humana (não é removida).
function quebrasPolicy(p, ctx) {
  const ausente = (id) => id && !ctx.byId.has(id);
  const acoes = (p.ui_policy_actions || []).filter((a) => a.variable || a.catalog_variable);
  const acoesAusentes = acoes.map((a) => String(a.catalog_variable || '').replace(/^IO:/, '')).filter(ausente);
  const condAusentes = [...String(p.catalog_conditions || '').matchAll(/IO:([0-9a-f]{32})/g)].map((m) => m[1]).filter(ausente);
  return { acoesAusentes, condAusentes, removida: acoes.length > 0 && acoesAusentes.length === acoes.length };
}

// ---------- códigos ----------
function codigo(val, lista, extras, onde, E, stats) {
  stats.total++;
  if (typeof val === 'string') {
    if (PENDENTES[val]) return E.push(`${onde}: ${PENDENTES[val]}`), null;
    if (lista.includes(val)) return { codigo: val };
    return E.push(`${onde}: código "${val}" fora da lista (${[...lista, ...extras.map((x) => `{${x}}`), '{outro}'].join(', ')})`), null;
  }
  if (val && typeof val === 'object' && Object.keys(val).length === 1) {
    const [k, v] = Object.entries(val)[0];
    if (k === 'outro') {
      stats.outro++;
      if (typeof v !== 'string' || !v.trim()) return E.push(`${onde}: "outro" exige texto curto`), null;
      if (v.length > 200) E.push(`${onde}: texto de "outro" com ${v.length} caracteres (máx. 200)`);
      return { codigo: 'outro', texto: v };
    }
    if (extras.includes(k)) return { codigo: k, ref: v };
  }
  return E.push(`${onde}: valor inválido ${JSON.stringify(val)}`), null;
}

// ---------- ações e condições ----------
function acoesDelta(actions, onde, E) {
  return Object.entries(actions || {}).map(([variable, a]) => {
    const r = { variable, visible: 'ignore', mandatory: 'ignore', disabled: 'ignore', cleared: 'false', value: '', value_action: 'ignore' };
    if (!a || typeof a !== 'object' || Array.isArray(a)) { E.push(`${onde}: ação em ${variable} deve ser objeto {"visible": true, ...}`); return r; }
    for (const [k, v] of Object.entries(a)) {
      if (ACAO[k]) { if (typeof v !== 'boolean') E.push(`${onde}: ${variable}.${k} deve ser true/false`); r[ACAO[k]] = String(v); }
      else if (k === 'clear') { r.cleared = String(!!v); if (v) r.value_action = 'clear_value'; }
      else if (k === 'set') { r.value_action = 'set_value'; r.value = String(v); }
      else E.push(`${onde}: ${variable}: chave de ação "${k}" inválida (visible, mandatory, readonly, clear, set)`);
    }
    return r;
  });
}
const acoesOriginais = (p) => (p.ui_policy_actions || []).filter((a) => a.variable || a.catalog_variable).map((a) => ({
  variable: String(a.catalog_variable || '').replace(/^IO:/, '') || a.variable,
  visible: a.visible, mandatory: a.mandatory, disabled: a.disabled, cleared: a.cleared, value: a.value || '', value_action: a.value_action || 'ignore',
}));
const condOriginal = (c) => String(c || '').replace(/\^EQ$/, '').replace(/IO:/g, '');
const partesCond = (c) => String(c || '').replace(/\^?EQ$/, '').split(/\^OR|\^NQ|\^/).filter(Boolean);
// Condição sempre verdadeira: vazia, ou toda cláusula E tem um par complementar no seu OU
// (vISEMPTY^ORvISNOTEMPTY, v=a^ORv!=a). ^NQ separa consultas alternativas.
function sempreVerdadeira(c) {
  const s = condOriginal(c).trim();
  if (!s) return true;
  const termo = (t) => {
    let m = t.match(/^(.+?)(ISNOTEMPTY|ISEMPTY)$/);
    if (m) return [m[1], m[2] === 'ISEMPTY' ? 'vazio' : 'nao_vazio'];
    m = t.match(/^([a-zA-Z0-9_]+?)(!=|=)(.*)$/);
    return m ? [m[1], `${m[2] === '=' ? 'igual' : 'diferente'}:${m[3]}`] : null;
  };
  const oposto = { vazio: 'nao_vazio', nao_vazio: 'vazio' };
  const complementar = (grupo) => {
    const ts = new Set(grupo.map(termo).filter(Boolean).map(([v, op]) => `${v}|${op}`));
    return [...ts].some((x) => {
      const [v, op] = x.split('|');
      const inv = oposto[op] || (op.startsWith('igual:') ? `diferente:${op.slice(6)}` : `igual:${op.slice(10)}`);
      return ts.has(`${v}|${inv}`);
    });
  };
  return s.split('^NQ').some((q) => {
    const grupos = [];
    for (const t of q.split('^').filter(Boolean)) {
      if (t.startsWith('OR') && grupos.length) grupos[grupos.length - 1].push(t.slice(2));
      else grupos.push([t]);
    }
    return grupos.every(complementar);
  });
}
// Variável citada no início de uma parte de condição: sys_id (32 hex) ou o prefixo mais longo que seja nome conhecido.
function varDaCond(parte, conhecida) {
  const m = parte.match(/^[a-zA-Z0-9_]+/);
  if (!m) return null;
  if (HEX.test(m[0].slice(0, 32)) && conhecida(m[0].slice(0, 32))) return m[0].slice(0, 32);
  for (let n = m[0].length; n > 0; n--) if (conhecida(m[0].slice(0, n))) return m[0].slice(0, n);
  return null;
}

// ---------- expansão ----------
// Retorna { exp (schema completo), erros[], avisos[], stats{total,outro}, info } — info é usado pelo validador.
function expand(spec, ctx, a1) {
  const E = [];
  const W = [];
  const stats = { total: 0, outro: 0 };
  const { orig, own, sets } = ctx;
  const status = spec.status;
  const base = { sys_id: orig.sys_id, name: orig.name, status, motivo: spec.motivo || '' };
  if (!STATUS.has(status)) E.push(`status inválido: ${status}`);
  if (!spec.motivo) E.push('sem motivo');
  (spec.divergencias || []).forEach((d, k) => codigo(d, CODIGOS.divergencia, [], `divergencias[${k}]`, E, stats));
  if (status === 'analise_humana') {
    for (const k of ['vars', 'remover', 'policies', 'scripts', 'itens']) if (spec[k]) E.push(`analise_humana não leva "${k}"`);
    if (spec.criterio == null) E.push(`analise_humana sem "criterio" (${CODIGOS.analise_humana.join(', ')} ou {outro})`);
    else codigo(spec.criterio, CODIGOS.analise_humana, [], 'criterio', E, stats);
    const esperado = a1 && STATUS_1A[a1.recomendacao];
    if (esperado && esperado !== 'analise_humana' && !(spec.divergencias || []).length) E.push(`diverge da 1ª análise (status analise_humana ≠ ${a1.recomendacao}) sem "divergencias" com código`);
    return { exp: { ...base, novos_itens: [{ copiar_original: true }] }, erros: E, avisos: W, avisosOriginal: [], stats, info: {} };
  }

  // Variáveis do item: chave normalizada = sys_id da variável própria, ou nome nova_*.
  const chaveVar = (k, onde) => {
    if (k.startsWith('nova_')) return k;
    const r = ctx.ref(k);
    if (r.erro) return E.push(`${onde}: ${r.erro}`), null;
    if (!r.own) return E.push(`${onde}: ${k} é variável do set "${r.set.title}"; o set é compartilhado e não é alterado pela spec do item`), null;
    return r.v.sys_id;
  };
  // O original já tira a variável da conversa: hidden/not_available_conversation, ou policy ativa sem condição real que a oculta.
  const escondidaNoOriginal = (v) => isTrue(v.hidden) || isTrue(v.not_available_conversation) || (orig.catalog_ui_policies || []).some((p) => p.active === 'true'
    && sempreVerdadeira(p.catalog_conditions)
    && (p.ui_policy_actions || []).some((a) => String(a.catalog_variable || '').replace(/^IO:/, '') === v.sys_id && String(a.visible) === 'false'));
  const deltaVars = (obj, onde) => {
    const m = new Map();
    for (const [k, d] of Object.entries(obj || {})) {
      const key = chaveVar(k, `${onde}.${k}`);
      if (!key) continue;
      if (!d || typeof d !== 'object') { E.push(`${onde}.${k}: deve ser objeto`); continue; }
      for (const x of Object.keys(d)) if (!['label', 'props', 'nova'].includes(x)) E.push(`${onde}.${k}: chave "${x}" inválida (label, props, nova)`);
      if (key.startsWith('nova_')) {
        if (!d.nova || !d.nova.type) E.push(`${onde}.${k}: variável nova sem "nova.type"`);
        if (!d.nova || !d.nova.question_text) E.push(`${onde}.${k}: variável nova sem "nova.question_text"`);
        if (d.label) E.push(`${onde}.${k}: variável nova usa só nova.question_text, não "label"`);
        const ch = d.nova && d.nova.choices;
        if (ch !== undefined && (!Array.isArray(ch) || !ch.length || ch.some((c) => !c || typeof c !== 'object' || Array.isArray(c)
          || typeof c.text !== 'string' || !c.text.trim() || typeof c.value !== 'string' || !c.value.trim() || Object.keys(c).some((x) => x !== 'text' && x !== 'value'))))
          E.push(`${onde}.${k}: nova.choices deve ser lista de {"text": "…", "value": "…"} (não "Rótulo [=valor]")`);
        else if (ch && new Set(ch.map((c) => c.value)).size !== ch.length) E.push(`${onde}.${k}: nova.choices com value repetido`);
      } else {
        if (d.nova) E.push(`${onde}.${k}: "nova" só em variável nova_*`);
        // Tirar da conversa variável que coleta dado: só se o original já a tirava, ou se ela tem valor padrão.
        const v = ctx.byId.get(key).v;
        const pr = d.props || {};
        const temValor = String((v.default_value && typeof v.default_value === 'object' ? v.default_value.__text : v.default_value) || '').trim() || String(pr.default_value ?? '').trim();
        for (const p of ['hidden', 'not_available_conversation']) {
          if (isTrue(pr[p]) && !naoColetaDado(v) && !escondidaNoOriginal(v) && !temValor)
            E.push(`${onde}.${k}: props.${p} em variável que coleta dado (type ${v.type}) só se o original já a tirava da conversa (hidden, not_available_conversation ou policy sem condição) ou se ela tem default_value; não é o caso`);
        }
      }
      for (const p of Object.keys(d.props || {})) {
        if (p === 'question_text') E.push(`${onde}.${k}: texto da variável vai em "label", não em props.question_text`);
        else if (!PROPS.has(p)) E.push(`${onde}.${k}: prop "${p}" inválida (${[...PROPS].join(', ')})`);
      }
      m.set(key, d);
    }
    return m;
  };
  const topVars = deltaVars(spec.vars, 'vars');
  const ownById = new Map(own.map((v) => [v.sys_id, v]));

  // remover
  const removidas = new Map(); // sys_id → motivo (texto)
  for (const [k, val] of Object.entries(spec.remover || {})) {
    const key = chaveVar(k, `remover.${k}`);
    if (!key || key.startsWith('nova_')) continue;
    const v = ownById.get(key);
    const c = codigo(val, CODIGOS.remover_var, ['substituida_por', 'duplicada_no_set'], `remover.${k}`, E, stats);
    if (!c) continue;
    const dado = !naoColetaDado(v);
    if (c.codigo === 'substituida_por') {
      const alvo = String(c.ref);
      const ok = alvo.startsWith('nova_') ? topVars.has(alvo) : !ctx.ref(alvo).erro && ctx.ref(alvo).own;
      if (!ok) E.push(`remover.${k}: substituida_por "${alvo}" não existe (variável do item ou nova_* definida em vars)`);
      // Substituta existente precisa coletar o mesmo tipo de dado; para mudar o tipo, crie uma nova_*.
      else if (!alvo.startsWith('nova_') && dado && String(ctx.ref(alvo).v.type) !== String(v.type))
        E.push(`remover.${k}: substituida_por "${alvo}" tem outro tipo (type ${ctx.ref(alvo).v.type} ≠ ${v.type}); a substituta precisa ser nova_* ou do mesmo tipo`);
      removidas.set(key, `substituída por ${alvo}`);
    } else if (c.codigo === 'duplicada_no_set') {
      const r = ctx.ref(String(c.ref));
      if (r.erro || !r.set) E.push(`remover.${k}: duplicada_no_set "${c.ref}" não é variável de um set do item`);
      removidas.set(key, `duplicada no set: ${c.ref}`);
    } else {
      if (c.codigo === 'sem_uso_conversa' && dado) E.push(`remover.${k}: sem_uso_conversa só vale para label/HTML/layout; variável de dado (type ${v.type}) → use substituida_por ou status analise_humana`);
      else if (c.codigo === 'visual' && !apresentacao(v)) E.push(`remover.${k}: "visual" só vale para variável visual/apresentação (type ${v.type} coleta dado)`);
      else if (c.codigo === 'texto_movido_descricao' && dado) E.push(`remover.${k}: texto_movido_descricao só vale para label/rich text/HTML (type ${v.type})`);
      else if (c.codigo === 'outro' && !apresentacao(v)) E.push(`remover.${k}: variável de dado (type ${v.type}) só sai com substituida_por ou duplicada_no_set`);
      removidas.set(key, c.codigo === 'outro' ? `outro: ${c.texto}` : c.codigo);
    }
  }

  // policies
  const origPol = new Map((orig.catalog_ui_policies || []).filter((p) => p.active === 'true').map((p) => [p.sys_id, p]));
  const polDelta = new Map();
  const polRemovidas = new Set();
  for (const [k, val] of Object.entries(spec.policies || {})) {
    const onde = `policies.${k}`;
    if (k.startsWith('nova_')) {
      if (!val || typeof val !== 'object') { E.push(`${onde}: deve ser objeto`); continue; }
      for (const x of ['short_description', 'conditions', 'actions']) if (!val[x]) E.push(`${onde}: policy nova sem "${x}"`);
      if (val.origem && !(orig.catalog_client_script || []).some((c) => c.sys_id === val.origem)) E.push(`${onde}: origem ${val.origem} não é client script do item`);
      polDelta.set(k, val);
    } else if (!origPol.has(k)) E.push(`${onde}: sys_id não é UI policy ativa do item`);
    else if (val === 'remover') polRemovidas.add(k);
    else if (val && typeof val === 'object') {
      for (const x of Object.keys(val)) if (!['short_description', 'on_load', 'conditions', 'actions'].includes(x)) E.push(`${onde}: chave "${x}" inválida`);
      polDelta.set(k, val);
    } else E.push(`${onde}: use "remover" ou objeto com conditions/actions`);
  }
  // Quebras do original (ações/condições sobre variável ausente): tratadas aqui, viram aviso do original, não erro da spec.
  const AO = []; // avisos do catálogo original
  const quebras = new Map([...origPol].map(([k, p]) => [k, quebrasPolicy(p, ctx)]));
  const autoRemovidas = new Set();
  for (const [k, q] of quebras) {
    const reescrita = polDelta.has(k) && polDelta.get(k).actions;
    if (q.removida && !reescrita) { autoRemovidas.add(k); AO.push(`policy ${k} removida: todas as ações sobre variável ausente (${q.acoesAusentes.join(', ')})`); }
    else if (q.acoesAusentes.length && !reescrita) AO.push(`policy ${k}: ${q.acoesAusentes.length} ação(ões) sobre variável ausente removida(s)`);
    if (q.condAusentes.length && !(polDelta.get(k) || {}).conditions && !polRemovidas.has(k) && !autoRemovidas.has(k)) AO.push(`policy ${k}: condição usa variável ausente (${q.condAusentes.join(', ')}) → pendência humana`);
  }
  const chavesPolicy = new Set([...[...origPol.keys()].filter((k) => !polRemovidas.has(k) && !autoRemovidas.has(k)), ...[...polDelta.keys()].filter((k) => k.startsWith('nova_'))]);
  // Ocultar variável que coleta dado (do item ou de set) exige condição real. Tirar set do derivado: só via sem_sets.
  for (const [k, d] of polDelta) {
    if (!d.actions || typeof d.actions !== 'object') continue;
    const cond = d.conditions ?? (origPol.get(k) ? origPol.get(k).catalog_conditions : '');
    if (!sempreVerdadeira(cond)) continue;
    for (const [alvo, a] of Object.entries(d.actions)) {
      if (!a || a.visible !== false) continue;
      const r = alvo.startsWith('nova_') ? { v: (topVars.get(alvo) || {}).nova } : ctx.ref(alvo);
      if (r.erro || !r.v || naoColetaDado(r.v)) continue;
      E.push(`policies.${k}: oculta ${alvo} (coleta dado${r.set ? `, set "${r.set.title}"` : ''}) com condição sempre verdadeira; use condição real, ou tire o set do derivado com sem_sets`);
    }
  }

  // client scripts
  const origCs = new Map((orig.catalog_client_script || []).filter((c) => c.active === 'true').map((c) => [c.sys_id, c]));
  const csFora = new Map(); // sys_id → como (convertido/removido)
  const csAjuste = new Map();
  for (const [k, val] of Object.entries(spec.scripts || {})) {
    const onde = `scripts.${k}`;
    if (!origCs.has(k)) { E.push(`${onde}: sys_id não é client script ativo do item`); continue; }
    const ks = Object.keys(val || {});
    if (ks.length !== 1 || !['converter', 'remover', 'ajustar'].includes(ks[0])) { E.push(`${onde}: use exatamente uma de {converter}, {remover}, {ajustar}`); continue; }
    if (ks[0] === 'converter') {
      const v = val.converter;
      if (typeof v === 'string' && v.startsWith('policy:')) {
        stats.total++;
        if (!chavesPolicy.has(v.slice(7))) E.push(`${onde}: converter para "${v}", policy que não existe na spec/item`);
        csFora.set(k, v);
      } else { const c = codigo(v, CODIGOS.converter, [], onde, E, stats); if (c) csFora.set(k, c.codigo === 'outro' ? `outro: ${c.texto}` : c.codigo); }
    } else if (ks[0] === 'remover') {
      const c = codigo(val.remover, CODIGOS.remover_script, ['substituido_por'], onde, E, stats);
      if (!c) continue;
      if (c.codigo === 'substituido_por') {
        const alvo = String(c.ref);
        const ok = chavesPolicy.has(alvo) || origCs.has(alvo) || topVars.has(alvo) || (!ctx.ref(alvo).erro);
        if (!ok) E.push(`${onde}: substituido_por "${alvo}" não existe (policy, client script ou variável)`);
        if (alvo === k) E.push(`${onde}: substituido_por aponta para o próprio script`);
        csFora.set(k, `substituído por ${alvo}`);
      } else csFora.set(k, c.codigo === 'outro' ? `outro: ${c.texto}` : c.codigo);
    } else {
      const lst = Array.isArray(val.ajustar) ? val.ajustar : [val.ajustar];
      const cs = lst.map((x, i) => codigo(x, CODIGOS.ajustar, [], `${onde}.ajustar[${i}]`, E, stats)).filter(Boolean);
      csAjuste.set(k, cs.map((c) => (c.codigo === 'outro' ? `outro: ${c.texto}` : c.codigo)).join('; '));
    }
  }

  // derivados
  const itens = spec.itens || (status === 'conversacional' ? [{}] : []);
  if (!Array.isArray(itens) || !itens.length) E.push('itens vazio');
  const der1a = (a1 && a1.itens_derivados) || [];
  const labels1a = Object.fromEntries(((a1 && a1.perguntas) || []).filter((p) => p.conversational_label).map((p) => [p.variavel, p.conversational_label]));
  const derivInfo = [];

  const novos = itens.map((n, idx) => {
    const tag = `itens[${idx}]`;
    for (const x of Object.keys(n)) if (!['name', 'short_description', 'description', 'frases_exemplo', 'fixas', 'vars', 'sem_vars', 'sem_sets', 'sem_policies', 'sem_scripts', 'flags', 'de_1a'].includes(x)) E.push(`${tag}: chave "${x}" inválida`);
    let fonte1a = null;
    if (n.de_1a != null) { fonte1a = der1a[n.de_1a]; if (!fonte1a) E.push(`${tag}: de_1a=${n.de_1a} não existe nos derivados da 1ª análise`); }
    else if (status === 'conversacional' && a1) fonte1a = { nome: a1.nome_sugerido, short_description: a1.short_description_sugerida, descricao: a1.descricao_sugerida, frases_exemplo: a1.frases_exemplo };
    const texto = (campo, campo1a, original) => n[campo] ?? (fonte1a && fonte1a[campo1a]) ?? original;
    const labelsDer = fonte1a && fonte1a.perguntas ? Object.fromEntries(fonte1a.perguntas.filter((p) => p.conversational_label).map((p) => [p.variavel, p.conversational_label])) : {};
    const derVars = deltaVars(n.vars, `${tag}.vars`);
    const semVars = new Set((n.sem_vars || []).map((k) => chaveVar(k, `${tag}.sem_vars`)).filter(Boolean));
    const semSets = new Set(n.sem_sets || []);
    for (const s of semSets) if (!sets.some((x) => x.set.sys_id === s)) E.push(`${tag}.sem_sets: ${s} não é set do item`);
    const semPol = new Set(n.sem_policies || []);
    for (const p of semPol) if (!chavesPolicy.has(p)) E.push(`${tag}.sem_policies: ${p} não é policy do item/spec`);
    const semCs = new Set(n.sem_scripts || []);
    for (const c of semCs) if (!origCs.has(c)) E.push(`${tag}.sem_scripts: ${c} não é client script do item`);

    const variables = [];
    const presentes = new Set(); // sys_id ou nome nova_*
    for (const v of own) {
      if (removidas.has(v.sys_id) || semVars.has(v.sys_id)) continue;
      const d = { ...(topVars.get(v.sys_id) || {}), ...(derVars.get(v.sys_id) || {}) };
      const props = { ...((topVars.get(v.sys_id) || {}).props || {}), ...((derVars.get(v.sys_id) || {}).props || {}) };
      const e = { name: v.name };
      if (props.order != null) e.order = props.order;
      delete props.order;
      if (Object.keys(props).length) e.overrides = props;
      const label = d.label ?? labelsDer[v.name] ?? labels1a[v.name] ?? v.conversational_label;
      if (label) e.conversational_label = label;
      variables.push(e);
      presentes.add(v.sys_id);
    }
    for (const [k, d] of [...topVars, ...derVars]) {
      if (!k.startsWith('nova_') || semVars.has(k) || presentes.has(k)) continue;
      const { question_text, order, ...nova } = d.nova || {};
      variables.push({ name: k, order: order ?? 9999, conversational_label: question_text, nova: { ...nova, question_text } });
      presentes.add(k);
    }
    const fixas = Object.entries(n.fixas || {}).map(([k, value]) => {
      const key = chaveVar(k, `${tag}.fixas`);
      if (key && !presentes.has(key)) E.push(`${tag}.fixas: ${k} foi removida deste derivado`);
      return key && { name: ownById.get(key) ? ownById.get(key).name : k, value };
    }).filter(Boolean);

    const setsDer = sets.filter((x) => !semSets.has(x.set.sys_id));
    const setsIds = new Set(setsDer.map((x) => x.set.sys_id));

    const ui_policies = [];
    for (const k of chavesPolicy) {
      if (semPol.has(k)) continue;
      const o = origPol.get(k);
      const d = polDelta.get(k) || {};
      const q = quebras.get(k);
      ui_policies.push({
        origem_sys_id: o ? o.sys_id : '', chave: k, alterada: polDelta.has(k),
        short_description: d.short_description ?? (o && o.short_description) ?? '',
        on_load: d.on_load ?? (o ? o.on_load === 'true' : false),
        conditions: d.conditions ?? condOriginal(o && o.catalog_conditions),
        actions: d.actions ? acoesDelta(d.actions, `policies.${k}`, E) : acoesOriginais(o).filter((a) => !q || !q.acoesAusentes.includes(a.variable)),
        pendencia_humana: !d.conditions && q && q.condAusentes.length ? `condição usa variável ausente: ${q.condAusentes.join(', ')}` : undefined,
      });
    }
    const client_scripts_mantidos = [...origCs.values()].filter((c) => !csFora.has(c.sys_id) && !semCs.has(c.sys_id))
      .map((c) => ({ sys_id: c.sys_id, name: c.name, ajuste: csAjuste.get(c.sys_id) || '' }));

    derivInfo.push({ presentes, setsIds, derVars, labelsDer, nomes: new Map(variables.map((v) => [v.name, v])) });
    return {
      name: texto('name', 'nome', orig.name),
      short_description: texto('short_description', 'short_description', orig.short_description),
      description: texto('description', 'descricao', orig.description),
      frases_exemplo: texto('frases_exemplo', 'frases_exemplo', []),
      make_item_non_conversational: (n.flags || {}).make_item_non_conversational ?? orig.make_item_non_conversational === 'true',
      turn_off_nowassist_conversation: (n.flags || {}).turn_off_nowassist_conversation ?? orig.turn_off_nowassist_conversation === 'true',
      variaveis_fixas: fixas,
      variables,
      variable_sets: setsDer.map((x) => ({ sys_id: x.set.sys_id, name: x.ref.variable_set._display_value, order: x.ref.order })),
      ui_policies,
      client_scripts_mantidos,
      conversoes: [...csFora].map(([id, como]) => ({ origem: origCs.get(id).name, tipo: 'client_script', como })),
    };
  });

  // Divergência da 1ª análise exige código; repetir texto igual ao da 1ª análise é aviso.
  const divergiu = [];
  if (a1) {
    const esperado = STATUS_1A[a1.recomendacao];
    if (esperado && esperado !== status) divergiu.push(`status ${status} ≠ 1ª análise (${a1.recomendacao})`);
    for (const [src, m, ref1a] of [['vars', topVars, labels1a], ...derivInfo.map((x, i) => [`itens[${i}].vars`, x.derVars, { ...labels1a, ...x.labelsDer }])]) {
      for (const [k, d] of m) {
        const nome = ownById.get(k) ? ownById.get(k).name : k;
        if (d.label == null || ref1a[nome] == null) continue;
        if (d.label === ref1a[nome]) W.push(`${src}.${nome}: label igual ao da 1ª análise, omita`);
        else divergiu.push(`label de ${nome}`);
      }
    }
    if (status === 'conversacional' && itens[0]) {
      const n = itens[0];
      for (const [campo, c1a] of [['name', 'nome_sugerido'], ['short_description', 'short_description_sugerida'], ['description', 'descricao_sugerida'], ['frases_exemplo', 'frases_exemplo']]) {
        if (n[campo] == null || a1[c1a] == null) continue;
        if (JSON.stringify(n[campo]) === JSON.stringify(a1[c1a])) W.push(`itens[0].${campo}: igual ao da 1ª análise, omita`);
        else divergiu.push(campo);
      }
    }
    // Dividido: texto ou label copiado de um derivado da 1ª análise → herde com de_1a em vez de repetir.
    if (status === 'dividido' && Array.isArray(itens)) {
      const igual = (a, b) => a != null && b != null && JSON.stringify(a) === JSON.stringify(b);
      const label1a = (d, nome) => ((d && d.perguntas) || []).find((p) => p.variavel === nome && p.conversational_label)?.conversational_label;
      itens.forEach((n, idx) => {
        const tag = `itens[${idx}]`;
        for (const [campo, c1a] of [['name', 'nome'], ['short_description', 'short_description'], ['description', 'descricao'], ['frases_exemplo', 'frases_exemplo']]) {
          if (n[campo] == null) continue;
          if (n.de_1a != null) { if (igual(n[campo], (der1a[n.de_1a] || {})[c1a])) W.push(`${tag}.${campo}: igual ao do derivado de_1a=${n.de_1a} da 1ª análise, omita`); continue; }
          const k = der1a.findIndex((d) => igual(n[campo], d[c1a]));
          if (k >= 0) W.push(`${tag}.${campo}: igual ao derivado ${k} da 1ª análise; use "de_1a": ${k} e omita o texto`);
        }
        if (n.de_1a != null) return;
        for (const [key, d] of (derivInfo[idx] || { derVars: new Map() }).derVars) {
          const nome = ownById.get(key) ? ownById.get(key).name : key;
          const k = der1a.findIndex((x) => igual(d.label, label1a(x, nome)));
          if (k >= 0) W.push(`${tag}.vars.${nome}: label igual ao do derivado ${k} da 1ª análise; use "de_1a": ${k} e omita`);
        }
      });
    }
  }
  if (divergiu.length && !(spec.divergencias || []).length) E.push(`diverge da 1ª análise (${divergiu.join('; ')}) sem "divergencias" com código`);

  return {
    exp: { ...base, variaveis_nao_utilizadas: [...removidas].map(([id, motivo]) => ({ name: ownById.get(id).name, motivo })), novos_itens: novos },
    erros: E, avisos: W, avisosOriginal: AO, stats, info: { derivInfo, removidas, csFora, origCs, origPol },
  };
}

// ---------- IO ----------
function carregar(src = 'input/catalog-map.json', analiseFile = 'output/catalog-ai-first.json') {
  const d = JSON.parse(fs.readFileSync(src, 'utf8'));
  const a1 = fs.existsSync(analiseFile) ? new Map(JSON.parse(fs.readFileSync(analiseFile, 'utf8')).itens.map((a) => [a.sys_id, a])) : new Map();
  return { d, a1, itemById: new Map(d.itens.map((i) => [i.sys_id, i])), setById: new Map(d.variable_sets.map((s) => [s.sys_id, s])) };
}
// Lê specs de arquivos ou pastas (recursivo). Cada arquivo = 1 objeto (ou array, por compatibilidade).
// Subpastas que começam com "_" (ex.: work/specs/_piloto) só são lidas se forem passadas diretamente.
function lerSpecs(alvos) {
  const out = [];
  const visita = (p, raiz) => {
    if (fs.statSync(p).isDirectory()) { if (!raiz && path.basename(p).startsWith('_')) return; fs.readdirSync(p).sort().forEach((f) => visita(path.join(p, f))); }
    else if (p.endsWith('.json')) [].concat(JSON.parse(fs.readFileSync(p, 'utf8'))).forEach((s) => out.push({ arquivo: p, spec: s }));
  };
  alvos.forEach((a) => visita(a, true));
  return out;
}

module.exports = { expand, contexto, quebrasPolicy, carregar, lerSpecs, partesCond, varDaCond, sempreVerdadeira, naoColetaDado, apresentacao, HEX, CODIGOS };

if (require.main === module) {
  const [, , alvo, saida, src, analiseFile] = process.argv;
  const base = carregar(src, analiseFile);
  const res = lerSpecs([alvo]).map(({ arquivo, spec }) => {
    const orig = base.itemById.get(spec.sys_id);
    if (!orig) { console.error(`${arquivo}: sys_id ${spec.sys_id} não existe no export`); return null; }
    const r = expand(spec, contexto(orig, base.setById), base.a1.get(spec.sys_id));
    if (r.erros.length) console.error(`${arquivo}:\n  - ${r.erros.join('\n  - ')}`);
    return r.exp;
  }).filter(Boolean);
  const json = JSON.stringify(res, null, 1);
  if (saida) fs.writeFileSync(saida, json); else console.log(json);
}
