# NIMROD — auditoria e redesign de UI/UX

Data: 17/10/2026. Auditoria anterior às alterações de interface desta tarefa.
O checkout contém alterações anteriores em backend, Foundry e missões; elas serão preservadas.

## Fase 1 — arquitetura, inventário e diagnóstico

React 18, React Router 6, Vite 5, date-fns 3 e lucide-react. JavaScript/JSX,
CSS global, estilos em elementos `<style>` e muitos objetos `style`. Sem framework
visual, TypeScript, script de lint ou suíte de frontend configurados. Backend
Fastify/PostgreSQL; `/api`, `/uploads` e `/ws` passam pelo proxy Vite.
AuthContext, WsContext e ExperienceContext governam identidade, eventos e modo.
Não é necessário trocar biblioteca ou alterar backend para o redesign.

| Rota/página | Fluxos avaliados no código | Diagnóstico / intervenção prevista |
|---|---|---|
| `/` ExperienceEntryPage | Escolha persistida clássico/jogo | Manter preferência; harmonizar entrada e ações |
| `/` HomePage no modo clássico | Feed, respostas, enquete, missões, online, calendário | Falhas viram vazio; quadro muito decorado compete com feed; criar orientação e atalhos |
| `/missions` MissionsPage | Criação, filtros, paginação, WS, notificações | Filtros misturam tipo e estado; sem busca; só seis visíveis e paginação depende de expansão |
| MissionPoster/MissionActions | Inscrição, reserva, aprovação, GM, edição, sessões, presença, histórico, cancelamento, alertas, avaliação, reações | Cartazes inclinados, fontes pequenas, informações/ações escondidas; separar resumo e gestão sem mudar permissões |
| `/profile`, `/profile/:userId` | Avatar, stats, ativos/aposentados, vínculos, sync GM, diretório de jogadores | Fluxos distintos de vínculo GM/jogador necessários; erro na busca de personagens vira vazio |
| `/lobby` LobbyPage | Personagem elegível, launch multiplayer, retorno ao clássico | Seleção acessível existente; reforçar contexto social e retorno às missões |
| `/foundry-connect` | Prova de identidade, aceite e revogação | Sem loading distinto; botão nativo sem padrão; IDs necessários apenas à conferência |
| `/calendar` CalendarPage | Estações, imagens, efeitos, semana, controles GM e auditoria | Fora de Layout, perde navegação; preservar identidade dinâmica das estações |
| `/gm/sessions` SessionsPage | Lista, filtros, recursos, auditoria, eventos, criação/fechamento, correções | Layout fixo em linha, drawer e muitos estilos inline; erro de leitura vira vazio; manter exclusividade GM |
| `/sidequests` + módulos activities | Lista jogador, inscrição; dashboard/form/detalhes GM | Tabela/lista e filtros com estilos repetidos; adaptar cabeçalhos e manter módulo distinto de missões |
| `/cemetery` | Manual/Foundry, mortos/aposentados, tributos, ranking, upload | Linguagem temática própria; falhas de leitura silenciosas; preservar homenagens e separação de origens |
| `/maps` | Upload GM, lista, download e exclusão | Labels sem associação, falhas viram vazio, ações só com ícone |
| `/patch-notes` | Leitura por seção, previews, edição/publicação GM | Conteúdo extenso e hierarquia densa; preservar edição, embeds e publicação |
| Fluxos globais | Splash, nome inicial, edição de nome, LGPD, launch e enquete | Vários modais sem semântica/foco/retorno; cabeçalho transborda, ícones mobile sem texto |

Componentes compartilhados: CharacterCard, PostCard/PostComposer, CalendarWidget,
OnlinePlayersPanel, SeasonEffectsEditor, FoundryLaunchButton/useFoundryLaunch,
MissionPoster, JoinMissionModal e os modais de identidade/personagens.
MissionCard é uma implementação antiga sem importadores encontrados; não será
reativada nem removida sem necessidade. Formulário de missão está acoplado ao
HomePage e é importado pelo quadro: extrair para componente compartilhado.

### Prioridades

1. **P0, experiência:** todas as rotas descobertas em menu com nomes legíveis,
   foco visível e alvo de toque; calendário dentro da navegação.
2. **P0, missões:** disponibilidade, nível, GM/criador, reserva e aprovação
   visíveis; filtros independentes, busca com escopo explícito, paginação
   acessível; conservar todas as operações atuais.
3. **P1, acessibilidade:** tokens de contraste, labels, diálogo com foco
   contido/retorno/Escape, movimento reduzido e feedback com live regions.
4. **P1, confiança:** loading/erro/vazio distintos e repetição de leitura
   sem inventar dados ou indicar indisponibilidade do serviço sem evidência.
5. **P2, coesão:** padrões de cabeçalho, superfícies, botões, formulários e
   estados nos demais módulos; simplificar visual sem excluir funções.
6. **P2, desempenho:** separar páginas por importação lazy se seguro; medir build.

### Direção visual e contratos

Carvão/grafite e azul profundo; ouro envelhecido para ações e identidade.
Cinzel em títulos, pilha sans-serif do sistema no conteúdo; mesma biblioteca
Lucide. Superfícies discretas, uma borda por grupo, espaçamento em escala de 4.
Reservar cores de sucesso/atenção/erro para estado acompanhado de texto.
CSS existente será aproveitado com tokens compatíveis; novos componentes
terão classes, sem objetos de estilo para valores estáticos.
Manter POST/PATCH/DELETE, dados, elegibilidade, papéis, aprovação, capacidade,
FIFO, histórico e regras de sessão existentes. Nenhum acesso a produção.

### Baseline executado

- `frontend: npm run build`: passou (Vite 5.4.21), JS 575,11 kB / gzip 150,17 kB.
- Aviso pré-existente: chunk > 500 kB.
- Lint: não configurado. TypeScript: não utilizado neste frontend.
- Inspeção estática de todas as páginas/componentes acima. Testes de navegador,
  contraste, responsividade e fluxos ainda não executados neste baseline.

## Registro incremental

As fases seguintes registrarão arquivos, mudanças, verificações e pendências
conforme forem executadas. Avaliação estática não equivale a homologação real
com Foundry, autenticação Cloudflare ou banco de produção.

### Fase 2 — design system aplicado

Arquivos: `frontend/src/components/ui.jsx`, `frontend/src/styles/design-system.css`,
`frontend/src/main.jsx`, `frontend/index.html`, `docs/design-system.md`.

- Tokens compatíveis com o CSS anterior; cores de texto com contraste, escala
  de espaçamento, tamanhos, raios e sombras; conteúdo em sans-serif do sistema.
- Button, PageHeader, Badge, StatePanel, LoadingCards, Modal e feedback por toast.
- Estilos reutilizáveis de campos, abas/filtros, tabelas, dicas e ações.
- Diálogo nativo com foco contido, restauração do foco, Escape e bloqueio
  durante envio; fundo inerte pelo navegador. Redução global de movimento.
- Documento em pt-BR. Nenhuma biblioteca visual ou dependência de runtime nova.

Verificações: build intermediário passou; testes de foco/Escape/retorno e
auditoria automatizada dos diálogos passaram na fase 6. Pendência: componentes
legados ainda contêm estilos inline; a camada compartilhada harmoniza sua
aparência, e as migrações futuras devem usar os componentes/tokens novos.

### Fase 3 — estrutura global

Arquivos: `components/Layout.jsx`, `styles/layout.css`, `App.jsx`.

- Destinos organizados em jornada, mundo e conta; nomes permanecem visíveis
  no menu mobile. Perfil/personagens e conexão Foundry são descobertos ali.
- Drawer mobile nomeado, foco contido, Escape, backdrop e retorno ao botão.
- Acesso direto à aventura preservado, com falha anunciada por toast; conexão descrita por texto e ícone.
- Skip link, conteúdo principal identificável e containers responsivos.
- Calendário dentro de Layout. Nenhuma rota existente foi removida.
- Importação lazy por página diminui o custo inicial sem excluir módulos.

Verificações: navegação, abertura/fechamento mobile e todas as rotas foram
exercitadas em Edge headless. Build final não tem o aviso de chunk > 500 kB.
Pendência: Safari/iOS, Firefox, leitores de tela e dispositivo físico não foram
testados; não confundir a simulação de viewport com esses ambientes.

### Fase 4 — quadro e missões

Arquivos: `pages/MissionsPage.jsx`, `pages/HomePage.jsx`,
`components/CreateMissionModal.jsx`, `components/MissionPoster.jsx`,
`components/MissionActions.jsx`, `components/JoinMissionModal.jsx`,
`components/MissionNotifications.jsx`, `lib/missionPresentation.js`,
`styles/mission-board.css`, `styles/mission-controls.css`, `styles/join-mission.css`.

- Cards alinhados e legíveis com descrição, níveis, vagas, espera, criador,
  narrador e estado da inscrição. Sem avatares fictícios para vagas ocupadas.
- Inscrição direta no resumo; gerenciamento completo permanece nos detalhes.
- Filtros de tipo e estado combináveis. Busca sem distinção de acentos por
  título, descrição, criador e narrador nos registros já carregados.
- Escopo local da busca explícito; carregar mais funciona mesmo sem resultados
  locais. Cursor existente preservado. Respostas antigas não substituem um
  filtro mais recente. Atualizações WS mantêm a posição do item na lista.
- Links da caixa de notificações alcançam publicações além do primeiro lote.
- Formulário compartilhado extraído da Home: grupo, agenda, inscrição e enquete.
  Mesmos nomes/corpos/endpoints, datas e validações de negócio; erro permanece
  no formulário. O texto inicial agora é um roteiro genérico de aventura.
- Seleção de personagem identifica elegibilidade sem afirmar que ausência de
  resultados equivale à ausência de vínculos. Aprovação/espera têm feedback.
- Criador e GM continuam com as operações anteriores: convites, aprovações,
  inscrições, edição, sessões, presença, auditoria, cancelamento e reativação.
  Confirmação adicionada ao cancelamento; motivo continua obrigatório.

Verificações: criação, payload da inscrição, busca, filtros combinados,
paginação com busca vazia, falha/repetição, link antigo e controles GM de
inscrições/início/pausa passaram com APIs simuladas. Cinco testes unitários
cobrem disponibilidade, aprovação, reserva, prazo e busca.
Pendência: não houve inscrição nem transição real em Foundry/PostgreSQL.
Busca global no servidor exigiria extensão do contrato e ficou fora do escopo;
a interface descreve esse limite. MissionCard antigo continua disponível no
fonte, sem ser reativado como um segundo fluxo.

### Fase 5 — demais módulos

Arquivos: `styles/modules.css`; `pages/HomePage.jsx`, `ProfilePage.jsx`,
`MapsPage.jsx`, `CalendarPage.jsx`, `CemeteryPage.jsx`, `PatchNotesPage.jsx`,
`SessionsPage.jsx`, `SideQuestsPage.jsx`, `FoundryConnectPage.jsx`;
`components/PostCard.jsx`, `CharacterCard.jsx`, `CalendarWidget.jsx`,
`OnlinePlayersPanel.jsx`, `ChooseNameModal.jsx`, `EditDisplayNameModal.jsx`,
`LgpdConsentModal.jsx`, `LinkCharacterModal.jsx`; módulos `activities/gm` e
`activities/player`; `contexts/WsContext.jsx`.

- Comunidade: orientação e atalhos, quadro compacto, feed legível, respostas
  menos recuadas, autor/personagem e feedback de envio preservados.
- Perfil: destaque para personagens vinculados, orientação por papel,
  erros explícitos nos vínculos/diretório; ferramentas GM conservadas.
- Mapas: campos associados, nomes nas ações, erro recuperável e confirmação
  de exclusão. Cemitério conserva tributos, origem, ranking e memoriais.
- Calendário preserva artes/cores/efeitos e controles GM; diálogos seguem a base.
- Conexão Foundry distingue consulta, confirmação, sucesso e erro, mantém a
  conferência do vínculo e confirmação destrutiva de revogação.
- Sessões: lista e conteúdo se adaptam ao mobile; registro de evento em diálogo;
  filtros nomeados; erro de consulta explícito. Botão aninhado detectado no
  navegador foi corrigido. Separação da guarda GM evita variar hooks ao mudar papel.
- Atividades: cabeçalho consistente, filtros que quebram linha, tabela com
  rolagem local e acesso por botão; labels dos formulários corrigidos.
- Experiência inicial e Lobby conservam escolha persistida, personagem e
  lançamento multiplayer; a harmonização visual é pelo CSS compartilhado.
- Observado em desenvolvimento: StrictMode deixava a conexão WS marcada como
  encerrada depois da primeira limpeza. A montagem agora reinicializa esse
  marcador e ignora encerramentos de sockets antigos; recusa de autenticação
  pelo servidor continua impedindo reconexão enquanto montado. Teste verifica
  estado conectado com WebSocket simulado, sem serviço externo.

Verificações: conteúdo preenchido de feed, mapas, perfil, memoriais,
atualizações, atividades e sessões, nos tamanhos da fase 6. Nenhuma alteração
nova de backend, esquema, Foundry module, autenticação ou autorização.
Pendência: homologação operacional de uploads reais, transporte de notificações,
sincronização e lançamento do jogo/Foundry em ambiente integrado.

### Fase 6 — validação e limites

Arquivos: `frontend/eslint.config.js`, `frontend/package.json`,
`frontend/package-lock.json`, `frontend/verification/mission-presentation.test.mjs`,
`frontend/verification/redesign.cjs`. Ferramentas acrescentadas são de
desenvolvimento: ESLint/plugins, Playwright e axe. ESLint 9 é usado porque o
plugin de acessibilidade instalado declara compatibilidade até essa versão;
a tentativa de versão 10 foi recusada pelo gerenciador, sem forçar peers.

| Verificação executada | Resultado |
|---|---|
| `npm run lint` | Passou: sem erros e sem avisos (`--max-warnings 0`) |
| `npm test` | 5 testes passaram |
| `npm run build` | Passou; 2.380 módulos; JS inicial 211,53 kB / gzip 67,70 kB |
| UI em desenvolvimento e build de produção | Passou: rotas em 1440, 1024, 768, 360 e 320 px; fluxos PLAYER e GM; sem overflow global nos cenários |
| Rodada final sobre o build de produção | 77 cenários passaram, zero falhas; inclui falha de launch e foco no conteúdo após navegação mobile |
| axe WCAG 2 A/AA, 2.1 AA e 2.2 AA | 20 estados auditados, zero violações automatizadas na rodada concluída |
| Teclado | Foco contido em criação/inscrição/menu; Escape e restauração verificados |
| Runtime | Sem exceções JS ou avisos React capturados na rodada concluída |
| `npm audit` | 11 alertas: 1 baixo, 5 moderados, 5 altos na árvore instalada |

O build inicial tinha JS 575,11 kB / gzip 150,17 kB. O arquivo inicial ficou
aproximadamente 63% menor; isso é uma medida de bundle, não de velocidade em
dispositivo real. As capturas e `results.json` ficam em
`node_modules/.cache/nimrod-redesign/`. Há capturas de quadro desktop/mobile,
comunidade, perfil e calendário, com dados fictícios claramente usados pela suíte.

Os alertas de dependência incluem Vite/esbuild, React Router e ferramentas
transitivas. Não foi executado `audit fix --force` nem atualização de framework
fora do redesign. Eles precisam de tratamento próprio, e não são erro de lint
ou build. Não se declara ausência integral de vulnerabilidades.

Limites: os testes de UI interceptam `/api` e WebSocket. Não cobrem rede,
concorrência, entrega de e-mail, autenticação Cloudflare nem integração real
com Foundry/PostgreSQL. A suíte de backend não foi executada nesta tarefa, pois
não foi alterada. O frontend é JavaScript; não existe verificação TypeScript
para ele. A auditoria axe e o teclado automatizado não certificam WCAG integral:
leitor de tela, zoom, dispositivos físicos e navegadores adicionais permanecem
na homologação manual. Estilos inline legados continuam como dívida de migração.

Capturas desktop/mobile, comunidade, perfil e calendário foram inspecionadas
visualmente. `git diff --check` do frontend passou após correção de espaços
remanescentes. Os servidores locais de verificação foram encerrados ao final;
nenhum deploy, commit, push ou alteração de dados reais foi executado.
