# Lote 04 (de 13): textos dos itens novos do catálogo (Assaí)
Dir: raiz do repositório. NÃO use a ferramenta Agent; trabalhe sozinho.

## Contexto
Itens de catálogo ServiceNow do Assaí para o Now Assist / Virtual Agent. Cada item tem a variável de oferta (`service_offering`): cada oferta mostra um formulário.
O código já agrupou as ofertas OPERACIONAIS com o MESMO formulário em "grupos". Cada grupo vira um item conversacional novo (item de 1 grupo continua um só).
O código já decidiu a estrutura: variáveis que saem, obrigatórias, policies, e já retirou as variáveis de ofertas desativadas.
Você escreve só **textos, labels e decisão sobre client scripts**. Leia as seções 4 (Variáveis, estilo do label) e 7 (Client scripts) de
`.claude/skills/regras-catalogo/SKILL.md`.

## Entrada
`work/assai-op/lotes/lote-04/lote.json` lista os itens. Para cada um, leia `work/assai-op/lotes/lote-04/pacotes/<sys_id>.json`:
name, category, descrições, sets (só nomes, não alterar), grupos [{k, ofertas (nome, sla, grupo_suporte), sai_do_formulario, passa_a_obrigatoria,
condicoes_que_continuam}], perguntas (variáveis do item que coletam dado), tecnicas_ocultas, client_scripts.

## Saída
Para cada item grave `work/assai-op/lotes/lote-04/textos/<sys_id>.json`:
```json
{"sys_id":"…","motivo":"1-2 frases: o que muda de formulário entre as ofertas/grupos",
 "derivados":[{"k":0,"name":"…","short_description":"…","description":"…","frases_exemplo":["…"]}],
 "labels":{"<variavel>":"…"},
 "scripts":{"<sys_id do script>":{"remover":{"outro":"…"}}},
 "pendencias":["…"]}
```

## Regras
- **derivados**: um por grupo (mesmo k). name: o que o colaborador pediria, pt-BR, até ~70 caracteres, usando o(s) nome(s) da(s) oferta(s) do grupo; distinto entre os derivados do item.
  description: 2-4 frases de negócio dizendo quando usar e citando as ofertas do grupo. frases_exemplo: 4-5, informais e variadas. Não invente processo.
- **labels**: uma entrada para CADA item de "perguntas". Estilo da seção 4 (pt-BR, pergunta direta com "?", curta, segunda pessoa, sem "selecione/preencha/campo", nunca copie o question_text).
  Se duas variáveis parecem repetidas, diferencie pelo contexto.
- **scripts**: decida só sobre client_scripts ATIVOS (ativo = "true"); script omitido continua igual. Códigos fechados da seção 7:
  {"converter":"props|regex|default|auto_populate"}, {"remover":"sem_efeito"} ou {"remover":{"outro":"texto curto"}}, {"ajustar":["va_supported","remover_dom","ui_type_all"]}.
  - Script que só troca/limpa campo ou label conforme a oferta já é coberto pela estrutura do derivado: remover com {"outro":"…"}.
  - Script que depende de oferta desativada ou fora dos grupos (ex.: compara com sys_id fixo de oferta que não está em nenhum grupo): remover com {"outro":"oferta desativada"}.
  - Script que delega a lógica a um UI Script que não está no pacote: omita, sem pendência.
  - Em dúvida real, omita.
- **pendencias**: só decisão humana real de negócio, no máximo 3 por item (lista vazia se não houver). Não registre variável órfã nem script de oferta desativada.

## Antes de terminar
Rode `node scripts/oferta-lotes.js check work/assai-op/lotes/lote-04` e corrija até não faltar nada. Não altere outros arquivos.
Responda só: itens gravados, total de derivados, e pendências (1 linha cada).
