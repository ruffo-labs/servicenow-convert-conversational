// Gera um pacote autocontido por item (item + variable sets referenciados + 1ª análise),
// para servir de entrada na especificação do novo catálogo.
// Uso: node scripts/build-digest.js [input/catalog-map.json] [work/digests] [output/catalog-ai-first.json]
//
// Regras de negócio (determinísticas, aplicadas aqui e não no prompt):
// 1. Pacote = só o objeto do item + os variable sets que ele referencia (resolvidos por sys_id).
// 2. Campos entram por lista de PERMITIDOS. Tudo fora dela (workflow, flow_designer_flow, taxonomy_topic, redirect_url,
//    view, triggered_*, catalog_available_for/not_available_for, volume, sys_*, ...) não entra. O builder final lê o
//    export original, então nada se perde no output.
// 3. Texto vai completo (sem truncar): o excedente somava ~17 KB no catálogo todo.
// Flags (calculadas no objeto bruto, antes do corte de campos):
// - precisa_leitura_completa: o pacote perdeu informação que existe no export (set não encontrado, pacote acima do teto).
// - atencao: risco para a conversa que o export também não resolve (opções dinâmicas, custom/macro/widget,
//   5+ variable sets, 40+ choices). A skill diz como tratar cada motivo.
// Policies do item que citam variável ausente (regra em expand-spec.js/quebrasPolicy): ação removida, policy sem ação
// válida removida, condição quebrada = pendência humana. Tudo vai para work/relatorios/policies-quebradas.csv.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { contexto, quebrasPolicy } = require('./expand-spec');

const [, , src = 'input/catalog-map.json', outDir = 'work/digests', analiseFile = 'output/catalog-ai-first.json'] = process.argv;
const d = JSON.parse(fs.readFileSync(src, 'utf8'));
const analise = fs.existsSync(analiseFile) ? new Map(JSON.parse(fs.readFileSync(analiseFile, 'utf8')).itens.map((a) => [a.sys_id, a])) : new Map();
if (!analise.size) console.warn(`aviso: ${analiseFile} não encontrado, pacotes sem primeira_analise`);

const ENT = { nbsp: ' ', amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", ordm: 'º', ordf: 'ª', deg: '°', ndash: '–', mdash: '—', hellip: '…', laquo: '«', raquo: '»', bull: '•', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“', iexcl: '¡', iquest: '¿', euro: '€', sup2: '²', sup3: '³' };
const ACC = { acute: '́', grave: '̀', circ: '̂', tilde: '̃', uml: '̈', cedil: '̧' };
function decode(s) {
  return s
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&([a-zA-Z])(acute|grave|circ|tilde|uml|cedil);/g, (_, l, a) => (l + ACC[a]).normalize('NFC'))
    .replace(/&([a-z0-9]+);/gi, (m, n) => ENT[n] ?? m);
}
function clean(html) {
  if (!html) return '';
  const t = decode(String(html).replace(/<br\s*\/?>|<\/p>|<\/li>|<\/div>/gi, '\n').replace(/<li[^>]*>/gi, '- ').replace(/<[^>]+>/g, ''));
  return t.replace(/[ \t]+/g, ' ').replace(/\n\s*\n+/g, '\n').trim();
}
const dv = (x) => (x && typeof x === 'object' ? x._display_value || '' : x || '');
const TETO_PACOTE = 100000;
const MUITAS_CHOICES = 40;

// ---------- atenção (objeto bruto) ----------
function atencaoVar(v, onde, m) {
  const tag = `${onde}${v.name}`;
  if (['14', '17', '23'].includes(String(v.type)) || dv(v.macro) || dv(v.sp_widget)) m.push(`${tag}: custom/macro/widget (type ${v.type})`);
  if (v.choice_table || v.lookup_table) m.push(`${tag}: opções dinâmicas (${v.choice_table || v.lookup_table})`);
  const ch = (v.question_choices || []).filter((c) => c.inactive !== 'true');
  if (ch.length > MUITAS_CHOICES) m.push(`${tag}: ${ch.length} choices (>${MUITAS_CHOICES})`);
}
function atencao(i, sets) {
  const m = [];
  (i.catalog_variables || []).filter((v) => v.active === 'true').forEach((v) => atencaoVar(v, '', m));
  if (sets.length >= 5) m.push(`${sets.length} variable sets`);
  for (const s of sets) (s.vs_variables || []).filter((v) => v.active === 'true').forEach((v) => atencaoVar(v, `set ${s.title}/`, m));
  return m;
}

// ---------- allowlists ----------
// Booleanos: só aparecem quando diferentes do padrão. Vazios não aparecem.
const VAR_TXT = ['name', 'type', 'conversational_label', 'example_text', 'reference', 'lookup_table', 'lookup_value', 'lookup_label', 'lookup_dependent_question', 'choice_table', 'choice_field', 'default_value', 'reference_qual', 'reference_qual_condition'];
const VAR_BOOL = ['mandatory', 'hidden', 'read_only', 'not_available_conversation', 'map_to_field', 'include_none', 'lookup_unique'];
function variavel(v, ctx) {
  const q = {};
  if (ctx.ambiguos.has(v.name)) q.sys_id = v.sys_id; // nome ambíguo no pacote: a spec cita pelo sys_id
  for (const k of VAR_TXT) if (dv(v[k])) q[k] = String(dv(v[k]));
  q.order = +v.order;
  const qt = clean(v.question_text);
  if (qt) q.question_text = qt;
  for (const k of VAR_BOOL) if (v[k] === 'true') q[k] = true;
  if (dv(v.macro)) q.macro = dv(v.macro);
  if (dv(v.sp_widget)) q.sp_widget = dv(v.sp_widget);
  const ch = (v.question_choices || []).filter((c) => c.inactive !== 'true').sort((a, b) => +a.order - +b.order)
    .map((c) => { const t = clean(c.text); return c.value && c.value !== t ? `${t} [=${c.value}]` : t; });
  if (ch.length) q.choices = ch;
  return q;
}
const variaveis = (vs, ctx) => (vs || []).filter((v) => v.active === 'true').sort((a, b) => +a.order - +b.order).map((v) => variavel(v, ctx));

// Condições e ações do export vêm por sys_id (IO:<sys_id>). No pacote viram nome da variável; ficam como sys_id
// quando o nome é ambíguo ou a variável não está no item/sets.
function nomeVar(sysId, ctx) {
  const v = ctx.todas.get(sysId);
  return v && !ctx.ambiguos.has(v.name) ? v.name : sysId;
}
const condicao = (c, ctx) => String(c || '').replace(/\^EQ$/, '').replace(/IO:([0-9a-f]{32})/g, (_, id) => nomeVar(id, ctx));
function acao(a, ctx) {
  const f = [];
  if (a.visible !== 'ignore') f.push(`visible=${a.visible}`);
  if (a.mandatory !== 'ignore') f.push(`mandatory=${a.mandatory}`);
  if (a.disabled !== 'ignore') f.push(`readonly=${a.disabled}`);
  if (a.cleared === 'true' || a.value_action === 'clear_value') f.push('clear');
  if (a.value_action === 'set_value') f.push(`set=${a.value}`);
  const id = String(a.catalog_variable || '').replace(/^IO:/, '');
  return `${id ? nomeVar(id, ctx) : a.variable || a.sys_name}: ${f.join(',')}`;
}
// doItem: policies do próprio item passam pela regra de variável ausente; as de set ficam como estão (set é compartilhado).
function policies(ps, ctx, doItem) {
  return (ps || []).filter((p) => p.active === 'true').sort((a, b) => +a.order - +b.order).map((p) => {
    const q = doItem ? quebrasPolicy(p, ctx) : { acoesAusentes: [], condAusentes: [], removida: false };
    if (q.removida) return null;
    const o = { sys_id: p.sys_id, short_description: p.short_description, conditions: condicao(p.catalog_conditions, ctx) };
    if (p.on_load !== 'true') o.on_load = false;
    if (p.va_supported !== 'true') o.va_supported = false;
    if (p.applies_catalog !== 'true') o.applies_catalog = false;
    o.actions = (p.ui_policy_actions || []).filter((a) => !q.acoesAusentes.includes(String(a.catalog_variable || '').replace(/^IO:/, ''))).map((a) => acao(a, ctx));
    if (q.condAusentes.length) o.pendencia_humana = 'condição usa variável ausente; mantenha a policy como está';
    return o;
  }).filter(Boolean);
}
function clientScripts(cs) {
  return (cs || []).filter((c) => c.active === 'true').map((c) => {
    const o = { sys_id: c.sys_id, name: c.name, type: c.type };
    if (c.cat_variable) o.cat_variable = String(c.cat_variable).replace(/^IO:/, '');
    if (c.va_supported !== 'true') o.va_supported = false;
    if (c.applies_catalog !== 'true') o.applies_catalog = false;
    o.ui_type = c.ui_type;
    o.script = clean(c.script && c.script.script_understanding);
    return o;
  });
}
function variableSet(s, order, ctx) {
  return {
    sys_id: s.sys_id, title: s.title, internal_name: s.internal_name, order: +order, description: clean(s.description),
    variaveis: variaveis(s.vs_variables, ctx), ui_policies: policies(s.vs_ui_policies, ctx, false), client_scripts: clientScripts(s.vs_catalog_client_scripts),
  };
}
// 1ª análise enxuta: só o que a spec pode reaproveitar (textos, labels, decisões por variável, divisão, scripts).
function primeiraAnalise(a) {
  if (!a) return undefined;
  const acoes = {};
  const labels = {};
  for (const p of a.perguntas || []) {
    if (p.conversational_label) labels[p.variavel] = p.conversational_label;
    if (p.acao && p.acao !== 'manter') acoes[p.variavel] = p.acao + (p.tipo_sugerido ? `:${p.tipo_sugerido}` : '');
  }
  return {
    recomendacao: a.recomendacao, nome: a.nome_sugerido, short_description: a.short_description_sugerida, description: a.descricao_sugerida,
    frases_exemplo: a.frases_exemplo, labels, acoes, derivados: a.itens_derivados, scripts_e_policies: a.scripts_e_policies,
  };
}

// ---------- relatório de policies quebradas ----------
const varGlobal = new Map([...d.itens.flatMap((i) => i.catalog_variables || []), ...d.variable_sets.flatMap((s) => s.vs_variables || [])].map((v) => [v.sys_id, v]));
function situacao(id) {
  const v = varGlobal.get(id);
  if (!v) return { tipo_var: 'apagada', nome: '' };
  return { tipo_var: v.active !== 'true' ? 'inativa' : 'set_nao_usado', nome: v.name };
}
const csvLinhas = [['origem', 'origem_sys_id', 'origem_nome', 'policy_sys_id', 'policy', 'variavel_sys_id', 'variavel', 'tipo', 'situacao_variavel', 'tratamento']];
function registrarQuebras(i, ctx) {
  for (const p of (i.catalog_ui_policies || []).filter((x) => x.active === 'true')) {
    const q = quebrasPolicy(p, ctx);
    const linha = (id, onde, trat) => {
      const s = situacao(id);
      csvLinhas.push(['item', i.sys_id, i.name, p.sys_id, p.short_description, id, s.nome, s.tipo_var === 'set_nao_usado' ? 'set_nao_usado' : onde, s.tipo_var, trat]);
    };
    q.acoesAusentes.forEach((id) => linha(id, 'acao', q.removida ? 'policy removida (todas as ações quebradas)' : 'ação removida'));
    q.condAusentes.forEach((id) => linha(id, 'condicao', q.removida ? 'policy removida (todas as ações quebradas)' : 'pendência humana'));
  }
}
// Policies de variable set: o set é compartilhado e não é alterado; só entram no relatório.
// Variável ausente = não é variável ativa do próprio set.
function registrarQuebrasSet(s) {
  const ativas = new Set((s.vs_variables || []).filter((v) => v.active === 'true').map((v) => v.sys_id));
  for (const p of (s.vs_ui_policies || []).filter((x) => x.active === 'true')) {
    const linha = (id, onde) => {
      const v = varGlobal.get(id);
      const sit = !v ? 'apagada' : v.active !== 'true' ? 'inativa' : 'fora_do_set';
      csvLinhas.push(['set', s.sys_id, s.title, p.sys_id, p.short_description, id, v ? v.name : '', onde, sit, 'set, sem alteração']);
    };
    for (const a of p.ui_policy_actions || []) { const id = String(a.catalog_variable || '').replace(/^IO:/, ''); if (id && !ativas.has(id)) linha(id, 'acao'); }
    for (const m of String(p.catalog_conditions || '').matchAll(/IO:([0-9a-f]{32})/g)) if (!ativas.has(m[1])) linha(m[1], 'condicao');
  }
}
const csv = (rows) => rows.map((r) => r.map((c) => (/[",;\n]/.test(String(c)) ? `"${String(c).replace(/"/g, '""')}"` : String(c))).join(';')).join('\r\n');

// ---------- pacotes ----------
const setById = new Map(d.variable_sets.map((s) => [s.sys_id, s]));
fs.mkdirSync(path.join(outDir, 'pacotes'), { recursive: true });

const index = [];
for (const i of d.itens) {
  const refs = (i.catalog_variable_sets || []).slice().sort((a, b) => +a.order - +b.order);
  const faltam = refs.filter((r) => !setById.has(r.variable_set.__text)).map((r) => r.variable_set.__text);
  const sets = refs.map((r) => setById.get(r.variable_set.__text)).filter(Boolean);
  const ctx = contexto(i, setById);
  const leitura = faltam.length ? [`variable set não encontrado no export: ${faltam.join(', ')}`] : [];
  const att = atencao(i, sets);
  registrarQuebras(i, ctx);

  const c = i.conversational || {};
  const pk = {
    sys_id: i.sys_id, name: i.name, tipo: i.sys_class_name === 'sc_cat_item_producer' ? 'record_producer' : 'catalog_item',
    table_name: i.table_name, category: dv(i.category), sc_catalogs: i.sc_catalogs,
    short_description: clean(i.short_description), description: clean(i.description),
    make_item_non_conversational: i.make_item_non_conversational, turn_off_nowassist_conversation: i.turn_off_nowassist_conversation,
    diagnostico_previo: { veredito: c.veredito, bloqueadores: c.bloqueadores },
    producer_script: clean(i.script && i.script.script_understanding) || undefined,
    precisa_leitura_completa: leitura.length ? leitura : undefined,
    atencao: att.length ? att : undefined,
    nomes_ambiguos: ctx.ambiguos.size ? [...ctx.ambiguos] : undefined,
    variaveis: variaveis(i.catalog_variables, ctx),
    ui_policies: policies(i.catalog_ui_policies, ctx, true),
    client_scripts: clientScripts(i.catalog_client_script),
    variable_sets: refs.filter((r) => setById.has(r.variable_set.__text)).map((r) => variableSet(setById.get(r.variable_set.__text), r.order, ctx)),
    primeira_analise: primeiraAnalise(analise.get(i.sys_id)),
  };
  let json = JSON.stringify(pk);
  if (json.length > TETO_PACOTE) {
    pk.precisa_leitura_completa = [...(pk.precisa_leitura_completa || []), `pacote com ${json.length} bytes (>${TETO_PACOTE})`];
    json = JSON.stringify(pk);
  }
  fs.writeFileSync(path.join(outDir, 'pacotes', `${i.sys_id}.json`), json);
  const setBytes = Object.fromEntries(pk.variable_sets.map((s) => [s.sys_id, JSON.stringify(s).length]));
  index.push({
    sys_id: i.sys_id, name: i.name, table: i.table_name, category: pk.category, veredito: c.veredito,
    recomendacao: pk.primeira_analise && pk.primeira_analise.recomendacao, last_12m: i.volume ? +i.volume.last_12m : 0,
    bytes: json.length, bytes_sem_sets: json.length - Object.values(setBytes).reduce((a, b) => a + b, 0), sets: setBytes,
    precisa_leitura_completa: leitura.length + (json.length > TETO_PACOTE ? 1 : 0), atencao: att.length,
    pendencias_humanas: pk.ui_policies.filter((p) => p.pendencia_humana).length,
  });
}
fs.writeFileSync(path.join(outDir, 'index.json'), JSON.stringify(index, null, 1));
// Hash das fontes: o manifest dos lotes copia daqui e o validador avisa se a 1ª análise mudou depois do digest.
const sha = (f) => (fs.existsSync(f) ? crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex') : null);
fs.writeFileSync(path.join(outDir, 'fontes.json'), JSON.stringify({ export: { arquivo: src, sha256: sha(src) }, primeira_analise: { arquivo: analiseFile, sha256: sha(analiseFile) } }, null, 1));
d.variable_sets.forEach(registrarQuebrasSet);
const relDir = path.join(path.dirname(outDir), 'relatorios');
fs.mkdirSync(relDir, { recursive: true });
fs.writeFileSync(path.join(relDir, 'policies-quebradas.csv'), '﻿' + csv(csvLinhas)); // BOM: abre certo no Excel
const total = index.reduce((a, b) => a + b.bytes, 0);
const n = (k) => index.filter((x) => x[k]).length;
console.log(`pacotes: ${index.length}, bytes: ${total}, maior: ${Math.max(...index.map((x) => x.bytes))}, precisa_leitura_completa: ${n('precisa_leitura_completa')}, atencao: ${n('atencao')}, com pendência humana: ${n('pendencias_humanas')}, policies-quebradas.csv: ${csvLinhas.length - 1} linhas`);
