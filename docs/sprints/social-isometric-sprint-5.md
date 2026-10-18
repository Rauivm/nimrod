# Sprint 5 — personagens reais do Nimrod

Data: 17/10/2026. Autorização: “Próximo”, após a conclusão da Sprint 4. Escopo: consultar os personagens da conta autenticada, selecionar um personagem elegível e identificar a exploração com seus dados reais. Sprint 6 não iniciada.

## Inspeção e contrato reutilizado

Foram inspecionados `AuthContext`, `WsContext`, página Mana, perfil, serialização de personagens, `/me/characters`, eventos de atualização/sincronização, proxy de imagens, acesso Foundry e ciclo de vida da cena. Não foi instalado pacote, criado endpoint, alterado cadastro/autenticação, executada migração ou modificada implementação de backend/Foundry/Mana.

O carregamento usa `api.get('/me/characters')`, portanto `/api/me/characters` no navegador. A rota existente filtra `player_characters.user_id = req.user.id`, `active = TRUE` e `retired = FALSE`; a conta vem do mesmo `AuthContext` que já alimenta o clássico. Não é usada a lista administrativa nem o catálogo de personagens disponíveis para vínculo.

| Informação | Fonte existente utilizada |
|---|---|
| Conta | `AuthContext.user.id` e nome de exibição; sem novo login/token |
| Personagem | `id`, `userId`, `name`, `active`, `retired`, `dead` de `/me/characters` |
| Ficha exibida | `level`, `classe`, `race` |
| Identidade Foundry | `foundryActorId`, quando preenchido |
| Retrato | `tokenImg` e depois `portraitImg`, com proxy existente `/api/foundry/assets?path=…` ou `/uploads/…` |
| Atualidade do snapshot | `lastSyncedAt`, quando disponível |
| Invalidação | Eventos existentes `CHARACTER_UPDATED` e `FOUNDRY_ACTORS_SYNCED` pelo mesmo `WsContext` |

A API ainda retorna registros mortos; não foi alterado esse contrato. A projeção do HTML5 aceita somente registros com vínculo correspondente à conta, nome/identificador válidos, `active === true`, `retired === false` e `dead === false`. Identificadores duplicados ou registros inconsistentes não entram na seleção. Isso é uma proteção de apresentação; não substitui a futura autorização de presença pelo servidor.

Personagens manuais do Nimrod sem Actor Foundry continuam elegíveis conforme as regras existentes, com essa ausência identificada. Não foram inventadas restrições adicionais por classe, nível máximo ou presença de retrato.

## Entrega

- Um único personagem elegível é selecionado automaticamente. Vários personagens exigem escolha no seletor, sem escolher silenciosamente o primeiro.
- Conta e personagem são apresentados separadamente, com nome, nível, classe, raça, estado de vínculo Foundry e última sincronização quando disponíveis.
- Nome e nível reais aparecem sobre o marcador e no cabeçalho da cena. A placa do personagem fica na camada de labels para permanecer legível sobre os móveis; o corpo/símbolo continua ordenado pela profundidade do chão.
- Trocar o personagem libera a cena anterior e monta uma nova exploração local a partir da chegada, com câmera/controles próprios. Reescolher o mesmo personagem não cria outra conexão de autenticação ou WebSocket.
- Carregamento, lista vazia, seleção pendente, erro/401 e nova tentativa têm estados próprios. Sem personagem elegível selecionado, nenhum renderizador é montado. O estado vazio aponta para o Perfil existente, sem cadastrar ou vincular automaticamente.
- Retrato ausente/inválido/indisponível usa um ícone identificado como indisponível; nenhuma imagem de personagem fictício é inserida. URLs Foundry seguem o proxy já existente, sem buscar um host externo fornecido pelo registro.

Seleção e preferência ficam somente em memória, por montagem/conta. Não são gravadas em localStorage, banco, ficha, inventário ou Foundry. Ao voltar pela rota, há nova consulta; se houver vários personagens, é necessário escolher novamente. O código não chama o endpoint inexistente `/characters/:id/select` do protótipo antigo.

## Revalidação e ciclo de vida

`CharacterRoster` concentra carregamento, projeção, escolha, filas e descarte; o hook liga esse estado a React e às assinaturas existentes. Uma solicitação concorrente comum reutiliza o carregamento em andamento. Se um evento invalidar dados enquanto uma leitura estiver em andamento, a resposta anterior é descartada e uma única nova leitura é agendada.

A lista é revalidada manualmente por “Atualizar”, nos eventos existentes da conta, em sincronização Foundry, ao reconectar o WebSocket e ao voltar para uma aba visível. `CHARACTER_UPDATED` de outra conta não dispara leitura. Os dados do evento nunca são usados como uma ficha autorizada: sempre se consulta novamente o endpoint canônico.

Durante a revalidação, a seleção exibida e a cena ficam suspensas. Uma escolha ainda elegível é recuperada ao terminar a consulta; um personagem removido, desvinculado, morto ou de outra conta não continua sendo usado. Se restar um único elegível, aplica-se a mesma seleção automática; com vários, solicita-se nova escolha. Falha da consulta não mantém uma cena com a identidade anterior.

Respostas tardias após navegação/troca de conta não publicam estado nem montam cena. A página é delimitada pela conta autenticada; não há cache compartilhado de personagens entre contas. Assinaturas de eventos e listener de visibilidade são removidos ao sair; o lifecycle gráfico anterior permanece responsável pelo canvas, observer, texturas, labels, ticker e controles.

A revalidação e a troca reiniciam posição/câmera locais. Não existe presença autoritativa ou posição persistida nesta etapa. O servidor legado da taverna usa o mapa do protótipo antigo; não foram enviados JOIN/MOVE_REQUEST nem adaptado esse protocolo silenciosamente ao mapa HTML5. Esse alinhamento pertence à Sprint 7.

## Representação visual e Foundry: limites explícitos

O símbolo verde/dourado ainda é uma representação de navegação, agora identificada com o personagem real selecionado. Não é um sprite definitivo por classe. Retratos são imagens de ficha existentes, carregadas em runtime; não foram baixados/embutidos como assets redistribuídos.

Sprites de corpo, classes/subclasses, equipamentos, composição visual e animações direcionais de personagem continuam faltantes e reservados à Sprint 6. O contrato atual não entrega inventário/equipamentos estruturados. Nenhum equipamento ou atributo foi inferido/gravado para preencher essa lacuna. Também não foram criados NPCs, chat, combate ou economia.

O portal permanece na parede e usa o `FoundryLaunchButton`/`useFoundryLaunch` existentes. `/foundry/launch` resolve o acesso da conta e, quando aplicável, o contexto de sessão suportado pelo backend; não estabelece um contrato para trocar o Actor com base na seleção local HTML5. **Escolher um personagem na taverna não troca automaticamente o Actor controlado na mesa.** Essa informação foi incluída no painel. Não foi inventado parâmetro/endpoint para fazê-lo.

O snapshot exibido pode estar defasado: worker Foundry parado e sincronização periódica desativada são condições preexistentes da auditoria. Não foram reativados serviços ou modificados vínculos. `lastSyncedAt` é apenas o dado real recebido, não uma garantia de sincronização contínua. O login dentro de um mundo Foundry não foi acionado/homologado nesta sprint.

## Arquivos alterados nesta sprint

Os caminhos abaixo são relativos à raiz. Alterações locais das sprints anteriores e outras alterações do usuário foram preservadas.

| Arquivo | Mudança |
|---|---|
| `frontend/src/pages/Html5LobbyPage.jsx` | Adaptador da conta, API e assinaturas WS existentes; isolamento por conta |
| `frontend/src/features/social-hub/characters/hubCharacters.ts` | Novo: tipos, projeção do contrato e URLs de retrato |
| `frontend/src/features/social-hub/characters/CharacterRoster.ts` | Novo: seleção/carregamento/revalidação por conta |
| `frontend/src/features/social-hub/characters/useHubCharacters.ts` | Novo: integração React e cleanup das assinaturas |
| `frontend/src/features/social-hub/ui/HubCharacters.tsx` | Novo: seletor, ficha resumida, retrato e estados |
| `frontend/src/features/social-hub/SocialHub.tsx` | Integração da seleção e informação do escopo |
| `frontend/src/features/social-hub/ui/HubViewport.tsx` | Recebe personagem real e o identifica no mapa |
| `frontend/src/features/social-hub/ui/HubInteraction.tsx` | Explica limite da seleção em relação ao Actor Foundry |
| `frontend/src/features/social-hub/scene/useHubScene.ts` | Personagem na criação/lifecycle da cena |
| `frontend/src/features/social-hub/scene/HubScene.ts` | Encaminha a identidade validada da seleção |
| `frontend/src/features/social-hub/scene/TavernExplorer.ts` | Marcador identificado e nome acessível do canvas |
| `frontend/src/features/social-hub/scene/ExplorerMarker.ts` | Nome/nível reais, com truncamento somente na placa gráfica |
| `frontend/src/features/social-hub/scene/TavernEnvironment.ts` | Camada de labels para a placa legível |
| `frontend/src/features/social-hub/config/hubConfig.ts` | Identificação da Sprint 5 |
| `frontend/src/features/social-hub/social-hub.css` | Seleção compacta/responsiva e ficha resumida |
| `frontend/verification/social-hub-characters.test.mjs` | Novo: nove testes de contrato, seleção, concorrência e isolamento |
| `frontend/verification/social-hub.cjs` | Cenários de personagens e regressões no navegador |
| `backend/tests/profileCharacters.test.js` | Novo: três testes do contrato existente, com banco mockado |
| `docs/sprints/social-isometric-sprint-5.md` | Este relatório |

Não foram alterados `package.json`, lockfile, imagens, mapas, configuração de serviços, backend de produção, autenticação, vínculos de personagem ou Source of Mana nesta sprint. O PNG conserva o SHA-256 `3e02678d8ec7eb62bf8dd86bb2d64862ebcc662a1999430c1a2b84a2adf67735` e sua proveniência/licenciamento anterior. Não foram adicionados assets de terceiros ou novos bitmaps.

## Critérios efetivamente verificados

| Verificação | Resultado |
|---|---|
| Testes frontend | `npm test`: 39/39 passaram; nove novos e 30 anteriores |
| Contrato/seleção | Conta correta, flags de elegibilidade, duplicados, dados ausentes, URLs de retrato, seleção única/múltipla, escolha inválida e revogação |
| Concorrência | Leitura invalidada em andamento, fila coalescida, erro/retry, resposta após descarte e isolamento entre contas |
| Backend relacionado | `profileCharacters.test.js` + `profileManagement.test.js`: 20/20 passaram; três novos testes e 17 existentes, sem banco real |
| Estática/build | Lint JS/JSX, typecheck TS estrito e build Vite passaram; 3.126 módulos transformados |
| Navegador | 20 grupos de checks passaram no Edge headless, zero pageerrors |
| Personagens no navegador | Automático com um; escolha com vários; exclusão de outra conta/mortos/aposentados; troca descarta canvas; metadados reais e fallback de imagem |
| Atualizações reais do contrato | Eventos existentes causam GET canônico, sem confiar no payload; seleção morta é removida; metadados mudam sem inventar ficha |
| Ausência/erro | Falha 503, 401 e lista vazia não montam nem mantêm renderizador; nova tentativa recupera; visitante não consulta personagens |
| Cleanup | Saída durante consulta tardia não monta cena; assinaturas removidas não fazem outra leitura após evento; um canvas/observer/listener de input por cena |
| Regressões | Movimento, colisões, teclado, toque, câmera, mapa, portal, perda de contexto, atlas indisponível e alternância clássico/Mana preservados |
| Acessibilidade/layout | Zero violações Axe WCAG 2/2.1 A/AA no salão e painel Foundry; desktop e mobile sem overflow horizontal; screenshots inspecionadas |
| API local sem mocks | Conta local retornou quatro personagens elegíveis; um foi selecionado a partir dessa lista e exibido na cena; uma consulta `/api/me`, cinco leituras de personagens ao longo da navegação, zero mutações/lançamentos e zero pageerrors |
| HTTP/Docker | Build Docker passou e somente o frontend foi atualizado; `/lobby/html5` retorna 200 em loopback 8088 |
| Preservação | 129 hashes de arquivos fora do frontend comparados ao baseline da sprint: zero alterações; Mana/volume preservados; `git diff --check` passou |

Os fixtures existem somente nos testes. O smoke real percorreu seleção HTML5→painel do portal→clássico→HTML5→seleção Mana→HTML5. Não abriu o Foundry, não lançou/resgatou ticket Mana, não alterou vínculos, fichas, inventários ou missões. O relatório divulga somente contagens, sem nomes/identificadores reais.

Resultados locais ignorados pelo Git: `frontend/node_modules/.cache/social-hub/report.json`, `desktop.png`, `mobile.png`, `portal.png` e `live-characters-report.json`. Para repetir os checks mantidos no repositório:

```powershell
Set-Location C:\Foundry\nimrod\frontend
npm test
npm run lint
npm run build
npm run test:hub:ui
Set-Location C:\Foundry\nimrod\backend
npm test -- --run tests/profileCharacters.test.js tests/profileManagement.test.js
```

Os testes de navegador usam Edge/Chromium headless, não dispositivos físicos ou auditoria manual de leitor de tela. Eles não certificam sprites de classe, inventário, multiplayer ou controle do Actor dentro do Foundry. O novo teste backend valida o contrato e o uso do proprietário autenticado; não substitui os testes de autenticação nem a futura autorização de JOIN.

## Atualização local e reversibilidade

A imagem anterior foi preservada como `nimrod-frontend:social-hub-before-sprint5`, ID `3731c017040222f4657e896f04546f484d19d1d8707d37e098376e8aef642fbf`. A imagem final é `2acd7f9f79e92219ae104ba5976ee0f2e36e2c0856cd3dce5c7f0820302e1d01`.

Foi executado build/update somente do frontend, com `docker compose build frontend` e `docker compose up -d --no-deps frontend`. Nenhum outro container foi reiniciado/recriado, nenhuma migração executada e nenhum volume alterado. O túnel Cloudflare permaneceu parado, sem deploy remoto.

`nimrod-mana-mana-server-1` permaneceu running/healthy, `nimrod-mana-mana-web-1` running, com `nimrod-mana_mana-data` montado em `/data`. O procedimento de retomada do projeto continua em [Source of Mana em standby](../operations/source-of-mana-standby.md).

Se necessário, reverter exclusivamente o frontend local:

```powershell
Set-Location C:\Foundry\nimrod
docker image tag nimrod-frontend:social-hub-before-sprint5 nimrod-frontend:latest
docker compose up -d --no-deps --no-build frontend
```

O rollback não foi executado e não exige apagar imagens/volumes. A Sprint 5 está concluída dentro do escopo documentado. A Sprint 6 — aparência por classe/equipamentos visuais — aguarda autorização.
