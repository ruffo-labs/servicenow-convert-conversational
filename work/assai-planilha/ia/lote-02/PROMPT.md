# Lote 02 (de 05): textos AI First dos itens do catálogo do Assaí, na estrutura da planilha do cliente
Dir: raiz do repositório. NÃO use a ferramenta Agent; trabalhe sozinho.

## Contexto
Itens de catálogo ServiceNow para o Now Assist / Virtual Agent. O cliente definiu a estrutura: cada "grupo" de um pacote é um ITEM NOVO do catálogo,
com o caminho de categoria dele (Autoatendimento ou Gestor - RH Ponta > Preciso de um serviço de RH ou Preciso reportar um problema > categoria) e as ofertas dele.
NÃO divida nem una grupos: a estrutura (variáveis, policies, ofertas) já está decidida pelo código. Você escreve só textos e labels.
Leia as seções 4 (Variáveis, estilo do label) e 7 (Client scripts) de `.claude/skills/regras-catalogo/SKILL.md`.

## Entrada
`work/assai-planilha/ia/lote-02/lote.json` lista os itens. Para cada um, leia `work/assai-planilha/ia/lote-02/pacotes/<sys_id>.json`: name, descrições originais, grupos [{k, destino (caminho e nome do item na planilha), ofertas,
ofertas_de_outro_item, anterior (textos da rodada AI First anterior das ofertas deste grupo, só referência), condicoes_que_continuam}], perguntas (com `label_atual` quando já existe), client_scripts.
O arquivo `work/assai-planilha/ia/lote-02/textos/<sys_id>.json` já vem com os labels e as decisões de script da rodada anterior. Edite-o: **não apague labels nem scripts existentes**.

## O que escrever (editando textos/<sys_id>.json)
- **derivados**: um por grupo (mesmo k): {"k":0,"name":"…","short_description":"…","description":"…","frases_exemplo":["…"]}.
  - name = exatamente o nome do item na planilha (`destino.item`); se o pacote tiver dois grupos com o mesmo `destino.item`, diferencie com o contexto entre parênteses.
  - Como o caminho é serviço ou problema, o texto deve combinar: serviço = pedido/solicitação; problema = reportar divergência, falha ou não recebimento.
  - description: 2-4 frases de negócio dizendo quando usar e citando as ofertas do grupo. short_description: 1 frase. frases_exemplo: 4-5, informais e variadas, no modo de pedir do colaborador ou gestor. Não invente processo.
  - Use `anterior` como base quando ele servir; reescreva para o contexto serviço/problema e para as ofertas deste grupo.
- **labels**: só os que faltarem (perguntas sem `label_atual`). Estilo da seção 4: pt-BR, pergunta direta com "?", curta, segunda pessoa, sem "selecione/preencha/campo", nunca copie o question_text.
- **motivo**: 1 frase (ex.: "Item da planilha: <caminho>, com N oferta(s)."). **pendencias**: só decisão humana real de negócio, no máximo 3 (lista vazia se não houver).
- **scripts**: mantenha como estão, salvo script ATIVO sem decisão que claramente já é coberto pela estrutura (então {"remover":{"outro":"…"}}). Em dúvida, omita.

## Antes de terminar
Rode `node scripts/oferta-lotes.js check work/assai-planilha/ia/lote-02` e corrija até não faltar nada. Não altere outros arquivos.
Responda só: itens gravados, total de grupos, e pendências (1 linha cada).
