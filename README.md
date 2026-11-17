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

## Catálogos simples (ex.: Afya)
Catálogo com poucas variáveis, `reference_choices` e `used_in_offers` (em que opção cada variável vale). Não usa o fluxo por lotes.
Regra: as opções de `v_o_que_deseja` com o MESMO formulário ficam num item só; só divide quando o formulário muda conforme a opção
(1 derivado por grupo de opções com o mesmo formulário). Detalhes em `docs/criterios-conversacional.md`.

1. `node scripts/simples-plano.js <export.json> work/<cliente> 3 [textos-antigos chunks-antigos]`: agrupa as opções e gera `split-chunks/` (só os itens a dividir).
2. Analistas escrevem `work/<cliente>/textos-split/chunk-N.json` (nome, descrição, frases por derivado; labels que faltarem).
   Itens que não dividem usam `textos/chunk-N.json` (rodada anterior ou `simples-chunks.js` + analistas).
3. `node scripts/simples-specs.js <export.json> work/<cliente>/textos work/<cliente>/chunks work/<cliente>/textos-split work/<cliente>/specs`
4. `node scripts/validate-spec.js work/<cliente>/specs --src <export.json> --analise work/<cliente>/sem-analise.json`
5. `node scripts/build-novo-catalogo.js work/<cliente>/specs <export.json> output/<cliente>-novo-catalogo.json work/<cliente>/sem-analise.json`
6. `node scripts/simples-finaliza.js <export.json> output/<cliente>-novo-catalogo.json <Cliente> work/<cliente>/set-recomendacoes.json`

## Catálogos com service offering (ex.: Assaí)
Itens com `reference_choices` no objeto do item (ofertas reais) e UI policies condicionadas na oferta. Regras em `docs/criterios-conversacional.md`.
1. `node scripts/oferta-plano.js <export.json> work/<cliente> [--so-operacionais]`: plano por código para TODOS os itens (grupos de ofertas com o mesmo formulário). Com `--so-operacionais` só entram ofertas com `operational_status = Operacional`.
2. `node scripts/build-digest.js <export.json> work/<cliente>/digests work/<cliente>/sem-analise.json` e
   `node scripts/oferta-specs.js pacote <export.json> work/<cliente>/plano.json work/<cliente>/pacotes <sys_id>...`: pacote enxuto por item.
3. Analistas gravam `work/<cliente>/textos/<sys_id>.json` (textos por derivado, labels, decisão sobre client scripts).
4. `node scripts/oferta-specs.js specs <export.json> work/<cliente>/plano.json work/<cliente>/textos work/<cliente>/specs`
5. `node scripts/validate-spec.js work/<cliente>/specs --src <export.json> --analise work/<cliente>/sem-analise.json`
6. `node scripts/build-novo-catalogo.js work/<cliente>/specs <export.json> output/<cliente>-novo-catalogo.json work/<cliente>/sem-analise.json`
7. `node scripts/oferta-finaliza.js <export.json> work/<cliente>/plano.json output/<cliente>-novo-catalogo.json <Cliente> [--so-com-spec]`

### Lotes do Assaí (várias máquinas)
`node scripts/oferta-lotes.js build <export.json> work/assai-op/plano.json work/assai-op/lotes 13 --excluir work/assai/piloto-ids.txt`
cria `work/assai-op/lotes/lote-NN/` autocontidos (13 lotes, ~100 mil tokens cada; `manifest.json` tem a estimativa). Cada pasta tem
`lote.json`, `pacotes/`, `PROMPT.md` e `textos/` (saída). Rodar um lote em qualquer máquina com Claude Code: *"Leia work/assai-op/lotes/lote-NN/PROMPT.md
e execute"*. Conferir: `node scripts/oferta-lotes.js check work/assai-op/lotes/lote-NN`; andamento: `node scripts/oferta-lotes.js status work/assai-op/lotes`.
**Divisão entre máquinas:** esta máquina roda do lote 01 para cima; a outra deve começar do último (13) para baixo, para não pagar duas vezes.
Para juntar: copie `lote-*/textos/*.json` para `work/assai-op/textos/` e siga com os passos 4 a 7 do fluxo (specs, validar, build, finaliza).

**Afya reexportado com ofertas no item (planilha):** `simples-plano.js` lê as ofertas de `item.reference_choices[]`; `simples-reaproveita.js <plano-novo> <plano-antigo> <textos-split-antigos> <saida>` reaproveita por nome os textos dos grupos que não mudaram; textos novos entram em `textos-novos/<sys_id>.json` (6º argumento de `simples-specs.js`); `simples-finaliza.js` amarra as ofertas com o `custom`, fixa a oferta (`oferta_fixa`) e aplica a regra de categorias.

**Nome padrão da saída:** `<nome da entrada>-TOBE-YYYY-MM-DD_HH-mm-ss.json` (`node scripts/nome-saida.js <entrada>`); vale para todos os clientes. Ofertas com mesmo nome e parent diferente são distintas (ver `docs/criterios-conversacional.md`).

## Catálogo organizado pela planilha do cliente (ex.: Assaí, Organograma)
Em vez de dividir por formulário/IA, cada **destino** da planilha (aba > serviço|problema > categoria C/G > item D/H) vira um item novo, com as ofertas que a planilha põe nele.
Categoria do item: `<Autoatendimento | Gestor - RH Ponta> > <Preciso de um serviço de RH | Preciso reportar um problema> > <C/G>` (níveis novos em `categorias_novas`).
Destino que junta ofertas de formulários diferentes mantém a variável de oferta e as policies da oferta (separar por formulário fica para a etapa de IA). Textos são provisórios.
1. `node scripts/planilha-le.js <planilha.xlsx> work/planilha/linhas.json`
2. `node scripts/planilha-mapa.js <export.json> work/planilha/linhas.json work/planilha/decisoes.json work/planilha/mapa.json` (casa por item + oferta; `decisoes.json` = ofertas a ignorar e itens fixados pelo cliente; confira `work/relatorios/planilha-mapa-ofertas.csv`)
3. `node scripts/planilha-plano.js <export.json> work/planilha/mapa.json work/<cliente>` (plano + textos provisórios)
4. `node scripts/build-digest.js <export.json> work/<cliente>/digests work/<cliente>/sem-analise.json`, `node scripts/oferta-specs.js specs <export.json> work/<cliente>/plano.json work/<cliente>/textos work/<cliente>/specs`, `node scripts/validate-spec.js work/<cliente>/specs --src <export.json> --analise work/<cliente>/sem-analise.json`
5. `OUT=$(node scripts/nome-saida.js <export.json>)`, `node scripts/build-novo-catalogo.js work/<cliente>/specs <export.json> $OUT work/<cliente>/sem-analise.json`, `node scripts/planilha-finaliza.js <export.json> work/<cliente>/plano.json work/planilha/mapa.json $OUT <Cliente>` (falha se alguma oferta mapeada não estiver no item do destino).

**Layout do formulário (`scripts/layout.js`):** pausa (type 12) separa estruturas; contêiner (19 início > esquerda > 24 divisão > direita > 20 fim) põe variáveis lado a lado; tudo pelo `order`.
Ao tirar variáveis de um item novo, contêiner sem as duas colunas sai (a coluna que sobrar fica empilhada) e pausa solta (começo, fim, repetida) sai. Variable set entra inteiro, com o `layout` dele (normal | 2across | 2down) gravado em `catalog_variable_sets[].layout`.
Client script e UI policy copiados para um item novo levam o `script` completo (`script_understanding` + `source`; policies também `script_true`/`script_false`).

**Passos finais do Assaí (rodar depois do `planilha-finaliza.js`, nesta ordem):**
6. `node scripts/tabela-itens.js $OUT` — `sys_class_name` fica vazio e `table_name` recebe a tabela do cliente (`x_asat_hr_services_cs_*`) conforme o nome do item. O mapa é `work/tabelas-itens.json` (`tabelas` = itens por tabela; `alias` = nomes que diferem da planilha/tela). Afastamentos e licenças vão para `..._ethics`. Lista no fim os itens sem tabela.
7. `node scripts/atributos-em-policy.js <export.json> $OUT` — devolve `mandatory`/`hidden`/`read_only` das variáveis ao valor do arquivo de entrada e passa o que o gerador tinha fixado na variável (efeito das policies da oferta) para uma UI policy onLoad sem condição por item novo, "Atributos dos campos". Regra do cliente: atributo fica na UI policy, não na variável (variável fixada por valor, `valor_fixo`, não muda).

**Etapa de IA sobre a planilha:** `node scripts/planilha-ia-prepara.js <export.json> work/assai-planilha/plano.json work/assai-planilha/ia work/assai-op/plano.json work/assai-op/textos work/assai/textos --lotes N` gera `ia/lote-NN/` (pacotes, textos semente, `PROMPT.md`); analistas gravam os textos dos destinos (sem dividir mais); confira com `node scripts/oferta-lotes.js check <lote>` e use `work/assai-planilha/textos-ia/` / `specs-ia/` nos passos 4 e 5.

**Decisões do cliente (Assaí):**
- Ofertas "Demandas Judiciais", "Solicitação de Cancelamento de Movimentação de Pessoal" e "Solicitação de movimentação com Transformação de Posição": ignoradas. "GRRF e comprovante" e "2ª via de guia SD" → item 68d87b36…; "Treinamento CIPA" → item a20c4d92… (`work/planilha/decisoes.json`).
- Oferta no arquivo e fora da planilha: ignorada. Oferta na planilha e fora do arquivo: fica de fora e vai para `metadata.planilha.sem_oferta_no_arquivo` (cliente cria à mão; 9 hoje).
- Itens do arquivo sem nenhuma oferta na planilha ficam fora do TO BE (10 de 138: Enxoval do Bebê, Propostas de Movimentação - Matriz, Temporários - Conecta, E-Social, Não categorizado do RH, Documentos Fiscalizações, Problema sistêmico (Férias), Cooperativa de Crédito, Auxílio-funeral, Manutenção de grupos ServiceNow). Mantidos assim por ora.
- Flag `u_incident` ignorada; rótulos (type 11) e rich text (32) continuam fora dos itens novos.

**Testes:** `node --test scripts/test/` (layout etc.).
**Versionamento:** `work/**/_brutos/` é ignorado; `work/tmp_*`, `work/test-*` e `work/tmp_snapshot.json` são rascunhos locais (não precisam ir no commit).
