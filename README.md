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
