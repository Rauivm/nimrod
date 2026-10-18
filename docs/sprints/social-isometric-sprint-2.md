# Hub social HTML5 — Sprint 2

Entrega em 17/10/2026, America/Sao_Paulo. Escopo autorizado pelo usuário após o [diagnóstico da Sprint 1](../audit/social-isometric-sprint-1.md): estrutura React/TypeScript/PixiJS e alternância entre as experiências existentes. A Sprint 3 não foi iniciada.

## Resultado

Prévia em [http://localhost:8088/lobby/html5](http://localhost:8088/lobby/html5), no frontend Docker local. A rota `/lobby` mantém a seleção/lançamento do Source of Mana. O modo clássico e suas páginas continuam acessíveis, com a mesma sessão Nimrod.

Há um canvas PixiJS/WebGL real, ainda sem mapa, personagens, movimento, chat ou missões dentro da cena. A tela informa expressamente esse estágio. Não há arte provisória apresentada como taverna final, personagens inventados ou dados de missão simulados em produção. O link de missões abre o mural clássico existente; não implementa a Sprint 9.

## Inspeção e decisões anteriores às alterações

- Confirmados novamente `App.jsx`, `Layout.jsx`, `LobbyPage.jsx`, os contextos de autenticação/experiência, os scripts de build/lint/test e a configuração Vite/Docker.
- React continua 18.3.1 resolvido, Vite continua 5.4.21 e o backend não mudou. O frontend já suporta o carregamento TS via Vite; foi adicionada checagem explícita de tipos apenas para a feature nova.
- PixiJS 8.19.0 e TypeScript 5.9.3 correspondem às versões já resolvidas no experimento anterior. Foram instalados apenas no frontend atual, sem promover o experimento que contém contratos antigos/mocks incompatíveis.
- A comparação do lockfile não encontrou atualização de versão de nenhum pacote previamente existente. Foram adicionadas 17 entradas: 12 de runtime e 5 de desenvolvimento/tipos.
- O servidor local e o túnel foram inspecionados antes da atualização: porta 8088 em loopback e Cloudflared parado. Não houve publicação no servidor remoto ou ativação do túnel.

## Estrutura implementada

```text
frontend/src/features/social-hub/
  config/hubConfig.ts       identidade provisória, descrição, rotas e configuração gráfica
  scene/HubScene.ts         Application Pixi e camadas de renderização
  scene/mountHubScene.ts    ciclo de vida assíncrono, resize, contexto gráfico e descarte
  scene/useHubScene.ts      montagem/desmontagem React e tentativa novamente
  ui/HubViewport.tsx        prévia, carregamento e falha recuperável
  SocialHub.tsx            apresentação e navegação entre experiências
  social-hub.css           estilos restritos à feature
```

`Html5LobbyPage.jsx` conecta a feature aos contextos JavaScript existentes. O estado da sessão permanece no `AuthProvider`; não há novo login, token, personagem ou endpoint. Sem sessão autenticada, o renderizador não é inicializado.

O módulo React da página é carregado sob demanda; a engine Pixi é importada de forma assíncrona dentro da montagem da cena. O bundle inicial do clássico não importa Pixi. `hubConfig.ts` é leve e pode ser usado pela navegação sem carregar a engine.

O nome provisório e a descrição estão em um único arquivo de configuração. O nome da referência visual não foi usado. A identidade/configuração do Mana permanece independente.

As camadas `floor`, `world`, `occluders`, `effects` e `labels` são containers vazios para a evolução posterior; `world` já permite ordenação de filhos. Isso não implementa mapa, profundidade entre móveis/personagens ou animação, que dependem das próximas sprints.

## Ciclo de vida e fallback

- Inicialização assíncrona: uma cena que termina de carregar depois da saída da rota é destruída sem anexar canvas ou atualizar estado React.
- Compatível com desmontagem/remontagem do StrictMode; cada montagem tem seu próprio renderizador.
- `ResizeObserver` acompanha o tamanho do container, com densidade limitada a 2; o canvas permanece contido no viewport.
- Não há loop de animação permanente na cena vazia. O frame é renderizado ao redimensionar; animações serão adicionadas quando houver conteúdo.
- Saída da rota remove o listener de perda de contexto, desconecta o observer, remove o canvas e chama o descarte do Pixi, inclusive dos filhos e do contexto gráfico.
- Perda de contexto ou falha de renderização mostra mensagem e opção de tentar novamente, mantendo links para clássico e Mana.
- A lista de renderizadores permitidos é explicitamente `['webgl']`. Pixi 8.19 também pode escolher outros renderizadores quando recebe apenas uma preferência textual; esse fallback não homologado foi impedido após o teste de falha gráfica.

Referência primária: [Application PixiJS](https://pixijs.com/8.x/guides/components/application), confrontada com os tipos e a implementação local da versão fixada.

## Navegação e preferências

- Novo link “Taverna HTML5 · Experimental” no menu existente.
- Novo link “Conhecer a prévia HTML5” na entrada Mana.
- Na prévia, acesso direto ao Modo Clássico, ao Source of Mana e ao mural de missões existente.
- O item `/lobby` passou a usar correspondência exata para que os dois itens de navegação não apareçam ativos juntos em `/lobby/html5`.
- O retorno ao clássico usa a preferência já implementada e a rota `/?experience=classic`. A preferência geral classic/game continua por conta/navegador. Não foi adicionada uma preferência de engine; entrar pela raiz com preferência game mantém o comportamento anterior, que leva ao Mana. A prévia tem seu próprio link/deep link.

## Arquivos alterados nesta sprint

| Arquivo | Mudança |
|---|---|
| `frontend/package.json` | Pixi/TS/tipos fixados, comando typecheck, build condicionado ao typecheck e teste UI da feature |
| `frontend/package-lock.json` | Dependências adicionadas sem atualizar as versões anteriores |
| `frontend/tsconfig.social-hub.json` | TypeScript estrito restrito ao módulo novo, sem migrar JS/JSX globalmente |
| `frontend/src/App.jsx` | Rota lazy `/lobby/html5` |
| `frontend/src/components/Layout.jsx` | Link HTML5 e correspondência exata da rota Mana |
| `frontend/src/pages/LobbyPage.jsx` | Atalho para HTML5; fluxo de personagens/ticket preservado |
| `frontend/src/pages/Html5LobbyPage.jsx` | Adaptador entre contextos existentes e feature tipada |
| `frontend/src/features/social-hub/config/hubConfig.ts` | Identidade e destinos centralizados |
| `frontend/src/features/social-hub/scene/HubScene.ts` | Renderizador e camadas |
| `frontend/src/features/social-hub/scene/mountHubScene.ts` | Gestão de recursos e erros |
| `frontend/src/features/social-hub/scene/useHubScene.ts` | Hook da cena |
| `frontend/src/features/social-hub/ui/HubViewport.tsx` | Viewport e estados acessíveis |
| `frontend/src/features/social-hub/SocialHub.tsx` | Interface e links |
| `frontend/src/features/social-hub/social-hub.css` | Layout responsivo local |
| `frontend/verification/social-hub-lifecycle.test.mjs` | Nove testes de concorrência, falha e liberação de recursos |
| `frontend/verification/social-hub.cjs` | Verificação de navegador com API/WS isolados, WebGL real e screenshots |
| `frontend/public/licenses/social-hub-dependencies.txt` | Avisos/licenças das 12 dependências de runtime adicionadas |
| `docs/sprints/social-isometric-sprint-2.md` | Este relatório |

As alterações locais anteriores em README, SplashScreen, calendário, configurações do PC e experimentos não foram revertidas nem incorporadas como trabalho desta sprint.

## Critérios de aceitação verificados

| Critério | Evidência e resultado |
|---|---|
| Novo código tipado compila | `npm run typecheck`: passou com strict e sem emissão; `npm run build` executa a mesma checagem antes do Vite |
| Build do frontend completo | Vite 5.4.21: passou, 3.108 módulos; build Docker com Node 20 também passou |
| Verificações existentes | `npm run lint`: passou para JS/JSX; código TS verificado pelo compilador estrito. `npm test`: 17/17 passaram, incluindo os 8 testes anteriores |
| Liberação de recursos | Nove testes do lifecycle: sucesso/resize/dispose idempotente, saída durante init, StrictMode, rejeição, falha síncrona, rejeição tardia, falha do observer, contexto perdido e falha de render |
| WebGL real | Edge/Chromium headless criou contexto WebGL válido e um único canvas, em build de produção |
| Layout móvel | 390×844 e desktop 1440×1000; canvas redimensiona pelo container, sem overflow horizontal; screenshots inspecionadas |
| Acessibilidade | Axe com WCAG 2 A/AA e 2.1 AA: zero violações na tela desktop; não equivale a auditoria manual completa de leitores de tela |
| Alternância sem novo login | Quatro idas/voltas clássico↔HTML5 na SPA; uma leitura `/me` e um canvas/observer por montagem, zero após saída |
| Mana preservado na navegação | Seleção existente acessível, com retorno a HTML5 e nenhum POST de lançamento no teste |
| Erro gráfico | Perda de contexto libera recursos e permite nova cena; WebGL indisponível mostra erro/tentar novamente/retorno ao clássico; nenhum pageerror não tratado |
| Sessão ausente | API fixture 401: informa necessidade da conta, não monta canvas nem observer |
| Smoke local sem mocks | Navegador na porta 8088 com API/WS existentes: HTML5→clássico→HTML5→seleção Mana→HTML5, uma consulta `/me`, zero requisições de alteração, zero pageerrors |
| Assets/licenças | Nenhuma arte nova; avisos MIT/ISC/BSD das dependências adicionais preservados e servidos em `/licenses/social-hub-dependencies.txt` |
| Preservação | 187 hashes de arquivos backend/Foundry/experimentos comparados ao baseline: zero alterações; containers Mana continuaram ativos e volume permaneceu montado |

O teste de navegador isolado usa somente contas/personagens fixture para exercitar o shell e a seleção Mana; essas respostas não existem no código de produção. O teste local adicional não interceptou a API, não abriu o jogo e não resgatou tickets. Nenhum teste desta sprint certifica seleção de avatar HTML5, sincronização de posições, chat, mapa ou mural físico: esses recursos ainda não foram implementados.

Resultados/screenshot da execução isolada ficam em `frontend/node_modules/.cache/social-hub/desktop.png` e `mobile.png`, ignorados pelo Git. Para repetir:

```powershell
Set-Location C:\Foundry\nimrod\frontend
npm ci
npm test
npm run lint
npm run build
npm run test:hub:ui
```

O teste UI inicia/encerra apenas seu próprio Vite preview em loopback 5192 e usa Edge instalado. Não inicia Docker ou backend e não escreve dados reais. O host de verificação usou Node 22.23.1; o pacote de testes Axe já existente requer Node >=22.12.0. O Dockerfile frontend usa Node 20 e reporta esse aviso no npm ci, mas não executa Axe durante o build; compilação/build passaram. Não foi alterado o runtime global nesta sprint.

## Dependências e limitações remanescentes

- A prévia ainda não tem mapa. A lista de assets faltantes e suas condições de licença permanece no diagnóstico da Sprint 1; nenhuma imagem de referência foi incorporada.
- O protótipo antigo em `experiments/tavern` e seu gateway de referência foram preservados, inclusive suas falhas preexistentes de compilação. O novo frontend não os importa e passa em suas próprias verificações.
- Autenticação continua dependendo do ingress confiável do Nimrod. Não foram alterados os riscos de vínculo de personagem, worker Foundry parado ou validação da sala descritos na auditoria.
- `npm audit --omit=dev` reportou 3 entradas moderadas na família React Router já existente, sem entradas para as dependências Pixi adicionadas. O npm ci completo também reportou 11 entradas incluindo desenvolvimento (5 altas). Não foi executado audit fix nem upgrade global. Referências retornadas pelo registro incluem [redirecionamento same-origin](https://github.com/advisories/GHSA-2j2x-hqr9-3h42), [backslash em navegação](https://github.com/advisories/GHSA-wrjc-x8rr-h8h6), [hidratação SSR](https://github.com/advisories/GHSA-337j-9hxr-rhxg) e [redirecionamento/XSS](https://github.com/advisories/GHSA-jjmj-jmhj-qwj2). A aplicabilidade requer triagem separada; esta tela usa destinos internos fixos.
- Não foram repetidos testes backend/PostgreSQL/Foundry/Godot, pois nenhuma implementação dessas camadas mudou; os resultados e limites do baseline estão na Sprint 1.
- Responsividade foi verificada por viewport Chromium, não em dispositivos iOS/Android físicos. WebGL é o renderizador homologado nesta etapa.

## Atualização local e reversibilidade

Somente `nimrod-frontend-1` foi reconstruído e recriado, usando `docker compose build frontend` e `docker compose up -d --no-deps frontend`. Nenhum serviço dependente foi iniciado/recriado. Não houve migrações, alterações de volumes, restart do Mana ou deploy remoto.

A imagem anterior está preservada como `nimrod-frontend:social-hub-before-sprint2`, ID `43d8ad9e7e7a730b8f02f26b00748bdccb873b2f43ddd0c1eb79aebcab79ebfc`. Se for necessário reverter apenas o frontend local, sem mexer nos dados:

```powershell
Set-Location C:\Foundry\nimrod
docker image tag nimrod-frontend:social-hub-before-sprint2 nimrod-frontend:latest
docker compose up -d --no-deps --no-build frontend
```

Não executar o rollback por rotina nem limpar imagens/volumes para fazê-lo. O procedimento de standby/retomada do Mana continua em [Source of Mana em standby](../operations/source-of-mana-standby.md).

A Sprint 2 está concluída dentro desse escopo. A Sprint 3 — mapa isométrico e assets — depende de nova autorização.
