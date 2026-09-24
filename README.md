# ServiceNow → Catálogo AI First (conversacional)

Analisa um export do catálogo ServiceNow e gera sugestões para tornar cada item conversacional no Now Assist in Virtual Agent / ServiceNow Otto.

## Fluxo
1. Coloque o export em `input/` (ex.: `input/catalog-map.json`).
2. `node scripts/build-digest.js input/catalog-map.json work/digests`: gera um digest por item e por variable set.
3. Análise por IA, em lotes (`work/batches/*`). Cada analista segue `docs/instrucoes-analise.md` e `docs/criterios-conversacional.md` e grava em `work/results/`.
4. Ajustes manuais, se houver: `work/patches/*.json`.
5. `node scripts/merge-results.js work/results work/digests output catalog-ai-first`: gera os arquivos finais.

## Saída (`output/`)
- `catalog-ai-first.json`: tudo estruturado (resumo, itens, variable sets).
- `catalog-ai-first.md`: relatório legível, com visão geral e detalhe por item.
- `catalog-ai-first-resumo.csv`: uma linha por item, abre direto no Excel.

## Fase 2: novo catálogo (spec delta por item)
Contexto e decisões: `CONTEXTO-catalogo.md`. Regras para o modelo: `.claude/skills/regras-catalogo/SKILL.md`.

Pré-requisitos: Node 20+ e o Claude Code (`claude`) logado. Os lotes já estão empacotados em `work/lotes/lote-NN/`
(25 lotes, `work/lotes/manifest.json`); não é preciso regerá-los.

1. Testes: `node --test "scripts/test/*.test.js"`.
2. Um lote: `node scripts/processa-itens.js NN --effort high`. Uma chamada `claude -p` por item (sem ferramentas),
   grava `work/specs/lote-NN/<sys_id>.json`, valida e reenvia só o item com erro (máx. 3 correções).
   - Retomável: item com spec válida é pulado. Se o limite de uso acabar, para e sai com código 3; rode de novo depois.
   - Métricas de cada chamada (tokens, custo a preço de tabela) vão para `work/metricas.jsonl`.
3. Conferir: `node scripts/validate-spec.js work/specs/lote-NN --lote NN` e
   `node scripts/compara-piloto.js work/specs/lote-NN NN high work/relatorios/lotes` (divergências e labels).
4. Para o time de ServiceNow: `node scripts/variaveis-alteradas.js work/specs/lote-*` → `work/relatorios/variaveis-alteradas.csv`.
5. Saída final: `node scripts/build-novo-catalogo.js work/specs input/catalog-map.json output/novo-catalogo.json`.

Divisão atual: lotes 01–15 rodados na máquina do Pedro; **lotes 16–25 ficam para rodar aqui**. Não rode lotes de
outra faixa sem combinar (o custo seria pago duas vezes).
