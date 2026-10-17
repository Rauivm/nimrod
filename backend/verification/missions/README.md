# Validação de missões

Os testes de integração importam as rotas de produção. Não replicam handlers.
Só aceitam banco `mission_audit_test` em `127.0.0.1:55438`; variáveis de e-mail
e assinatura são substituídas por valores sintéticos. Não carregam `.env`.

## PostgreSQL descartável e suíte de API

Na raiz do repositório, com Docker Desktop local:

```powershell
docker --context desktop-linux run -d --name nimrod-mission-audit-db `
  --label nimrod.purpose=mission-audit-test `
  -e POSTGRES_USER=mission_test -e POSTGRES_PASSWORD=mission_test_only `
  -e POSTGRES_DB=mission_audit_test -p 127.0.0.1:55438:5432 `
  --tmpfs /var/lib/postgresql/data:rw postgres:16-alpine

$env:MISSION_TEST_DATABASE_URL='postgres://mission_test:mission_test_only@127.0.0.1:55438/mission_audit_test'
cd backend
node node_modules/vitest/vitest.mjs run --config vitest.missions.config.js --silent
```

O nome do container é exclusivo desses testes. Se já existir, verificar a
label e reutilizar somente esse container. O armazenamento é temporário;
nenhum volume do Nimrod é montado.

Casos cobertos: conta PLAYER criando missão; agenda ausente; reserva padrão;
última vaga disputada por oito contas; retry de inscrição; aprovação manual;
capacidade; FIFO; promoção após fechamento/prazo; níveis alterados;
personagem obrigatório, dono e faixa; seleção posterior; convite e aceite;
substituição de GM; estados inválidos; início simultâneo site/Foundry;
sessões distintas; PAUSED com inscrições abertas; confirmação duplicada;
conexão/reconexão; correção de presença; cancelamento/reativação;
notificações privadas; e-mail indisponível; contagens com ratings;
avisos/enquetes; código sem privilégio; heartbeat com nome/IDs forjados sem atribuição de identidade; migração de dados legados e recusa
de duas sessões abertas sem apagar dados.

## Navegador e simulação de Foundry

Usam Playwright e um navegador disponíveis no ambiente de desenvolvimento.
Playwright não foi adicionado às dependências de produção. No Windows os
scripts usam o canal `msedge`; em outro ambiente ajustar o runtime/canal.
Se o runtime estiver fora do projeto, fornecer seu diretório via NODE_PATH.

Na raiz, após o build frontend e com o banco temporário acima em execução:

```powershell
npm --prefix frontend run build
$env:MISSION_TEST_DATABASE_URL='postgres://mission_test:mission_test_only@127.0.0.1:55438/mission_audit_test'
node backend/verification/missions/server.mjs
```

Em outro terminal, também na raiz:

```powershell
node backend/verification/missions/board.cjs
node backend/verification/missions/foundry.cjs
```

O fixture escuta só em `127.0.0.1:55439`, usa autenticação de desenvolvimento
com contas sintéticas e importa os módulos de rotas reais. Não inicia jobs
de Foundry, tick ou serviços de produção. Os scripts verificam fluxos completos
de interface e gravam capturas em `node_modules/.cache/nimrod-audit` ou no
diretório informado por MISSION_TEST_ARTIFACTS.

No teste Foundry, `game`, `Hooks`, permissões do cliente e settings são
simulados. HTTP e persistência Nimrod são reais. Um 503 é injetado na primeira
tentativa de início; o retry e o estado único são observados. A simulação
inclui associação autenticada, inscrição/presença própria, reconexão, correção
GM, pausa, continuação e conclusão. Ela não substitui testar o mundo real.

Ao concluir, encerrar o fixture com Ctrl+C e parar apenas seu container:

```powershell
docker --context desktop-linux stop nimrod-mission-audit-db
```
