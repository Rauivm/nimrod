# Quadro de Avisos — aplicação e validação

Entrega de 17/10/2026. Diagnóstico, decisões de negócio, evidências e limitações:
[auditoria de missões](../audit/mission-board-audit.md).

## Arquivos por etapa

| Etapa | Arquivos principais |
|---|---|
| Auditoria | `docs/audit/mission-board-audit.md` |
| Banco e domínio | `backend/migrations/034_mission_lifecycle_states.sql`, `035_mission_board.sql`; `backend/src/db/index.js`; `services/missionRules.js`, `missionBoard.js`, `missionAttendance.js`, `foundryIdentity.js` |
| API e autenticação | `backend/src/routes/missions.js`, `sessions.js`, `sessionEvents.js`, `foundry.js`, `missionIntegration.js`; `middleware/auth.js`; `src/index.js` |
| Notificações | `backend/src/services/notifier/inbox.js`, `email.js`, `queue.js`, `worker.js` |
| Interface | `frontend/src/components/MissionActions.jsx`, `MissionNotifications.jsx`, `MissionPoster.jsx`, `JoinMissionModal.jsx`; `pages/HomePage.jsx`, `MissionsPage.jsx`, `FoundryConnectPage.jsx`; `src/App.jsx`, `styles/mission-controls.css`, `frontend/nginx.conf` |
| Foundry | `foundry-module/mission-panel.js`, `module.json`; `nimrod-session/scripts/PlayerMap.js`, `nimrod-session/module.json` |
| Testes | `backend/tests/missionBoard.integration.test.js`, `authProduction.test.js`, `missionNotifier.test.js`; `backend/vitest.missions.config.js`; `backend/verification/missions/*` |
| Ambiente | `docker-compose.yml` (produção por padrão); `docker-compose.pc.yml` e override local (development explícito); README |

Arquivos de experimentos já não rastreados e alterações anteriores à tarefa
foram preservados. Nenhuma dependência ou lockfile foi substituído.

## Uso no PC

O backend e frontend locais foram reconstruídos e reiniciados, com backup
prévio do PostgreSQL local. As migrações 034/035 constam em `_migrations`.
O backup está em diretório privado e ignorado pelo Git:
`node_modules/.cache/nimrod-audit/backups/`. O catálogo do arquivo foi validado;
a restauração não foi executada.

Acesse `http://localhost:8088/missions`. O fluxo clássico e a entrada opcional
do modo jogo continuam na estrutura existente.

Para uma atualização local posterior:

```powershell
.\scripts\configure-local-docker.ps1
docker compose up -d --build --no-deps backend frontend
```

Esse comando usa o override do PC. Ele mantém o banco/volumes e exclui o
túnel público. O Compose base tem produção como padrão e o override mantém
development no PC. Não copiar o override para o servidor.

Novas missões exigem mínimo de jogadores e faixa de níveis explícitos.
Missões antigas com esses campos ausentes são exibidas e mantêm seus dados;
o criador deve configurá-las em **Editar missão** antes de novas inscrições
ou início. O título/texto de nível antigo não foi convertido por adivinhação.

## Migrações e implantação no servidor

As migrações são executadas pelo runner existente ao iniciar o backend.
Antes de aplicar no servidor, conservar um backup e conferir os registros
legados. A pré-verificação usada para identificar conflitos é:

```sql
SELECT COALESCE(sl.mission_id, ma.mission_id) AS mission_id, COUNT(*)
FROM session_logs sl
LEFT JOIN mission_arcs ma ON ma.id = sl.arc_id
WHERE sl.status = 'open' AND sl.deleted_at IS NULL
  AND COALESCE(sl.mission_id, ma.mission_id) IS NOT NULL
GROUP BY COALESCE(sl.mission_id, ma.mission_id)
HAVING COUNT(*) > 1;
```

Se retornar conflitos, a migração recusa a aplicação. A escolha de qual
registro encerrar exige revisão dos dados e não é feita pelo código.

Também conferir missões com capacidade inválida anterior à migração. Os
checks novos usam NOT VALID para não eliminar registros legados; novas
operações precisam respeitar os limites.

Produção exige `NODE_ENV=production` e a autenticação/proxy já usados pelo
Nimrod. A correção do middleware impede que DEV_USER_EMAIL ou X-Dev-User
substituam a identidade em produção. O servidor remoto não foi acessado
durante esta entrega e não recebeu migrações ou novas imagens.

## Instalação e homologação Foundry

Atualizar o módulo existente `nimrod-bridge` com `module.json`,
`nimrod-bridge.js` e o novo `mission-panel.js`. Atualizar também
`nimrod-session`, incluindo PlayerMap. Ambos estão versionados em 1.1.0;
o Bridge exige a versão correspondente da dependência e Foundry mínimo 13.
Recarregar o mundo após a atualização.

O botão **Nimrod: missões e presença** usa URL e chave já configuradas no
Bridge. A URL pode apontar para a raiz do site ou terminar em `/api`; o
frontend Docker agora encaminha também `/nimrod/*` ao backend.

1. Associar a conta no painel, abrir o Nimrod e confirmar os IDs do
   mundo/conta usando a própria conta autenticada.
2. Concluir a associação no Foundry. O segredo de resgate fica nesse cliente;
   apenas o ID da solicitação é levado ao site.
3. GM seleciona uma missão associada e inicia, observando GM designado e
   mínimo de inscrições aprovadas. O código do painel antigo é alternativa
   disponível nos detalhes da missão no site.
4. Cada jogador confirma sua própria presença. Apenas conectar/reconectar
   mantém a informação de conexão. GM pode corrigir presença com motivo.
5. Encerrar a sessão para pausar; a continuação cria uma sessão distinta.
6. Para desfazer uma conta associada incorretamente, o próprio titular pode
   abrir `/foundry-connect` e revogar seu vínculo. Os vínculos de personagens
   continuam sendo gerenciados pelo Perfil existente.

A homologação real deve conferir GM e PLAYER no Foundry, dois navegadores,
recarregamento do mundo e as políticas Cloudflare para os caminhos de API.
Os endpoints mantêm autenticação própria por chave/prova/JWT conforme a rota;
o código curto não é credencial administrativa. Não ampliar a exceção de
Access para as rotas humanas do site como forma de contornar erros.

## Notificações e e-mail

A caixa interna no quadro consulta notificações persistidas, com leitura
limitada à própria conta. Alertas não são inscrições nem reservam posição.
Primeiro são promovidos os reservas; depois é avaliada qualquer vaga livre.
Alertas também informam vagas surgidas após o fechamento das inscrições,
orientando conferir o prazo.

O repositório não possui um transporte real de e-mail. O adapter
`notifier/email.js` aceita uma função de entrega configurada pelo deployment
antes de iniciar o worker. Ela recebe `to`, `subject`, `text` e
`idempotencyKey` e deve rejeitar a Promise em caso de falha, respeitando a
chave de idempotência. O notifier reutiliza a fila existente e mantém o
estado da entrega na inbox para recuperação.

Sem esse adapter, o checkbox fica indisponível e a API recusa opt-in com
HTTP 503. O alerta interno funciona; nenhum e-mail é marcado como enviado.
Credenciais de provedor não foram incluídas no código ou nesta documentação.

## Validação desta entrega

- Regressão isolada: **217 testes passaram** em 14 arquivos. A suíte de
  PostgreSQL fica desativada nesse comando para evitar qualquer banco real.
- Suíte de missão opt-in: **18 testes passaram**, com rotas reais e PostgreSQL descartável, sem carregar
  `.env`; cenários e instruções em `backend/verification/missions/README.md`.
- Dois fluxos Playwright: quadro com contas GM/PLAYER e painel Foundry
  simulado com backend/PG reais. Sem erro de JavaScript; retry de 503,
  reconexão e correção administrativa exercitados.
- Build Vite e build das duas imagens Docker concluídos. Persiste o aviso
  anterior de chunk acima de 500 kB.
- Smoke no PC: saúde, lista de missões e inbox responderam HTTP 200;
  migrações registradas, Nginx válido, pedido Foundry sem JWT recusado com 401 e túnel local continuou desativado.
- Pendente: sessão real em mundo Foundry autorizado e entrega por provedor
  real de e-mail. A simulação não é apresentada como homologação do Foundry.

As alterações permanecem locais, sem commit/push nesta tarefa.

### Revalidação em 17/10/2026, 07:50 (America/Sao_Paulo)

Os comandos foram executados novamente a pedido do usuário:

- Regressão: 217 aprovados; os 18 casos de PostgreSQL ficaram desativados
  nessa execução e passaram separadamente na suíte de integração.
- Integração: 18 aprovados em PostgreSQL descartável, com rotas reais.
- Navegador: os dois fluxos passaram, ambos com zero erros de JavaScript.
  Foram exercitados criação, aprovação, início, presença, pausa, segunda
  sessão, conclusão e reabertura; no painel Foundry simulado, também
  associação autenticada, retry após 503, reconexão e correção pelo GM.
- Build frontend aprovado; permanece o aviso de bundle acima de 500 kB.
- Verificação sintática dos módulos alterados e `git diff --check` aprovados.
- Serviço local: health, missões e notificações retornaram 200; a rota
  Foundry sem JWT retornou 401; configuração Nginx válida, backend ativo
  sem reinícios e túnel local parado.

Fixture e PostgreSQL de testes foram encerrados após a validação. Nenhum
arquivo de implementação foi alterado nesta revalidação; o serviço local
continuou em execução. Produção não foi acessada. Permanecem pendentes a
homologação em mundo Foundry real e o provedor de e-mail.

## Contratos operacionais

Os caminhos abaixo são do backend; clientes web usam o prefixo `/api`.

| Caminho | Controle |
|---|---|
| POST /missions | Conta autenticada; criador vem da autenticação |
| POST/DELETE /missions/:id/join | Própria inscrição; conta única, transação, capacidade e nível |
| PATCH /missions/:id/participants/:userId | CHARACTER próprio; APPROVE/REJECT/REMOVE por administrador associado |
| POST /missions/:id/invite | Criador, `kind: GM`, aceite do convidado |
| POST/PATCH /missions/:id/gm-requests[/requestId] | Candidatura própria ou convite; resposta por convidado/criador conforme o caso |
| POST /missions/:id/start,pause,finish,cancel,reopen,reactivate | Uma rota por ação; criador/GM designado; valida estado, motivo e confirmação |
| POST /missions/:id/open-registrations,close-registrations | Uma rota por ação; criador/GM; não abre durante RUNNING |
| POST/DELETE /missions/:id/alerts | Alerta próprio, sem inscrição ou preferência de posição |
| GET /missions/:id/history | Criador/GM designado |
| GET/PATCH /notifications[/id] | Apenas a própria caixa de entrada |
| GET/POST /sessions/:id/attendance | Lista da sessão; confirmação própria ou correção administrativa com motivo |
| GET /nimrod/missions | Identidade autenticada do cliente Foundry |
| POST /nimrod/missions/:id/start,pause,finish | Uma rota por ação; mesmo domínio e autorização usados pelo site |
| GET/POST /nimrod/sessions/:id/attendance | Identidade Foundry vinculada; mesma regra de presença |
| POST /nimrod/sessions/:id/connection | Conexão da própria conta; não confirma presença |
| /nimrod/identity/* | Criação com chave do módulo; resgate com segredo de uso único |
| /foundry/identity/* e /foundry/identity-links | Aprovação e revogação pela conta Nimrod autenticada |

No vínculo novo, há uma associação ativa por conta Nimrod em cada mundo e
por conta Foundry nesse mundo. Para trocar de conta Foundry, revogar antes
o vínculo anterior na página de associações. Isso não altera os vínculos de
personagens ou os históricos já registrados.
