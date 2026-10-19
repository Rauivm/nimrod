# Sprint 7 — presença multiplayer e sincronização

Conclusão do diagnóstico e implementação em 19/10/2026 (America/Sao_Paulo).
Escopo autorizado: “próxima sprint”, após a publicação das Sprints 1–6.
Chat, balões, interação social com jogadores/NPCs e mural integrado continuam
nas sprints posteriores. Nenhuma dessas etapas foi antecipada.

## Diagnóstico e escopo

O Nimrod já possui `/ws`, autenticado pelo middleware existente, eventos do
clássico, `WsProvider` e uma sala legada associada ao outro mapa. Essa sala
legada não representa as coordenadas/colisões do mapa HTML5 atual. Seu serviço
e protocolo foram preservados. A integração nova usa tipos `HUB_*` na mesma
conexão, sem novo endpoint HTTP, login, token de autenticação, tabela ou migração.

Foram inspecionados o handshake, autenticação, consultas de personagens,
contratos de eventos, navegação, animação, lifecycle, assets e Dockerfiles.
Não foi instalada dependência. Continuam React 18, PixiJS 8.19, TypeScript 5.9,
Fastify 4 e PostgreSQL existentes.

## Autoridade e transporte

- O cliente pede entrada com `characterId`, nonce, versão de protocolo e mapa.
  O servidor consulta `player_characters` pelo ID e pelo usuário autenticado,
  exigindo ativo, vivo e não aposentado. Nome, nível e classe vêm dessa consulta.
- O servidor gera a sessão efêmera de sala e o ponto de chegada, escolhendo
  piso livre perto do portal. Há um avatar por conta e até 32 na sala. Uma nova
  aba pode assumir a presença, mantendo o socket clássico da outra aba aberto.
- O cliente envia destino, direção, parada e heartbeat; não informa sua posição,
  velocidade, nome, nível, classe ou usuário. Campos extras/coordenadas inválidas
  são recusados. Mensagens antigas de limpeza não removem uma sessão nova.
- A geometria, A*, raio e movimento puros do frontend são compilados em JS
  para o backend. `sync-hub-world.mjs` gera os três artefatos e um teste compara
  os resultados exatos para detectar divergência. Não editar esses JS à mão.
- Tick autoritativo a 20 Hz, velocidade 2,8 tiles/s, passo de tempo limitado a
  50 ms, colisão contínua com paredes/móveis e direção expirada em 400 ms sem
  renovação. Estado completo até 10 Hz em movimento e uma vez/s em repouso.
- Heartbeat do cliente a cada 5 s; presença silenciosa expira após 15 s.
  Elegibilidade/propriedade e metadados são relidos em lote a cada 15 s.
  Uma revalidação falha ou sem resposta em 3 s remove os membros afetados;
  novos joins aguardam a recuperação da consulta pendente.
- Limites: frames WS até 16 KiB; protocolo de sala até 2 KiB; 40 mensagens/s
  por conexão (burst 50); joins 2/s (burst 5); destinos 4/s; direção 15/s;
  ping 2/s. Flood continuado e consumidores com mais de 128 KiB pendentes são
  desconectados. Há uma consulta de entrada em voo por socket e oito na sala;
  uma seleção mais nova substitui somente a intenção ainda enfileirada.
- A confiança de identidade continua no modelo Cloudflare Access/Tunnel existente.
  O transporte só sinaliza `connected` após `CONNECTED`, emitido depois da auth
  e instalação dos handlers. Fechamento 1008/Unauthorized interrompe retries.

## Cliente e renderização

A própria posição é confirmada pelo servidor. A suavização visual não prevê
deslocamento além do alvo e evita interpolar por dentro de móveis; a chegada
inicial/reconexão aplica diretamente o spawn confirmado. Sem conexão/ack,
não há movimento local apresentado como presença multiplayer.

A cena desenha outros personagens com os mesmos presets de classe originais,
nome/nível reais e ordenação pelo chão. O painel mostra presentes e o estado
Online/Ausente. Ausência é um sinal explícito da aba, não uma permissão de jogo.
Inventário, retratos e integração Foundry não foram alterados.

Atlas remotos são compartilhados por preset dentro da cena, com contagem de
referências; o atlas próprio pode ser reutilizado. Saída/desmontagem cancela
carregamentos remotos pendentes e libera sprites/texturas/fontes. Falha de um
visual remoto mantém a lista verdadeira, informa a falha e permite reconectar.
Nenhum boneco fictício substitui silenciosamente um personagem não carregado.

Reconexão usa o socket/retry existente e refaz a validação de entrada. Uma aba
substituída exige ação explícita para retomar: atualização de personagens pelo
Foundry não provoca disputa automática entre abas. O bloqueio é somente uma
escolha de entrada da página/conta, não uma credencial. Visibilidade, blur,
pagehide e pageshow persistido tratam parada, ausência, saída e retomada.

## Validação

| Critério verificado | Resultado |
|---|---|
| Frontend unitário | 59/59 passaram: contratos, roster, lifecycle, mapa, colisões, classes, protocolo, sessão, timeout, takeover persistido e suavização |
| Backend isolado completo | 242 passaram, incluindo 22 de sala/transporte; 18 PostgreSQL opt-in ficaram skipped |
| Auth/contrato real do WS | Fastify e sockets reais: middleware existente, rejeição 1008 anônima, `CONNECTED` após auth, consulta por usuário da sessão, protocolo legado preservado e frame excessivo 1009 |
| Compilação/estática | Lint, TypeScript estrito e Vite passaram; 3.138 módulos. Backend `node --check` e import da sala/mundo gerado passaram |
| Regressores de navegador | 23 grupos passaram; zero pageerrors: câmera, colisões, teclado, toque, 13 presets, mural/portal existente, falhas de assets/WebGL, seleção/revalidação e clássico/Mana |
| Dois jogadores | 12 grupos passaram com WebSockets reais, duas contas fixture, mapa/sala reais e zero mutações HTTP |
| Presença/movimento | Visibilidade recíproca dos sprites; alvo e teclado executados no tick; outra conta recusada; ausência, queda/reentrada e limpeza confirmadas |
| Abas/Foundry | Uma conta mantém um avatar; uma aba substituída não retoma sozinha nem após `FOUNDRY_ACTORS_SYNCED`; retry explícito funciona |
| Recursos assíncronos | Erro de atlas remoto não inventa um avatar; retry recupera. Saída durante imagem pendente não recria a cena nem conserva presença |
| Ciclo de página | pagehide/pageShow persistido simulados removem/revalidam a presença, mantendo o transporte existente |
| Acessibilidade/layout | Desktop 1440×1000 e móvel 390×844 sem overflow; zero violações Axe WCAG 2/2.1 A/AA nos estados examinados; capturas inspecionadas |
| Preservação | Diff protegido sem mudanças em Source of Mana, módulos Foundry, rotas/serviços Mana e Compose; `git diff --check` passou |

As fixtures HTTP/autenticação/banco são isoladas; o teste de dois jogadores usa
WebSockets reais e a classe de sala de produção. Não acessa banco real ou Foundry.
Os testes não equivalem a uma auditoria manual de leitor de tela, teste em
dispositivo físico ou homologação autenticada em produção.

Artefatos locais ignorados: `frontend/node_modules/.cache/social-hub/report.json`
e capturas da regressão; `frontend/node_modules/.cache/social-hub-multiplayer/report.json`,
`desktop-two-players.png` e `mobile-two-players.png`. Os personagens dessas
capturas são fixtures explicitamente identificadas, nunca usuários inventados
apresentados como dados reais do Nimrod.

## Reprodução

```powershell
Set-Location C:\Foundry\nimrod\backend
npm run test:hub
# Auditoria completa isolada, sem carregar .env:
$env:NIMROD_HUB_FULL_SUITE='1'
npm run test:hub
Remove-Item Env:NIMROD_HUB_FULL_SUITE

Set-Location C:\Foundry\nimrod\frontend
npm test
npm run lint
npm run build
npm run test:hub:ui
npm run test:hub:multiplayer
```

Após modificar mapa, navegação ou movimento, executar `npm run sync:hub-world`
no frontend e incluir os artefatos backend regenerados na mesma entrega.

## Preservação, ativação e limites

Durante a implementação e validação, não foi executado comando Docker, deploy,
push, SSH, migração ou alteração de volume. O envio dos arquivos ao GitHub foi
autorizado posteriormente em 19/10/2026, sem ativação em produção.
Source of Mana, arquivos Foundry e rotas/serviços Mana
não têm alterações no diff. Mudanças locais anteriores foram preservadas.
O procedimento de retomada Mana permanece em `docs/operations/source-of-mana-standby.md`.

Para poupar o PC, a validação usou processos temporários de QA e navegador
sequencialmente, encerrados ao terminar. Dockerfiles foram preparados mas não
construídos nesta sprint. O build executado é o Vite/TypeScript; o backend
interpretado foi verificado por testes e checagem sintática/importação.

Produção e containers locais continuam na versão anteriormente implantada.
Uma ativação futura precisa atualizar backend e frontend compatíveis juntos;
frontend novo com backend antigo mostra timeout de sala, sem simular multiplayer.
Não houve homologação com Cloudflare/Foundry/PostgreSQL reais nesta sprint.
Os 18 testes PostgreSQL opt-in não foram executados.

A sala é efêmera e pertence a um único processo backend. Reinício implica
reentrada no spawn, sem perda de ficha/inventário. Múltiplas réplicas exigem
coordenação de sala futura; Redis/Bridge existentes não foram reaproveitados
implicitamente. Não foi feito benchmark de 32 renderizadores/jogadores ou de
dispositivos físicos. Colisões são contra cenário; avatares podem cruzar-se.
Rótulos de personagens muito próximos podem sobrepor-se; o polimento é da Sprint 10.
Sprint 8 não iniciada.

## Arquivos da sprint

39 arquivos no escopo desta sprint (incluindo este relatório):

- `backend/Dockerfile`
- `backend/package.json`
- `backend/src/index.js`
- `backend/src/services/socialHub/index.js`
- `backend/src/services/socialHub/Room.js`
- `backend/src/services/socialHub/world/ExplorerMovement.js`
- `backend/src/services/socialHub/world/Navigation.js`
- `backend/src/services/socialHub/world/tavernMap.js`
- `backend/src/ws/connection.js`
- `backend/tests/socialHubRoom.test.js`
- `backend/tests/socialHubSocket.test.js`
- `backend/vitest.social-hub.config.js`
- `docs/sprints/social-isometric-sprint-7.md`
- `frontend/package.json`
- `frontend/src/contexts/WsContext.jsx`
- `frontend/src/features/social-hub/assets/avatarAtlas.ts`
- `frontend/src/features/social-hub/config/hubConfig.ts`
- `frontend/src/features/social-hub/multiplayer/HubRoom.ts`
- `frontend/src/features/social-hub/multiplayer/protocol.ts`
- `frontend/src/features/social-hub/multiplayer/RoomMotion.ts`
- `frontend/src/features/social-hub/multiplayer/useHubRoom.ts`
- `frontend/src/features/social-hub/scene/ExplorerMarker.ts`
- `frontend/src/features/social-hub/scene/HubScene.ts`
- `frontend/src/features/social-hub/scene/RoomAvatars.ts`
- `frontend/src/features/social-hub/scene/TavernExplorer.ts`
- `frontend/src/features/social-hub/scene/useHubScene.ts`
- `frontend/src/features/social-hub/social-hub.css`
- `frontend/src/features/social-hub/SocialHub.tsx`
- `frontend/src/features/social-hub/ui/HubCharacters.tsx`
- `frontend/src/features/social-hub/ui/HubPresence.tsx`
- `frontend/src/features/social-hub/ui/HubViewport.tsx`
- `frontend/src/features/social-hub/world/Navigation.ts`
- `frontend/src/pages/Html5LobbyPage.jsx`
- `frontend/verification/social-hub-fixture.cjs`
- `frontend/verification/social-hub-multiplayer.cjs`
- `frontend/verification/social-hub-multiplayer.test.mjs`
- `frontend/verification/social-hub-world.test.mjs`
- `frontend/verification/social-hub.cjs`
- `frontend/verification/sync-hub-world.mjs`
