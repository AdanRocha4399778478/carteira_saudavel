# Requisito: Comparação de Duplicidade Multi-Reunião — Reunião Inteligente

Sep 27, 2026

## Contexto e problema

A função "Reunião Inteligente" gera sugestões de itens de projeto (objetivos, ações, decisões, riscos etc.) a partir da transcrição de cada reunião, e tenta detectar duplicidade/atualização contra o histórico antes de aplicar. Hoje essa comparação parece olhar apenas a reunião imediatamente anterior (N vs. N-1), não o conjunto do projeto.

Três reuniões reais do cliente Grupo Erinho (projeto Operações) expuseram o problema:

- **12/05/2026**: gerou a ação "Revisar dados do sistema Conta Azul para avaliação do fluxo de caixa" e a decisão "Aguardar mais meses de dados para finalizar modelo de remuneração".
- **13/05/2026** (1 dia depois): as 25 sugestões vieram todas marcadas como "novas" (0 marcadas para revisão), incluindo itens que na prática são continuação direta do dia anterior — "Revisar e categorizar corretamente os lançamentos do extrato" (evolução da ação sobre Conta Azul) e a decisão "Implementação do modelo de pagamento baseado em meritocracia" (que contradiz/substitui a decisão de aguardar, do dia anterior, sem qualquer vínculo sinalizado).
- **20/05/2026**: a decisão "Uso da planilha para substituição do sistema financeiro atual" também não foi vinculada ao trabalho de revisão do Conta Azul de 12/05, por estar fora da janela de comparação (reunião N-1 é a de 13/05).

Em paralelo, no bloco de Ações de 12/05, o sistema classificou corretamente um par como "possível duplicidade" (52% de similaridade, conflito de responsável) mesmo comparando textos bem diferentes — mostrando que a lógica de similaridade em si funciona; o problema é o escopo temporal restrito da comparação, não o algoritmo de match.

**Necessidade levantada pelo consultor:** o sistema precisa comparar cada sugestão nova contra o conjunto acumulado do projeto, não apenas contra a reunião anterior.

## Decisões de escopo (confirmadas com o consultor)

| Dimensão | Decisão |
| --- | --- |
| Janela temporal | Todo o histórico do projeto, sem limite de tempo (decisão revista — descarta a janela de N reuniões) |
| Status dos itens comparados | Todos, incluindo itens já concluídos e já ignorados pelo consultor |
| Escopo de cliente/projeto | Cruza todos os projetos do mesmo cliente, não só o projeto da reunião atual |

## Proposta técnica: duas camadas separadas

Hoje as duas parecem fundidas na mesma lógica de comparação N vs. N-1. Devem ser tratadas como mecanismos distintos:

**1. Detecção de duplicidade/atualização** (bloco "Requer revisão" — Criar novo / Atualizar existente / Ignorar)

- Cada sugestão nova deve ser comparada por similaridade contra todo o histórico de itens do mesmo cliente (todos os projetos dele), incluindo itens concluídos e ignorados.
- Manter a lógica de match já validada em 12/05 (ela pegou um par com apenas 52% de similaridade textual por causa de conflito de responsável) — o ajuste é só ampliar o universo comparado, não o algoritmo de similaridade em si.
- Ao marcar "possível duplicidade", indicar de qual reunião/projeto veio o item original, já que agora pode não ser a reunião imediatamente anterior.

**2. Widget "Evolução desde a última reunião"**

- Correção após a investigação 2: hoje não é uma visão cronológica. Ele é derivado do match de duplicidade da própria reunião, sem noção de "última reunião". Manter, mas redefinir ou renomear para não sugerir uma ordem que ele não usa.
- Sugestão de complemento: um segundo indicador de "relacionado a item de reunião anterior" quando a detecção de duplicidade (camada 1) encontrar relação com uma reunião mais antiga que a N-1, para casos como a decisão de 20/05 que decorre do trabalho de 12/05.

## Pontos em aberto e riscos

- **Sem limite de tempo (decisão revista)**: a comparação passa a cobrir todo o histórico do cliente enquanto ele estiver ativo, não uma janela fixa de reuniões. Isso reforça o risco de custo/latência abaixo — vale reavaliar no futuro se algum corte por performance (ex: arquivar itens muito antigos) se tornar necessário.
- **Custo de embeddings/similaridade**: comparar contra todo o histórico do cliente (todos os projetos, incluindo itens concluídos e ignorados) multiplica o volume da busca à medida que o relacionamento avança — vale medir o crescimento de custo/latência com o tempo e considerar índices/caching desde já.
- **Itens ignorados re-surgindo**: incluir itens já ignorados no universo comparado pode fazer uma sugestão nova ser sinalizada como "duplicidade" de algo que o consultor já descartou de propósito. Vale decidir se o alerta muda de tom nesse caso (ex: "semelhante a item já ignorado" em vez de "possível duplicidade").
- **Cruzamento entre projetos do mesmo cliente**: um item do projeto "Operações" pode ser sinalizado contra um item do projeto "Financeiro" do mesmo cliente — precisa deixar claro na UI de qual projeto veio o item original, para não confundir o consultor.

## Descoberta na investigação do código (27/09)

Antes de implementar, o código atual foi mapeado e testado contra os dados reais de produção (Grupo Erinho). O diagnóstico original deste documento precisa de correção:

- **O escopo já é o projeto inteiro, não N vs. N-1**: `scopeToProject()` (ações e riscos) já busca candidatos em todas as reuniões do projeto, sem limite de tempo — é comportamento intencional desde o início. Decisões e oportunidades (`projectDecisionsQuery`) nunca tiveram limite de reunião. O que falta de fato é só o cruzamento entre projetos diferentes do mesmo cliente.
- **Os dois pares que motivaram este documento não são um problema de escopo**: testados com os embeddings reais já salvos, "Revisar Conta Azul" (12/05) vs. "Revisar e categorizar lançamentos do extrato" (13/05) deu cosine 0,658, e "Aguardar mais meses..." vs. "Implementação gradual do modelo..." deu 0,612 — ambos abaixo do threshold de revisão (0,70), mesmo comparando contra o projeto inteiro sem limite de tempo. Ampliar o escopo não teria pego nenhum dos dois.
- **Conclusão**: alargar o cruzamento para todos os projetos do cliente continua válido e resolve o caso de 20/05 (que estava em outro recorte de reunião). Mas os dois exemplos centrais do documento são um problema diferente — detectar que uma decisão nova substitui/contradiz uma antiga sobre o mesmo tema, ou que duas tarefas são a mesma mudando de fonte de dados — que a similaridade textual pura não capta. Isso provavelmente exige um mecanismo à parte (ex: um julgamento mais semântico/contextual sobre o mesmo tópico, não só distância de embedding).

## Implementação (item 1) — concluída, aguardando validação visual

- Ações/riscos: comparação passou a ser client-wide (removida a restrição `scopeToProject` só no pool de comparação); métricas de pauta continuam escopadas ao projeto.
- Decisões: nova `clientDecisionsQuery(clientId)` cruza todos os projetos do cliente; a query existente por projeto segue servindo a aba Decisões e a pauta.
- Origem do item: nova função pura `annotateOrigin()` anota "Vem do projeto 'X'." quando o candidato vem de outro projeto, sem alterar veredito/confiança/algoritmo. Precisou de `Meeting.project_id` (novo campo).
- Conectado em `projetos/$projectId.tsx` e `reuniao-inteligente.tsx`.
- 5 testes novos para `annotateOrigin` + 1 teste estrutural pré-existente corrigido; suíte completa: 311 pass, 0 fail, build limpo.
- Estado atual: o trabalho foi separado da branch `feat/unified-erp-taxonomy-and-entity-timer` e está na branch local `feat/dedup-cliente-cronologia`, com 4 commits sobre a main (cruzamento entre projetos, trava de cronologia, relatório de duplicidade, normalização de responsável). Cada commit passa typecheck, testes e build sozinho; o HEAD tem 366 testes. Ainda sem push e sem PR.

## Investigação 2 — dados reais (reuniões 05/06 e 10/06, Grupo Erinho)

A reunião de 05/06 foi processada depois da de 10/06. Isso expôs três pontos, todos confirmados com dados de produção, sem alteração de código:

- **Cronologia não é considerada.** O widget "Evolução desde a última reunião" não escolhe reunião nenhuma: é montado a partir do resultado do match da própria reunião. Os candidatos são ordenados só por score, sem olhar a data da reunião de origem. `previousMeetingId` nunca é passado pelos dois pontos de entrada, então a tabela `meeting_evolution` fica sempre com `null`. O "Atualizar existente" sobrescreve prazo, responsável, prioridade (e o título, nas decisões) sem comparar as datas das reuniões. Efeito: uma reunião antiga processada tarde pode substituir, em silêncio, dados de um registro mais novo.
- **Responsável mal normalizado.** `normalizeOwner()` usa só o primeiro token. "Speaker 1" e "Speaker 2" viram ambos `speaker` (falso negativo: conflito real escondido). "Ada" e "Adam" divergem, embora na transcrição sejam a mesma pessoa (falso positivo). "Equipe operacional/Erinho" vira `equipe` e conflita com "Erinho" (falso positivo).
- **Consolidação interna não é bug.** As duas ações de carteira assinada têm cosine 0,553, abaixo do limiar de 0,60, e similaridade lexical de 0,283. O reforço por núcleo lexical/verbo existe só no match histórico, não na consolidação dentro da mesma reunião. Fica no backlog junto com o item 2 (relação semântica entre itens).

**Decisões desta rodada:** (1) impedir que item de reunião mais antiga sobrescreva registro de reunião mais nova; (2) botão de relatório de duplicidade em texto puro; (3) normalização de responsável por conjunto de nomes, tratando rótulos genéricos como desconhecidos e usando alias por cliente para variações de grafia. **Backlog:** alimentar `previousMeetingId` pela data da reunião; equiparar a consolidação intra-reunião ao match histórico.

## Validação ao vivo (análise de 05/06, somente leitura)

- **Relatório de duplicidade:** a validação achou um bug do B2. O relatório mostrava 85 sugestões no cabeçalho, mas só listava as de decisões, ações, riscos e oportunidades; os itens de contexto ficavam de fora. Corrigido, com 2 testes novos. Resultado: 85 de 85 sugestões listadas, 366 testes, typecheck e build limpos.
- **Cronologia:** 2 decisões foram marcadas com candidato de reunião posterior (10/06) e "Atualizar existente" desabilitado. "Modelo de comissão de 9%…" teve como melhor candidato "Modelo de comissão definido para equipe" (cosine 0,612). "Organização do pátio e quadro de controle" teve "Desocupar o pátio" (0,483). As duas ficaram com veredito Novo. O bloqueio efetivo, com score de 0,70 ou mais contra item posterior, só foi exercitado nos testes unitários, não com dado real.
- **Responsável:** nenhum rótulo genérico ("Speaker N", "Equipe operacional/Erinho") gerou conflito. Os vereditos vieram só do score.
- **Limite conhecido:** os itens de contexto (objetivos, problemas, prioridades etc.) aparecem sem cosine no relatório, porque o embedding é removido antes de a análise ser devolvida ao cliente.
- **Evidência para o item 2:** a decisão de comissão de 9% (05/06) e a de "modelo de comissão definido para equipe" (10/06) tratam do mesmo assunto e ficaram em 0,612, abaixo do limiar de revisão de 0,70. É o mesmo padrão dos pares de 12/05 e 13/05 (0,658 e 0,612): mesma frente de trabalho, redação diferente. O próximo passo é o mecanismo de relação semântica, não um ajuste de limiar.
- **Decisões e pendências:** alias de responsável fica como constante indexada por `client_id` (sem migration por enquanto). Commits prontos na branch local feat/dedup-cliente-cronologia; faltam push e PR.

## Próximos passos sugeridos

- [x] Confirmar índices/estratégia de performance para busca por similaridade em todo o histórico do cliente (sem janela fixa)
- [x] Mapear onde no código está a lógica atual de comparação — feito: \`scopeToProject()\` (ações/riscos) e \`projectDecisionsQuery\` (decisões) já cobrem o histórico inteiro do projeto; falta só cruzar outros projetos do mesmo cliente.
- [x] Ajustar a busca de similaridade para cruzar todos os projetos do mesmo cliente (dentro de um projeto o histórico já é integral), incluindo itens concluídos/ignorados nesse cruzamento também.
- [x] Adicionar ao resultado da comparação a origem do item (projeto + data da reunião), para exibir na UI quando a duplicidade vier de outro projeto do mesmo cliente.
- [ ] Revisar o tratamento de itens ignorados no match (rótulo diferenciado, conforme risco acima)
- [ ] Testar novamente contra o caso real de 12/05 → 13/05 → 20/05 para confirmar que as três lacunas identificadas neste documento são fechadas
- [x] Decidido: opção (c), em sequência — 1) implementar agora o cruzamento entre projetos do mesmo cliente; 2) investigar depois, como frente separada, um mecanismo de detecção de substituição/contradição semântica entre decisões (não é ajuste de escopo, é um julgamento novo — não bloqueia o item 1)
- [ ] Abrir o PR da branch feat/dedup-cliente-cronologia e revisar o diff antes do merge
- [ ] Após o merge, sincronizar a branch feat/unified-erp-taxonomy-and-entity-timer com a main, descartando as mudanças de duplicidade que ela ainda tem soltas
- [ ] Iniciar o desenho do item 2 (relação semântica entre decisões e ações), ainda sem código
