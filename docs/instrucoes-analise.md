# Instruções para o analista (por item)

Você analisa Record Producers / Catalog Items do ServiceNow e propõe como torná-los **AI First**, ou seja,
bons de pedir por conversa no Now Assist in Virtual Agent / ServiceNow Otto (Conversational Catalog Request).
Os critérios técnicos estão em `docs/criterios-conversacional.md`. Leia esse arquivo antes de começar.

## Entrada
Cada item é um digest JSON com estes campos:
- nome, descrições, volume, `diagnostico_previo` (veredito/bloqueadores/avisos já calculados);
- `variaveis` do item (em ordem), `variable_sets` (só o resumo das perguntas do set);
- `ui_policies` (condição → ações) e `client_scripts` (com o que o script faz);
- `producer_script`, `flows` e user criteria.

## Como pensar
1. **Qual é a intenção real do usuário?** Se o item agrupa intenções diferentes num "tipo de solicitação"
   (select box que muda todo o formulário via UI policy), proponha **dividir**: 1 item conversacional por intenção.
   Cada derivado fica com as perguntas daquela intenção. O select box vira o próprio item
   (default value / hidden). Recomende dividir só quando cada ramo tiver volume ou sentido próprio.
   Se forem 2 opções triviais, basta ajustar.
2. **O que dá pra não perguntar?** Dados do solicitante (auto-populate / `gs.getUserID()`), campos derivados,
   labels informativos, rich text com instrução (vira texto na descrição ou link de KB), containers.
3. **Bloqueadores**: diga exatamente o que trocar (ex.: variável Custom/widget de anexo →
   Attachment OOB ou anexo no final da conversa; client script sem VA Supported → reescrever como UI Policy
   sem script, ou marcar VA Supported se o script for compatível (sem DOM, sem g_form de layout)).
4. **Conversational labels** em **pt-BR**, curtas, em forma de pergunta natural, uma ideia por pergunta,
   sem jargão (acrônimos por extenso na primeira menção). Não repita o que já foi perguntado.
5. **Nome e descrição**: o nome é o que o usuário diria ("Solicitar adiantamento salarial").
   A descrição em linguagem de negócio explica quando usar e quando não usar
   (evita confusão com itens irmãos). Inclua 4–6 frases de exemplo no jeito que o colaborador escreveria,
   inclusive informais.
6. **Manter formulário** quando: muitas perguntas com lógica pesada, tabelas/grids, anexos obrigatórios
   de várias planilhas, uso interno técnico de baixo volume. Nesse caso ainda sugira nome, descrição e frases,
   para o item ser encontrado e aberto como link.
7. Volume ausente ou zero nos últimos 12 meses → recomendação `avaliar_desativacao`
   (sem gastar esforço de conversão detalhada, só justifique).
8. Seja concreto e use os nomes reais das variáveis. Não invente variáveis sem dizer que é `nova`.

## Saída
Grave **um arquivo JSON** (array) no caminho indicado, com UM objeto por item, neste schema:

```json
{
  "sys_id": "…", "nome_atual": "…", "tabela": "…", "volume_12m": 0,
  "recomendacao": "conversacional | conversacional_com_ajustes | dividir | manter_formulario | avaliar_desativacao",
  "prioridade": "alta | media | baixa",
  "esforco": "baixo | medio | alto",
  "prontidao_atual": 0,
  "justificativa": "2-4 frases",
  "nome_sugerido": "…",
  "short_description_sugerida": "…",
  "descricao_sugerida": "texto de negócio para o LLM (quando usar / quando não usar)",
  "frases_exemplo": ["…"],
  "bloqueadores": [{ "onde": "variavel/script", "problema": "…", "acao": "…" }],
  "perguntas": [
    { "ordem": 1, "variavel": "nome_real ou nova_xxx", "origem": "item | set:<nome>",
      "acao": "manter | remover | derivar | alterar_tipo | nova | ocultar_na_conversa",
      "tipo_sugerido": "(se alterar)", "conversational_label": "pergunta pt-BR (se for perguntada)",
      "obs": "…" }
  ],
  "scripts_e_policies": [{ "nome": "…", "acao": "manter | remover | converter", "substituicao": "…" }],
  "configuracoes": { "make_item_non_conversational": false, "turn_off_nowassist_conversation": false, "outras": ["…"] },
  "itens_derivados": [
    { "nome": "…", "short_description": "…", "descricao": "…", "frases_exemplo": ["…"],
      "fixar": "v_tipo = X (default/hidden)",
      "perguntas": [{ "ordem": 1, "variavel": "…", "conversational_label": "…" }] }
  ],
  "observacoes": "…"
}
```

- `perguntas`: liste só as que o usuário **vai responder** na conversa, mais as que você manda remover,
  derivar ou ocultar (com a ação). Não liste containers ou labels, a não ser para mandar remover algo relevante.
- Perguntas de variable set: inclua só se a recomendação for específica deste item. As recomendações gerais
  dos sets são feitas numa análise separada.
- `itens_derivados` só quando `recomendacao = dividir`. Nesse caso `perguntas` do item pai pode ficar vazio.
- `prontidao_atual`: 0–100, o quão pronto o item está hoje (considere o diagnóstico prévio).
- `prioridade`: combine volume_12m (alto volume = alta) com o ganho da conversa.
- Texto em pt-BR. JSON válido (sem comentários, sem vírgula sobrando).
