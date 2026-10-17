# Quadro de Avisos e Missões — auditoria e execução

Data: 17/10/2026. Base inspecionada: commit `2fd7c7d`. Escopo: missões, participantes, personagens, sessões,
notificações e módulos Foundry. Nenhum banco de produção foi acessado.

## Etapa 1 — diagnóstico anterior às alterações

Arquitetura: React/Vite consome Fastify por `/api`; PostgreSQL mantém missões,
arcos, sessões e personagens. WebSocket publica eventos. Redis atende a fila
do Foundry Bridge, não as inscrições. O notifier existente oferece Discord
com fila em memória; não há caixa de entrada interna nem transporte de e-mail.
`nimrod-bridge` trata launch/handshake; `nimrod-session` coleta eventos.

| Requisito | Estado inicial | Evidência estática |
|---|---|---|
| Criação por autenticado | Parcial | `missions.js:349`, POST já aceita PLAYER; formulário em `HomePage.jsx:75`; faltam limites estruturados, mínimo e aprovação |
| Agenda opcional | Defeituoso | `missions.js:29` inventa hoje/20h; migration 003 impõe data para MISSION |
| Uma inscrição por conta | Implementado no esquema | migration 001, UNIQUE(mission_id,user_id); endpoint não trata corrida |
| Personagem/nível | Parcial | `missions.js:511` valida dono; nível textual não é validado; modal permite ausência em qualquer missão |
| Capacidade/FIFO/promoção | Defeituoso | `missions.js:526` conta antes de inserir sem lock; DELETE join não promove; invite ignora capacidade |
| Aprovação manual | Inexistente | `participant_type` só PLAYER/RESERVE, sem estado de aprovação |
| Alertas/inbox/e-mail | Inexistente | notifier/queue.js é memória/Discord; nenhuma tabela de notificações |
| GM designado/convites | Inexistente | Sem GM na missão; start usa solicitante como primary_gm |
| Permissões compartilhadas | Defeituoso | `missions.js:433,575` autoriza qualquer GM, mesmo sem associação |
| Estados independentes | Parcial | enum OPEN/CLOSED/RUNNING/FINISHED; fechamento de inscrição altera status; falta PAUSED/CANCELLED |
| Múltiplas sessões | Parcial | migration 021 vincula missão/arco/sessão; ausência de exclusão de duas sessões abertas |
| Início Foundry/site | Defeituoso | start exige código, ignora mínimo/GM e não usa transação; link-foundry trata expires_at NULL como expirado |
| Presença por sessão | Parcial/inseguro | migration 022 é reutilizável; foundry.js:399 resolve nomes visíveis e mistura conexão/presença |
| Identificação Foundry | Parcial/inseguro | vínculos de Actor existem; PlayerMap.js:184 usa nome; não existe vínculo verificado world/user |
| Histórico administrativo | Inexistente | Sem trilha de alterações de missão/GM |
| Testes críticos | Insuficiente | sessions.test.js declara mini-app que replica rotas, não importa produção; sem teste de disputa de vagas |

Evidência de execução inicial: **214 testes passaram, em 12 arquivos**, com
configuração isolada e bloqueio de rede. Isso não demonstra o funcionamento
das rotas de missão nem da integração real Foundry. Nenhuma sessão real foi
iniciada durante a auditoria.

## Riscos prioritários

1. **Alta**: inscrições e início simultâneos podem exceder vagas/criar sessões
   duplicadas. Centralizar transações em uma conexão e bloquear a missão.
2. **Alta**: GM não associado administra terceiros; convites furam lotação.
   Autorizar pelo criador/GM designado, nunca por código de handshake.
3. **Alta**: nomes são usados como identidade de presença. Trocar por vínculo
   de Actor sincronizado ou associação comprovada por autenticação Nimrod.
4. **Alta**: DELETE da missão apaga presenças/arcos. Usar cancelamento
   auditável preservando registros e relacionamentos.
5. **Média**: JOIN de participantes com ratings multiplica contagens. Agregar
   independentemente, sem produto cartesiano.
6. **Média**: fechamentos têm regras diferentes entre missões/sessions e
   Foundry. Reutilizar o mesmo serviço de ciclo de vida.
7. **Média**: exceções de leitura são convertidas silenciosamente em listas
   vazias. Remover esse fallback nos dados centrais de missão.

## Sequência incremental autorizada

1. Registrar auditoria e baseline (este documento).
2. Migrações aditivas; serviço de domínio sobre as tabelas existentes;
   transações/locks, regras de inscrição, GM, ciclo de vida e inbox.
3. Adequar os componentes existentes do quadro e formulário. Reutilizar
   endpoints existentes; adicionar apenas operações ausentes verificadas.
4. Estender nimrod-bridge: identidade autenticada, seleção de missão,
   início pelo mesmo serviço e presença explícita; código como alternativa.
5. Validar migrações em PostgreSQL descartável, rotas reais, concorrência,
   builds e simulação de APIs Foundry. Registrar limites da validação real.

## Decisões ainda abertas

Foram sinalizadas ao usuário: mínimo padrão de jogadores, candidatura de
conta PLAYER a narrador e reabertura antes da primeira sessão. Até definição,
novos cadastros devem informar o mínimo explicitamente, sem inferir narrador
do criador. Regras legadas ambíguas devem exigir configuração explícita,
preservando inscrições, sessões e o texto original de nível.

## Resultados por etapa

As seções seguintes distinguem implementação, execução e homologação pendente.

### Etapa 2 — backend e persistência

Implementação sobre `missions`, `mission_participants`, `mission_arcs`,
`session_logs`, `session_attendance`, `session_events` e `session_snapshots`.
Não foi criado outro sistema de missões/sessões. Não houve troca de bibliotecas.

| Funcionalidade entregue | Evidência na implementação | Validação |
|---|---|---|
| Limites, criador autenticado, agenda/prazo opcionais, GM inicialmente ausente | `routes/missions.js`, POST /missions; `missionRules.js:validateMissionFields` | Rota real + PostgreSQL; criação no navegador |
| Inscrição por conta, personagem opcional até mínimo 3, propriedade e faixa de nível | `missionBoard.js:joinMission`, `missionRules.js:validateCharacter` | Última vaga disputada por 8 contas; personagem obrigatório e dono incorreto |
| Aprovação sem ocupar vaga antecipadamente | `missionBoard.js:participantAction` | Pedido pendente não conta; aprovação sem capacidade retorna 409 |
| FIFO, promoção sem nova aprovação, reservas preservadas | `missionBoard.js:promoteAndAlert` | Promoção após fechamento/prazo e após alteração de níveis |
| Alerta interno persistente, cancelamento de alerta e ausência de reserva | `mission_vacancy_alerts`, `notifier/inbox.js` | Notificação após promoção; conta alertada não ocupa a vaga; acesso privado à inbox |
| Candidatura de GM, convite com aceite e substituição | `gmRequest`, `resolveGmRequest` | GM estranho recebe 403; PLAYER não se candidata; GM antigo perde administração após substituição |
| Estados e inscrições independentes | `transitionMission` | Transições inválidas recusadas; PAUSED reabre inscrições sem mudar estado da aventura |
| Sessões múltiplas, início idempotente, fechamento e snapshots | `transitionMission`, `closeActiveSession`, índice `uq_mission_open_session` | Início simultâneo site/Foundry retorna o mesmo UUID; segunda sessão conserva a primeira |
| Cancelamento, reativação e reabertura auditáveis | `mission_history`, `transitionMission` | Motivo/confirmação validados; participantes e sessões preservados |
| Presença individual, própria ou corrigida por administrador | `missionAttendance.js:confirmAttendance` | Duas confirmações simultâneas geram um evento; correção por estranho é recusada |

As transações usam uma conexão de `pg.Pool`, via `db/index.js:transaction`.
Inscrição, aprovação, desistência, promoção, alteração de regras, troca de GM,
início e encerramento bloqueiam a mesma missão com `SELECT ... FOR UPDATE`.
O índice parcial é uma segunda proteção contra sessões ativas duplicadas.

Migrações:

- `034_mission_lifecycle_states.sql`: acrescenta PAUSED/CANCELLED ao enum,
  em arquivo separado para confirmar os novos valores antes de usá-los.
- `035_mission_board.sql`: campos estruturados, aprovação, histórico,
  solicitações GM, alertas, inbox, confirmação explícita e provas/vínculos de
  identidade Foundry. Remove a obrigação de agendamento.
- Não apaga inscrições, sessões ou personagens. Backfill da missão da sessão
  usa seu arco já existente; GM é inferido somente de narrador registrado,
  nunca do criador. Níveis textuais antigos e UUIDs permanecem.
- Mínimo de jogadores e faixa de níveis legados ambíguos ficam sem inferência:
  precisam de edição explícita antes de iniciar/receber novas inscrições.
- Conflitos de duas sessões abertas impedem a migração e fazem rollback.
  Não há seleção automática de qual sessão deve ser encerrada.
- Migração repetida foi testada; também foi testado o upgrade com dados
  legados e a recusa de duplicidades sem exclusão de registros.

### Etapa 3 — Quadro de Avisos

`HomePage.jsx` continua fornecendo o formulário existente; ele também foi
exposto na página do quadro, sem outro fluxo de criação. `MissionPoster.jsx`
continua sendo o cartão utilizado nas duas páginas. O controle operacional
fica em `MissionActions.jsx`, com seleção de personagem no modal existente.

Foram acrescentados filtros PAUSED/CANCELLED, erros explícitos, caixa de
notificações, aprovação, candidatura/aceite GM, agendamento, motivo
administrativo, histórico e seleção de sessões anteriores para presença.
As ações verificam novamente as permissões no backend.

Eventos globais MISSION_CREATED/MISSION_UPDATED transportam o ID; cada
cliente recarrega seu DTO autenticado. Isso evita distribuir candidatura
privada, `canManage` ou `user_joined` de uma pessoa a todos os sockets.
Reconexão do quadro recarrega o estado. Confirmações e conexões atualizam
a lista de presença por eventos, sem converter conexão em presença.

Fluxo executado no navegador, com duas contas sintéticas, rotas reais e
PostgreSQL: criar → assumir narração explicitamente → solicitar inscrição →
aprovar → iniciar → confirmar presença → pausar → segunda sessão → concluir →
reabrir. Nenhum erro de JavaScript observado. Avisos/enquetes foram mantidos
e têm teste de API para criação sem os campos específicos de missão.

### Etapa 4 — Foundry

O módulo existente `nimrod-bridge` recebeu `mission-panel.js`; não foi criado
outro módulo. `nimrod-session/PlayerMap.js` agora consulta o mapa existente
de Actor ID, em vez de associar personagens por nome. Ambos os manifests
foram versionados em 1.1.0; o mínimo efetivo é Foundry 13, já exigido pela
dependência nimrod-session. A compatibilidade declarada não substitui
homologação na instalação real.

Identidade: a prova de associação tem segredo aleatório mantido apenas no
cliente Foundry, hash no banco e validade de dez minutos. A conta autenticada
confirma no site, vendo os IDs do mundo/conta. O resgate é único e emite JWT
específico do cliente, de oito horas, validado contra o vínculo persistido e
o papel atual da conta. A associação pode ser revogada pelo próprio usuário
em `/foundry-connect`; os tokens deixam de ser aceitos. Nenhum papel do
Foundry é promovido por esse processo.

O painel lista missões associadas, exibe participantes, inicia pelo mesmo
serviço do site e permite pausa/conclusão. Controles administrativos só são
exibidos ao GM real do Foundry e dependem ainda da autorização Nimrod. O
código legado continua como alternativa de vinculação a sessão autorizada,
sem atribuir narrador ou substituir autenticação.

Presença: heartbeat/conexão são fatos de conexão. `confirmed_at` só é alterado
por confirmação própria ou correção administrativa com motivo. Cada sessão
mantém sua lista e seus eventos. Um teste adicional recusa identidade forjada no payload de heartbeat.
Nomes visíveis não resolvem identidade nos
caminhos de presença; o vínculo da conta ou o Actor ID sincronizado são usados.

Validação executada: APIs de `game`, `Hooks` e settings simuladas em navegador,
com **rotas Nimrod e PostgreSQL reais**. Associação GM/jogador, seleção,
falha 503 seguida de retry, confirmação própria, reconexão, correção do GM,
pausa, sessão seguinte e conclusão passaram. A validação detectou uma corrida
de renderização ao trocar a missão antes da resposta anterior; foi corrigida
com controle da versão de renderização, e o cenário passou depois da correção.

**Pendente de homologação real:** instalação/recarga dos dois módulos em um
mundo Foundry autorizado, permissões efetivas da conta Foundry, funcionamento
das rotas através das políticas Cloudflare Access e atualização conjunta dos
clientes antigos. Nenhuma operação foi executada contra o Foundry/servidor
de produção. Esta etapa está validada em simulação, sem alegação de teste
em uma sessão real de jogo.

### Etapa 5 — testes, aplicação local e limites

Resultados finais: **217 testes de regressão isolados e 18 testes de
integração PostgreSQL passaram (235 no total)**. Os dois fluxos Playwright
também passaram. Resultados e reprodução estão em `docs/operations/mission-board.md` e
`backend/verification/missions/README.md`. A aplicação local usa as imagens
Docker reconstruídas; migrações 034/035 foram aplicadas ao banco do PC após
backup em formato custom e validação do catálogo com `pg_restore -l`.
Não foi realizado ensaio de restauração desse backup.

Pré-verificação local encontrou zero conflitos de sessões abertas. Os volumes
existentes foram mantidos. `/api/health`, `/api/missions` e `/api/notifications`
responderam HTTP 200. O conector Cloudflare do PC permaneceu parado e sem
reinício automático.

O transporte real de e-mail não existe no projeto. Foi criada uma interface
desacoplada no notifier existente, com entrega pendente persistida, fila,
retry e recuperação na inicialização. Sem transporte, a opção aparece
indisponível e tentativas de habilitá-la recebem 503; não há envio simulado.
A entrega por SMTP/provedor externo permanece não verificada.

## Decisões aplicadas e compatibilidade

- Conforme a resposta do usuário, candidatura/designação exige conta GM no
  Nimrod; a narração no Foundry exige sua permissão real de GM.
- Criar não designa narrador. O criador GM pode usar **Assumir narração**;
  o gesto solicita e aprova sua própria candidatura autenticada.
- Novas missões informam mínimo de jogadores e faixa de níveis explicitamente.
  Máximo padrão 4 e reservas padrão 2 reaproveitam os valores existentes.
- OPEN/CLOSED são mantidos para clientes legados antes da primeira sessão.
  `registrations_open` é a fonte do estado das inscrições e pode variar em
  PAUSED sem alterar o estado da aventura.
- Fechamento do prazo impede novos pedidos; pedidos pendentes podem ser
  deliberados antes da próxima sessão, respeitando capacidade e nível atual.
  Aprovados mantêm vaga/posição mesmo após mudanças de nível da missão.
- Alertas são consumidos quando surge vaga, inclusive com inscrições fechadas;
  a mensagem orienta consultar o prazo e não promete reservar ou reabrir vaga.
- Reabertura/reativação exige confirmação e motivo; volta com inscrições
  fechadas. Pausa encerra a sessão, e a continuação cria outro UUID.
- `/missions/:id/invite` exige `kind: "GM"` para o novo convite de narrador.
  O payload legado que forçava inscrição retorna 409 e não modifica vagas.
- DELETE de missão retorna 409 orientando cancelamento auditável. Essa
  incompatibilidade intencional impede apagar o histórico e seus vínculos.
- PATCH status OPEN/CLOSED continua como alias das ações de inscrição.
  Outros estados precisam das ações validadas; não se aceita status arbitrário.
- Detalhes de participantes mantêm aliases snake_case anteriores junto dos
  campos usados pela interface, evitando perder identificadores de contratos.
- O Compose base agora usa `NODE_ENV=production` por padrão. O override do PC
  define development explicitamente. DEV_USER_EMAIL e X-Dev-User não são
  aceitos pelo middleware em produção. A configuração do servidor remoto
  não foi alterada nem aplicada.

## Riscos e pendências remanescentes

1. Homologação real Foundry/Cloudflare, descrita acima; a simulação não testa
   o servidor Foundry nem suas permissões internas.
2. E-mail sem provedor configurado; o canal interno está disponível.
3. Missões legadas com limites não estruturados precisam de configuração,
   preservando o texto e as inscrições existentes.
4. Coleta legada de recursos/eventos continua usando a chave de serviço do
   módulo. Os novos comandos administrativos exigem identidade Nimrod; esta
   entrega não redesenha a distribuição da chave dos coletores legados.
5. Os testes antigos que replicam handlers continuam existindo; as regras
   novas são cobertas por rotas importadas da implementação real.
6. Permanece o aviso de bundle frontend acima de 500 kB. Não houve troca de
   dependências nem divisão preventiva de módulos para eliminar esse aviso.
