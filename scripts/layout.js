// Layout do formulário do item (variáveis "visuais" que organizam a tela, ordenadas por `order`):
//   12 Pausa (break): linha que separa uma estrutura da outra.
//   19 Início do contêiner > variáveis da esquerda > 24 Divisão > variáveis da direita > 20 Fim do contêiner (colunas lado a lado).
// Ao tirar variáveis de um item novo (divisão por destino/oferta), o layout precisa continuar coerente:
//   - contêiner com as duas colunas vazias sai inteiro; com só uma coluna com variável, sai o contêiner (as variáveis ficam empilhadas);
//   - pausa no começo, no fim ou colada em outra pausa sai.
// Variable sets não passam por aqui: entram inteiros, com o layout próprio (normal | 2across | 2down).
const LAYOUT = new Set(['12', '19', '20', '24']);

// own: variáveis ativas do item ({ sys_id, type, order }); manterDado: sys_ids das variáveis de dado que continuam no item novo.
// Devolve o Set de sys_ids de layout que devem sair.
function layoutQueSai(own, manterDado) {
  const seq = [...own].sort((a, b) => Number(a.order) - Number(b.order));
  const sai = new Set();
  const pilha = [];
  const blocos = [];
  for (const v of seq) {
    if (v.type === '19') pilha.push({ start: v, split: null, end: null, lado: 'e', e: 0, d: 0 });
    else if (v.type === '24' && pilha.length) { const b = pilha[pilha.length - 1]; b.split = v; b.lado = 'd'; }
    else if (v.type === '20' && pilha.length) { const b = pilha.pop(); b.end = v; blocos.push(b); }
    else if (pilha.length && manterDado.has(v.sys_id)) pilha[pilha.length - 1][pilha[pilha.length - 1].lado === 'e' ? 'e' : 'd']++;
  }
  for (const b of blocos) {
    const duas = b.split ? b.e > 0 && b.d > 0 : b.e > 0;
    if (!duas) [b.start, b.split, b.end].filter(Boolean).forEach((v) => sai.add(v.sys_id));
  }
  // Pausas: só ficam entre dois trechos com conteúdo.
  const significativos = seq.filter((v) => v.type === '12' || (LAYOUT.has(v.type) ? !sai.has(v.sys_id) : manterDado.has(v.sys_id)));
  let ultimo = null;
  for (const v of significativos) {
    if (v.type === '12') { if (!ultimo || ultimo.type === '12') sai.add(v.sys_id); else ultimo = v; } else ultimo = v;
  }
  for (let i = significativos.length - 1; i >= 0 && (significativos[i].type === '12' || sai.has(significativos[i].sys_id)); i--) if (significativos[i].type === '12') sai.add(significativos[i].sys_id);
  return sai;
}

module.exports = { LAYOUT, layoutQueSai };
