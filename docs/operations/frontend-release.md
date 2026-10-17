# Publicação do refinamento de interface

## Escopo

Interface atual, design system, navegação responsiva, Quadro de Avisos e
afinidades elementais. O mockup ilustrado e a retenção de capas por 90 dias
foram somente avaliados; não fazem parte desta versão.

As alterações anteriores de backend, Foundry, nginx e experimentos continuam
separadas desta entrega. Nenhum arquivo de ambiente ou credencial é incluído.

## Requisito de compatibilidade

Esta interface foi desenvolvida sobre o trabalho anterior de missões que
ainda estava sem commit no checkout. Publicar o frontend sozinho sobre o
backend antigo do Git não constitui uma versão funcional homologada.

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

Os testes de interface usam respostas de API e WebSocket simuladas. Eles não
substituem a verificação do backend de produção ou de uma sessão real Foundry.

## Implantação

Pendente de acesso ao servidor e da verificação de compatibilidade acima.
Não copiar o override Docker exclusivo do PC para produção. Após conferir
o backend, construir e recriar somente o frontend conforme a configuração
real do servidor; verificar o build servido e as rotas, preservando os dados.
