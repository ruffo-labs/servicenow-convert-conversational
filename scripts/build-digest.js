// Gera digests compactos (1 por item + 1 por variable set) a partir do export do catálogo,
// para servir de entrada na análise AI First.
// Uso: node scripts/build-digest.js input/catalog-map.json <pasta-saida>
const fs = require('fs');
const path = require('path');

const [, , src = 'input/catalog-map.json', outDir = 'work/digests'] = process.argv;
const d = JSON.parse(fs.readFileSync(src, 'utf8'));

const ENT = { nbsp: ' ', amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", ordm: 'º', ordf: 'ª', deg: '°', ndash: '–', mdash: '—', hellip: '…', laquo: '«', raquo: '»', bull: '•', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“', iexcl: '¡', iquest: '¿', euro: '€', sup2: '²', sup3: '³' };
const ACC = { acute: '́', grave: '̀', circ: '̂', tilde: '̃', uml: '̈', cedil: '̧' };
function decode(s) {
  return s
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&([a-zA-Z])(acute|grave|circ|tilde|uml|cedil);/g, (_, l, a) => (l + ACC[a]).normalize('NFC'))
    .replace(/&([a-z0-9]+);/gi, (m, n) => ENT[n] ?? m);
}
function text(html, max = 1200) {
  if (!html) return '';
  let t = decode(String(html).replace(/<br\s*\/?>|<\/p>|<\/li>|<\/div>/gi, '\n').replace(/<li[^>]*>/gi, '- ').replace(/<[^>]+>/g, ''));
  t = t.replace(/[ \t]+/g, ' ').replace(/\n\s*\n+/g, '\n').trim();
  return t.length > max ? t.slice(0, max) + '…' : t;
}
const dv = (x) => (x && typeof x === 'object' ? x._display_value || '' : x || '');
const LAYOUT = new Set(['11', '12', '19', '20', '24']);

function question(v) {
  const q = { name: v.name, type: v.type_label || v.type, type_code: v.type, label: text(v.question_text, 400) };
  if (v.mandatory === 'true') q.mandatory = true;
  if (v.hidden === 'true') q.hidden = true;
  if (v.read_only === 'true') q.read_only = true;
  if (v.active !== 'true') q.inactive = true;
  if (v.default_value) q.default = String(v.default_value).slice(0, 150);
  if (v.conversational_label) q.conversational_label = v.conversational_label;
  if (v.not_available_conversation === 'true') q.not_available_conversation = true;
  if (v.example_text) q.example = v.example_text;
  if (v.reference) q.reference = dv(v.reference) || v.reference;
  if (v.lookup_table) q.lookup = v.lookup_table;
  if (v.reference_qual) q.ref_qual = String(v.reference_qual).slice(0, 150);
  if (v.macro) q.macro = dv(v.macro);
  if (v.sp_widget) q.widget = dv(v.sp_widget);
  if (v.map_to_field === 'true') q.map_to_field = true;
  if (v.include_none === 'true') q.include_none = true;
  const choices = v.question_choices || v.choices;
  if (Array.isArray(choices) && choices.length) {
    const ch = choices.filter((c) => c.inactive !== 'true').sort((a, b) => +a.order - +b.order).map((c) => { const t = text(c.text, 120); return c.value && c.value !== t ? `${t} [=${c.value}]` : t; });
    q.choices = ch.length > 40 ? [...ch.slice(0, 40), `… +${ch.length - 40}`] : ch;
  }
  return q;
}
const questions = (vars) => (vars || []).slice().sort((a, b) => +a.order - +b.order).map(question);

function policies(ps) {
  return (ps || []).filter((p) => p.active === 'true').map((p) => ({
    name: p.short_description,
    when: p.catalog_conditions_label || p.catalog_conditions || '(sempre)',
    on_load: p.on_load === 'true',
    va_supported: p.va_supported,
    scripted: p.run_scripts === 'true' || undefined,
    actions: (p.ui_policy_actions || []).map((a) => {
      const flags = [];
      if (a.visible !== 'ignore') flags.push(`visible=${a.visible}`);
      if (a.mandatory !== 'ignore') flags.push(`mandatory=${a.mandatory}`);
      if (a.disabled !== 'ignore') flags.push(`readonly=${a.disabled}`);
      if (a.cleared === 'true') flags.push('clear');
      return `${a.variable || a.sys_name}: ${flags.join(',')}`;
    }),
  }));
}
function clientScripts(cs) {
  return (cs || []).filter((c) => c.active === 'true').map((c) => ({
    name: c.name, type: c.type, on: c.cat_variable ? String(c.cat_variable).replace(/^IO:/, '') : undefined,
    va_supported: c.va_supported, ui_type: c.ui_type,
    what: text(c.script && c.script.script_understanding, 500),
  }));
}

const setById = new Map(d.variable_sets.map((s) => [s.sys_id, s]));
const setUsage = new Map();

fs.mkdirSync(path.join(outDir, 'items'), { recursive: true });
fs.mkdirSync(path.join(outDir, 'sets'), { recursive: true });

const index = [];
for (const i of d.itens) {
  const sets = (i.catalog_variable_sets || []).slice().sort((a, b) => +a.order - +b.order).map((r) => {
    const s = setById.get(r.variable_set.__text);
    const id = r.variable_set.__text;
    if (!setUsage.has(id)) setUsage.set(id, []);
    setUsage.get(id).push(i.name);
    const qs = s ? questions(s.vs_variables).filter((q) => !q.inactive) : [];
    return {
      sys_id: id, name: dv(r.variable_set), order: r.order,
      perguntas: qs.filter((q) => !LAYOUT.has(q.type_code)).map((q) => `${q.name} (${q.type}${q.hidden ? ', hidden' : ''}${q.default ? ', default' : ''}${q.read_only ? ', ro' : ''}): ${q.label}`),
    };
  });
  // Escopo do digest: só o objeto do item + os variable sets que ele referencia.
  // Fora disso (workflow, taxonomy_topic, redirect_url, view, triggered_*, catalog_available_for/not_available_for,
  // volume) não entra — não serve pra decidir a estruturação conversacional, e o builder final lê esses campos
  // direto do JSON original, então nada se perde no output.
  const c = i.conversational || {};
  const dg = {
    sys_id: i.sys_id, name: i.name, sys_name: i.sys_name, tipo: i.sys_class_name === 'sc_cat_item_producer' ? 'record_producer' : 'catalog_item',
    table: i.table_name, category: dv(i.category), catalogs: i.sc_catalogs,
    short_description: text(i.short_description, 400), description: text(i.description, 1500),
    flags: { make_item_non_conversational: i.make_item_non_conversational, turn_off_nowassist_conversation: i.turn_off_nowassist_conversation },
    diagnostico_previo: { veredito: c.veredito, resumo: c.resumo, bloqueadores: c.bloqueadores, avisos: (c.avisos || []).map((a) => `${a.code}${a.onde ? ' @' + a.onde : ''}: ${a.detail}`) },
    producer_script: text(i.script && i.script.script_understanding, 600),
    variaveis: questions(i.catalog_variables).filter((q) => !q.inactive),
    variable_sets: sets,
    ui_policies: policies(i.catalog_ui_policies),
    client_scripts: clientScripts(i.catalog_client_script),
  };
  fs.writeFileSync(path.join(outDir, 'items', `${i.sys_id}.json`), JSON.stringify(dg, null, 1));
  index.push({ sys_id: i.sys_id, name: i.name, table: i.table_name, category: dg.category, veredito: c.veredito, last_12m: i.volume ? +i.volume.last_12m : 0, bytes: JSON.stringify(dg).length });
}

let setCount = 0;
for (const [id, usedBy] of setUsage) {
  const s = setById.get(id);
  if (!s) continue;
  setCount++;
  fs.writeFileSync(path.join(outDir, 'sets', `${id}.json`), JSON.stringify({
    sys_id: id, title: s.title, internal_name: s.internal_name, description: text(s.description, 500),
    usado_por: usedBy.length, itens_exemplo: usedBy.slice(0, 8),
    variaveis: questions(s.vs_variables).filter((q) => !q.inactive),
    ui_policies: policies(s.vs_ui_policies), client_scripts: clientScripts(s.vs_catalog_client_scripts),
  }, null, 1));
}
fs.writeFileSync(path.join(outDir, 'index.json'), JSON.stringify(index, null, 1));
console.log(`itens: ${index.length}, sets usados: ${setCount}, bytes totais itens: ${index.reduce((a, b) => a + b.bytes, 0)}`);
