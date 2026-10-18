# Tavern props v1 — origem e prompt

Arquivo final: `frontend/public/social-hub/tavern-props-v1.png`.

Gerado em 17/10/2026 para o Nimrod com a skill **imagegen**, usando o **tool built-in `image_gen.imagegen`**, modo generate e `transparent_background: true`. Não foi usado CLI/API externo nem pacote de arte de terceiros. A imagem anexada pelo usuário orientou o briefing de composição; seus pixels não foram incorporados ao cenário nem enviados como alvo de edição nesta geração.

Resultado preservado sem edição do bitmap: PNG RGBA, 1254 × 1254, 2.357.766 bytes, SHA-256 `3e02678d8ec7eb62bf8dd86bb2d64862ebcc662a1999430c1a2b84a2adf67735`.

O resultado contém nove objetos separados. O grid solicitado não saiu regular; os enquadramentos e máscaras de contorno foram definidos no código Pixi, sem recortar/regravar o arquivo. Cada móvel continua sendo um sprite independente, com posição, escala, pivô e profundidade próprios. O atlas inteiro nunca é desenhado como fundo.

## Direitos e redistribuição

Os [Termos de Uso OpenAI](https://openai.com/policies/terms-of-use/), vigentes em 01/01/2026 e consultados nesta sprint, atribuem ao usuário os direitos sobre o output entre usuário/OpenAI, nos limites da lei. O asset foi gerado para uso e distribuição com o Nimrod conforme o pedido do usuário. Não foi aplicada licença CC0, CC BY-SA ou uma licença de pacote externo a esse output. Isso não declara exclusividade ou proteção autoral universal de arte gerada.

Não há dependência visual do Source of Mana, de seus assets ou da arte ilustrativa anexada. Os avisos das bibliotecas de software continuam em `/licenses/social-hub-dependencies.txt`.

## Prompt final enviado

```text
Create a production game-asset sprite atlas, original art for a medieval fantasy tavern social hub. Landscape or square PNG with TRUE TRANSPARENT background, preferably 1536x1536. EXACTLY NINE isolated props in a perfectly regular 3 COLUMN x 3 ROW grid of equal square cells. Each object must be fully inside its own cell with generous transparent padding at all four edges. Absolutely no grid lines, no labels, no text, no characters, no room, no floor background, no logos. Camera: consistent orthographic 2:1 isometric, from above, visible top surfaces and front-left/front-right sides, zero perspective vanishing points. Art direction: beautifully detailed hand-painted dark fantasy environment assets, aged oak, iron fittings, dark stone, muted burgundy and indigo accents, warm amber candlelight, crisp readable silhouettes with fine material texture. Close to an atmospheric illustrated medieval RPG tavern, NOT low-poly, not cartoon icons, not flat vector, not pixel art. Props at cohesive scale but centered to use each cell well; do not connect any objects across cells.
Row 1 left: long ornate oak tavern bar counter with mugs, copper taps, several colored glass bottles on top; visible panelled front, roughly 3 tiles long and 1 tile deep. Row 1 middle: round oak dining table with a candle, two ceramic mugs, small plates and bread, absolutely no chairs attached. Row 1 right: tall stone fireplace, broad front opening facing front-left, carved stone mantel and soot-dark empty fire cavity with dark logs and embers, absolutely NO large flames (flames will be animated separately in the engine).
Row 2 left: tall timber drinks shelving, full of jewel-toned glass bottles, ceramics, tankards and barrels, facing front-left. Row 2 middle: freestanding wooden quest noticeboard with heavy posts, irregular blank parchment sheets and tiny illegible marks, no readable writing or icons. Row 2 right: small low isometric wooden musicians platform with burgundy carpet, one lute propped on a stool, a small hand drum and a music stand; no people.
Row 3 left: a SINGLE sturdy medieval oak dining chair with a burgundy upholstered seat, facing toward the upper-right, entire chair and feet visible. Row 3 middle: three oak barrels, one crate and a small burlap sack grouped compactly, entire silhouette visible. Row 3 right: freestanding old stone archway with an open dark passage, three shallow stone steps toward the viewer and a very subtle cool blue glow inside; no doors, no symbols.
Every asset must be a separate usable transparent sprite. Minimal soft contact shadow under each prop, no cast shadow outside its cell. Keep all nine props separated by clear transparent gutters. This is a modular asset atlas for actual PixiJS rendering, NOT a screenshot, mockup or finished tavern illustration.
```

## Inventário visual

1. Balcão de madeira com bebidas.
2. Mesa com vela, canecas e alimentos decorativos, sem cadeiras incorporadas.
3. Lareira de pedra; chamas e luz adicionadas/animação pelo código.
4. Estante de bebidas.
5. Quadro de missões físico com pergaminhos decorativos sem dados de missões reais.
6. Palco vazio com instrumentos; não representa NPC ou jogador real.
7. Cadeira de madeira reutilizável, com espelhamento visual quando necessário.
8. Grupo de barris, caixa e saco decorativos, sem inventário/economia.
9. Entrada de pedra reposicionável, usada como portal de acesso ao Foundry pela integração existente a partir da Sprint 4.

Piso, paredes, vigas, tapetes, estandartes, sombras e efeitos são desenho original por código em camadas. Os avatares de classe adicionados na Sprint 6 têm origem e prompts próprios em [AVATAR-GENERATION.md](AVATAR-GENERATION.md). Variantes de subclasses, peças independentes de equipamento, corpos personalizáveis e NPCs animados continuam dependendo de assets adicionais.

Na Sprint 3, a disposição foi ajustada conforme orientação do usuário: entrada no canto inferior, quadro paralelo à parede e estante de bebidas paralela ao balcão. Na Sprint 4, conforme nova indicação, a entrada foi movida para a parede entre o balcão e o palco. A orientação dos sprites é ajustada por transformação afim no plano isométrico, preservando os postes verticais e o PNG original. O marcador de exploração da Sprint 4 é desenho por código e não é um sprite definitivo de personagem.
