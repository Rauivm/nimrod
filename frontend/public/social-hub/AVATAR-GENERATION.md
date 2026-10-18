# Avatares v1 — origem, frames e direitos

Gerados em 17/10/2026 para a Sprint 6 com a skill **imagegen**, usando o **tool built-in `image_gen.imagegen`**, modo generate, `transparent_background: true`. Não foi usado CLI/API externo. Quatro chamadas independentes produziram os quatro atlas. A referência do usuário orientou a atmosfera pelo briefing; seus pixels não foram incorporados nem enviados como alvo de edição.

## Arquivos usados pelo projeto

| Arquivo | Dimensões reais | Conteúdo |
|---|---|---|
| `avatars-martial-v1.png` | 1254 × 1254 RGBA | Guerreiro, paladino, patrulheiro, ladino |
| `avatars-arcane-v1.png` | 1254 × 1254 RGBA | Mago, feiticeiro, bruxo, clérigo |
| `avatars-primal-v1.png` | 1254 × 1254 RGBA | Druida, bardo, bárbaro, monge |
| `avatars-traveler-v1.png` | 1536 × 1024 RGBA | Traje neutro para classe ausente/desconhecida |

Cada classe tem três poses de frente e três de costas: passo esquerdo, repouso e passo direito. O espelhamento em runtime completa quatro direções. São 78 frames originais para 13 presets. Não são oito direções desenhadas separadamente.

Os PNGs foram copiados sem edição do bitmap; os originais permanecem em `$CODEX_HOME/generated_images/01a14c56-36bf-7992-85fe-4ab44af6ca92/`. Os frames/pivôs foram medidos a partir do alpha de cada figura e registrados em `frontend/src/features/social-hub/assets/avatarFrames.ts`. A análise de pixels não recortou/regravou as imagens. Os pedidos de grid/tamanho são intenções do prompt, não metadados presumidos: o runtime usa as dimensões e retângulos efetivamente medidos. Recortes e espelhamentos são operações do renderizador sobre texturas independentes.

O sprite atual contém corpo, roupa e equipamento do preset em um mesmo desenho. A receita/compositor oferece slots e ordenação por vista para peças separadas no futuro; **não há ainda um pacote de corpo/armaduras/armas intercambiáveis**. As roupas/armas desenhadas são exclusivamente visuais, sem alteração de ficha/inventário. Os corpos são genéricos, sem personalização de raça/gênero.

## Direitos

Os [Termos de Uso OpenAI](https://openai.com/policies/terms-of-use/), vigentes em 01/01/2026 e consultados na Sprint 3 desta implementação, atribuem ao usuário os direitos sobre o output entre usuário/OpenAI nos limites da lei. Estes outputs originais foram solicitados para uso e distribuição com o Nimrod. Não foram usados pacotes de arte de terceiros ou assets do Source of Mana. Não se atribui uma licença externa fictícia (como CC0) nem se afirma exclusividade/proteção autoral universal de arte gerada.

Hashes SHA-256, tamanhos e origem de cada PNG estão em [assets.json](assets.json). Avisos das dependências permanecem em `/licenses/social-hub-dependencies.txt`; nenhuma dependência foi instalada para os avatares.

## Prompts exatos

Os quatro prompts completos enviados ao tool estão em [avatar-prompts-v1.json](avatar-prompts-v1.json), por chave `martial`, `arcane`, `primal` e `traveler`. São prompts de geração, sem imagem-alvo de edição. Não houve uma etapa posterior de alteração dos bitmaps.

Pontos de uso:

- `appearance/classPresets.ts`: aliases e presets visuais das classes.
- `appearance/resolveAppearance.ts`: escolha explícita de classe/multiclasse/fallback e receita de camadas.
- `appearance/avatarAnimation.ts`: direção, repouso e ciclo dos passos.
- `assets/avatarAtlas.ts`: carregamento local e descarte das texturas de cada cena.
- `appearance/AvatarSprite.ts`: renderização por camadas e espelhamento.

Recursos adicionais ainda necessários para expansão: corpos/raças/gêneros personalizáveis, variantes de subclasses, peças independentes de equipamento, vistas adicionais desenhadas sem espelhamento e integração autorizada de inventário equipado. Esses recursos não são simulados pela arte atual.
