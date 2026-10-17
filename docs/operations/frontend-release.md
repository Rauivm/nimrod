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
