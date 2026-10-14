# RFC-001 --- Side Quest MVP

## Objetivo

Implementar um sistema de Side Quests assíncronas que aumente a imersão
dos jogadores entre sessões sem substituir o RPG de mesa.

## Premissas

-   Foundry é a fonte da verdade da ficha.
-   Nimrod é a camada persistente do mundo.
-   Side Quests nunca devem superar campanhas em recompensas.
-   Uma participação por personagem.
-   Sem combate visual no MVP.
-   Toda lógica deve ser genérica.

## Fluxo

1.  GM cria.
2.  Jogador escolhe personagem.
3.  Sistema calcula contribuição.
4.  Progresso visual é distribuído ao longo do tempo.
5.  Encerramento gera relatório.
6.  Bridge sincroniza recompensas.

## Critérios de aceite

-   Funciona para qualquer tipo de atividade.
-   Não exige intervenção do GM após criação.
-   Suporta futuras expansões.
