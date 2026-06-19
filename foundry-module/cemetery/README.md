# Cemetery — Memorial dos Caídos
**Módulo para Foundry VTT v13+**

Um memorial permanente e elegante para registrar os personagens que caíram durante a campanha. Honre seu legado, preserve sua memória.

---

## Instalação

1. Copie a pasta `cemetery` para `{Data}/modules/`
2. Ative o módulo em **Gerenciar Módulos**
3. O ícone 🏛️ aparecerá nos controles da cena

---

## Funcionalidades

### Registrar um personagem no memorial
- Clique com o botão direito em um ator no diretório de atores
- Selecione **"Enviar ao Memorial"**
- Preencha as informações da morte (todos os campos são opcionais)

### Interface principal
- Clique no ícone 🏛️ na barra de controles da cena
- Navegue pela galeria com filtros e busca
- Clique em qualquer card para ver os detalhes completos

### Configurações do GM
Em **Configurações → Módulos → Cemetery**:
- **Nome do Memorial**: Personalize o nome exibido (ex.: "Os Caídos de Faerûn")
- **Permitir jogadores verem**: Se ativado, jogadores podem abrir o memorial
- **Mostrar botão na barra lateral**: Oculta/exibe o controle

### Ressurreição
No card do personagem ou na visualização de detalhes:
- Clique em **Ressuscitar** (ícone de coração)
- O personagem é marcado como "Retornou dos Mortos"
- O histórico é preservado, agora com data e notas de ressurreição

### Exportação
Clique em **Exportar JSON** para baixar todos os registros em formato JSON.

---

## API Pública

Para integrações (ex.: Nimrod), acesse via `window.Cemetery` ou `window.MemorialDosCaidos`:

```javascript
// Registrar uma morte programaticamente
await Cemetery.registerDeath(actor, {
  causeOfDeath: "Flechas envenenadas",
  lastWords: "Que a luz guie vocês...",
  placeOfDeath: "Catacumbas de Valdris",
  killedBy: "Lord Sombrio",
  memorialText: "Um herói lembrado por todos.",
});

// Ressuscitar por actorId
await Cemetery.restoreActor("actorId123", {
  restoredDate: new Date().toISOString(),
  restoredNotes: "Trazido de volta pelo feitiço Ressurreição.",
});

// Listar todos os registros
const fallen = Cemetery.getAllFallen();

// Obter um registro específico
const entry = Cemetery.getMemorial("actorId123");

// Abrir a interface
Cemetery.open();
```

---

## Estrutura do módulo

```
cemetery/
├── module.json
├── scripts/
│   ├── main.js              ← Entrada, hooks, settings, API
│   ├── MemorialData.js      ← Gerenciador de dados (flags)
│   ├── CemeteryApp.js       ← ApplicationV2 principal
│   ├── RegisterDeathDialog.js
│   ├── RestoreActorDialog.js
│   └── EditMemorialDialog.js
├── templates/
│   ├── cemetery-app.hbs
│   ├── register-dialog.hbs
│   ├── restore-dialog.hbs
│   └── edit-dialog.hbs
├── styles/
│   └── cemetery.css
└── lang/
    ├── pt-BR.json
    └── en.json
```

---

## Dados persistidos

Tudo é salvo via `game.settings` (world-scope), em um único objeto JSON. Nenhuma tabela externa é criada. Nenhum dado é salvo como flag no ator original.

**Campos por entrada:**
| Campo | Tipo | Descrição |
|-------|------|-----------|
| `id` | string | Actor ID do Foundry |
| `name` | string | Nome do personagem |
| `type` | string | `character` ou `npc` |
| `img` | string | Caminho da imagem |
| `deathDate` | ISO string | Data/hora da morte |
| `causeOfDeath` | string | Causa da morte |
| `lastWords` | string | Últimas palavras |
| `placeOfDeath` | string | Local da morte |
| `killedBy` | string | Responsável |
| `memorialText` | string | Texto memorial livre |
| `level` | number/null | Nível (quando disponível) |
| `class` | string/null | Classe |
| `race` | string/null | Raça |
| `restored` | boolean | Se foi ressuscitado |
| `restoredDate` | ISO string/null | Data da ressurreição |
| `restoredNotes` | string | Notas da ressurreição |
| `world` | string | ID do mundo |
| `user` | string | Nome do usuário que registrou |

---

## Compatibilidade

- ✅ Foundry VTT v13+
- ✅ Sistema agnóstico (D&D 5e, Pathfinder 2e, SWADE, etc.)
- ✅ Funciona com qualquer tipo de ator
- ✅ ES Modules nativos
- ✅ ApplicationV2
- ✅ Sem dependências externas
