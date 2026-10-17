# NIMROD — linguagem de interface

## Direção

Uma mesa de aventuras em uma aplicação moderna. Carvão, grafite e azul
profundo sustentam superfícies calmas; ouro envelhecido indica identidade e
ações principais. Cinzel é reservada aos títulos. Texto, controles e metadados
usam Segoe UI/system-ui. A identidade das estações continua em
`frontend/src/config/calendarSeasons.js`.

## Fontes de verdade

- `frontend/src/styles/design-system.css`: tokens e componentes básicos.
- `frontend/src/components/ui.jsx`: Button, PageHeader, Badge, StatePanel,
  LoadingCards, Modal e ToastProvider/useToast.
- `frontend/src/styles/layout.css`: navegação, estrutura e breakpoints do shell.
- `frontend/src/styles/mission-board.css`: resumo, detalhes, pesquisa e criação.
- `frontend/src/styles/modules.css`: integração gradual dos módulos legados.
- `frontend/src/styles/elemental.css`: identidade heráldica e paletas de afinidade.
- `frontend/src/config/elementThemes.js`: catálogo, nomes e persistência dos temas.
- `frontend/src/contexts/ElementThemeContext.jsx`: aplicação global por conta.
- `frontend/src/components/BrandSeal.jsx`: selo vetorial compartilhado.

Tokens antigos (`--bg-card`, `--text-muted`, `--gold`, etc.) continuam sendo
aliases compatíveis; o tema é definido depois de `index.css`. Espaçamentos
seguem a escala `--space-1` a `--space-12`; tipografia segue `--text-xs` a
`--text-2xl`; bordas e sombras usam os tokens compartilhados.

## Comportamento dos componentes

| Padrão | Uso |
|---|---|
| Button primary | Uma ação principal por contexto; fundo ouro, texto escuro |
| Button secondary/ghost | Ações complementares e navegação local |
| Button danger | Revogação ou ação destrutiva, acompanhada de confirmação quando necessária |
| PageHeader | Um h1 por página, contexto opcional, descrição curta e ação |
| Badge | Texto de estado com tom neutral/success/warning/danger/info; cor nunca é a única informação |
| StatePanel | Vazio explicativo ou erro com repetição da operação; preservar dados anteriores quando disponíveis |
| LoadingCards | Skeleton com região de status; distinguir carregamento de lista vazia |
| Modal | `dialog.showModal()`, fundo inerte, foco contido e restaurado, Escape; `dismissible=false` durante envio |
| Toast | Feedback após escrita bem-sucedida; erros de formulário permanecem no diálogo |
| ui-tabs | Botões `aria-pressed` para filtros; não simular tablist sem implementar suas teclas |
| ui-table-scroll | Tabela semântica dentro de região nomeada e focável para rolagem por teclado |
| data-tooltip | Dica auxiliar em hover/foco; ícones sempre recebem nome acessível independente |

Inputs devem estar dentro de `<label>` ou ter `id`/`htmlFor`. Campos opcionais
recebem indicação textual. Não ocultar regras de participação atrás de ícones.
Rótulos e mensagens são em português. Datas de agendamento seguem os contratos
existentes: formulário no horário local do dispositivo, envio em ISO.

## Layout e movimento

Desktop usa navegação lateral por jornada, mundo e conta; até 1024 px o menu
vira drawer com texto, controle de foco e fechamento por Escape. No mobile,
missões e formulários usam uma coluna; tabelas preservam rolagem local, sem
forçar rolagem da página inteira. O calendário permanece dentro do shell.
Controles principais têm alvo mínimo de 44 px. Foco é visível, inclusive nos
links e filtros. `prefers-reduced-motion` elimina movimento não essencial.

## Regras de evolução

Novos estilos devem usar classes/tokens. Valores dinâmicos, como percentuais
de enquete e cores de estação vindas da configuração, podem continuar sendo
calculados pelo componente. Não converter dados remotos em HTML. Permissões,
capacidade, aprovação e transições de missão continuam validadas pelo servidor.
Estilos inline e componentes antigos ainda existentes são dívida de migração;
não usar `modules.css` como lugar para novos componentes sem relação com o legado.

## Verificação

Na pasta frontend: `npm run lint`, `npm test`, `npm run build`.
Para a suíte de interface, iniciar `npm run dev -- --host 127.0.0.1 --port 5191`
e executar `npm run test:ui`. Ela usa Edge headless instalado e APIs simuladas;
`NIMROD_UI_TEST_URL` e `NIMROD_PLAYWRIGHT` permitem configurar o ambiente.
Os resultados e capturas ficam em `node_modules/.cache/nimrod-redesign` na raiz.
Testes automatizados de acessibilidade complementam a revisão manual;
não constituem certificação integral WCAG nem homologação real do Foundry.

## Afinidades e assinatura da marca

O selo compacto remete à rosa dos ventos integrada ao O da splash. O anel,
as pontas e os quatro pontos elementais formam a assinatura; o centro acolhe
a afinidade pessoal. A ilustração original, seus quatro elementos e sua
animação permanecem na splash. Luz e Sombra são opções da interface, sem
reescrever a arte original.

| Afinidade | Identificador | Destaque |
|---|---|---|
| NIMROD (padrão) | `nimrod` | Ouro envelhecido |
| Fogo | `fire` | Cobre e âmbar |
| Água | `water` | Azul mineral |
| Terra | `earth` | Oliva e pedra |
| Ar | `air` | Prata e névoa |
| Luz | `light` | Marfim e ouro pálido |
| Sombra | `shadow` | Ametista |

`--brand-gold` é institucional e fixo. `--accent`, `--accent-bright`,
`--accent-dim`, `--element-edge`, `--element-wash` e `--element-glow` personalizam
interações e ornamentos. Os aliases `--gold*` continuam funcionando no legado,
agora apontando para a afinidade. Sucesso, erro e atenção mantêm seus tokens
semânticos. As cores das estações continuam vindo de sua configuração própria.

O seletor fica no header, em “Escolher tema elemental”. Radios nativos permitem
setas e Tab, com preview imediato e foco visível. A preferência é guardada em
`nimrod:element:<userId>`; visitantes usam `guest`. Não há sincronização remota
entre dispositivos. Mudanças em outra aba são recebidas por `storage`; valor
inválido volta a NIMROD. Quando o navegador bloqueia gravação, a escolha vale
na sessão e a interface informa esse limite.

Para ampliar o catálogo, adicionar metadados em `elementThemes.js`, o ícone no
mapa de `ElementThemePicker.jsx` (ou reutilizar um existente) e os seis tokens
da paleta em `elemental.css` sob `[data-element="novo-id"]`. Incluir a opção
nos testes de contraste/teclado. Não alterar neutros, semântica de status ou
estrutura de página para criar uma afinidade.
