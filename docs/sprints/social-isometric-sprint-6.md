# Sprint 6 — aparência por classe e equipamentos visuais

Data: 17/10/2026. Autorização: “próximo”, após a conclusão da Sprint 5. Escopo: representar as classes com sprites originais, animar caminhada/repouso e preparar receitas de composição visual sem alterar o inventário real. Sprint 7 não iniciada.

## Diagnóstico e dependências

Foram inspecionados os contratos de personagem, perfil, collector Foundry, schema do Bridge, normalização de Actors, eventos de itens, renderização/lifecycle e seleção da Sprint 5. `/me/characters` continua fornecendo nome, nível, `classe`, raça, imagens e estado, sem inventário/equipamentos equipados estruturados.

O collector usa embedded items para classes e raça, mas não transmite uma lista atual de armas/armaduras equipadas. O Bridge e a serialização do perfil também não estabelecem esse contrato. Eventos `ITEM_EQUIPPED`/`ITEM_UNEQUIPPED` são histórico de atividade; não foram tratados como inventário atual. Não houve alteração da sincronização Foundry para preencher essa lacuna.

Consequência: os itens desenhados nesta entrega são **presets exclusivamente visuais**. Nenhum item foi criado, equipado ou adicionado à ficha real. A seleção continua usando `/me/characters`, a conta autenticada e os mesmos critérios da Sprint 5. Nenhuma dependência foi instalada, endpoint criado, autenticação duplicada ou migração executada.

## Entrega visual

O símbolo de navegação foi substituído por sprites originais de corpo inteiro para as doze classes solicitadas, mais um viajante neutro para classe ausente/não reconhecida. Todos foram gerados para este projeto com a skill imagegen e o tool built-in `image_gen.imagegen`, preservando o alpha dos PNGs e sem reutilizar os tokens antigos de origem não documentada ou assets do Source of Mana.

| Classe | Elementos ilustrativos do preset |
|---|---|
| Guerreiro | Armadura, espada e escudo |
| Paladino | Armadura pesada, símbolo sagrado, espada e escudo |
| Mago | Túnica e cajado |
| Feiticeiro | Vestes arcanas e foco visual |
| Bruxo | Vestimenta sombria e foco arcano |
| Ladino | Armadura leve, capuz e adagas |
| Patrulheiro | Arco, aljava e capa |
| Clérigo | Vestes religiosas, símbolo sagrado e livro |
| Druida | Vestes naturais e cajado |
| Bardo | Vestes de artista e instrumento musical |
| Bárbaro | Vestes rústicas e machado embainhado |
| Monge | Roupas leves e faixas |
| Viajante | Traje neutro, sem arma/armadura de classe |

Nome e nível continuam vindo do personagem real. O retrato existente da ficha permanece independente do sprite. A interface identifica o preset em “Aparência” e explica que seus itens são ilustrativos. Os corpos são genéricos; raça/gênero não são inferidos para afirmar que o desenho reproduz a aparência pessoal do Actor.

O sprite é uma entidade independente na camada de profundidade, com origem nos pés, mantendo colisões e posições do mapa. Nome/nível ficam na camada de labels legíveis. Nenhum fundo estático de taverna ou imagem de referência com personagens sobrepostos foi introduzido.

## Mapeamento e extensibilidade

`classPresets.ts` contém um catálogo de dados com identificador, rótulo, aliases em português/inglês, localização do clip e descrição das peças visuais. O resolvedor normaliza caixa, acentos e separadores, respeitando palavras completas. Assim, por exemplo, “Clérigo” e “Cleric” resolvem o mesmo preset sem converter palavras apenas semelhantes em classes.

Para multiclasse, a **primeira classe reconhecida na ordem do texto recebido** define o visual. Não se supõe qual classe tem mais níveis, porque esse detalhamento não existe no contrato. Todas as classes reconhecidas são retidas na resolução; a regra é explicada no painel de aparência. Classe desconhecida não é substituída por uma classe fictícia: recebe o traje neutro, explicitamente identificado.

O resolvedor aceita catálogo adicional e regras explícitas de subclassificação por `parentId`, aliases e preset. Regras de subclasse só podem substituir o preset da classe principal correspondente. Não foram inventados dados de subclasse nem produzidas variantes específicas nesta sprint; sem regra/asset configurado, mantém-se a classe base ou o traje neutro.

Receitas declaram camadas/slots (`body`, `outfit`, `mainHand`, `offHand`, `accessory`, `back`) e ordem de desenho por vista. O compositor trabalha com esses slots e pivôs alinhados, permitindo inserir peças independentes futuramente. **A arte atual tem corpo, roupa e equipamento já desenhados juntos na camada `body`**: não é um pacote de armaduras/armas intercambiáveis. Para composição real por item serão necessários assets separados e um contrato autorizado de equipamento equipado. A origem atual é sempre `visual-preset`, separada da identidade/inventário.

## Animações e recursos gráficos

São 78 frames originais: seis por preset, para 13 presets. Cada um tem três poses de frente e três de costas — passo esquerdo, repouso e passo direito. A sequência de caminhada é `0, 1, 2, 1`, a 8 poses/s; o repouso usa a pose central com respiração discreta por transformação em runtime.

As vistas de frente/costas e espelhamento oferecem quatro direções (`se`, `sw`, `ne`, `nw`) coerentes com a projeção isométrica. Não se afirma haver oito direções desenhadas individualmente. O personagem conserva sua orientação ao parar.

Movimento reduzido congela os passos na pose de repouso e desliga a respiração/fogo decorativo, mantendo deslocamento funcional. Foi corrigido um caso de transição entre keyup e o próximo frame: a cena agora confirma a pose de repouso antes de parar o ticker, evitando congelar uma pose antiga de caminhada.

Somente os atlas usados pela receita selecionada são carregados. Não existe cache global de texturas destruído por outra montagem. Fontes, frames e imagens pertencem à cena e são liberados junto com o ciclo de vida existente, inclusive em falha de carregamento, saída durante inicialização, perda de contexto e troca de personagem. Os PNGs têm cerca de 1,67–2,19 MB cada; o conjunto soma 8.057.406 bytes, sem obrigar o carregamento simultâneo das quatro imagens.

## Assets, prompts e direitos

| Arquivo final no projeto | Dimensões reais |
|---|---|
| `frontend/public/social-hub/avatars-martial-v1.png` | 1254 × 1254 RGBA |
| `frontend/public/social-hub/avatars-arcane-v1.png` | 1254 × 1254 RGBA |
| `frontend/public/social-hub/avatars-primal-v1.png` | 1254 × 1254 RGBA |
| `frontend/public/social-hub/avatars-traveler-v1.png` | 1536 × 1024 RGBA |

Os PNGs originais foram copiados para o projeto sem edição do bitmap. Retângulos e pivôs foram medidos a partir dos pixels/alpha, sem presumir que o grid solicitado tivesse saído perfeitamente regular. Recortes de frames e espelhamento são operações do Pixi, não uma regravação das imagens.

Origem, condições de uso, limitações e modo built-in estão em [AVATAR-GENERATION.md](../../frontend/public/social-hub/AVATAR-GENERATION.md). Os quatro prompts completos/exatos estão em [avatar-prompts-v1.json](../../frontend/public/social-hub/avatar-prompts-v1.json). Hashes SHA-256 e tamanhos estão em [assets.json](../../frontend/public/social-hub/assets.json). Os termos do gerador atribuem ao usuário os direitos sobre seus outputs entre as partes, nos limites legais; não se declara licença externa fictícia ou exclusividade universal de arte gerada.

Nenhum pacote de arte de terceiros foi importado. O atlas de móveis e os avisos das dependências foram preservados. A inspeção de pixels serviu apenas para medir os PNGs; não foi usada ferramenta externa para editar os bitmaps.

## Arquivos desta sprint

Todos os caminhos são relativos à raiz. Alterações locais anteriores foram preservadas.

| Arquivo | Mudança |
|---|---|
| `frontend/src/features/social-hub/appearance/classPresets.ts` | Novo: catálogo das doze classes e fallback neutro |
| `frontend/src/features/social-hub/appearance/resolveAppearance.ts` | Novo: aliases, multiclasse, extensão de subclasses e receitas |
| `frontend/src/features/social-hub/appearance/avatarAnimation.ts` | Novo: direção, passo e repouso |
| `frontend/src/features/social-hub/appearance/AvatarSprite.ts` | Novo: compositor de camadas e animação |
| `frontend/src/features/social-hub/assets/avatarFrames.ts` | Novo: retângulos/pivôs medidos dos 78 frames |
| `frontend/src/features/social-hub/assets/avatarAtlas.ts` | Novo: carregamento e descarte por cena |
| `frontend/src/features/social-hub/scene/ExplorerMarker.ts` | Sprite de classe, origem nos pés, nome/nível e destino |
| `frontend/src/features/social-hub/scene/TavernExplorer.ts` | Integra aparência, animação e diagnóstico local |
| `frontend/src/features/social-hub/scene/HubScene.ts` | Posse dos novos recursos e transição de movimento reduzido |
| `frontend/src/features/social-hub/ui/HubAppearance.tsx` | Novo: informação de preset, multiclasse e itens ilustrativos |
| `frontend/src/features/social-hub/ui/HubCharacters.tsx` | Exibe o resumo de aparência junto à ficha |
| `frontend/src/features/social-hub/ui/HubViewport.tsx` | Descrição acessível da representação visual |
| `frontend/src/features/social-hub/SocialHub.tsx` | Identifica o escopo local e os presets visuais |
| `frontend/src/features/social-hub/config/hubConfig.ts` | Identificação da Sprint 6 |
| `frontend/src/features/social-hub/social-hub.css` | Resumo de aparência |
| `frontend/public/social-hub/avatars-martial-v1.png` | Novo: atlas marcial |
| `frontend/public/social-hub/avatars-arcane-v1.png` | Novo: atlas arcano/religioso |
| `frontend/public/social-hub/avatars-primal-v1.png` | Novo: atlas natural/artista/rústico/monge |
| `frontend/public/social-hub/avatars-traveler-v1.png` | Novo: atlas neutro |
| `frontend/public/social-hub/avatar-prompts-v1.json` | Novo: prompts completos das quatro gerações |
| `frontend/public/social-hub/AVATAR-GENERATION.md` | Novo: origem, direitos e limites dos sprites |
| `frontend/public/social-hub/assets.json` | Manifesto dos novos assets |
| `frontend/public/social-hub/GENERATION.md` | Referência à documentação dos avatares |
| `frontend/verification/social-hub-appearance.test.mjs` | Novo: oito testes de aparência/frames/animação |
| `frontend/verification/social-hub.cjs` | Verifica as classes, passos, falhas e galeria no navegador |
| `docs/sprints/social-isometric-sprint-6.md` | Este relatório |

## Critérios efetivamente verificados

| Verificação | Resultado |
|---|---|
| Unitários frontend | `npm test`: 47/47 passaram; oito novos e 39 preservados |
| Resolução de classe | Doze classes PT/EN, acentos, variantes de gênero no nome da classe, limites de palavras, desconhecidos e multiclasse |
| Extensibilidade | Catálogo adicional e regra de subclasse explicitamente vinculada à classe principal, sem mudar o algoritmo |
| Dados/equipamento | Receitas exclusivamente visuais, sem campo de inventário ou equipado inventado |
| Frames/direção | 78 retângulos válidos em PNGs RGBA, seis poses por preset, quatro direções e repouso/movimento reduzido |
| Estática/build | Lint JS/JSX, typecheck TS estrito e build Vite passaram; 3.133 módulos transformados |
| Navegador | 23 grupos de checks passaram no Edge headless, zero pageerrors |
| Renderização real | Todos os doze sprites e o viajante foram selecionados/renderizados em WebGL, mantendo um canvas/observer/listener por cena e um socket existente |
| Animação real | Os três frames de passo foram observados durante deslocamento; frente/costas, espelhamento e retorno à pose de repouso verificados |
| Transparência | As quatro imagens têm mais de 30% de pixels totalmente transparentes; não formam retângulos opacos sobre o cenário |
| Falha de asset | Atlas de avatar indisponível não deixa cena parcial; nova tentativa cria renderizador/recursos novos |
| Regressões | Colisões, teclado, toque, câmera, seleção/revalidação, mural/portal, erros gráficos e alternância clássico/Mana continuam passando |
| Acessibilidade/layout | Zero violações Axe WCAG 2/2.1 A/AA nas telas verificadas; desktop/mobile sem overflow horizontal; screenshots e galeria inspecionadas |
| API real local | Quatro personagens elegíveis retornados; selecionado personagem real e carregado preset `bard`; uma consulta `/api/me`, cinco leituras de personagens na navegação, zero mutações/lançamentos e zero pageerrors |
| Docker/HTTP | Build Docker passou; somente frontend atualizado; rota HTML5 e os quatro atlas retornam 200 em loopback 8088 |
| Preservação | 129 hashes de arquivos fora do frontend comparados ao baseline da sprint: zero alterações; Mana e volume preservados; `git diff --check` passou |

Os testes isolados usam personagens fixture somente no harness. A galeria é formada por capturas do renderizador real, não por uma montagem conceitual. Artefatos ignorados pelo Git ficam em `frontend/node_modules/.cache/social-hub/`: `report.json`, `desktop.png`, `mobile.png`, `portal.png`, `avatar-gallery.png`, capturas individuais `avatar-<preset>.png` e `live-avatar-report.json`.

O smoke sem mocks percorreu seleção HTML5→painel do portal→clássico→HTML5→seleção Mana→HTML5. Não abriu o Foundry, lançou/resgatou ticket Mana ou gravou ficha/inventário/missões. Os relatórios não publicam identidades ou nomes reais.

Para repetir os checks mantidos no repositório:

```powershell
Set-Location C:\Foundry\nimrod\frontend
npm test
npm run lint
npm run build
npm run test:hub:ui
```

Não foram repetidos testes backend/Foundry/Godot, pois suas implementações e contratos não foram alterados nesta sprint. Os testes de navegador são Chromium/Edge headless, não dispositivos físicos nem auditoria manual de leitor de tela.

## Limitações e próxima etapa

- Corpos/raças/gêneros personalizáveis, variantes específicas de subclasses e oito vistas sem espelhamento exigem arte adicional.
- Equipamentos separados por slot exigem novos assets e contrato real de itens equipados. A camada atual contém a arte completa do preset; a arquitetura de composição não equivale a esses assets já entregues.
- A escolha da taverna não troca automaticamente o Actor controlado no Foundry; permanece o lançamento existente da conta.
- Presença e posições continuam locais. Nenhum JOIN/MOVE foi enviado ao servidor legado do outro mapa. A autoridade multiplayer, adaptação do mapa/protocolo e sincronização pertencem à Sprint 7.
- Chat/NPCs sociais e mural integrado continuam nas sprints correspondentes. Não foram introduzidos combate, economia, rankings ou minijogos.

## Atualização local e rollback

Somente `nimrod-frontend-1` foi reconstruído/recriado com `docker compose build frontend` e `docker compose up -d --no-deps frontend`. Não houve migração, alteração de volume, restart de backend/Mana/Bridge ou deploy remoto. O túnel Cloudflare permaneceu parado.

`nimrod-mana-mana-server-1` permaneceu running/healthy, `nimrod-mana-mana-web-1` running e `nimrod-mana_mana-data` montado em `/data`. O procedimento de retomada permanece em [Source of Mana em standby](../operations/source-of-mana-standby.md).

Imagem anterior preservada: `nimrod-frontend:social-hub-before-sprint6`, ID `2acd7f9f79e92219ae104ba5976ee0f2e36e2c0856cd3dce5c7f0820302e1d01`. Imagem final: `876dda4571316d00b7cbb2b926df7cb5c51cc4b6efe560a03d92c3e0b8af02c4`.

Se necessário, reverter exclusivamente o frontend local:

```powershell
Set-Location C:\Foundry\nimrod
docker image tag nimrod-frontend:social-hub-before-sprint6 nimrod-frontend:latest
docker compose up -d --no-deps --no-build frontend
```

O rollback não foi executado e não exige apagar imagens/volumes. A Sprint 6 está concluída dentro do escopo documentado. A Sprint 7 — presença multiplayer e sincronização — aguarda autorização.
