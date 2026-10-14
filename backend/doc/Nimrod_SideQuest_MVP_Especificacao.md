# Nimrod - Especificação do Patch: Side Quests (MVP)

## Objetivo

Implementar um sistema de Side Quests assíncronas para o Nimrod.

Este documento descreve SOMENTE o MVP. Toda decisão foi tomada para
minimizar complexidade, permitir testes rápidos e servir de base para
futuras expansões.

## Princípios obrigatórios

-   O Foundry continua sendo o centro da campanha.
-   O Nimrod representa a vida do personagem entre as sessões.
-   Side Quests nunca devem substituir campanhas.
-   O jogador participa apenas uma vez por personagem em cada Side
    Quest.
-   O resultado deve depender da ficha sincronizada do personagem.
-   O sistema deve ser totalmente genérico. Não criar código específico
    para "Caçada aos Javalis".

## Fluxo

### Criação

Somente GM.

Campos obrigatórios:

-   Título
-   Descrição
-   Tipo
-   Data/hora de início
-   Data/hora de término
-   Meta global
-   XP máxima
-   Ouro máximo
-   Atributo utilizado
-   Número máximo de participantes (0 = ilimitado)

Tipos iniciais:

-   Patrulha
-   Reconstrução
-   Organização
-   Pesquisa
-   Caçada
-   Coleta
-   Escolta

Todos utilizam exatamente o mesmo motor.

### Participação

Jogador:

1.  Abre Nimrod.
2.  Seleciona Side Quest.
3.  Seleciona personagem sincronizado.
4.  Confirma.

Após confirmar:

-   não poderá alterar o personagem;
-   não poderá participar novamente com o mesmo personagem.

### Resolução

A resolução é calculada imediatamente no momento da inscrição.

Algoritmo inicial:

resultado = 1d20 + modificador do atributo configurado.

Esse valor representa a contribuição máxima daquele personagem.

IMPORTANTE:

O jogador NÃO vê esse valor imediatamente.

### Simulação

A cada 10 minutos:

-   atualizar apenas a interface;
-   distribuir gradualmente a contribuição;
-   nunca ultrapassar a contribuição máxima calculada.

Exemplo:

Contribuição final = 18.

Interface:

10 min -\> 2 20 min -\> 5 30 min -\> 9 40 min -\> 13 50 min -\> 16 60
min -\> 18

Isso é apenas visual.

O backend já conhece o resultado final.

### Barra Global

Toda Side Quest possui progresso coletivo.

Exemplo:

183 / 200 javalis

ou

412 / 500 pedras transportadas

Todos os jogadores enxergam o mesmo progresso.

### Encerramento

Ao finalizar:

-   congelar resultados;
-   gerar relatório;
-   sincronizar recompensas com Foundry.

### Recompensas

No MVP:

-   XP
-   Ouro
-   Reputação (estrutura preparada)

Jamais conceder:

-   armas raras;
-   armaduras raras;
-   artefatos;
-   equipamentos que alterem equilíbrio.

## Arquitetura

Classes conceituais:

ActivityType SideQuest SideQuestParticipant ResolutionEngine
RewardEngine FoundrySync

ResolutionEngine deve ser completamente genérico.

## Banco de dados (conceitual)

SideQuest

-   id
-   title
-   description
-   activity_type
-   attribute
-   goal
-   progress
-   xp_max
-   gold_max
-   starts_at
-   ends_at
-   status
-   max_participants

SideQuestParticipant

-   id
-   sidequest_id
-   character_id
-   joined_at
-   roll_result
-   contribution_max
-   contribution_current
-   finished

## Tick

Executar a cada 10 minutos.

Responsabilidades:

-   atualizar contribuição visual;
-   atualizar progresso global;
-   finalizar participantes;
-   finalizar Side Quests vencidas.

## Interface MVP

Jogador:

-   Lista de Side Quests
-   Barra global
-   Tempo restante
-   Sua contribuição atual
-   Relatório

GM:

-   Criar
-   Editar
-   Cancelar
-   Encerrar
-   Ver participantes
-   Histórico

## Melhorias futuras (não implementar agora)

Fase 2

-   Localização das Side Quests
-   Mapa da ilha
-   NPCs
-   Badges
-   Conquistas
-   Easter eggs
-   Eventos mundiais
-   Ranking semanal

Fase 3

-   Arena
-   Descanso
-   Hospital
-   Economia
-   Energia
-   Atividades simultâneas
-   Sistema de condições

Fase 4

-   Mundo persistente
-   Movimentação
-   Caravanas
-   Hordas
-   IA simples para NPCs

## Restrições

-   Nenhuma Side Quest deve impedir campanhas.
-   Ganhos sempre inferiores aos de uma sessão comum.
-   Todo código deve ser extensível.
-   Nunca acoplar lógica ao tipo específico da missão.
-   Todo tipo novo deve reutilizar o mesmo motor de resolução.
