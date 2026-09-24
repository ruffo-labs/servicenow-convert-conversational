# Contexto: reestruturação do catálogo (ServiceNow)

Decisões tomadas em conversa no claude.ai. Valide contra o código real antes de implementar.

## Objetivo
Gerar `novo-catalogo.json` com sugestões de alteração estrutural dos itens de catálogo, com cobertura total: `validate-spec.js` exige que toda variável apareça em algum item novo (zero perda).

## Números reais
- `catalog-map.json` bruto: 24,5 MB (~6,1M tokens). NUNCA leia este arquivo inteiro. Use `jq`, `head` ou scripts para amostrar.
- Digest (`build-digest.js`): itens 1,7 MB + sets 0,7 MB (~600k tokens). Não cabe no contexto.
- 13 lotes de ~130 KB (~32k tokens cada). Cabem com folga.
- Estimativa de 4 caracteres/token provavelmente é otimista (muitos `sys_id`). Medir o real.

## Decisões fechadas
- Sem RAG e sem embeddings. É map-reduce determinístico: cada registro precisa ser processado, não recuperado por similaridade.
- Lotes processados por sub-agentes curtos em paralelo. Sem compactação nem memória: o contexto longo já foi resolvido pela divisão.
- Cache de prompt: o Claude Code já faz automaticamente. Manter instruções idênticas entre lotes, com a parte variável no final.

## Regras de negócio
1. Ao processar um item, use apenas o objeto do item e os variable sets referenciados por ele. Todos os outros registros ficam fora.
2. Ignore estes campos do item (irrelevantes para as sugestões): `flow_designer_flow`, `workflow`, `taxonomy_topic`, `redirect_url`, `view`, `triggered_workflows`, `triggered_flow_designers`, `catalog_available_for`, `catalog_not_available_for`, `volume`.

As duas regras são determinísticas: devem ser aplicadas no digest (código), não só no prompt.

## Incidentes já ocorridos
- HTTP 429 com 13-15 sub-agentes em paralelo.
- Sub-agente chamando outro sub-agente (2x): terminou sem gravar nada. Instrução "não use Agent" não bastou.
- Validador só garante completude estrutural. "0 erros" não significa semântica correta.

## Melhorias a implementar, nesta ordem
1. **Digest por item:** pacote = item + variable sets referenciados, resolvidos por `sys_id`. Lista de campos PERMITIDOS (não de excluídos). Flag `precisa_leitura_completa` + motivo quando detectável por código.
2. **Medir tokens reais** por pacote e por lote. Reagrupar lotes por variable sets compartilhados se reduzir repetição.
3. **Skill de regras** em `.claude/skills/regras-catalogo/SKILL.md`, com exemplos entrada → saída, precedência entre regras e critério explícito para `analise_humana`.
4. **Sub-agente** em `.claude/agents/processa-lote.md` com `tools` restrito (Read, Write, Bash). Sem a ferramenta Agent.
5. **Orquestração:** lote só está concluído se `lote-NN.json` existir E passar no validador (checado pelo orquestrador). Saída idempotente, execução retomável, ondas de no máximo 4, primeiro lote sozinho.
6. **Reduce:** comparar lotes procurando labels conflitantes, duplicatas e referências cruzadas.
7. **Gabarito (humano):** 20-30 itens revisados à mão para medir acerto semântico.

## Pendências para confirmar com o humano
- UI policies e catalog client scripts referenciam variáveis por nome. Ficam fora de propósito, ou entram como referência?
- `validate-spec.js` depende de algum campo que será descartado?
- Lista final de campos permitidos.

## Métricas
Custo por item (incluindo retentativas), iterações até 0 erros, % `analise_humana`, duração por lote, incidentes por tamanho de onda, acerto no gabarito e, por fim, taxa de defeito aplicando primeiro numa instância de teste.

## Restrições
- Não rodar os 13 lotes sem autorização. Primeiro um lote piloto, comparado ao gabarito.
- Mudanças de arquitetura: propor antes de implementar.
