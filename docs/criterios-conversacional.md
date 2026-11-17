# Critérios para tornar itens de catálogo "AI First" (Conversational Catalog – Now Assist)

Referência usada para analisar cada item em `input/` e gerar as sugestões em `output/`.

## Como funciona o Conversational Catalog Request
- No Now Assist in Virtual Agent (e agora no ServiceNow Otto), o LLM encontra o item pela **intenção do usuário**,
  usando o **nome** e a **descrição** do item.
- Depois ele conduz a conversa pergunta por pergunta, com base nos **labels das variáveis**
  (ou no **Conversational Label**, quando está preenchido).
- **Slot filling**: se o usuário já informou algo na primeira frase, o LLM preenche e pula a pergunta.
- Multi-turn: o usuário pode corrigir respostas anteriores; há validação de resposta.
- Perguntas read-only ou já pré-preenchidas são puladas.
- **Help text / tooltip / instruções NÃO chegam ao LLM.** Só o nome, a descrição e os labels (ou conversational labels).
- Todo item é conversacional por padrão. Quando o item não é compatível, ele abre como tile/window/popup.

## Configurações relevantes
| Campo / propriedade | Uso |
|---|---|
| `Make the item non-conversational in VA` | Força o item a abrir como formulário |
| `Turn off Now Assist (LLM)` | Não envia dados ao LLM (sensível, pricing, scripts complexos) |
| `Use NLU for conversational requests` | Deixar desmarcado para usar o LLM |
| Conversational Label (variável) | Texto da pergunta em linguagem natural |
| `sn_now_assist_cr.llm.conversational.question.limit` | Limite de perguntas (padrão 500); referências antigas citam 15 variáveis |
| `sn_nowassist_va.now.assist.generic.ticket.fallback.record.producer` | Record producer de fallback (ticket genérico) |

## Bloqueadores (tornam o item não conversacional ou pioram a experiência)
- Tipos de variável customizados: Custom, Custom with Label, UI Page, Macro, Macro with Label.
- Tipos de variável que não aceitam linguagem natural: Attachment, Masked.
- Catalog Client Scripts, principalmente com manipulação de DOM, `g_form` complexo ou GlideAjax em cascata.
- UI Policies com script (Run scripts) e UI Policies `onLoad` sobre variáveis não inicializadas.
- Pricing (preço ou recurring price por variável).
- Content Item, Order Guide, Wizard Launcher e Standard Change Template: não são suportados, abrem como window.

## Tipos de variável com ressalvas
- **Checkbox**: não é agrupado sem uma variável intermediária. Melhor trocar por Multiple Choice ou Select Box.
- **Yes/No**: precisa de "Include None".
- **Date/DateTime**: formatos `yyyy-mm-dd` e `yyyy-mm-dd HH24:MI:SS`.
- **Reference**: tabelas grandes exigem ajuste de propriedades e de qualificadores de referência.
- **List Collector**: problemas com filtros dinâmicos ou scriptados.
- Layout (Container Start/End/Split, Label, Break) não gera pergunta. Não precisa de ação, mas não pode carregar lógica.

## Boas práticas (base das sugestões)
1. **Descrição de negócio** clara, sem jargão, com acrônimos por extenso e frases de exemplo
   ("preciso de acesso ao SAP", "meu notebook não liga").
2. **Conversational Label** em forma de pergunta direta ("Qual o centro de custo?").
3. **Poucas variáveis**: remover as redundantes e as que dá pra derivar
   (auto-populate a partir do usuário, default value).
4. **Ordem lógica** das perguntas, das mais amplas para as mais específicas.
5. Preferir tipos OOB: Select Box, Multiple Choice, Single Line Text, Reference.
6. Trocar scripts por recursos no-code: auto-populate, default value, Validation Regex,
   UI Policy sem script, atributos direto na variável (mandatory/read-only/visible).
7. **Dividir o item** quando ele mistura intenções diferentes (ex.: "Acesso" com ações Conceder/Remover/Alterar,
   ou um item genérico com N sistemas). Cada intenção vira um item conversacional mais enxuto,
   e o nome/descrição de cada um casa melhor com o que o usuário pede.
8. Manter como formulário (non-conversational) o que tiver lógica intrincada. O VA mostra o link.
9. Record Producer segue as mesmas regras: descrição e labels guiam o LLM.
   Mapeamento para campos da tabela destino deve continuar funcionando.

## Estrutura de saída por item (proposta)
- Identificação (sys_id, nome, tipo: catalog item / record producer)
- Diagnóstico: score de prontidão conversacional + bloqueadores + ressalvas
- Recomendação: `conversacional` | `conversacional com ajustes` | `dividir em N itens` | `manter como formulário`
- Novo nome e descrição sugeridos (+ frases de exemplo de intenção)
- Variáveis: manter / remover / alterar tipo / conversational label sugerido / nova ordem
- Scripts e UI Policies: substituição no-code sugerida
- Quando dividir: definição de cada novo item (nome, descrição, variáveis)
- Configurações: flags sugeridas (non-conversational, turn off Now Assist)

## `reference_choices` (variável de referência que funciona como select box)
Em alguns exports (ex.: Afya) uma variável do tipo Referência traz `reference_choices`: lista de opções `{text, value, order, inactive}`
no mesmo formato de `question_choices`. Tratamento:
- **Entender o nome do campo.** Ex.: `v_o_que_deseja` (referência a `service_offering`) é a intenção do pedido, e cada opção é uma oferta.
  A tabela referenciada precisa ter as opções cadastradas: os registros da tabela são pré-requisito do novo catálogo.
- **Tratar como choices normais.** O digest lista as opções em `choices` (como `question_choices`), a descrição e as frases de
  exemplo usam as opções reais, e o label da pergunta serve para qualquer opção.
- **Dividir só se o formulário mudar.** Se a opção escolhida muda as perguntas (UI policy, variáveis exclusivas de uma opção), cada
  opção (ou grupo de opções com o mesmo formulário) vira um item, com a variável fixada por `fixas`. Se o formulário é o mesmo
  para todas as opções, **não divide**: mantém um item só, com as opções na descrição e nas frases (o assistente preenche a
  opção pelo pedido do usuário).
- **Afya:** 124 variáveis, 483 opções, nenhum item com UI policy ou script, então o formulário é igual para toda opção e nenhum
  item foi dividido. `reference_choices` segue na saída, copiado do original sem alteração.

## Service offering no item (`reference_choices` no objeto do item) — ex.: Assaí
O item traz `reference_choices[0]`: a variável de oferta (`service_offering`, tabela `service_offering`, muitas vezes dentro de um variable
set compartilhado), o filtro e as `options`, que são os registros reais de oferta (SLA, grupo de suporte, serviço-pai, aprovação, flow...).
- **A oferta define o formulário.** Quase todas as UI policies condicionam em `service_offering = <sys_id da oferta>`. O plano
  (`scripts/oferta-plano.js`) avalia as policies oferta por oferta (`=`, `!=`, vazio, `IN`, alternativas `^NQ`) e agrupa as ofertas que
  resultam no MESMO formulário (mesmos efeitos e mesmas condições em outras variáveis). 1 grupo = item inteiro; 2+ = um item novo por grupo.
- **Dividir só pelo formulário** (principalmente quando a oferta muda a estrutura). SLA, grupo de suporte e aprovação diferentes NÃO dividem:
  seguem no registro da oferta e, quando variam entre ofertas agrupadas, vão em `observacoes_oferta` para revisão.
- **Variável que uma policy mostra só para algumas ofertas** sai dos grupos que não a usam. **Técnica** (`hidden=true`, nenhuma policy da
  oferta a mostra) e **órfã** (a policy que a mostra aponta para ofertas fora da lista) ficam em todos os itens novos (zero perda); a órfã
  é sinalizada em `variaveis_orfas` para o time decidir.
- **O set da oferta não é alterado.** Cada item novo ganha `reference_choices` só com as ofertas do grupo e `oferta_fixa` (sys_id quando o
  grupo tem uma oferta só, senão `null`); o sistema de destino decide como aplicar.
- As policies da oferta saem dos itens divididos: o que faziam vira estrutura fixa do grupo (variável que sai, obrigatória) ou uma
  policy condicional nova (só o resíduo da condição, sem o termo da oferta).

## Regras de saída que valem para todos os clientes
- **Categoria de item desmembrado** (`scripts/categorias.js`): um item que vira 2+ itens novos ganha uma categoria nova com o NOME DO ITEM (ex.: "ABAX"),
  os itens novos ficam dentro dela e a categoria que o item tinha vira o PAI da nova (a cadeia de pais da categoria antiga é preservada).
  A lista fica em `categorias_novas` no topo do arquivo; o `__text` (sys_id) da categoria nova fica vazio até ela ser criada na instância.
  Item que não se divide mantém a categoria original.
- **`icon` não é usado**: sai de todos os itens. **`meta`** (palavras-chave de busca) é copiado para cada item novo.
- **Ofertas (service offerings) com `custom`**: o registro da oferta vai completo para o item novo que a contém, inclusive `custom` (colunas da planilha:
  aprovações, estimativa, OLA, horário, `variaveis_formulario`...), amarrado para exportação. Oferta que o cliente marcou como desativada não entra.
- **Lista de módulos e similares** (segundo `reference_choices` do item, de outra variável de referência) fica inteira no item novo que tem a variável.

## Nome da saída e identidade das ofertas (todos os clientes)
- **Nome da saída:** `<nome da entrada>-TOBE-YYYY-MM-DD_HH-mm-ss.json` (hora local de geração), na pasta `output/`. Facilita parear AS IS e TO BE.
  Gere com `OUT=$(node scripts/nome-saida.js input/<entrada>.json)` e passe `$OUT` ao `build-novo-catalogo.js` e ao finalizador.
- **Identidade da oferta (service offering) = o registro** (sys_id; nome + parent). Ofertas com o mesmo nome e `parent` diferente são ofertas
  distintas, nunca duplicata: todas entram, cada uma em exatamente um item novo. Em 2 registros com mesmo nome E mesmo parent, ficam os dois e o
  item recebe `ofertas_mesmo_nome_e_parent` para conferir com o cliente.
- **Formulário de cada oferta:** vem da lista da planilha do registro (`custom.variaveis_formulario`, que é por registro); sem a lista, de `used_in_offers`
  (que só tem nome e não separa registros de mesmo nome). Variável que nenhuma oferta lista fica em todos os itens novos (zero perda).
- **Cobertura verificada no finalizador** (`simples-finaliza.js`): se alguma oferta faltar ou se repetir, o arquivo não é gerado. Resultado em `metadata.ofertas`.
- **Não criar oferta nova.** Só se for inevitável: entra em `ofertas_novas` (topo do arquivo) com `name`, `parent`, `support_group` e `sla` COPIADOS da oferta
  de origem, `origem_oferta` (sys_id e nome) e o `motivo`, e é sinalizada ao cliente. Hoje `ofertas_novas` é sempre `[]`.
