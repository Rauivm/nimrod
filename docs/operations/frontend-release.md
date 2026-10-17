# Publicação do refinamento de interface

## Escopo

Interface atual, design system, navegação responsiva, Quadro de Avisos e
afinidades elementais. O mockup ilustrado e a retenção de capas por 90 dias
foram somente avaliados; não fazem parte desta versão.

O commit inicial da interface foi separado do trabalho anterior. O pacote de
publicação também inclui, em commit próprio, o backend de missões, seu proxy
e os arquivos de integração Foundry já implementados de que esta tela depende.
Os experimentos e a configuração exclusiva do PC permanecem separados.
Nenhum arquivo de ambiente ou credencial é incluído.

## Requisito de compatibilidade

Esta interface foi desenvolvida sobre o trabalho anterior de missões que
estava sem commit no checkout. Esse pré-requisito foi preparado para publicação
após verificar sua ausência no servidor. Publicar somente o commit inicial
de frontend sobre o backend antigo não constitui uma versão homologada.

Antes da implantação, conferir a presença do backend compatível com
`MissionActions`, `MissionNotifications` e `FoundryConnectPage`: inscrições,
aprovação, ciclo de missão, notificações e associação de identidade Foundry.
O trabalho anterior está descrito em `mission-board.md` e inclui migrações
034/035 e novos serviços/rotas. Sua publicação requer revisão própria,
backup e verificação dos dados legados indicados naquele documento.

## Validação desta interface em 17/10/2026

- `npm run lint`: passou sem erros ou avisos.
- `npm test`: oito testes passaram.
- `npm run build`: passou.
- `npm run test:ui` contra o build servido por `vite preview`: 90 cenários
  passaram, 29 estados axe sem violações e nenhum erro de runtime capturado.
- `git diff --cached --check`: passou antes do commit.
- Backend associado: 217 testes isolados e 18 de integração PostgreSQL
  passaram novamente, sem carregar o ambiente de produção.

Os testes de interface usam respostas de API e WebSocket simuladas. Eles não
substituem a verificação do backend de produção ou de uma sessão real Foundry.

## Implantação

Acesso SSH ao servidor confirmado em `/opt/nimrod`. Pré-verificação do banco:
zero missões com sessões abertas duplicadas e zero capacidades inválidas.
O servidor tem o commit próprio `13091e7` e o diretório não rastreado
`foundry-module/nimrod-launcher`, que precisam ser preservados.

Antes de aplicar: conservar backup do banco e referência do código anterior.
Construir backend e frontend antes de recriar esses dois serviços. Manter
PostgreSQL, Redis, bridges e túnel existentes. Não copiar o override Docker
exclusivo do PC para produção. Homologação Foundry real permanece separada.

## Publicação concluída em 17/10/2026

- Interface: `ef5e703`; dependências de missões já implementadas: `0b6d9e3`.
- Servidor `/opt/nimrod`, branch local `main`: merge `8f9027a`, preservando
  o commit próprio `13091e7` e `foundry-module/nimrod-launcher` não rastreado.
  O branch publicado no GitHub é `codex/ui-elemental-refinement`; o `main`
  remoto não foi modificado por esta publicação.
- Backup em `/home/raui/.local/state/nimrod/release-20261017-evtsJI`: bundle
  do código, módulo não rastreado, configuração privada protegida e dumps
  PostgreSQL. Um segundo dump foi criado imediatamente antes da ativação;
  ambos tiveram seu catálogo validado com `pg_restore --list`. Não foi
  realizado um ensaio de restauração integral em produção.
- Builds Docker de backend e frontend passaram no servidor. O build frontend
  gerou os mesmos hashes e tamanhos validados localmente, incluindo
  `index-IRSC_zNx.js` e `index-DxIxrI5-.css`.
- Somente backend e frontend foram recriados. O Nginx externo passou em
  `nginx -t` e recebeu reload. IDs de PostgreSQL, Redis, bridges, Nginx e
  Cloudflare permaneceram os mesmos.
- Backend confirmado com `NODE_ENV=production`; migrações 034/035 aplicadas.
  A primeira espera de saúde expirou em 60 segundos enquanto a migração 035
  estava em andamento. A inspeção mostrou o container sem reinícios, espera
  de gravação WAL sem bloqueadores e, em seguida, migração e startup completos.
  O frontend só foi substituído após a resposta de saúde do backend.
- Smoke tests em `http://frontend` e `http://nginx`: saúde HTTP 200,
  `/api/me` sem autenticação HTTP 401, `/nimrod/missions` sem credencial
  Foundry HTTP 401 com a mensagem esperada, HTML do quadro e assets elementais
  JavaScript/CSS HTTP 200.
- Contagens imediatamente antes/depois: duas missões, três inscrições e duas
  sessões. Nenhum registro de teste foi criado em produção.
- Uma missão ativa legada precisa configurar seus limites estruturados
  (mínimo de jogadores e/ou faixa de níveis) em **Editar missão** antes de
  novas inscrições/início. Não foram inferidos valores nem alterados registros
  para contornar essa exigência do módulo já implementado.

Limites: não foi realizada inscrição real, postagem ou sessão Foundry real
em produção. A interface foi validada por cenários com APIs simuladas e o
backend por banco descartável, complementados pelos smoke tests acima.

Avisos mantidos: 11 alertas npm já registrados (um baixo, cinco moderados e
cinco altos). A dependência de desenvolvimento `@axe-core/playwright@4.14.0`
exige Node >=22.12; o ambiente local de testes usou Node 22.23.1. O builder
Docker Node 20 emitiu aviso de engine, mas compilou; essa ferramenta de testes
não integra o bundle ou o container Nginx final. Não foram executados testes
axe dentro do builder Node 20 nem aplicadas atualizações automáticas.
