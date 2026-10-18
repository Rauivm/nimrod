# Publicação da prévia social HTML5 — Sprints 1–6

Autorização: “Pode subir por enquanto isso que já foi feito”. Esta publicação
congela o escopo na Sprint 6; não inicia presença multiplayer/chat/mural integrado.

## Pacote

- Rota experimental `/lobby/html5`, React/TypeScript/PixiJS, mapa modular,
  movimento local, colisões e interações, portal pelo lançamento Foundry existente.
- Seleção de personagens reais autorizados e sprites originais por classe.
  Equipamentos dos sprites são exclusivamente ilustrativos.
- Auditoria, relatórios das seis sprints, avisos das dependências e proveniência
  dos assets. Teste do contrato de personagens incluído sem alterar o backend.
- `/lobby` continua sendo a entrada Mana; clássico e autenticação preservados.

O pacote não inclui alterações anteriores de README, configuração do PC,
experimentos antigos ou arquivos de ambiente. Não há migração ou mudança
de backend, Bridge, Foundry, volume, segredo ou túnel.

## Validação antes da publicação

47 testes frontend, lint, TypeScript estrito e build Vite passaram. A Sprint 6
registrou 23 grupos de testes de navegador com WebGL real, zero pageerrors
e zero violações axe nas telas verificadas. O smoke com a API local existente
usou personagens reais sem mutações nem lançamento Foundry/Mana.

Limites: movimentação/presença são locais; multiplayer e chat ainda não estão
implementados nesta experiência. O mural abre as rotas clássicas existentes.
A seleção HTML5 não muda o Actor controlado no Foundry. Homologação interativa
com a sessão Cloudflare/Foundry de produção não se presume a partir do smoke HTTP.

## Procedimento de implantação

Destino existente: `/opt/nimrod`, servidor `raui@192.168.0.160`.
Branch de publicação GitHub: `codex/ui-elemental-refinement`.
Preservar o commit próprio e o módulo não rastreado do servidor.

Antes de aplicar: guardar referência/bundle do código e imagem frontend anterior,
registrar IDs dos containers/volumes e verificar checkout. Construir somente
frontend antes de ativar. Recriar somente frontend com `--no-deps --no-build`.
Validar/recarregar Nginx externo se necessário para resolver o novo IP frontend.
Não copiar `docker-compose.override.yml` do PC nem executar túnel local.

Após ativação: verificar HTML e chunks da rota, cinco atlas com seus hashes,
saúde da API, rejeição de acesso anônimo e preservação dos demais containers.

## Resultado

Implantação em andamento; registrar commit, backup, imagem e smoke efetivos
após a verificação do servidor.
