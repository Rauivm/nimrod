# Source of Mana — preservação, standby e retomada

Registro da auditoria HTML5 de 17/10/2026. Standby significa suspender o desenvolvimento baseado em Mana durante a avaliação do HTML5; não exige apagar nem desligar o ambiente.

## Estado confirmado

- Compose separado com nome `nimrod-mana`.
- `nimrod-mana-mana-server-1` ativo e healthy; `nimrod-mana-mana-web-1` ativo.
- Volume `nimrod-mana_mana-data` montado em `/data` no servidor; preserva a representação/estado SQLite do jogo.
- Modo integrado ativo: `MANA_INTEGRATED=true`, API interna `http://backend:3001`.
- Web em `http://localhost:5184/`, entrada autorizada pela rota Nimrod `/lobby` e `POST /mana/launch`.
- Backend e PostgreSQL precisam estar acessíveis para redeem/revalidação. Abrir a URL web diretamente não cria autorização integrada.

Nenhum comando de parada/retomada abaixo foi executado nesta auditoria. Ao abrir o Docker Desktop, os containers existentes retomaram por suas políticas anteriores.

## O que conservar

1. Toda a pasta `experiments/source-of-mana/`, inclusive `game/`, arquivos não rastreados, `artifacts/`, addons e licenças. A pasta `game/` é um repositório interno ignorado pelo Git principal, fixado em `095803fe9bf496cafcfeebf6a62ae591593491bf`, com modificações locais anteriores.
2. Patches, geradores, scripts GDScript, Dockerfile, template Nginx e verificações; não resetar o checkout para substituir mudanças locais pelo upstream.
3. `docker-compose.mana.yml`, `.mana.integration.yml`, `.mana.local.yml` e `.mana.verify.yml`.
4. Imagens locais do servidor/web e volume `nimrod-mana_mana-data`. Conservar também os volumes PostgreSQL, uploads e Redis do Nimrod.
5. Valores privados existentes de `MANA_BRIDGE_SECRET`, `MANA_PUBLIC_URL`, rede e acesso Nimrod. Não regenerar o segredo como parte da retomada e não publicá-lo.
6. Rotas/serviços Mana, migrações 031–033, atividades e vínculos Nimrod existentes. Presets/aparência do jogo não substituem a ficha D&D.

Não usar `down -v`, `docker volume rm`, `docker system prune`, `git clean` ou checkout/reset destrutivo. Esta entrega não fez backup externo nem snapshot de dados. Antes de alterar o experimento futuramente, preparar backup consistente do volume e uma cópia das alterações locais/arquivos ignorados; um patch sozinho não contém tudo.

## Pausa opcional, reversível

Somente se for necessário liberar recursos e as sessões ativas puderem ser encerradas, executar na raiz `C:\Foundry\nimrod`:

```powershell
docker compose -f docker-compose.mana.yml -f docker-compose.mana.integration.yml stop mana-web mana-server
```

Isso para apenas os dois serviços Mana, mantém containers, imagens e volume. Não parar PostgreSQL, Redis, frontend, backend ou worker do Nimrod para colocar o desenvolvimento Mana em standby.

## Retomar os containers preservados

Com Docker Desktop aberto, backend e banco já funcionando, mesma `.env` privada e mesma rede externa configurada:

```powershell
docker compose -f docker-compose.mana.yml -f docker-compose.mana.integration.yml start mana-server mana-web
docker compose -f docker-compose.mana.yml -f docker-compose.mana.integration.yml ps
```

Se os containers já estiverem em execução, basta verificar o estado. Usar o overlay integrado preserva a intenção de configuração; `start` retoma os containers existentes sem reconstruí-los ou aplicar novas configurações.

Se somente os containers tiverem sido removidos e as imagens/volume continuarem presentes, a recuperação exige revisar a configuração e então recriar com as imagens preservadas:

```powershell
docker compose -f docker-compose.mana.yml -f docker-compose.mana.integration.yml up -d --no-build mana-server mana-web
```

Não trocar o nome do projeto Compose nem o volume ao recuperar. Não executar `prepare.ps1` ou rebuild por rotina de retomada: o script copia integrações e regenera conteúdo, portanto requer inspeção das alterações locais antes de usá-lo. Os comandos standalone do README original habilitam outro modo de acesso; para personagens Nimrod, manter o overlay integrado e o segredo já configurado.

## Validação após uma retomada futura

1. Servidor healthy e volume correto montado em `/data`.
2. Mana web responde e conserva COOP `same-origin`/COEP `require-corp`.
3. Pela sessão Nimrod autenticada, abrir `/lobby`, selecionar personagem próprio elegível e lançar o jogo; confirmar entrada, movimento, reconexão e identidade persistente.
4. Para certificar multiplayer e revogação, usar o harness isolado descrito em `LOBBY.md`, inspecionando-o antes de executar; não cadastrar fixtures no banco real.

Nesta auditoria foram verificados os itens 1 e 2 e a geometria do mapa. Não foram executados lançamentos/tickets reais nem o teste de dois clientes. Não confundir saúde HTTP com homologação ponta a ponta.

## Coexistência com HTML5

Proposta ainda não implementada: `/lobby` continua Mana e `/lobby/html5` recebe a experiência experimental. Reutilizar sessão, seleção de personagem, mural e retorno ao clássico. Uma promoção posterior do HTML5 não deve remover o acesso Mana, seus serviços ou dados. O desenvolvimento das duas engines pode voltar a ocorrer em paralelo mediante decisão explícita.

Diagnóstico completo: [Hub social isométrico — Sprint 1](../audit/social-isometric-sprint-1.md).
