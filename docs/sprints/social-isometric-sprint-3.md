# Sprint 3 — mapa isométrico da taverna

Data: 17/10/2026. Escopo autorizado: construção visual do mapa na estrutura HTML5/PixiJS da Sprint 2, incluindo os ajustes de disposição solicitados pelo usuário. Sprint 4 não iniciada.

## Entrega

A rota `/lobby/html5` apresenta um salão isométrico 14 × 12, tiles 96 × 48, com piso de madeira, duas paredes, vigas, estandartes, cinco mesas, quinze cadeiras, balcão, estante de bebidas, quadro físico de missões, lareira, palco com instrumentos, barris e entrada. São 28 móveis/objetos independentes. O nome e a descrição continuam centralizados em `hubConfig.ts`.

A entrada foi deslocada para o vértice inferior/frontal do piso, interpretando o pedido de “primeiro pixel inferior”. O ponto de chegada fica no interior, com passagem reservada. O quadro foi orientado em paralelo à parede; estante e balcão foram alinhados entre si. As transformações afins ajustam o eixo horizontal dos sprites mantendo postes e colunas verticais. Mesas próximas foram redistribuídas para liberar a chegada.

O cenário não é a imagem de referência com sobreposição de personagens. Piso/arquitetura, paredes, sombras, luz, objetos ordenados por profundidade e placas são camadas separadas. Cada móvel tem posição, pivô, escala e profundidade calculada pela posição no chão. A arquitetura é desenho original por código; os móveis são frames independentes de um atlas transparente original.

Há zoom de 100% a 250%, arraste da câmera após ampliar e restauração da visão geral. A escala é uniforme e se adapta ao container. Lareira, tochas e iluminação têm animação, com limite de 30 FPS; a cena interrompe o ticker quando oculta e respeita `prefers-reduced-motion`. Texturas, ticker, canvas, eventos, câmera e observer são liberados na saída e nos fluxos de erro.

## Arquitetura e limites

- `world/`: projeção/inversa, profundidade, enquadramento e mapa declarativo tipado.
- `assets/`: frames, âncoras, máscaras de contorno e carregamento do atlas com recursos pertencentes à montagem da cena, sem cache global compartilhado.
- `scene/`: arquitetura, móveis/camadas, iluminação, câmera e ciclo de vida Pixi.
- `ui/`: viewport, estados acessíveis, zoom e legenda das áreas.
- `config/`: identidade e destinos existentes.

O mapa registra footprints, spawn e cinco pontos de aproximação para as próximas interações. Esses dados são metadados de projeto; não existe ainda colisão, pathfinding ou movimentação de avatar em runtime. Um teste de conectividade valida a disposição dos footprints em uma malha de quarto de tile, sem substituir a implementação da Sprint 4. O mapa usa TypeScript declarativo nesta etapa; não foi instalado Tiled nem implementado importador de mapas Tiled.

Nenhum avatar, personagem real, NPC funcional, chat, presença multiplayer, teleporte ou operação de missão foi implementado nesta sprint. As placas e pergaminhos são elementos visuais, sem registros fictícios. O palco está vazio. O link para missões e a navegação clássica/Mana continuam usando as rotas existentes. O teste isolado usa fixtures exclusivamente no harness; produção não contém personagens ou missões simulados.

## Assets e direitos

O atlas `frontend/public/social-hub/tavern-props-v1.png` foi gerado com a skill imagegen e o tool built-in `image_gen.imagegen`, com transparência, sem edição posterior do bitmap. Tem 1254 × 1254 pixels e nove tipos de objetos. Aproximadamente 39,76% dos pixels são totalmente transparentes. Frames e máscaras separam os objetos no Pixi; o atlas inteiro nunca é desenhado como cenário.

O inventário/proveniência está em [assets.json](../../frontend/public/social-hub/assets.json); o prompt exato, o hash SHA-256 e as condições de direitos consultadas estão em [GENERATION.md](../../frontend/public/social-hub/GENERATION.md). O output foi criado para uso e distribuição com o Nimrod, conforme os termos do gerador, sem atribuir uma licença externa fictícia. Não foram reutilizados pixels da referência nem assets do Source of Mana. Nenhuma dependência foi adicionada nesta sprint.

Ainda faltam sprites de personagens por classe, composição de equipamentos, animações direcionais de repouso/caminhada e NPCs para as sprints correspondentes. O conjunto atual entrega os móveis do mapa; esses recursos futuros não estão representados como implementação visual definitiva.

## Arquivos desta sprint

Os caminhos abaixo são relativos à raiz. Alterações locais anteriores, inclusive as das Sprints 1/2 e dos experimentos, foram preservadas.

| Arquivo | Trabalho desta sprint |
|---|---|
| `frontend/src/features/social-hub/world/isometric.ts` | Projeção, inversa, profundidade e enquadramento |
| `frontend/src/features/social-hub/world/tavernMap.ts` | Móveis, chegada, footprints e áreas |
| `frontend/src/features/social-hub/assets/atlasFrames.ts` | Frames, âncoras e contornos |
| `frontend/src/features/social-hub/assets/tavernAtlas.ts` | Carregamento e descarte do atlas |
| `frontend/src/features/social-hub/scene/drawArchitecture.ts` | Piso, paredes e decoração por código |
| `frontend/src/features/social-hub/scene/TavernEnvironment.ts` | Camadas, sprites, orientação e placas |
| `frontend/src/features/social-hub/scene/TavernLighting.ts` | Luz e fogo animados |
| `frontend/src/features/social-hub/scene/TavernCamera.ts` | Zoom, arraste e enquadramento |
| `frontend/src/features/social-hub/scene/HubScene.ts` | Integração, ticker, movimento reduzido e descarte |
| `frontend/src/features/social-hub/scene/mountHubScene.ts` | Contrato opcional de zoom |
| `frontend/src/features/social-hub/scene/useHubScene.ts` | Estado/controles de câmera e proteção de referência assíncrona |
| `frontend/src/features/social-hub/ui/HubViewport.tsx` | Mapa, controles, legenda e estados |
| `frontend/src/features/social-hub/SocialHub.tsx` | Informação sobre o escopo visual |
| `frontend/src/features/social-hub/social-hub.css` | Viewport responsivo e controles |
| `frontend/src/features/social-hub/config/hubConfig.ts` | Identificação da Sprint 3 |
| `frontend/public/social-hub/tavern-props-v1.png` | Atlas original |
| `frontend/public/social-hub/assets.json` | Manifesto e origem |
| `frontend/public/social-hub/GENERATION.md` | Prompt e direitos |
| `frontend/verification/social-hub-map.test.mjs` | Seis verificações de geometria, mapa e atlas |
| `frontend/verification/social-hub.cjs` | Verificação visual/funcional em navegador |
| `docs/sprints/social-isometric-sprint-3.md` | Relatório da entrega |

## Aceitação verificada

| Verificação | Resultado |
|---|---|
| `npm test` | 23/23 passaram: oito testes existentes, nove de lifecycle e seis de mapa/atlas |
| `npm run lint` | Passou para JS/JSX; TS verificado pelo compilador estrito |
| `npm run build` | Typecheck estrito e build Vite passaram; 3.116 módulos |
| Build Docker | Passou no Dockerfile existente, frontend atualizado em loopback 8088 |
| Mapa e câmera em WebGL real | Atlas transparente, zoom, arraste e restauração verificados no Edge headless |
| Animação | Quadros mudam com animação ativa e permanecem estáveis com movimento reduzido |
| Recuperação | Atlas indisponível, WebGL indisponível e contexto perdido permitem recuperação/retorno ao clássico sem canvas parcial |
| Sessão/navegação | Quatro ciclos clássico↔HTML5: uma consulta `/api/me`, um canvas/observer por montagem e nenhum após saída |
| Mana | Seleção existente acessível e retorno HTML5 verificado, sem lançar/resgatar ticket |
| Sessão ausente | Fixture 401 não monta renderizador |
| Acessibilidade e layout | Zero violações Axe desktop; 1440 × 1000 e 390 × 844 sem overflow horizontal; screenshots inspecionadas |
| API real local | HTML5→clássico→HTML5→seleção Mana→HTML5, sem mocks: uma consulta `/api/me`, zero mutações e zero pageerrors |
| HTTP | `/lobby/html5` e atlas retornam 200 em `127.0.0.1:8088` |
| Preservação | 129 hashes fora do frontend comparados ao baseline desta sprint: zero alterações; Mana saudável e volume preservado |
| Diff | `git diff --check` passou |

O harness de navegador passou nas dez verificações e não registrou pageerrors. A diferença média normalizada dos pixels após restaurar o zoom foi 0,000298 (tolerância 0,015, permitindo rasterização de texto pelo Pixi). Relatório e screenshots ficam em `frontend/node_modules/.cache/social-hub/{report.json,desktop.png,mobile.png}`, ignorados pelo Git; o smoke adicional está em `live-report.json` no mesmo diretório. Para repetir os checks mantidos no repositório:

```powershell
Set-Location C:\Foundry\nimrod\frontend
npm test
npm run lint
npm run build
npm run test:hub:ui
```

Os testes de navegador usam Edge/Chromium e não certificam dispositivos físicos iOS/Android nem navegação manual completa com leitor de tela. Backend/PostgreSQL/Foundry/Godot não foram modificados; seus testes não foram repetidos. Riscos preexistentes de autenticação/Foundry e dependências constam no diagnóstico da Sprint 1 e no relatório da Sprint 2.

## Preservação e atualização local

Somente o frontend foi reconstruído e recriado com `docker compose build frontend` e `docker compose up -d --no-deps frontend`. Backend, Foundry, Source of Mana, seus assets/configurações e volumes não foram alterados. Nenhuma migração ou deploy remoto foi executado. O túnel Cloudflare permaneceu parado.

Ao concluir, `nimrod-mana-mana-server-1` está running/healthy, `nimrod-mana-mana-web-1` está running e `nimrod-mana_mana-data` continua montado em `/data`. O procedimento de retomada continua em [Source of Mana em standby](../operations/source-of-mana-standby.md); não é necessário reativá-lo para abrir esta prévia.

A imagem frontend anterior foi preservada como `nimrod-frontend:social-hub-before-sprint3`, ID `06c5245d9cfaff048274a2df9d7a0903e383b0dad438fff39ee50131191bfaf1`. A imagem final desta sprint é `0e31bcda70f40fe82eb66cb56e3b10b0f3dde5b9acd26834286e1b7e3c22c0d4`. Se necessário, o rollback exclusivo do frontend local é:

```powershell
Set-Location C:\Foundry\nimrod
docker image tag nimrod-frontend:social-hub-before-sprint3 nimrod-frontend:latest
docker compose up -d --no-deps --no-build frontend
```

O rollback não foi executado; não exige apagar imagens ou volumes. A Sprint 3 está concluída neste escopo. Movimentação, colisões e interações da Sprint 4 aguardam autorização do usuário.
