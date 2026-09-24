> **Substituído** por [.claude/skills/regras-catalogo/SKILL.md](../.claude/skills/regras-catalogo/SKILL.md) (formato delta). Mantido só como histórico.

# Instruções: especificação do novo catálogo (por item original)

Objetivo: para cada item original, definir o **estado final** do(s) item(ns) no novo catálogo conversacional.
Um script (`scripts/build-novo-catalogo.js`) depois monta os objetos completos, copiando do export original
todos os atributos das variáveis e das policies citadas **pelo nome**. Por isso você só descreve estrutura e mudanças.

Entrada por item:
- digest `work/digests/items/<sys_id>.json`;
- a sugestão já feita na 1ª análise (`work/results/batch-XX.json`, mesmo sys_id): nome, descrição, frases,
  labels, divisão. Reaproveite tudo o que estiver bom.

## Regras obrigatórias
1. **Não perder funcionalidade.** Toda variável que carrega dado (tipo diferente de Container Start/End/Split,
   Label, Break, Rich Text Label) precisa aparecer em pelo menos um item novo.
   - Não deve ser perguntada? Mantenha com `not_available_conversation: true` e/ou `hidden: true` +
     `default_value` / auto-populate.
   - Divisão: a variável que fixa o ramo (ex.: tipo de solicitação) vai para cada derivado em `variaveis_fixas`,
     com o valor daquele ramo. As variáveis exclusivas de um ramo vão só para o derivado desse ramo, e as comuns
     vão para todos.
   - Se não tiver certeza de a qual ramo uma variável pertence, coloque-a em todos os derivados em que ela
     possa ser usada.
2. Podem sair do item novo (listar em `variaveis_nao_utilizadas` com motivo) **somente** variáveis visuais:
   containers, labels, breaks, rich text informativo e widgets/macros de apresentação.
   Quem move texto informativo relevante para a descrição do item diz isso no motivo.
   Widget/macro/custom que coleta dado (ex.: anexo customizado) → substituir por variável OOB `nova`
   (ex.: Attachment) e listar a original em `variaveis_nao_utilizadas` com motivo "substituída por <nova>".
3. **Variable sets**: referencie por sys_id e nome em `variable_sets`, não copie as variáveis.
   Numa divisão, cada derivado leva os sets de que precisa. Todo set do original tem que estar em pelo menos um derivado.
4. **UI policies no-code**: gere a lista final de policies de cada item novo.
   - As onLoad que só definem atributo fixo (mandatory/visible/read-only incondicional) → aplique o atributo
     direto na variável (`overrides`) e não gere policy. Registre em `conversoes`.
   - As condicionais que continuam fazendo sentido → mantenha (`origem_sys_id` da policy original quando existir)
     e ajuste a condição/ações ao item novo. Numa divisão, a condição sobre a variável que fixa o ramo some.
   - Use nomes de variável nas condições (`variavel=valor`, `^` = AND, `^OR` = OR) e nas ações.
5. **Client scripts**: converta para UI policy, Validation Regex, atributo, auto-populate ou default value
   sempre que possível (registre em `conversoes`). Script que não dá para converter e é necessário ao
   funcionamento → `client_scripts_mantidos` (sys_id + o que ajustar, ex.: marcar VA Supported ou remover DOM).
6. **status**:
   - `conversacional`: 1 item novo ajustado;
   - `dividido`: 2 ou mais itens novos;
   - `analise_humana`: não dá para deixar conversacional com segurança (formulário complexo, item-atalho de
     link/KB, sem uso, dúvida de negócio). Nesse caso `novos_itens` = `[{"copiar_original": true}]` e
     `motivo` explica o que a pessoa precisa decidir.
7. Conversational labels em pt-BR (em espanhol se o item for só do catálogo hispânico), em forma de pergunta
   curta. Toda variável perguntada na conversa precisa de `conversational_label`.

## Schema de saída (array, um objeto por item original)
```json
{
  "sys_id": "<item original>",
  "name": "<nome original>",
  "status": "conversacional | dividido | analise_humana",
  "motivo": "1-3 frases",
  "variaveis_nao_utilizadas": [{ "name": "…", "motivo": "…" }],
  "novos_itens": [
    {
      "name": "…", "short_description": "…", "description": "texto de negócio (HTML simples permitido)",
      "frases_exemplo": ["…"],
      "make_item_non_conversational": false, "turn_off_nowassist_conversation": false,
      "variaveis_fixas": [{ "name": "v_tipo", "value": "<value da choice>" }],
      "variables": [
        { "name": "<nome original ou nova_xxx>", "order": 100,
          "conversational_label": "…",
          "overrides": { "mandatory": true, "hidden": false, "read_only": false, "default_value": "…",
                          "not_available_conversation": false, "type": "<código>", "question_text": "…",
                          "include_none": true, "validation_regex": "…" },
          "nova": { "type": "33", "question_text": "…", "mandatory": false, "choices": [{ "text": "…", "value": "…" }] } }
      ],
      "variable_sets": [{ "sys_id": "…", "name": "…", "order": 100 }],
      "ui_policies": [
        { "origem_sys_id": "<opcional>", "short_description": "…", "on_load": false,
          "conditions": "v_x=valor^v_y=outro",
          "actions": [{ "variable": "v_z", "visible": "true", "mandatory": "true", "disabled": "ignore" }] }
      ],
      "client_scripts_mantidos": [{ "sys_id": "…", "name": "…", "ajuste": "…" }],
      "conversoes": [{ "origem": "<nome da policy/script>", "tipo": "ui_policy | client_script", "como": "…" }]
    }
  ]
}
```
- `overrides`: só os atributos que mudam. `nova`: só em variável nova (nome começando com `nova_`).
- Valores de choice em `variaveis_fixas`/`conditions`: use o **value** da choice quando o digest mostrar só o texto;
  o script tenta resolver texto → value.
- `variables` inclui as variáveis do próprio item (e não as de set), perguntadas ou não, com `order` final.
- JSON válido, texto em pt-BR.
