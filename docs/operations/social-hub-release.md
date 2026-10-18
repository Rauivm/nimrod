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

## Publicação concluída em 17/10/2026 (America/Sao_Paulo)

- URL: https://nimrod.raui.uk/lobby/html5. O acesso público sem sessão retorna
  302 para a proteção Cloudflare existente; não foi contornada a autenticação.
- Código GitHub: `26aa4c0`, no branch `codex/ui-elemental-refinement`.
  Código integrado no servidor pelo merge `365586e`, preservando o histórico
  local e as alterações próprias `13091e7`. O `main` remoto permanece `2fd7c7d`.
- Backup: `/home/raui/.local/state/nimrod/social-release-20261018-sE6SVZ`,
  contendo bundle Git, referência anterior `18473f4`, arquivo próprio
  `foundry-module/nimrod-launcher`, IDs dos containers/volumes e imagem anterior.
  Nenhum dado persistente foi alterado; não foi necessário executar migrações.
- Imagem final e container confirmados com o digest
  `sha256:73b24ac7d11ffb9d658d0ec7552883c8cebffb15fa4ad587510be640b77f630c`.
  Build Docker e TypeScript/Vite passaram, com os mesmos chunks locais.
- Somente o frontend foi recriado. O Nginx externo passou em `nginx -t` e
  recebeu reload. IDs de todos os demais containers e lista de volumes
  permaneceram iguais. O arquivo próprio Foundry foi comparado ao tar do backup.
- Smoke executado dentro da rede de produção contra `http://frontend` e
  `http://nginx`: saúde 200/`ok`; `/api/me`, `/api/me/characters` e
  `/nimrod/missions` anônimos retornaram 401; rota HTML5 200. Em cada origem,
  54 arquivos (HTML, todos os chunks JS/CSS e os cinco PNGs) retornaram 200
  e SHA-256 idêntico ao build local. Nenhuma mutação ou lançamento foi realizado.
- O primeiro smoke encontrou PNGs com permissão 600, herdada da máscara 077
  usada durante o preparo do backup/checkout. A leitura pública foi corrigida
  no container e nos arquivos fonte; a imagem foi reconstruída e recriada.
  A imagem final passou em teste isolado como usuário `nginx` antes da ativação;
  o smoke acima só foi considerado aprovado após essa correção. Em operações
  futuras, restringir a máscara 077 ao backup e restaurar 022 antes do checkout.
- Mana local permaneceu em execução, com `nimrod-mana_mana-data` montado em
  `/data`; o túnel do PC permaneceu parado. Configuração exclusiva do PC não
  foi enviada ao servidor.

O servidor demorou nas etapas Docker; não foram aplicadas atualizações de
dependências para contornar a demora. Permanecem os 11 avisos npm anteriores
e o aviso da ferramenta de testes axe que requer Node >=22.12 no builder
Node 20; o build passou e essa ferramenta não integra o runtime Nginx.

Não foi executada uma sessão autenticada Cloudflare/Foundry em produção.
Os testes interativos locais e o smoke HTTP são evidências distintas.
Não houve homologação de multiplayer/chat nem início da Sprint 7.

## Reversão do frontend

A imagem anterior foi mantida como `nimrod-frontend:social-hub-before-release`
(digest `sha256:9cb64c88992db0b50b005c96d2d067c81a3f42484c8a9ca717324e7130a8a237`).
Caso seja necessário reverter, no servidor:

```sh
cd /opt/nimrod
docker image tag nimrod-frontend:social-hub-before-release nimrod-frontend:latest
docker compose up -d --no-deps --no-build frontend
docker compose exec -T nginx nginx -t
docker compose exec -T nginx nginx -s reload
```

Esse procedimento não foi executado. Ele reverte a imagem servida e preserva
código, bancos e volumes; não usar reset/clean ou remoção de dados.
