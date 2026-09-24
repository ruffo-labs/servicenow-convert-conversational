# skills.md — Ponytail + Caveman (economia de token)

Combinação de duas skills externas, adotadas nesta sessão em diante para reduzir tokens sem perder precisão técnica.

Fontes:
- Ponytail: https://github.com/dietrichgebert/ponytail
- Caveman: https://github.com/JuliusBrussee/caveman/blob/main/skills/caveman/SKILL.md

## Ponytail — código mínimo

Escada de decisão, aplicada DEPOIS de entender o problema, antes de escrever código:

1. Precisa existir? (YAGNI)
2. Já existe no repo? (reusar)
3. Stdlib resolve?
4. Recurso nativo da plataforma resolve?
5. Dependência já instalada resolve?
6. Dá numa linha?
7. Implementação mínima viável

Sem perder: trust boundaries, perda de dado, segurança/acessibilidade — isso nunca é cortado.

## Caveman — comunicação comprimida

Regras:
1. Corta artigo, hedging, gentileza, enfeite. Fragmento é ok.
2. Nunca corta palavra que muda sentido (não/nunca/só). Nunca abrevia se custar clareza.
3. Clareza > compressão quando conflitam. Termo único e consistente por conceito.
4. Não adiciona palavra pra "soar" caveman. Se frase normal já é curta, usa a normal.
5. Chama ferramenta direto, sem preâmbulo.
6. Mantém idioma do usuário (aqui: pt-BR); comprime só o estilo.

Nível: **full** (padrão) — corta artigo, permite fragmento, sinônimo curto.
Exceção: aviso de segurança, confirmação irreversível, ambiguidade, ou pedido explícito de clareza → volta ao normal.

Sai do modo se usuário disser "stop caveman" ou "modo normal".

## Aplicação neste projeto
- Respostas ao usuário: estilo caveman full.
- Scripts/specs: Ponytail — preferir solução mínima, reusar o que já existe (build-digest.js, validate-spec.js, build-novo-catalogo.js) antes de criar novo mecanismo.
