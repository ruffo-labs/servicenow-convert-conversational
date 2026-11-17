// Catálogo simples: monta as specs delta (formato da skill regras-catalogo) a partir dos textos dos analistas.
// - Item cujas opções de v_o_que_deseja têm o MESMO formulário (1 grupo): status conversacional, item inteiro.
// - Item com 2+ grupos (formulário muda conforme a opção): status dividido, 1 derivado por grupo (ver simples-plano.js).
// Variáveis padrão (v_o_que_deseja, v_descricao, v_anexos) recebem label por código; as demais vêm do analista.
// Uso: node scripts/simples-specs.js <export.json> <textos-antigos> <chunks-antigos> <textos-split> <pasta-specs>
//   textos-antigos/chunks-antigos: rodada anterior (sys_ids antigos, casados por NOME); textos-split: itens a dividir.
const fs = require('fs');
const path = require('path');
const { plano, textosAntigos, SEM_DADO, INTENCAO } = require('./simples-plano');

const [, , src, dirAntigos, dirChunks, dirSplit, out, dirNovos] = process.argv;
const d = JSON.parse(fs.readFileSync(src, 'utf8'));
const antigos = textosAntigos(dirAntigos, dirChunks);
const splits = new Map(fs.readdirSync(dirSplit).filter((f) => /^chunk-\d+\.json$/.test(f))
  .flatMap((f) => JSON.parse(fs.readFileSync(path.join(dirSplit, f), 'utf8'))).map((t) => [t.sys_id, t]));

// Textos novos por sys_id (<dirNovos>/<sys_id>.json): item inteiro sobrepõe a rodada anterior; item dividido acrescenta derivados (k) que faltavam.
const novos = new Map(dirNovos && fs.existsSync(dirNovos) ? fs.readdirSync(dirNovos).filter((f) => f.endsWith('.json')).map((f) => JSON.parse(fs.readFileSync(path.join(dirNovos, f), 'utf8'))).map((t) => [t.sys_id, t]) : []);

const PADRAO = {
  v_o_que_deseja: 'O que você deseja solicitar?',
  v_descricao: 'Descreva sua solicitação com o máximo de detalhes.',
  v_anexos: 'Envie os arquivos que ajudem no atendimento, se tiver.',
};
const NOTA_OFERTA = 'v_o_que_deseja é referência a service_offering: fixada pelo texto da opção; trocar pelo sys_id da oferta depois do cadastro.';

fs.mkdirSync(out, { recursive: true });
const pendencias = [];
let n = 0;
for (const orig of d.itens) {
  const p = plano(orig);
  const ant = antigos.get(orig.name);
  const nv = novos.get(orig.sys_id);
  const sp0 = splits.get(orig.sys_id);
  const sp = sp0 && nv && nv.derivados ? { ...sp0, derivados: [...sp0.derivados.filter((x) => !nv.derivados.some((y) => y.k === x.k)), ...nv.derivados] } : sp0;
  const ativas = orig.catalog_variables.filter((v) => v.active === 'true');
  const t = p.divide ? sp : (nv && ant ? { ...ant, ...nv } : nv || ant);
  if (!t) { pendencias.push(`${orig.name}: sem texto (${p.divide ? 'divisão' : 'rodada anterior'})`); continue; }

  const labels = { ...(ant && ant.labels), ...(sp && sp.labels) };
  const spec = { sys_id: orig.sys_id, status: p.divide ? 'dividido' : 'conversacional', motivo: p.divide ? `${t.motivo} ${NOTA_OFERTA}` : t.motivo, vars: {}, remover: {} };
  for (const v of ativas) {
    if (SEM_DADO.has(v.type)) { spec.remover[v.name] = 'visual'; continue; }
    if (v.hidden === 'true' || v.not_available_conversation === 'true') continue;
    const label = labels[v.name] || PADRAO[v.name];
    if (!label) { pendencias.push(`${orig.name}: variável ${v.name} sem label`); continue; }
    spec.vars[v.name] = { label };
  }
  if (!Object.keys(spec.remover).length) delete spec.remover;

  if (!p.divide) spec.itens = [{ name: t.name, short_description: t.short_description, description: t.description, frases_exemplo: t.frases_exemplo }];
  else {
    // As policies só mostravam/obrigavam campos conforme a opção: em cada derivado o formulário já é fixo, então saem
    // e o "obrigatório" delas vira prop da variável no derivado.
    spec.policies = Object.fromEntries(p.policies.map((id) => [id, 'remover']));
    const porNome = new Map(ativas.map((v) => [v.name, v]));
    const dados = ativas.filter((v) => !SEM_DADO.has(v.type)).map((v) => v.name);
    spec.itens = p.grupos.map((g, k) => {
      const tx = (t.derivados || []).find((x) => x.k === k);
      if (!tx) { pendencias.push(`${orig.name}: derivado ${k} sem texto`); return { name: `${orig.name} (${k})`, short_description: '', description: '', frases_exemplo: [] }; }
      const it = { name: tx.name, short_description: tx.short_description, description: tx.description, frases_exemplo: tx.frases_exemplo, sem_vars: dados.filter((x) => !g.vars.includes(x)) };
      if ((g.ofertas ? g.ofertas.length : g.opcoes.length) === 1) it.fixas = { [INTENCAO]: g.opcoes[0] }; // um REGISTRO só (nome repetido com outro parent não fixa)
      const obrig = Object.keys(g.mandatory).filter((x) => porNome.get(x) && porNome.get(x).mandatory !== 'true');
      if (obrig.length) it.vars = Object.fromEntries(obrig.map((x) => [x, { props: { mandatory: true } }]));
      if (!it.sem_vars.length) delete it.sem_vars;
      return it;
    });
  }
  fs.writeFileSync(path.join(out, `${orig.sys_id}.json`), JSON.stringify(spec, null, 1));
  n++;
}
console.log(`${n} specs em ${out}`);
if (pendencias.length) console.log(`pendências (${pendencias.length}):\n- ${pendencias.join('\n- ')}`);
