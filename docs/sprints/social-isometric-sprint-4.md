# Sprint 4 — movimentação, colisões e interações locais

Data: 17/10/2026. Sprint autorizada pelo usuário, incluindo mover a entrada para a parede indicada na nova referência e utilizá-la para acessar o Foundry. Sprint 5 não iniciada.

## Escopo inspecionado e entregue

Foram inspecionados mapa, projeção, atlas, camadas, câmera, lifecycle, viewport React, autenticação existente, componente/hook de lançamento do Foundry, contrato de `/foundry/launch` e seus testes. A estrutura React/PixiJS/TypeScript da Sprint 3 foi mantida, sem dependências novas, migrações, refatoração global ou substituição de backend.

A entrada agora fica junto à parede de fundo entre balcão e palco, na posição de mapa `(4.7, 0.75)`, com o ponto de chegada/aproximação em `(4.7, 2.3)`. O estandarte próximo foi reposicionado. O quadro continua paralelo à parede e a estante continua alinhada ao balcão. A placa identifica a passagem como Foundry VTT.

O salão permite:

- Clique/toque em piso livre para percorrer um caminho com desvio de móveis.
- WASD e setas com o canvas em foco, com direção correspondente à tela e velocidade diagonal normalizada.
- Colisão com todos os footprints de móveis e limites do piso, incluindo margem do marcador, teste contínuo de segmentos e bloqueio de corte diagonal de cantos.
- Clique nos cinco objetos/áreas de interação ou uso dos botões “Ir até…”. A interação abre depois de alcançar o ponto de aproximação.
- E/Enter para interagir perto de uma área; Esc para parar/fechar. Perda de foco e ocultação interrompem o movimento, sem teclas presas.
- Zoom e arraste com arbitragem entre gesto de câmera e clique de caminhada. Arrastar não cria um destino.

## Marcador local e integrações

O símbolo verde/dourado é um **marcador de exploração local**, identificado na interface. Não é personagem inventado, avatar definitivo ou jogador conectado. Possui indicação de direção, movimento e repouso; integra a camada ordenada pela profundidade do chão, aparecendo atrás/à frente dos móveis. Não possui nome/nível fictícios, inventário ou atributos. A posição é efêmera e reinicia ao montar a cena.

Essa separação mantém personagens reais para a Sprint 5 e sprites por classe/equipamentos/animações direcionais de personagem para a Sprint 6. Esses assets continuam faltantes; o marcador não é apresentado como sua entrega visual definitiva.

As interações implementadas são:

| Área | Comportamento |
|---|---|
| Balcão | Painel informativo; nenhum NPC, compra ou inventário simulado |
| Palco | Painel sobre o recanto; não reproduz música nem inventa músicos |
| Lareira | Painel local, sem efeitos sobre atributos ou combate |
| Mural | Link para `/missions`, usando a implementação clássica existente; sem duplicar regras/listagens/inscrições |
| Portal | Botão “Entrar no Foundry VTT” e link para a conexão existente |

O portal recebe o **FoundryLaunchButton existente** pelo adaptador JSX da página. Esse componente continua usando `useFoundryLaunch` e `GET /api/foundry/launch`, resolvendo a URL pela integração atual da conta. Não foi fixada uma URL externa nem alterado o endpoint, o token, o vínculo de identidade ou a autorização. O link de gestão usa `/foundry-connect`. Só clicar explicitamente em “Entrar no Foundry VTT” solicita o lançamento; aproximar-se/abrir o painel não gera token nem abre aba.

A resposta de sucesso e a apresentação de erro do botão foram verificadas com fixtures isoladas. O smoke com a API real não solicitou lançamento nem entrou em mundo Foundry. Portanto, esta sprint certifica o reaproveitamento do fluxo existente, não uma nova homologação ponta a ponta de login dentro do Foundry.

As posições são locais, sem envio ao WebSocket/API e sem persistência. Validação autoritativa no servidor, identidade do personagem, presença e frequência de mensagens pertencem às próximas sprints. Este controlador não é autoridade para multiplayer. Autenticação e WebSocket do shell existente foram preservados.

## Organização técnica

- `Navigation`: malha A* de quarto de tile, raio de 0,18 tile, footprints expandidos e interseção segmento/retângulo para percursos seguros. Rotas são simplificadas somente quando o segmento permanece livre.
- `ExplorerMovement`: estado puro, velocidade de 2,8 tiles/s, passos limitados/subdivididos, deslizamento contra obstáculos, cancelamento e chegada exata.
- `TavernExplorer`: teclado/pointer, diferenciação de toque/arraste, aproximação/proximidade, eventos para React e limpeza dos listeners.
- `ExplorerMarker`: desenho original por código, destino e ordenação por profundidade.
- `TavernEnvironment`/atlas: picking por alpha e máscaras, respeitando sobreposição e transparência dos sprites.
- `HubInteraction`: painel React acessível com foco no título, fechamento e ações existentes.

Movimento reduzido desliga a animação decorativa e o ticker quando o marcador está parado; caminhar continua funcional e acorda a cena. O estado da preferência também é amostrado no frame final para evitar estado desatualizado quando o ticker para. Quando oculta, a cena interrompe a exploração. Listeners globais/de canvas, captura do pointer, ticker, observer, texturas e referências assíncronas são liberados na desmontagem ou erro. Não foi adicionado cache global de texturas.

## Arquivos alterados nesta sprint

Os caminhos abaixo são relativos à raiz. Alterações das sprints anteriores e outras alterações locais foram preservadas.

| Arquivo | Mudança |
|---|---|
| `frontend/src/pages/Html5LobbyPage.jsx` | Injeta botão Foundry existente com estilo atual do Nimrod |
| `frontend/src/features/social-hub/world/tavernMap.ts` | Mapa v2, entrada na parede, spawn e aproximação |
| `frontend/src/features/social-hub/world/Navigation.ts` | Novo: navegação e colisões |
| `frontend/src/features/social-hub/world/ExplorerMovement.ts` | Novo: estado puro de movimento |
| `frontend/src/features/social-hub/assets/tavernAtlas.ts` | Picking por alpha |
| `frontend/src/features/social-hub/scene/drawArchitecture.ts` | Reposição do estandarte próximo à entrada |
| `frontend/src/features/social-hub/scene/TavernEnvironment.ts` | Acesso às camadas, picking por profundidade e placa Foundry |
| `frontend/src/features/social-hub/scene/TavernCamera.ts` | Separa pan da arbitragem de input |
| `frontend/src/features/social-hub/scene/ExplorerMarker.ts` | Novo: marcador visual local |
| `frontend/src/features/social-hub/scene/TavernExplorer.ts` | Novo: controles e interações da cena |
| `frontend/src/features/social-hub/scene/HubSceneEvents.ts` | Novo: contrato de eventos locais |
| `frontend/src/features/social-hub/scene/HubScene.ts` | Integração com ticker, preferências e limpeza |
| `frontend/src/features/social-hub/scene/mountHubScene.ts` | Contrato opcional de aproximação/parada |
| `frontend/src/features/social-hub/scene/useHubScene.ts` | Estado de interação e ponte React/cena |
| `frontend/src/features/social-hub/ui/HubInteraction.tsx` | Novo: painel das cinco áreas |
| `frontend/src/features/social-hub/ui/HubViewport.tsx` | Controles, instruções, status e botões acessíveis |
| `frontend/src/features/social-hub/SocialHub.tsx` | Prop da ação Foundry e identificação do escopo local |
| `frontend/src/features/social-hub/config/hubConfig.ts` | Sprint 4 e rota de conexão Foundry centralizada |
| `frontend/src/features/social-hub/social-hub.css` | Controles, foco e painel |
| `frontend/public/social-hub/GENERATION.md` | Registra reposição do asset existente e marcador por código |
| `frontend/public/social-hub/assets.json` | Origem do desenho por código do marcador |
| `frontend/verification/social-hub-navigation.test.mjs` | Novo: sete testes de navegação/movimento |
| `frontend/verification/social-hub.cjs` | Checks de interação, teclado, toque, Foundry e listeners |
| `docs/sprints/social-isometric-sprint-4.md` | Este relatório |

O PNG original, frames e licença/proveniência foram preservados. Não foram gerados novos bitmaps ou importados assets de terceiros/Source of Mana. O prompt e direitos do atlas continuam em [GENERATION.md](../../frontend/public/social-hub/GENERATION.md).

## Critérios efetivamente verificados

| Verificação | Resultado |
|---|---|
| Frontend unitário | `npm test`: 30/30 passaram, sendo sete novos e 23 preservados |
| Navegação | Coordenadas inválidas, margem de paredes/móveis, segmentos longos, cantos diagonais, desvio de obstáculo, sala desconectada e todos os pontos do mapa real |
| Movimento | Destino exato, estado parado na chegada, normalização diagonal, limite de delta, bloqueio em móveis/paredes, troca de destino, cancelamento por teclado e parada |
| Estática/build | `npm run lint`, typecheck estrito e `npm run build` passaram; Vite transformou 3.122 módulos |
| Foundry existente | `npm test -- --run tests/foundryLaunch.test.js` no backend: 7/7 passaram, com dependências de teste mockadas |
| Navegador | `npm run test:hub:ui`: 14 grupos de checks passaram no Edge headless, zero pageerrors |
| Controles reais | Clique no piso, clique físico no mural, teclado, Esc, blur, botões de aproximação e toque mobile verificados |
| Portal | Aproximação não consulta `/api/foundry/launch`; ação explícita trata 503 e abre aba com URL fixture em sucesso; E/Esc próximos funcionam |
| Acessibilidade | Zero violações Axe WCAG 2/2.1 A/AA no salão e no painel Foundry aberto |
| Câmera e responsividade | Zoom, arraste, reset e viewports 1440×1000 / 390×844 sem overflow horizontal |
| Lifecycle/regressão | Quatro ciclos clássico↔HTML5 mantêm a sessão e um canvas/observer/listener global por montagem, nenhum após saída; Mana acessível sem lançar ticket |
| Falhas gráficas | Atlas ausente, contexto perdido e WebGL indisponível mantêm recuperação/retorno; sem sessão, nenhum renderizador |
| Smoke real local | API/WS existentes, sem mocks: HTML5→painel do portal→clássico→HTML5→seleção Mana→HTML5, uma leitura `/api/me`, zero chamadas de lançamento Foundry, zero mutações e zero pageerrors |
| Docker/HTTP | Build Docker passou; rota HTML5 e atlas retornam 200 em loopback 8088 |
| Preservação | 129 hashes de arquivos fora do frontend comparados ao baseline: zero alterações; containers Mana e volume preservados |

Relatórios e screenshots da execução isolada ficam em `frontend/node_modules/.cache/social-hub/{report.json,desktop.png,mobile.png,portal.png}`. O smoke real adicional fica em `live-report.json`. Esses arquivos são ignorados pelo Git. As contas/personagens fixture existem somente no harness, não no aplicativo. Nenhuma conexão foi feita a uma mesa Foundry real pelos testes.

Para repetir as verificações mantidas no repositório:

```powershell
Set-Location C:\Foundry\nimrod\frontend
npm test
npm run lint
npm run build
npm run test:hub:ui
Set-Location C:\Foundry\nimrod\backend
npm test -- --run tests/foundryLaunch.test.js
```

Os testes usam Edge/Chromium headless. Não certificam dispositivos físicos, leitor de tela manual, pinch-to-zoom, NPCs, multiplayer ou o login interno de Foundry. O mural físico ainda não apresenta a listagem integrada da Sprint 9. Interações com cadeiras para sentar e atendimento de NPCs não fazem parte desta entrega. Riscos preexistentes de autenticação/Foundry/dependências permanecem descritos nas Sprints 1/2.

## Atualização local, preservação e rollback

Somente `nimrod-frontend-1` foi reconstruído/recriado; nenhum backend, bridge, banco, container Mana ou volume foi alterado/reiniciado. Não houve deploy remoto. O túnel Cloudflare permaneceu parado. `nimrod-mana-mana-server-1` permaneceu running/healthy, `nimrod-mana-mana-web-1` running e `nimrod-mana_mana-data` montado em `/data`. O procedimento de retomada do projeto continua em [Source of Mana em standby](../operations/source-of-mana-standby.md).

Imagem anterior preservada: `nimrod-frontend:social-hub-before-sprint4`, ID `0e31bcda70f40fe82eb66cb56e3b10b0f3dde5b9acd26834286e1b7e3c22c0d4`. Imagem final: `3731c017040222f4657e896f04546f484d19d1d8707d37e098376e8aef642fbf`.

Se necessário, reverter exclusivamente o frontend local:

```powershell
Set-Location C:\Foundry\nimrod
docker image tag nimrod-frontend:social-hub-before-sprint4 nimrod-frontend:latest
docker compose up -d --no-deps --no-build frontend
```

Esse rollback não foi executado e não exige apagar imagens ou volumes. A Sprint 4 está concluída dentro do escopo documentado. A Sprint 5 — personagens reais — aguarda autorização.
