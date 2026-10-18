# Hub social isométrico HTML5 — diagnóstico da Sprint 1

Data: 17/10/2026, America/Sao_Paulo.

Escopo autorizado: diagnóstico da arquitetura, preservação do Source of Mana, proposta de integração e identificação de riscos/dependências. Nenhuma implementação, dependência, migração ou configuração operacional foi alterada. As sprints deste documento são as do pedido HTML5; a numeração de `docs/sprints/inn-sprints-1-2.md` pertence a uma entrega anterior baseada em Godot.

## Parecer

React + TypeScript + PixiJS é uma alternativa tecnicamente compatível com o Nimrod. O backend principal já é Fastify, com PostgreSQL, autenticação e WebSocket. Não é necessário trocar o backend nem criar outro cadastro/login. Há um experimento PixiJS anterior e uma sala autoritativa já incorporada ao backend, mas isso não constitui a taverna isométrica solicitada.

A rota `/lobby` está ocupada pela entrada integrada do Source of Mana. Recomenda-se introduzir o experimento HTML5 em `/lobby/html5`, preservando `/lobby` e todas as rotas clássicas. A promoção futura de HTML5 a entrada principal deve ser uma decisão posterior à avaliação, mantendo acesso explícito ao Mana.

O diagnóstico está entregue com impedimentos conhecidos de prontidão: o experimento PixiJS não compila atualmente, a referência de gateway não passa no typecheck com as dependências locais, faltam assets isométricos licenciados e a sala WebSocket precisa de endurecimento antes do uso público. Não se declara a implementação HTML5 compilável, homologada ou pronta para produção.

## 1. Arquitetura efetivamente encontrada

Versões abaixo são dos lockfiles; quando existe observação do runtime, ela está indicada. Os intervalos dos `package.json` nem sempre correspondem às versões resolvidas.

| Camada | Implementação e versões verificadas | Evidência local |
|---|---|---|
| Interface clássica | React 18.3.1, React Router 6, Vite 5.4.21; JavaScript/JSX e CSS | `frontend/package.json`, lockfile, `src/main.jsx`, `src/App.jsx` |
| API principal | Fastify 4.29.1, `@fastify/websocket` 8.3.1, `pg`, JWT, multipart, static, node-cron | `backend/package-lock.json`, `src/index.js`; versões confirmadas no container |
| Persistência | PostgreSQL 16; SQL direto e transações por conexão; migrações no startup | `backend/src/db/index.js`, `backend/migrations/`, Compose |
| Eventos web | `/ws`, conexões por usuário, presença e broadcasts do clássico; também recebe eventos da taverna | `backend/src/ws/broadcast.js`, `src/services/tavernRoom.js` |
| Bridge Foundry | Serviço separado com Fastify 5.8.5, BullMQ 5.76.7, ioredis 5.10.1; Redis 7 | `foundry-module/foundry-bridge/`, Compose |
| Módulos Foundry | Bridge/mission-panel, nimrod-sync, nimrod-session e cemetery | `foundry-module/`; manifestos sync/session declaram mínimo 13 e verificado 14, sem comprovar versão instalada do Foundry |
| Publicação | Nginx, Docker Compose e Cloudflare Access/Tunnel; portas locais 8088 e 8081 em caminhos distintos | Compose, `frontend/nginx.conf`, `nginx/nginx.conf` |
| Source of Mana | Projeto separado, versão interna 0.0.9, revisão `095803fe9bf496cafcfeebf6a62ae591593491bf`, Godot 4.7.1 | Checkout `experiments/source-of-mana/game/`, Dockerfile; Godot confirmado no container |
| Experimento HTML5 | React 18.3.1, PixiJS 8.19.0, TypeScript 5.9.3, Vite 5.4.21 | `experiments/tavern/` e lockfile |
| Gateway de referência | Fastify 4.29.1, websocket 10.0.1 declarado/resolvido; não é o gateway de produção | `experiments/tavern/server-reference/` |
| Runtimes | Host Node 22.23.1/npm 10.9.8; Dockerfiles Node 20; backend em execução Node 20.20.2 | CLI, Dockerfiles, consulta ao container |

```mermaid
flowchart LR
  U[Usuário] --> CF[Cloudflare Access / Tunnel]
  CF --> N[Nginx / React clássico]
  N --> API[Fastify principal]
  N <--> WS[WebSocket /ws]
  WS --> API
  API --> PG[(PostgreSQL)]
  F[Foundry + módulos] --> B[Foundry Bridge]
  B --> R[(Redis / BullMQ)]
  R --> W[Bridge worker]
  W --> API
  N --> L[/lobby existente]
  L --> T[POST /mana/launch]
  T --> API
  L --> M[Mana web / Godot]
  M <--> MS[Mana server]
  MS --> A[/mana/redeem e /mana/authorize]
  A --> API
  MS --> SQ[(SQLite em mana-data)]
  N -. proposta futura .-> H[/lobby/html5 + PixiJS]
  H -. mesma sessão e APIs .-> API
  H -. transporte existente .-> WS
```

O processo real de produção parte de `backend/src/index.js`. `app.js` é uma fábrica de testes com autenticação simplificada e subconjunto de rotas; `server.js` usa essa fábrica e não é o `npm start` principal. Passar os testes dessa fábrica não comprova todo o startup de produção.

O clássico mantém feed, perfil, personagens, missões, side quests, calendário, mapas, cemitério, patch notes e sessões. A raiz `/` já contém uma escolha de experiência; `ExperienceContext` persiste `classic`/`game` no navegador por UUID da conta. `/?experience=classic` retorna ao feed clássico. Não há necessidade de duplicar esse mecanismo.

## 2. Source of Mana: preservação e estado observado

O desenvolvimento Mana fica em standby; não foi necessário desligá-lo. Ao abrir o Docker Desktop, os serviços existentes retomaram. Esta auditoria não executou `start`, `stop`, `up`, `restart`, builds de imagens, limpeza ou remoção de volumes.

| Recurso | Estado observado nesta sessão |
|---|---|
| `nimrod-mana-mana-server-1` | Em execução, healthy, `MANA_INTEGRATED=true`, API privada `http://backend:3001` |
| `nimrod-mana-mana-web-1` | Em execução, página HTTP 200 em `127.0.0.1:5184` |
| `nimrod-mana_mana-data` | Existente e montado em `/data` no servidor Mana |
| Portas Mana | Loopback: 5184 web, 6118/TCP WebSocket, 6119/UDP ENet |
| Isolamento web | COOP `same-origin`, COEP `require-corp`, confirmados por HTTP |
| Checkout upstream | Revisão fixada, com alterações locais anteriores em 12 arquivos rastreados e conteúdo de integração/mapa não rastreado no repositório interno |
| Persistência Nimrod | Volumes `nimrod_pgdata`, `nimrod_uploads`, `nimrod_foundry-redis-data` existentes |

Preservar em conjunto:

- `experiments/source-of-mana/game/`, incluindo alterações locais, assets, addons, licenças e configuração de exportação.
- `patches/local-environment.patch`, `prepare.ps1`, `build-lobby.mjs`, `integration/`, `docker/`, `verification/` e documentação.
- Os quatro arquivos `docker-compose.mana*.yml`, imagens existentes e o volume Mana.
- `backend/src/routes/mana.js`, `src/services/manaAccess.js`, migrações 031–033 e integrações de side quests.
- Configuração privada existente de `MANA_BRIDGE_SECRET`, `MANA_PUBLIC_URL` e rede; nunca incluir seus valores nos relatórios.

O checkout `game/` e `artifacts/` são ignorados pelo Git. Existem documentos e arquivos locais ainda não rastreados no repositório principal. Preservação nesta auditoria não significa backup externo ou commit: nenhum deles foi feito. Não executar `git clean`, reset do checkout, `down -v`, prune ou exclusão de dependências para preparar o HTML5.

O mapa Mana atual é Tiled **ortogonal**, 36 × 28 células de 32 px. A verificação estrutural encontrou 675 células caminháveis conectadas e cinco áreas sociais acessíveis. Não é um mapa isométrico pronto para PixiJS.

Procedimento reversível de pausa e retomada: [Source of Mana em standby](../operations/source-of-mana-standby.md).

## 3. Autenticação, personagens e Foundry

### Identidade existente

O frontend consulta `/api/me` por `AuthContext`; o Nginx remove `/api` ao encaminhar à API. `cfAuthMiddleware` resolve a identidade pelo header de email do Cloudflare Access e faz upsert em `users`. O origin precisa permanecer protegido pelo Tunnel/rede. Em desenvolvimento existem `X-Dev-User` e `DEV_USER_EMAIL`; não são um login que deva ser copiado para HTML5. O container observado está em desenvolvimento, em acesso local.

`/ws` usa o mesmo middleware, associa a conexão ao usuário autenticado e recebe mensagens da taverna. Não existe necessidade demonstrada de um segundo JWT, cadastro, serviço de autenticação ou gateway separado. A referência de ticket em `server-reference/` não é o contrato implantado.

### Dados e vínculos reais

| Necessidade | Contrato existente / fonte de verdade |
|---|---|
| Conta autenticada | `GET /me`, tabela `users` |
| Personagens vinculados | `GET /me/characters`, tabela `player_characters`, FK `user_id` |
| Catálogo para vínculo | `GET /me/characters/available` |
| Vincular / desvincular | `POST` / `DELETE /me/characters/:id/link`; também há operações administrativas em `/players/...` |
| Identidade Actor | `player_characters.foundry_actor_id`; `user_foundry_map` e serviços de resolução para acesso/eventos legados |
| Ficha disponível para UI | `id`, `foundryActorId`, nome, nível, XP, `classe`, raça, retrato/token, estado e última sincronização |
| Imagens Foundry | Proxy existente `/foundry/assets?path=...` |
| Entrada Mana | `POST /mana/launch { character_id }`, ticket opaco de uso único no fragmento da URL |
| Autorização Mana | `/mana/redeem` e `/mana/authorize`, segredo exclusivo entre servidores, propriedade/estado revalidados |

`/me/characters` filtra ativos e não aposentados, mas não exclui mortos no SQL. A página Mana filtra mortos no cliente; os serviços de entrada também devem continuar validando no servidor. O novo cliente deve aplicar estado vazio, seleção única/múltipla e rejeição do servidor, sem inventar personagem.

Consulta ao PostgreSQL executada em `BEGIN READ ONLY` e encerrada com `ROLLBACK`: 5 usuários, 6 personagens, 9 missões e 1 atividade. Os 6 personagens eram elegíveis e vinculados; 5 tinham `classe` preenchida. Migrações 031 a 035 constavam aplicadas. São contagens do ambiente local, sem publicação de identidades ou fichas.

### Fluxo de sincronização

1. `nimrod-sync/collector.js` serializa Actors do Foundry, incluindo classes/multiclasse, nível, imagens e estados.
2. O Bridge valida o payload, enfileira no BullMQ/Redis e o worker envia a `/foundry/push-actors` com `X-Nimrod-Key`.
3. `foundrySync.js` normaliza e atualiza `player_characters`, mantendo o vínculo Nimrod; também existe leitura periódica/manual dos arquivos do Foundry.
4. Perfil, missões e lobby leem essa representação. Foundry não precisa estar aberto para ler o snapshot já persistido.

**Limite operacional atual:** Bridge e Redis estavam ativos, mas `nimrod-foundry-bridge-worker-1` estava parado e o backend tinha `FOUNDRY_SYNC_DISABLED=true`. A atualização automática não foi homologada; isso não deve ser confundido com ausência de personagens. Não reiniciei o worker nem alterei a configuração.

### Classe e equipamentos

`classe` é texto livre, inclusive nomes localizados e múltiplas classes separadas por vírgula. Não há catálogo estruturado de subclasses no contrato de perfil. É necessário um resolvedor visual extensível com aliases, regra explícita para multiclasse e fallback identificado quando faltar classe.

O collector, o schema do Bridge e a resposta de `/me/characters` não entregam inventário/equipamentos estruturados. `resources` e `custom_data` JSONB existem, mas não estabelecem um contrato de equipamento equipado. Eventos de itens em `nimrod-session` são histórico de recursos, não um inventário atual completo. O Bridge também não declara `abilities` no schema embora o collector as envie: não presumir propagação de todos os campos do Actor.

Na Sprint 6, usar presets exclusivamente visuais por classe enquanto não houver equipamento real autorizado no contrato. Separar `appearance` de ficha/inventário; nenhuma arma, armadura ou moeda deve ser escrita no personagem para representar o sprite. Importação de equipamentos exigiria análise específica e autorização para ampliar a sincronização Foundry, sem necessidade disso para a Sprint 2.

## 4. O que existe no experimento PixiJS

| Item | Estado encontrado |
|---|---|
| Cena | `TavernScene.ts`: Application Pixi, câmera, redimensionamento, fundo `tavern.webp`, camada de tokens, ordenação dos jogadores por Y |
| Movimento | Clique/teclado, predição/interpolação e colisão poligonal; não há navegação isométrica por tiles implementada |
| Backend da sala | `tavernRoom.js` já é importado em produção: JOIN, intenção de movimento, tick 20 Hz, teto de velocidade, colisão e sincronização periódica |
| Personagem | Leitura real de `/api/me/characters`; servidor confirma vínculo no JOIN; frontend experimental perde `classe` e usa `userId` vazio no adaptador |
| Contrato de seleção | Chamada experimental `/api/characters/:id/select` não foi localizada no backend; erro é ignorado e a entrada continua |
| Chat | Mensagens/balões e nomes reais no caminho WS; histórico efêmero; labels global/taverna/grupo não implementam isolamento de audiência |
| Missões | `Tavern.tsx` passa array vazio; não consulta o mural real e não deve afirmar que não há missões no Nimrod |
| Interface | Nome da referência e reino fixos; inventário/mensagens/configurações/guilda/ranking são seleções locais sem integração funcional comprovada |
| Assets | Dois fundos WebP e seis tokens locais; sem manifesto de origem/licença localizado no experimento fora de dependências |
| Legado | `mockTransport.ts`, `types_.ts`, mapas alternativos e gateway de referência; documentos/comentários não refletem integralmente o código atual |

O cenário único com tokens por cima não permite oclusão correta por móveis, componentes de avatar, animações direcionais ou interações por objeto. Portanto, não será apresentado como visual definitivo. O mapa de colisão possui 18 obstáculos e nome ilustrativo fixo; há cópias em backend, frontend experimental e gateway. A igualdade e evolução desses recursos precisam de validação explícita.

O cleanup já existe parcialmente, mas é necessário testar desmontagem durante `Application.init`/carregamento de assets, timers de balões, texturas/cache, listeners e reconexão. O React principal usa StrictMode, que torna esses cenários especialmente relevantes. O estado `ready` do protótipo é definido ao abrir o socket, antes da confirmação do JOIN; a nova experiência deve aguardar aceitação do servidor.

## 5. Missões: reuso, contratos e lacunas

Fonte de verdade: `routes/missions.js`, `services/missionBoard.js`, `missionRules.js` e `missionAttendance.js`; tabelas `missions`, `mission_participants`, histórico, solicitações de narrador e sessões. Side quests usam `activities`/`activity_participants` e não devem ser confundidas automaticamente com missões do mural.

| Operação do mural físico | Integração existente a reutilizar |
|---|---|
| Listar aventuras | `GET /missions?kind=MISSION`, com filtros `status`, `before`, `limit` e paginação real |
| Descrição, requisitos, níveis, participantes | `GET /missions/:id`; campos como `min_level`, `max_level`, limites e participantes retornados pela API |
| Vagas, aprovação e reserva | `player_count`, `reserve_count`, `max_players`, `max_reserves`, `approval_required`, `registrations_open`, prazo e estado |
| Inscrição | `POST /missions/:id/join { characterId }`, mesmas verificações e transações do mural clássico |
| Sair / ajustar personagem | `DELETE /missions/:id/join`; `PATCH /missions/:id/participants/:userId` para ações suportadas |
| Participação atual | `user_joined`, `user_is_reserve`, `user_approval_status`; considerar paginação, sem inventar endpoint de “minhas missões” |
| Abrir detalhes | Reutilizar o fluxo de detalhe/modal do clássico; a rota React `/missions/:id` não está registrada atualmente |

Componentes reutilizáveis: `MissionActions`, `JoinMissionModal`, `MissionCard`/`MissionPoster`, utilitários de `missionPresentation.js`, estados de UI e notificações. Regras de inscrição continuam exclusivamente no backend. O HTML5 não deve traduzir os estados reais OPEN/CLOSED/RUNNING/PAUSED/FINISHED/CANCELLED para os três estados fictícios do tipo experimental e tratá-los como contrato de negócio.

Lacunas do protótipo: painel real paginado, abertura de detalhes, inscrição com feedback de reserva/aprovação, atualização após eventos e interação física com o quadro. São trabalho da Sprint 9, não endpoints novos a implementar agora.

## 6. Estrutura proposta, ainda não implementada

Manter o frontend atual, com feature carregada sob demanda; adicionar TypeScript apenas no novo módulo. O Vite suporta esse uso, mas a checagem de tipos deve ter comando próprio: build Vite sozinho não comprova TypeScript. Não migrar o aplicativo inteiro nem atualizar React/Fastify como pré-requisito.

```text
frontend/src/features/social-hub/        # proposta; não criado
  config/                               # nome, descrição, identidade, engine e manifestos
  scene/                                # Pixi, câmera, camadas, lifecycle e iluminação
  world/                                # importação do mapa, projeção, colisão, navegação, interações
  entities/                             # jogadores, NPCs, estado e animações
  appearance/                           # classes, aliases, presets e composição de sprites
  realtime/                             # adaptador do /ws e contrato validado
  integrations/                         # adaptadores de personagens e missões existentes
  ui/                                   # painéis React, seleção e acessibilidade
  assets/                               # atlas/mapas aprovados e manifesto de licenças
```

Backend: evoluir incrementalmente o serviço `tavernRoom.js` e suas validações no mesmo Fastify, mantendo os eventos clássicos. `WsContext` já oferece assinatura bruta `on('*', ...)`, mas não expõe envio; esse adaptador precisará ser definido na sprint multiplayer. Não conectar o frontend ao `server-reference` como serviço paralelo. O protocolo de sala é plano; broadcasts clássicos usam `{type,data,ts}`. Essa diferença precisa ser tratada explicitamente, inclusive o JOIN hoje ausente em `ClientEvent` e enviado com `as any`.

Mapa: Tiled JSON isométrico é adequado para camadas de piso, objetos ordenáveis, oclusores/frontais, colisões, pontos de interação e spawn. Pixi fornece renderização; importador, projeção, pathfinding e autoridade de movimento são responsabilidades da aplicação. Gerar cliente/servidor a partir de um mapa canônico, validando versão/hash. Não introduzir um pacote compartilhado fora dos contextos Docker sem ajustar e testar seu empacotamento: hoje backend e frontend são builds separados.

Camadas: piso → objetos e entidades com profundidade por ponto de apoio → oclusores → efeitos/luzes → labels/balões; interface e modais em React. A profundidade precisa considerar personagens e mobiliário juntos, não somente jogadores entre si. Câmera com limites, escala por viewport e controles sem capturar a digitação do chat.

Coexistência: usar o mesmo `AuthProvider`, API e preferência já existentes; preservar entrada Mana e retorno ao clássico. Seleção de engine deve ser configuração explícita e reversível, separada de autorização. Integrações futuras com Mana podem compartilhar identidade/seleção Nimrod, abrir side quests já autorizadas e retornar ao hub; posições, equipamentos e estados transitórios das duas engines continuam próprios até existir um contrato deliberado de interoperabilidade.

Fontes técnicas primárias: [PixiJS Application](https://pixijs.com/8.x/guides/components/application), [migração v8](https://pixijs.com/8.x/guides/migrations/v8), [camadas Tiled](https://doc.mapeditor.org/en/stable/manual/layers/) e [JSON Tiled](https://github.com/mapeditor/tiled/blob/master/docs/reference/json-map-format.rst). A compatibilidade proposta é uma avaliação da codebase e desses recursos, não um teste de desempenho/mobile já concluído.

## 7. Assets necessários e licenciamento

A imagem anexada foi considerada referência de composição: salão central, balcão, mesas, fogo/luz quente, músicos/NPCs, quadro físico, entrada e painéis periféricos. Não foi importada como cenário nem tratada como autorização de redistribuição. Nenhum asset novo foi baixado ou gerado nesta sprint.

Faltam assets aprovados para o objetivo visual:

1. Tiles isométricos de madeira, paredes e recortes/frontais; entrada/passagem e seus pontos de apoio.
2. Balcão modular, garrafas/canecas/barris/prateleiras, mesas, cadeiras, tapetes e decoração, com peças e oclusores separados.
3. Lareira e chama animadas, velas/tochas, máscaras/emissões de luz e efeitos compatíveis com a mesma escala.
4. Quadro de missões separado e estados visuais de interação; não cartazes com missões inventadas.
5. Sprites direcionais idle/walk para as 12 classes solicitadas, mais corpo base e fallback visível; presets e alias para classes adicionais/subclasses/multiclasse.
6. Camadas compatíveis de corpo, armadura, arma, escudo e acessórios, com pivôs e animações alinhadas, para evolução futura sem alterar inventário real.
7. NPC anfitrião/músico e instrumento, animações simples e pontos de interação; ícones existentes podem atender a UI.

Cada entrega deve incluir origem, autor, licença/versão, autorização de redistribuição e modificações, créditos e arquivo da licença. Não há comprovação suficiente para publicar os WebP/tokens existentes como arte final. A licença local do Source of Mana distingue código MIT de arte, incluindo CC BY-SA 4.0 e licenças específicas de fontes/addons; conferir a entrada de cada recurso e seus créditos antes de reutilizá-lo. A arte ortogonal do Mana também não corresponde automaticamente ao estilo isométrico pretendido. Referência primária adicional: [licença do upstream](https://github.com/sourceofmana/sourceofmana/blob/095803fe9bf496cafcfeebf6a62ae591593491bf/LICENSE.md).

## 8. Riscos e dependências prioritários

| Prioridade | Achado | Tratamento proposto / momento |
|---|---|---|
| Alta | Autenticação humana confia em headers do Access; ingress `/bridge` não autentica produtor no código do Bridge | Verificar limites de rede/Access e autorização do produtor antes de expor novos fluxos; nunca expor API/Bridge diretamente |
| Alta | Vínculo self-service aceita personagem sem dono sem comprovar ownership Foundry; SELECT e UPDATE não são atômicos | Risco de associação indevida e corrida entre usuários, identificado por leitura; diagnóstico/correção específica antes de confiar no vínculo como prova de propriedade do Actor |
| Alta | Sala HTML valida propriedade apenas no JOIN; JOINs concorrentes e troca de personagem no mesmo socket não têm gestão robusta | Revalidação/revogação, uma sessão por vínculo, remoção correta e testes de corrida na Sprint 7 |
| Alta | Sala não impõe limite de frequência próprio para JOIN/movimento/chat nem valida finitude de todos os números | Schema estrito, teto de payload/conexões, rate limit, heartbeat/timeout e cleanup; não confundir teto de velocidade com proteção contra flood |
| Alta | Chat “grupo” é transmitido para a sala inteira | Disponibilizar apenas canais realmente isolados; nenhuma promessa de privacidade de grupo com o broadcast atual |
| Alta | Fundo único, arte sem licença comprovada e ausência de sprites por classe | Produção/aprovação dos assets por camada nas Sprints 3 e 6; nunca declarar placeholders como resultado final |
| Média | Protótipo e referência não passam nas verificações estáticas atuais | Corrigir apenas o que for promovido, sob autorização da Sprint 2; preservar o experimento e alinhar versões do plugin ao backend real |
| Média | Worker Foundry parado e sync periódico desativado | Tratar dados como snapshot; revalidar atualização real em etapa própria, sem reiniciar serviços durante esta auditoria |
| Média | Estado da sala, presença e rate limiter são locais ao processo | Começar com uma instância; definir capacidade e estratégia de múltiplas instâncias antes de escalar; Redis atual é fila Foundry, não estado multiplayer pronto |
| Média | `game/` ignorado e diversos arquivos locais não rastreados | Backup controlado antes de mudanças futuras; patch não substitui cópia de assets gerados, alterações locais e volume |
| Média | Duas fábricas de aplicação, testes com mocks e caminhos de proxy distintos (8088/8081/3001) | Testar o entrypoint/ingress usados no deploy; não criar contratos com base no README de referência |
| Média | TickEngine importa `./reportEngine.js`, mas o arquivo está em `services/` | Defeito preexistente fora do escopo; planejar correção separada antes de certificar atividades expiradas |

Achados de segurança da tabela são conclusões de inspeção estática, não testes ofensivos no ambiente real. Nenhuma associação real foi alterada para reproduzi-los.

## 9. Verificações executadas e seus limites

| Verificação | Resultado nesta sessão |
|---|---|
| Backend: `npm test -- --pool=forks --minWorkers=1 --maxWorkers=2` | 217 testes passaram, 18 ignorados; 14 arquivos passaram e 1 foi ignorado |
| Segurança da execução dos testes | DATABASE_URL apontada a destino sintético sem serviço; teste PostgreSQL opt-in desabilitado e webhook vazio; nenhuma migração de teste no banco real |
| Frontend clássico: `npm test` | 8/8 passaram |
| Frontend clássico: `npm run lint` | Passou sem mensagens de erro/warning |
| Frontend clássico: `npm run build` | Passou, Vite 5.4.21, 2.385 módulos |
| Experimento PixiJS: `npm run build` | Falhou: 25 erros TypeScript em `mockTransport.ts`, por eventos/tipos antigos incompatíveis |
| Referência de gateway: `npm run typecheck` | Falhou: resolução local de `@fastify/websocket` ausente e erros derivados de tipos do handler; não foram instaladas dependências |
| Backend/Foundry: `node --check` | 77 arquivos JavaScript, zero falhas de sintaxe; não substitui testes de import/dependências |
| Mana: `node experiments/source-of-mana/verification/hub-layout.mjs` | Passou: 36×28, 675 células conectadas, 5 áreas acessíveis, bordas sólidas e tilesets existentes |
| Compose principal e Mana integrado: `config --quiet` | Ambos passaram; principal avisa token Cloudflare não definido, sem iniciar túnel |
| HTTP local | `/api/health`, `/lobby` e Mana web retornaram 200; Mana com COOP/COEP esperados |
| Docker/DB | Inventário e montagens consultados; PostgreSQL consultado apenas em transação READ ONLY |
| Preservação | Snapshot SHA-256 de 249 arquivos de implementação/configuração de recursos sob inspeção: nenhuma alteração antes/depois das verificações |

Os 18 testes ignorados são a suíte PostgreSQL de missões que exige banco descartável explicitamente configurado (`MISSION_TEST_DATABASE_URL`, porta 55438, base `mission_audit_test`). Os testes Mana da suíte padrão usam mocks; não foi repetido o teste de dois clientes Godot, resgate de ticket real, navegador autenticado ou sincronização Foundry ponta a ponta. HTTP 200 de `/lobby` apenas comprova o shell SPA servido, não login/entrada/movimento. Os containers não foram reconstruídos com o checkout desta sessão. Não há script de build ou lint de backend no package.json; a checagem de sintaxe e a suíte disponível foram usadas.

Os builds locais geram somente saídas de verificação como `frontend/dist` e metadados TypeScript ignorados; não houve deploy ou alteração de bundle servido pelo Docker.

## 10. Plano e fronteira de autorização

| Sprint | Escopo de entrega e dependência principal |
|---|---|
| 1 — diagnóstico atual | Arquitetura, inventário de preservação, testes de baseline, riscos e proposta. Relatório entregue com falhas preexistentes registradas; sem homologação do HTML5 |
| 2 — depende de autorização | Feature HTML5/TS/Pixi isolada, rota experimental, configuração central de identidade, lifecycle e alternância usando contextos existentes; compilar e testar; sem entregar mapa/multiplayer fictícios |
| 3 | Mapa isométrico em camadas com assets e licenças aprovados; dependência de produção artística |
| 4 | Navegação, colisões e interações por objeto com testes de geometria e profundidade |
| 5 | Seleção e autorização pelos personagens reais, estados vazios e tratamento de revogação |
| 6 | Resolvedor de aparência por classe; equipamento somente quando existir dado real, presets apenas visuais |
| 7 | Sala atual endurecida, autenticação no upgrade, autoridade, reconexão, limites e testes de dois clientes |
| 8 | Chat/balões, canais verdadeiros e NPCs sociais simples; sem combate/economia/minigames novos |
| 9 | Mural físico conectado às APIs/componentes de missões, permissões, paginação e inscrições existentes |
| 10 | Polimento, acessibilidade, desempenho, desktop/mobile, testes de integração e documentação operacional |

Critérios efetivamente verificados nesta Sprint 1: arquitetura e versões identificadas; conflito de rota localizado; Mana/volume existentes confirmados; contratos de identidade/personagens/missões inspecionados; ausência de equipamentos estruturados identificada; baseline executado; riscos, assets e retomada documentados; nenhuma implementação alterada. Permanecem abertas a compilação do protótipo/referência e a homologação ponta a ponta. Nenhuma sprint de implementação foi iniciada. A Sprint 2 aguarda autorização explícita do usuário.

## Arquivos criados nesta auditoria

- `docs/audit/social-isometric-sprint-1.md` — este diagnóstico.
- `docs/operations/source-of-mana-standby.md` — preservação e retomada reversível.

Todos os arquivos e alterações locais anteriores foram mantidos. Não foram instaladas bibliotecas, criadas migrações, mudadas rotas, atualizados módulos Foundry, alterados containers ou apagados volumes/assets.
