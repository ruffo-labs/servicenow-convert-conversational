---
name: regras-catalogo
description: Regras para escrever a spec do novo catálogo conversacional do ServiceNow (Now Assist / Virtual Agent) a partir de um lote de pacotes (pasta work/lotes/lote-NN). Cobre o formato delta, os códigos fechados, a precedência de textos, os critérios de analise_humana e de atencao, e a validação. Use sempre que for processar um lote do catálogo.
---

# Regras do novo catálogo conversacional

Você recebe um lote com até 12 itens em `work/lotes/lote-NN/`: `lote.json` (itens e sets do lote),
`itens/<sys_id>.json` (um pacote por item) e `sets/<sys_id>.json` (cada variable set uma vez). Para cada item, escreva **um arquivo** `<sys_id>.json` na pasta de saída (padrão `work/specs/lote-NN/`)
com o **delta** do item: só o que muda. Depois valide com `node scripts/validate-spec.js work/specs/lote-NN`
e corrija só os arquivos com erro. O que você não escreve, o código mantém igual ao original.

## 1. Princípios (em ordem de precedência; em conflito, vale o de cima)
1. **Zero perda.** Toda variável que coleta dado continua em pelo menos um derivado. A base é **sempre o catálogo
   original**, nunca a 1ª análise.
2. **Omitido = mantido igual ao original, em todos os derivados.** Variável, variable set, UI policy (inclusive
   `nova_*`) e client script que você não cita vão para todos os derivados sem mudança.
3. **Variable set é compartilhado:** não altere variáveis de set. Policies do item podem agir sobre elas.
4. **Policies sem código:** prefira prop na variável ou UI policy a client script.
5. **Textos e labels:** conversa curta, em pt-BR (em espanhol se o item só está no catálogo hispânico).

## 2. Entrada
Cada pacote tem: dados do item, `variaveis`, `ui_policies` (condições e ações já com **nome** de variável),
`client_scripts` (com resumo do script), `variable_sets` (referência; o conteúdo está em `sets/<sys_id>.json`),
`primeira_analise`, e às vezes `atencao`, `nomes_ambiguos` ou `pendencia_humana` em uma policy.
- **`nomes_ambiguos`:** o mesmo nome existe no item e num set. Essas variáveis trazem `sys_id`, e na spec
  você as cita **pelo sys_id**, nunca pelo nome (o validador recusa o nome).
- **Policy com `pendencia_humana`:** a condição usa uma variável que não existe mais. Não mexa nela; o time
  de ServiceNow vai resolver. Ações sobre variáveis ausentes já foram removidas pelo código. Manter a policy
  (e as variáveis que ela controla) **não é divergência**, mesmo que a 1ª análise peça para removê-la: não
  registre em `divergencias`.

## 3. Formato da spec
```json
{
  "sys_id": "<item>", "status": "conversacional | dividido | analise_humana", "motivo": "1-3 frases",
  "criterio": "<só em analise_humana, ver §9>",
  "divergencias": ["<código §8, só se divergir da 1ª análise>"],
  "vars": {
    "<variável>": { "label": "…", "props": { "mandatory": true } },
    "nova_<nome>": { "nova": { "type": "33", "question_text": "…", "mandatory": false, "order": 900 } }
  },
  "remover": { "<variável>": "<código §4>" },
  "policies": {
    "<sys_id>": "remover",
    "<sys_id>": { "conditions": "…", "actions": { "<variável>": { "visible": true, "mandatory": true } } },
    "nova_<nome>": { "short_description": "…", "conditions": "…", "actions": { … }, "origem": "<sys_id do client script>" }
  },
  "scripts": { "<sys_id>": { "converter": "<código>" } },
  "itens": [ { "name": "…", "short_description": "…", "description": "…", "frases_exemplo": ["…"],
               "de_1a": 0, "fixas": { "<variável>": "<value>" }, "vars": { … },
               "sem_vars": ["…"], "sem_sets": ["<sys_id>"], "sem_policies": ["<sys_id|nova_…>"], "sem_scripts": ["<sys_id>"],
               "flags": { "make_item_non_conversational": false } } ]
}
```
- `vars`: `label` só em variável existente. Variável nova (`nova_*`) leva o texto **só** em `nova.question_text`.
  Opções de variável nova de escolha: `"choices": [{ "text": "Rótulo", "value": "valor" }, …]`, com `value` único.
  **Não** use o formato `"Rótulo [=valor]"` do pacote (o validador recusa). Ao unir duas listas, mantenha o
  `value` original de cada opção.
  `props` aceita: `mandatory, hidden, read_only, default_value, not_available_conversation, type, include_none,
  validation_regex, order, reference_qual`. O texto da variável nunca vai em props.
- `itens`: num `conversacional`, pode omitir (1 derivado, textos herdados). Num `dividido`, um objeto por derivado.
  Cada derivado diz só o que **tira** (`sem_*`) e o que **fixa** (`fixas`, com o **value** da choice).
  `de_1a: k` herda os textos e labels do derivado k da 1ª análise. `vars` dentro do derivado sobrepõe o topo.
- `analise_humana`: só `sys_id`, `status`, `criterio`, `motivo` (e `divergencias`, se houver).

## 4. Variáveis
**Toda variável perguntada precisa de label** (herdado ou escrito): tipo que coleta dado, não oculta, não
`not_available_conversation`, não fixa. O original quase não tem `conversational_label`; se a 1ª análise não
trouxer, escreva um. Não copie o `question_text` do formulário (costuma estar em inglês e em estilo de campo).

**Tirar da conversa variável que coleta dado** (`props.hidden` ou `props.not_available_conversation`) só é
permitido se (a) o original já a tirava (`hidden`/`not_available_conversation` no pacote, ou policy sem condição
que a oculta) ou (b) ela tem `default_value` (no pacote ou na sua spec, ex.: `javascript:gs.getUserID()`).
Fora disso, a variável continua perguntada e precisa de label (`read_only` não a tira da conversa). Se a 1ª
análise pede `derivar` ou `ocultar_na_conversa` e nenhum dos dois casos vale, mantenha a pergunta e registre
`limite_formato`.

Estilo do label:
- **Português do Brasil.** Espanhol só se o item estiver apenas no catálogo hispânico.
- **Pergunta direta**, terminando em "?". Anexo e texto livre podem ser pedido: "Envie…", "Descreva…".
- **Curta:** uma frase, de preferência até ~80 caracteres. Explicação longa vai para a `description` do item.
- **Segunda pessoa ("você")**, no tom de quem atende: "Qual é…", "Você já…", "Para quem é…".
- Sem jargão de formulário ("campo abaixo", "selecione", "preencha") e sem código ou nome técnico da variável.

| `question_text` original | label |
|---|---|
| "2 Document Number (Invoice)" | "Qual é o número da nota fiscal?" |
| "Select the classification of the contract service according to complementary law 116/2003." | "Qual é a classificação do serviço pela Lei Complementar 116/2003?" |

Remover (`remover`), lista fechada:
| Código | Quando |
|---|---|
| `visual` | variável visual ou de apresentação (label, break, container, rich text, custom/widget só de exibição) |
| `texto_movido_descricao` | label/rich text/HTML cujo texto você levou para a `description` do item |
| `sem_uso_conversa` | **só** variável que não coleta dado (label, HTML, layout) |
| `{"substituida_por": "<var>"}` | substituída por outra (ex.: widget de anexo → `nova_anexo` tipo 33). A alvo precisa existir e ser `nova_*` ou do **mesmo tipo** (outro tipo = outro dado) |
| `{"duplicada_no_set": "<var do set>"}` | o mesmo dado já é coletado por variável de um set do item |
| `{"outro": "texto curto"}` | só para variável que não coleta dado |

Variável que **coleta dado** só sai com `substituida_por` ou `duplicada_no_set`. Se não couber na conversa e
não tiver substituta, o item vai para `analise_humana` (`dado_sem_destino`).

## 5. Tipos de variável (campo `type`)
| Código | Tipo | Coleta dado |
|---|---|---|
| 1 | Sim/Não | sim |
| 2 | Texto de várias linhas | sim |
| 3 | Múltipla escolha | sim |
| 5 | Select box (lista) | sim |
| 6 | Texto de linha única | sim |
| 7 | Checkbox | sim |
| 8 | Referência | sim |
| 9 | Data | sim |
| 10 | Data/Hora | sim |
| 16 | Texto de linha única larga | sim |
| 18 | Lookup select box | sim |
| 21 | List collector | sim |
| 29 | Duração | sim |
| 33 | Anexo | sim |
| 14, 15, 17 | Custom, UI page, custom com label | depende (ver §10) |
| 11 | Label | não |
| 12 | Break | não |
| 19, 20, 24 | Container início, fim, divisão | não |
| 23 | HTML | não |
| 32 | Rich text label | não |

## 6. UI policies
- Condição: `variavel=valor`, `^` = E, `^OR` = OU, `variavelISEMPTY`, `variavelISNOTEMPTY`, `variavelINa,b`.
  Use o **value** da choice.
- Ação: objeto `{"visible": bool, "mandatory": bool, "readonly": bool, "clear": true, "set": "valor"}`.
- onLoad sem condição que só fixa atributo → `"remover"` na policy e a prop na variável.
- Condicional que continua útil: omita (fica igual) ou reescreva `conditions`/`actions`.
- Condições e ações só podem citar variáveis **presentes no derivado** (do item ou de set que o derivado tem).
  Num `dividido`, tire do derivado (`sem_policies`) a policy que age sobre uma variável que ele não tem.
- `nova_*`: exige `short_description`, `conditions` e `actions`. Vai para todos os derivados, salvo `sem_policies`.
- **Ocultar variável que coleta dado** (`"visible": false`, do item ou de set) exige **condição real**. Policy
  sem condição ou sempre verdadeira (`vISEMPTY^ORvISNOTEMPTY`) que oculta dado é erro: é perda de dado disfarçada.
- **Tirar um set de um derivado: só com `sem_sets`**, nunca com policy que oculta as variáveis dele. O set
  precisa ficar em pelo menos um derivado (zero perda). Se a 1ª análise pede para ocultar um set e não há
  derivado de onde tirá-lo, mantenha o set e registre `limite_formato`.

## 7. Client scripts (`scripts`), um objeto com exatamente uma chave
| Chave | Códigos |
|---|---|
| `converter` | `props`, `regex`, `default`, `auto_populate`, `"policy:<sys_id ou nova_…>"` (a policy precisa existir) |
| `remover` | `sem_efeito`, `{"substituido_por": "<policy, script ou variável>"}` |
| `ajustar` | lista com `va_supported`, `remover_dom`, `ui_type_all` (o script continua) |

Script convertido ou removido sai da saída. Script omitido continua igual.
**`so_desktop` está bloqueado** (decisão pendente sobre o uso do catálogo fora do assistente): não use.

## 8. 1ª análise (`primeira_analise`)
É uma **referência revisada por humano**: siga a recomendação, a divisão, os textos e os labels dela.
- **Precedência de textos: spec > 1ª análise > original.** Label: derivado > topo > 1ª análise > original.
  Textos do item: spec > 1ª análise (ou `de_1a`) > original.
- **Não repita** na spec um texto igual ao da 1ª análise: omita e ele é herdado (o validador avisa).
  Num `dividido`, use `"de_1a": k` no derivado que corresponde ao derivado k da 1ª análise e **não copie** nome,
  textos, frases nem labels dele (o validador avisa também nos divididos).
- Divergir (status diferente da recomendação, label ou texto diferente) exige `divergencias` com código:
  `divisao_diferente`, `label_melhor`, `regra_negocio`, `erro_1a_analise`, `limite_formato`, `{"outro": "…"}`.
- **`limite_formato`**: a 1ª análise pede algo que o formato da spec não permite. Ex.: editar as opções de uma
  variável (unir duas listas), fixar ou ocultar variável de set, alterar variável de set. Faça o mais próximo
  que o formato permite, sem perder dado, e explique no `motivo`.
- Mapa recomendação → status: `conversacional`/`conversacional_com_ajustes` → `conversacional`; `dividir` →
  `dividido`; `manter_formulario`, `avaliar_desativacao`, `substituir_por_link_kb` → `analise_humana`.

## 9. `analise_humana`, lista fechada de `criterio`
| Código | Quando |
|---|---|
| `item_atalho` | sem perguntas, só leva a um link/sistema externo (vira KB ou tópico). Os da 1ª análise já vêm resolvidos pelo código e não aparecem no lote |
| `formulario_complexo` | muitas perguntas interdependentes ou scripts que não dá para converter com segurança |
| `custom_coleta_dado` | widget/macro custom coleta dado e não há variável OOB equivalente |
| `dado_sem_destino` | variável de dado que não cabe na conversa e não tem substituta |
| `sem_uso` | sem finalidade clara ou item a desativar. Idem: os da 1ª análise já vêm resolvidos |
| `duvida_negocio` | depende de decisão de negócio |
| `{"outro": "…"}` | texto curto obrigatório |

Uma policy com `pendencia_humana` **não** manda o item para `analise_humana`.

## 10. `atencao`, tratamento por motivo
| Motivo | Como tratar |
|---|---|
| opções dinâmicas (`lookup_table`/`choice_table`) | as opções vêm de tabela: **não** converta em lista fixa; mantenha a variável e dê um label que funcione com qualquer opção |
| `reference_qual` com `javascript:` | idem: o filtro roda no servidor e funciona na conversa; **não** troque por escolhas fixas |
| custom/macro/widget (14, 15, 17, ou com macro/sp_widget) | só exibe → `remover: visual`; coleta dado com equivalente OOB → `nova_*` + `substituida_por`; sem equivalente → `analise_humana` (`custom_coleta_dado`) |
| 5+ variable sets | confira se cada set é necessário em cada derivado; tire com `sem_sets` o que não for |
| 40+ choices | lista longa na conversa: prefira referência ou lookup se já existir; senão mantenha e escreva um label que ajude a pessoa a digitar |

## 11. "outro"
Toda lista fechada aceita `{"outro": "texto curto"}` (até 200 caracteres). Use só quando nenhum código servir:
o percentual de "outro" é medido.

## 12. Exemplos (entrada resumida → saída)

**conversacional**: "Solicitações Diversas sobre Encargos (Jurídico)". Variáveis: `v_cont_start_legal` (19),
`v_describe_legal` (2). Policy `092fc151…` onLoad sem condição: `v_describe_legal: mandatory=true`. A 1ª análise
já tem nome, textos e label, que são herdados.
```json
{
  "sys_id": "139bc59d1b44a558d1abda4ce54bcbef",
  "status": "conversacional",
  "motivo": "Intenção única com uma pergunta aberta. A policy só torna a descrição obrigatória: vira prop.",
  "vars": { "v_describe_legal": { "props": { "mandatory": true } } },
  "remover": { "v_cont_start_legal": "visual" },
  "policies": { "092fc1511bc4a558d1abda4ce54bcb44": "remover" }
}
```

**dividido**: "Adicionar ou Remover membros em Grupos". `v_type` (add/remove) separa duas intenções. A 1ª análise
tem 2 derivados com textos e labels (`de_1a`). `v_tower` não tem label na 1ª análise, então o label é escrito.
Os scripts limpam campos ou escondem por tipo.
```json
{
  "sys_id": "2a4bc3a71b283110a530426fe54bcbd4",
  "status": "dividido",
  "motivo": "Duas intenções (incluir e retirar membro) com perguntas diferentes. v_type vira valor fixo em cada derivado.",
  "vars": {
    "v_tower": { "label": "De qual torre é o grupo de atendimento?", "props": { "mandatory": true } },
    "group": { "props": { "mandatory": true } },
    "v_justify_your_request": { "props": { "mandatory": true } },
    "manager": { "label": "Quem é o gestor do grupo?", "props": { "read_only": true } },
    "v_user": { "props": { "default_value": "javascript:gs.getUserID()" } }
  },
  "policies": {
    "300944b31b207110a530426fe54bcb3c": "remover",
    "3a5108371bec3110a530426fe54bcbd7": "remover",
    "f52088731bec3110a530426fe54bcb45": "remover",
    "fe83d4f31b607110a530426fe54bcb05": "remover",
    "88e088731bec3110a530426fe54bcb1a": { "conditions": "v_requests_for_whom=someone", "actions": { "v_user": { "visible": true, "mandatory": true } } }
  },
  "scripts": {
    "559234c41bb83110a530426fe54bcb3a": { "converter": "default" },
    "6824847b1bec3110a530426fe54bcbac": { "remover": "sem_efeito" },
    "6933003b1bec3110a530426fe54bcbbf": { "remover": "sem_efeito" },
    "c942c4771bec3110a530426fe54bcb9b": { "converter": "policy:88e088731bec3110a530426fe54bcb1a" },
    "d18444bb1bec3110a530426fe54bcbd0": { "converter": "auto_populate" }
  },
  "itens": [
    { "de_1a": 0, "fixas": { "v_type": "add" }, "sem_vars": ["v_group_members"] },
    { "de_1a": 1, "fixas": { "v_type": "remove" }, "sem_vars": ["v_requests_for_whom", "v_user"], "sem_policies": ["88e088731bec3110a530426fe54bcb1a"] }
  ]
}
```

**analise_humana**: "Solicitação de Liberação de Medicamento". Formulário da equipe do Serviço Médico, com
8 variáveis, anexo de receita médica (dado de saúde) e 4 pedidos no ano. A 1ª análise diz `manter_formulario`.
```json
{
  "sys_id": "13a1b0d287474390ec360e530cbb3512",
  "status": "analise_humana",
  "criterio": "formulario_complexo",
  "motivo": "Uso exclusivo da equipe do Serviço Médico, volume muito baixo e anexo de receita (dado de saúde). A 1ª análise recomenda manter como formulário; decidir se entra no assistente."
}
```

## 13. Antes de terminar o lote
- Um arquivo por item, nome `<sys_id>.json`, JSON válido.
- `node scripts/validate-spec.js work/specs/lote-NN` com **0 erros**. Avisos da spec (texto repetido) → omita
  o texto. "Avisos do original" não são com você.
- Corrija só os arquivos com erro. No máximo 3 rodadas de correção.
