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
