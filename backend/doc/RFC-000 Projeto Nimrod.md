# RFC-000 --- Projeto Nimrod

## Status

Documento normativo.

Este documento possui prioridade máxima sobre todos os demais RFCs.

Seu objetivo é definir os princípios permanentes do projeto Nimrod.

Caso qualquer RFC entre em conflito com este documento, este documento
prevalece.

------------------------------------------------------------------------

# 1. Visão do Projeto

O Nimrod é uma plataforma persistente para campanhas de RPG.

Ele NÃO é um VTT.

Ele NÃO substitui o Foundry.

Ele complementa o Foundry.

O Foundry representa a sessão de RPG.

O Nimrod representa a vida do personagem entre as sessões.

Toda funcionalidade futura deverá respeitar essa separação.

------------------------------------------------------------------------

# 2. Princípios Fundamentais

Todo desenvolvimento deve obedecer às seguintes regras.

## 2.1 Campanhas são prioridade

As campanhas narradas pelo GM são sempre o conteúdo principal.

Nenhuma funcionalidade do Nimrod pode tornar desnecessária uma sessão.

Jamais implementar mecânicas que permitam evolução equivalente à
campanha.

------------------------------------------------------------------------

## 2.2 Mundo persistente

Mesmo sem sessão acontecendo, Kassanthar continua existindo.

O personagem trabalha, pesquisa, ajuda a cidade e participa de pequenas
atividades.

O jogador deve sentir que o mundo continua vivo.

------------------------------------------------------------------------

## 2.3 Baixo atrito

O jogador deve conseguir utilizar qualquer atividade em poucos segundos.

Evitar interfaces complexas.

Evitar excesso de cliques.

------------------------------------------------------------------------

## 2.4 Progressão controlada

Todo ganho deve ser pequeno.

Sessões continuam sendo a principal fonte de:

-   XP
-   Ouro
-   Itens importantes
-   Desenvolvimento narrativo

------------------------------------------------------------------------

## 2.5 Arquitetura extensível

Toda implementação deve permitir expansão futura.

Nunca criar lógica específica para um único tipo de atividade.

Toda funcionalidade nova deve reutilizar motores genéricos.

------------------------------------------------------------------------

# 3. Responsabilidades

## Foundry

É responsável por:

-   campanha
-   mapas
-   combate
-   fichas
-   inventário
-   narrativa
-   decisões do GM

## Nimrod

É responsável por:

-   perfil
-   rede social
-   side quests
-   conquistas
-   badges
-   progresso persistente
-   eventos entre sessões
-   estatísticas
-   histórico
-   mundo persistente

Nenhuma responsabilidade deve ser duplicada.

------------------------------------------------------------------------

# 4. Filosofia de Design

Sempre priorizar:

-   simplicidade
-   clareza
-   consistência
-   reutilização
-   manutenção

Nunca implementar soluções específicas quando uma solução genérica for
possível.

------------------------------------------------------------------------

# 5. Código

Todo código deverá seguir:

-   Clean Code
-   SOLID
-   separação de responsabilidades
-   baixo acoplamento
-   alta coesão

Evitar:

-   duplicação
-   regras espalhadas
-   condicionais específicas por atividade
-   valores mágicos

------------------------------------------------------------------------

# 6. Interface

Toda interface deve:

-   ser objetiva
-   funcionar em desktop
-   funcionar em dispositivos móveis
-   evitar excesso de animações
-   manter identidade visual única

------------------------------------------------------------------------

# 7. Regras para IA

Ao implementar funcionalidades:

1.  Ler RFC-000.
2.  Ler a especificação principal.
3.  Ler todos os RFCs em ordem.
4.  Nunca assumir comportamento não documentado.
5.  Quando houver dúvida, solicitar esclarecimento.
6.  Nunca alterar comportamento existente sem autorização.
7.  Sempre preferir arquitetura preparada para expansão.

------------------------------------------------------------------------

# 8. Estrutura de RFCs

RFC-000 é permanente.

A especificação principal descreve a visão do recurso.

Os RFCs detalham implementação.

Documentos posteriores expandem os anteriores.

------------------------------------------------------------------------

# 9. Compatibilidade

Novas funcionalidades devem preservar compatibilidade com:

-   banco existente
-   integração Foundry
-   bridge
-   frontend
-   APIs públicas

Sempre que possível utilizar migrações incrementais.

------------------------------------------------------------------------

# 10. Roadmap

Fase 1 - Side Quests

Fase 2 - Badges - Easter Eggs

Fase 3 - Arena - Descanso - Hospital

Fase 4 - Localizações - Mapa - Mundo persistente

Fase 5 - Economia dinâmica - Eventos mundiais - Simulação da ilha

Cada fase deve ser funcional antes da próxima.

------------------------------------------------------------------------

# 11. Objetivo Final

O Nimrod deve proporcionar a sensação de que o personagem continua
vivendo mesmo quando a sessão termina.

O jogador deve entrar no Nimrod porque deseja acompanhar a vida do seu
personagem e contribuir para o mundo, e não porque é obrigado a farmar
recursos.

Toda decisão de arquitetura futura deverá ser avaliada à luz desse
objetivo.
