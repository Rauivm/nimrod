# NIMROD — refinamento de identidade e afinidades elementais

## Fase 1 — avaliação antes das alterações

Base: redesign existente, React/CSS/Lucide, navegação lateral, cartões legíveis,
diálogos nativos e suíte de interface. Preservar layout, rotas, dados, regras,
contratos de API e a arte/temporização da splash. O checkout contém trabalho
anterior ainda não commitado; esta etapa não o substitui.

A splash usa a arte `public/splash/nimrod-elements.jpeg`: uma rosa dos ventos
integrada ao O, círculo de encontro, pontas de metal antigo, fogo/água/terra/ar
e o lema “Um mundo. Infinitas histórias.” A interface atual usa uma espada em
um escudo genérico; não há correspondência simbólica com essa assinatura.
Cards e badges têm bom conteúdo, mas molduras, separadores e estados vazios
compartilham a linguagem de um dashboard convencional.

Intervenções priorizadas:

1. Criar um selo vetorial compacto e original a partir da linguagem de bússola,
   círculo e convergência; usá-lo no lockup, título do quadro e estados vazios.
   Não tentar comprimir a ilustração completa em um ícone de 32 px.
2. Reforçar cards como contratos da guilda: cantos metálicos discretos, leve
   textura, cabeçalho com selo, narrador identificado e metadados agrupados.
   Manter descrição, estados e ações claramente legíveis.
3. Separar ouro institucional de cor de afinidade. Dourado identifica NIMROD;
   a afinidade personaliza ações, seleção, foco, bordas e ambientação leve.
4. Adicionar seleção acessível com preview imediato: NIMROD (padrão), Fogo,
   Água, Terra, Ar, Luz e Sombra. Luz/Sombra são extensões do sistema, não
   elementos novos inseridos na arte original da splash.
5. Propagar ornamentos pequenos aos componentes compartilhados; preservar
   cores semânticas e a identidade das estações. Sem bibliotecas/arte remota.

Persistência proposta: por conta e navegador em localStorage; fallback em
memória quando armazenamento não é permitido; valor inválido volta ao padrão;
troca de conta não herda a preferência da anterior. Não é sincronização entre
dispositivos, pois não será alterado o backend para uma preferência visual.

## Registro de execução

As próximas fases registrarão arquivos, alterações, testes e limites após a
implementação. Nenhuma conformidade ou integração real é presumida por esta auditoria.

### Fase 2 — linguagem e tokens

Arquivos: `src/styles/elemental.css`, `src/components/BrandSeal.jsx`,
`src/components/ui.jsx`, `docs/design-system.md`.

Ouro institucional separado do destaque pessoal, bordas elementais de baixa
opacidade, grão estático leve e cantos de contrato. O selo é SVG local e
decorativo; textos e controles conservam nomes acessíveis. PageHeader aceita
um selo opcional, StatePanel e LoadingCards receberam assinatura discreta.
Botões, foco e badges mantêm a estrutura anterior; estados semânticos continuam
independentes da afinidade. Sem novos pacotes, fontes, downloads ou imagens.

### Fase 3 — header, navegação e contratos

Arquivos: `src/components/Layout.jsx`, `src/components/MissionPoster.jsx`,
`src/pages/MissionsPage.jsx`, `src/App.jsx` e `src/styles/elemental.css`.

Lockup com bússola de convergência e legenda da splash; footer com o mesmo
lema. Sidebar mantém grupos/rotas e ganha divisórias e assinatura da afinidade.
No mobile, a ação de aventura aparece como “Jogar”, preservando o nome
acessível completo. Cards conservam todas as operações: selo com ícone de
estado, narrador com coroa discreta, faixa de nível com escudo, espera com
ampulheta, metadados separados e cantos de metal. Sem novas confirmações,
mudanças de capacidade, prazos, elegibilidade ou autorização.

### Fase 4 — sistema de afinidade

Arquivos: `src/config/elementThemes.js`, `src/contexts/ElementThemeContext.jsx`,
`src/components/ElementThemePicker.jsx`, `src/main.jsx`, `src/styles/elemental.css`.

Sete opções, sendo NIMROD o padrão. Aplicação em `<html>` para alcançar também
portais/diálogos. Radios nativos com preview imediato; preferência por conta
e navegador; troca de conta isolada; sincronização por evento `storage`;
fallback para valor inválido; fallback em memória com mensagem se a gravação
for bloqueada. Preferência existente de modo clássico/jogo não é alterada.

### Fase 5 — propagação controlada

A camada de tokens propaga as afinidades à comunidade, perfil, taverna, mapas,
calendário, sessões e atividades. As superfícies importantes receberam apenas
uma borda temática; cabeçalhos e estados compartilham o selo. O calendário
preserva artes e cores sazonais. Tema visual não altera dados, APIs ou regras.
A fonte da splash e seus tempos permanecem intactos. As variáveis são
compartilhadas; não existem seis layouts ou duplicações de componentes.

### Verificações em andamento

- `npm run lint`: executado sem erros nem avisos na primeira rodada.
- `npm test`: 8 testes passaram, incluindo validação do catálogo, preferência
  por conta e falhas de armazenamento.
- `npm run build`: passou na primeira rodada; nenhuma dependência adicionada.
- Primeira rodada de navegador: temas Fogo/Água/Terra/Ar/Luz/Sombra passaram em
  persistência e contraste; o teste do padrão inicialmente exigia uma gravação
  mesmo quando o radio já estava selecionado. Corrigida a expectativa para
  aceitar o fallback padrão; o app não precisava de uma escrita para esse caso.
- Capturas de quadro Água e seletor foram inspecionadas visualmente. Rodada
  final de regressão e teste de armazenamento bloqueado serão registrados abaixo.

Limites: preferência local por conta/navegador, sem sincronização entre aparelhos.
Navegador de verificação: Edge headless; axe é complementar à revisão manual.
Nenhuma sessão real de Foundry, postagem real ou chamada de produção foi feita.

### Resultado da rodada completa em desenvolvimento

| Verificação | Resultado |
|---|---|
| Lint | Passou, zero erros e avisos |
| Testes unitários | 8 passaram |
| Interface e regressão | 90 cenários passaram, zero falhas |
| Acessibilidade automatizada | 29 estados auditados, zero violações axe nos cenários |
| Tamanhos | 320, 360, 768, 1024 e 1440 px, sem overflow global nos cenários |
| Afinidades | Sete paletas; preview imediato, recarga, navegação, conta isolada e eventos de storage |
| Armazenamento bloqueado | Tema continua na sessão e mensagem explica a limitação |
| Teclado | Radios por setas, foco contido e restaurado, Escape, navegação principal |
| Runtime | Zero exceções ou avisos React capturados |
| Splash | Suíte existente passou: arte exata, desktop/mobile/landscape, skip/Escape, StrictMode, movimento reduzido e falha da imagem |
| Build | Passou; JS inicial 219,34 kB / gzip 70,08 kB; CSS inicial 46,41 kB / gzip 10,33 kB |

O JS inicial anterior a esta etapa era 211,53 kB / gzip 67,70 kB. A diferença
é aproximadamente 7,81 kB / gzip 2,38 kB, incluindo contexto, seletor e ícones.
Sem imagem nova, dependência nova ou animação contínua. Os cantos e grão são
estáticos e decorativos; o selo é SVG local. `git diff --check` passou.

Capturas em `node_modules/.cache/nimrod-redesign/`: `board-desktop.png`,
`board-fire.png`, `board-water.png`, `board-shadow.png`, `board-mobile.png`
e `element-picker.png`, além dos módulos da suíte. São dados de demonstração.
Inspecionadas as capturas de Água e seletor; marca institucional continua em
ouro, enquanto a afinidade colore as interações. A borda da missão pausada
mantém atenção âmbar, assim como os estados de aprovação.

### Conferência final do build de produção

A mesma suíte foi repetida em `vite preview` sobre `dist/`: **90 cenários
passaram**, 29 estados axe sem violações e zero erros de runtime capturados.
A suíte de splash passou separadamente. Nenhum teste simula homologação real
de Foundry/Cloudflare: as chamadas da suíte são interceptadas com dados fictícios.
Servidores de desenvolvimento/verificação encerrados após os testes. Sem deploy,
commit ou push. Nenhuma dependência, arquivo de backend ou regra de negócio
foi alterado nesta etapa. Os alertas de dependências registrados na auditoria
anterior não foram tratados neste refinamento.
