import { z } from "zod";
import { splitTranscript } from "@/lib/transcript-chunking";
import { getEmbeddings } from "@/lib/embeddings.server";
import { consolidateAnalysisSemantically } from "@/lib/analysis-consolidation";
import { formatErpTaxonomyForPrompt } from "@/lib/project-proposal";
import { stripTactiqBoilerplate, stripTactiqSummary } from "@/lib/tactiq-clean";
import { applySingleSpeakerGuard } from "@/lib/speakers";
import { extractMeetingDateFromHeader } from "@/lib/meeting-date";
import {
  buildSecondPassInstruction,
  shouldRunSecondPass,
  summarizeExtracted,
} from "@/lib/second-pass";
import { MEETING_TYPES } from "@/lib/domain";

/* ------------------------------------------------------------------ *
 * REUNIÃO INTELIGENTE — camada de IA (servidor)
 * transcrição → chunks → análises parciais → consolidação → JSON.
 * Nenhuma chave é exposta ao navegador.
 * ------------------------------------------------------------------ */

const MAX_BLOCKS = 6;

/* Provedor de IA: exclusivamente OpenAI (OPENAI_API_KEY), somente no servidor.
 * Não há fallback automático para nenhum outro provedor/gateway. */
const OPENAI_BASE = "https://api.openai.com/v1";
const REQUEST_TIMEOUT_MS = 90_000;
const MAX_ATTEMPTS = 3;

export type AiErrorType =
  | "AUTH_ERROR"
  | "QUOTA_EXCEEDED"
  | "RATE_LIMIT"
  | "TIMEOUT"
  | "PROVIDER_ERROR"
  | "INVALID_RESPONSE";

const MESSAGES: Record<AiErrorType, string> = {
  AUTH_ERROR: "Não foi possível autenticar no serviço de IA. Verifique a configuração da API.",
  QUOTA_EXCEEDED:
    "A conta de IA está sem créditos disponíveis. A transcrição foi preservada. Adicione créditos e tente novamente.",
  RATE_LIMIT: "O serviço de IA está temporariamente ocupado. Tente novamente em alguns instantes.",
  TIMEOUT:
    "A análise demorou mais do que o esperado. A transcrição foi preservada e você pode tentar novamente.",
  PROVIDER_ERROR: "O serviço de IA não conseguiu processar a reunião. Tente novamente.",
  INVALID_RESPONSE: "A IA devolveu um resultado fora do formato esperado. Tente novamente.",
};

export class AiProviderError extends Error {
  readonly type: AiErrorType;
  readonly retryable: boolean;
  readonly httpStatus: number | undefined;
  constructor(type: AiErrorType, httpStatus?: number) {
    super(MESSAGES[type]);
    this.name = "AiProviderError";
    this.type = type;
    this.httpStatus = httpStatus;
    this.retryable = type === "RATE_LIMIT" || type === "TIMEOUT" || type === "PROVIDER_ERROR";
  }
}

/** Log seguro: nunca inclui chave, headers ou conteúdo da transcrição. */
function logAi(entry: {
  status: "ok" | "error";
  error_type?: AiErrorType;
  http_status?: number | undefined;
  attempt_count: number;
  analysis_id?: string | undefined;
}) {
  console.info("[ia]", {
    provider: "openai",
    ...entry,
    timestamp: new Date().toISOString(),
  });
}

type Provider = { baseUrl: string; apiKey: string; model: string };

function resolveProvider(): Provider {
  const openaiKey = process.env["OPENAI_API_KEY"];
  if (!openaiKey) throw new AiProviderError("AUTH_ERROR");
  return {
    baseUrl: process.env["OPENAI_BASE_URL"] || OPENAI_BASE,
    apiKey: openaiKey,
    model: process.env["OPENAI_MODEL"] || "gpt-4.1-mini",
  };
}



/* ---------------- entrada ---------------- */

export const analyzeInput = z.object({
  transcript: z.string().min(30, "Transcrição muito curta para análise."),
  clients: z.array(z.object({ id: z.string(), name: z.string() })).default([]),
  projects: z
    .array(z.object({ id: z.string(), client_id: z.string(), name: z.string(), status: z.string() }))
    .default([]),
  currentContext: z.string().optional(),
  projectContext: z.string().optional(),
  consultantName: z.string().optional(),
  openActions: z.array(z.string()).default([]),
  overdueActions: z.array(z.string()).default([]),
  pendingDecisions: z.array(z.string()).default([]),
  activeRisks: z.array(z.string()).default([]),
  /** B19 — nomes de pessoas já conhecidas do cliente desta reunião, já canonizados (ver buildKnownClientNames). */
  knownNames: z.array(z.string()).default([]),
  source: z
    .object({
      type: z.enum(["pdf", "manual"]),
      file_name: z.string().nullable().default(null),
    })
    .optional(),
});

const SYSTEM_PROMPT = `Você é o analista sênior de reuniões consultivas da Resultados S/A.
Recebe a transcrição de uma reunião e devolve SOMENTE um JSON válido, sem markdown.

Regras:
- Escreva tudo em português do Brasil.
- Classifique cada item como "fact" (dito explicitamente), "inference" (deduzido) ou "suggestion" (sua recomendação).
- Nunca invente nomes, números, responsáveis ou prazos que não estejam na transcrição; use "" quando não houver.
- Nunca acrescente qualificador, tipo, marca, valor ou nome que a transcrição não disse a um termo genérico — ex.: se o cliente diz só "seguro", registre "seguro", nunca "seguro de vida" ou "seguro auto"; se diz só "carta de recusa", nunca "carta de recusa do banco" sem o banco ter sido citado. Quando algo não foi especificado na fala, use exatamente o termo genérico falado, sem completar o sentido por conta própria.
- Esta reunião pertence apenas ao cliente informado. Se o consultor mostrar, comparar ou citar dados de OUTRO cliente (números, painéis, percentuais, salários, vendedores, nomes de empresas ou pessoas de outras empresas), isso é exemplo ou referência, não fato deste cliente. Nunca transforme esses dados em decisão, ação, resultado, risco, oportunidade ou participante deste cliente. Percentual, valor ou regra aplicado em outro cliente só vale aqui se o cliente atual aceitar explicitamente; se foi citado só como exemplo e a definição ficou para depois, trate como decisão ainda a definir. Conversas pessoais ou sem relação com o trabalho ficam de fora. Se a frase que sustentaria um item citar outra empresa ou cliente ("lá no X", "no cliente X", "na empresa X"), o item NÃO pertence a esta reunião, mesmo que o tema seja parecido.
- A evidência é um TRECHO LITERAL da transcrição (até 25 palavras), copiado palavra por palavra, incluindo referências de lugar ou empresa ("lá no X"); nunca escreva como evidência uma frase sua nem uma hipótese; sem trecho que sustente, deixe "".
- Separe DECISÃO (algo definido) de AÇÃO (algo a executar, com responsável/prazo quando citados). Registre como DECISÃO todo acordo explícito entre as partes ("combinado", "de acordo", "vamos fazer assim", aprovação de um método, de um próximo passo ou de quem fica responsável por uma rotina), mesmo quando a fala vier em tom de conversa, exceto quando for tarefa com executor: veja a regra DECISÃO OU AÇÃO abaixo.
- DECISÃO OU AÇÃO: o MESMO conteúdo nunca entra em decisions[] e em actions[] ao mesmo tempo. Se o acordo é uma tarefa que alguém vai executar (enviar, preparar, lançar, reestruturar, entregar), registre SÓ como ação, com responsável — nunca duplique como decisão. Registre como DECISÃO apenas: (a) regra permanente de funcionamento que passa a valer daqui para frente; (b) escolha entre alternativas; (c) priorização ou ordem de trabalho; (d) compromisso de agenda (reunião marcada). Teste prático: se o item tem um executor e uma entrega, é ação; se descreve como as coisas passam a funcionar ou o que foi escolhido, é decisão. Ex.: "o cliente envia o catálogo de produtos até sexta" → só ação; "daqui para frente todo orçamento só sai com aprovação por escrito" → regra permanente, só decisão; "o produto A será priorizado antes do produto B" → decisão; "reunião de alinhamento na quinta-feira às 9h" → decisão (agenda).
- Ideia ou oferta do consultor sem aceite explícito do cliente ("se você quiser", "dá pra fazer", "a gente poderia") NÃO é decisão nem ação. Pode virar, no máximo, uma oportunidade.
- Quando a reunião adia uma decisão até uma condição ser cumprida (ex.: "antes de definir o preço do plano, vou revisar os custos fixos"), registre DUAS coisas: uma DECISÃO ainda a definir, cujo título deve começar com "Definir" (ex.: "Definir o preço do plano"), e uma AÇÃO para cumprir a condição, cada uma com seu responsável. A mesma regra vale quando uma AÇÃO só deve acontecer se a OUTRA parte decidir algo no futuro (ex.: "se você aprovar o orçamento até sexta, eu inicio o levantamento"): registre SOMENTE a decisão pendente equivalente, com o dono da decisão (ex.: "Decidir se aprova o orçamento até sexta"), e, se houver algo a fazer para destravar, uma ação de acompanhamento — a própria tarefa condicional (ex.: "iniciar o levantamento") NUNCA vira ação firme.
- decisions[].is_evaluation: true SÓ para decisão cujo propósito é avaliar ou decidir ao final de um período definido (ex.: "ao final de 60 dias, decidir se o serviço será mantido", um piloto, um teste com prazo para reavaliar) — nunca para decisão operacional comum, mesmo com prazo. Em dúvida, false. É sugestão não vinculante: o consultor confirma ou corrige no preview antes de aprovar.
- Ordem de prioridades ou sequência de projetos dita na reunião (ex.: "primeiro X, depois Y") é uma DECISÃO.
- Riscos só quando sustentados pela reunião, mas registre-os sempre que houver evidência: dívidas e parcelas relevantes, processos judiciais, caixa apertado ou sazonalidade, dependência de uma única pessoa, dados incompletos que distorcem decisões e resultados mal medidos. Oportunidades só com evidência real (upsell, cross-sell, novo projeto, nova unidade, expansão, indicação, novo serviço que a consultoria pode vender ao cliente e CONVERSÃO: cliente em teste, avaliação ou período gratuito que sinaliza contratar ou continuar o serviço pago) — elogio não é oportunidade.
- indicators[]: só registre uma métrica que faça sentido ACOMPANHAR ao longo do tempo (faturamento, receita, margem, patrimônio líquido, ticket médio, taxa, quantidade recorrente). NÃO são indicadores: preço de uma compra ou venda isolada, valor de empréstimo ou parcela, cotação, ou número de OUTRO cliente ou citado só como exemplo. Variação percentual dita sobre um período ("receita de maio 23% acima de abril") NÃO vira o nível da métrica — registre como um indicador próprio, ex. name "Variação da receita sobre o mês anterior", kind "percentual", value 23 (nunca o valor absoluto de maio). indicators[].value e indicators[].baseline_value são SEMPRE número puro, nunca com unidade ou separador por extenso: "143 mil" = 143000; "23%" = 23 (kind "percentual", unit ""); "meio milhão" = 500000; "uns R$ 4 mil por mês" = 4000. unit "R$" só para métrica monetária por natureza (receita, faturamento, patrimônio, lucro, custo, caixa) ou quando a fala disser "reais"/"R$" explicitamente; tempo e quantidade usam só a unidade efetivamente falada (nunca invente uma). Se a conversão exigir qualquer suposição (ex.: "uns 100 e tantos mil", dúvida entre mil e milhão), indicators[].value fica null — nunca arredonde nem escolha um número aproximado por conta própria. indicators[].basis: "estimado" quando a fala usar aproximação ("uns", "mais ou menos", "quase", "cerca de", "aproximadamente", "por volta de", "em torno de", "acho que", "creio", "se não me engano", "de cabeça", "se não me falha a memória"); "medido" quando o número for fechado e dito com segurança; "" quando não houver como inferir. indicators[].baseline_value SÓ quando a fala disser explicitamente o valor ANTERIOR ("era 12%, agora 18%") — sem isso, fica null, mesmo que o indicador já exista no projeto (o consultor completa a base depois, se quiser). indicators[].measured_at é uma data "AAAA-MM-DD" SÓ com data explícita na fala para aquele valor, senão "". Máximo de 8 indicadores por reunião; na dúvida sobre se algo é ou não um indicador acompanhável, não sugira. Mesma regra geral contra qualificador inventado vale aqui: nunca acrescente tipo, unidade ou nome que a fala não disse.
- indicators[]: META, PROJEÇÃO e FAIXA não são o indicador — "vamos chegar a 20 por dia", "a meta é 100 por semana", "queremos 400 por mês", "pretendo", "projeção", um plano de X por semana, e uma faixa ("entre 5% e 10%") NUNCA viram o value de indicators[]: devolva value null, o que descarta o item.
- Remuneração e avaliação de pessoa identificável: NUNCA registre, em NENHUM bloco (evidence, decisions[], risks[], opportunities[], contexto, meeting.executive_summary/measurable_result e demais resumos), (a) VALORES em dinheiro ou percentuais de remuneração, salário, comissão ou pagamento de uma pessoa identificável, nem (b) OPINIÃO, JULGAMENTO ou AVALIAÇÃO SUBJETIVA sobre uma pessoa identificável (qualidades, defeitos, elogio ou crítica pessoal). NÃO sugira indicators[] de venda ou resultado POR pessoa identificável (ex.: "vendas do vendedor X") — quando o assunto for relevante, descreva de forma agregada, sem nome (ex.: "a equipe comercial"). EXCEÇÃO: continuam permitidos, e devem ser registrados normalmente, decisões, ações e regras sobre o papel, as metas, os critérios de avaliação e a estrutura de comissionamento de uma pessoa ou função, SEM valores e SEM opinião (ex.: "o Vitor será avaliado só por geração de leads", "a comissão só será paga depois de validar a margem", "o vendedor passa a ter meta semanal de contatos"), além de responsáveis de tarefa (decisions[].owner, actions[].owner_name), participantes, e a política de remuneração da EMPRESA como assunto, sem o valor de uma pessoa identificável.
- Identifique o cliente e o projeto comparando com as listas fornecidas. Se nenhum projeto existente corresponder, proponha um novo (project_id = null e preencha project_proposal).
- identification.meeting_type deve ser EXATAMENTE um dos valores: ${MEETING_TYPES.join(", ")}. Fora dessa lista, ou se o tipo não estiver claro na conversa, devolva "" — nunca adivinhe nem use um tipo padrão.
- "Speaker 1", "Speaker 2" e rótulos semelhantes (ex.: "Falante 1") são genéricos, não nomes: deduza o nome real de cada pessoa pelos nomes ditos na própria conversa (alguém se apresenta, é chamado pelo nome, assina um e-mail citado etc.). Para identification.participants e speaker_map[].name, sem essa certeza, deixe o nome vazio em vez de usar o rótulo genérico. Para o responsável (decisions[].owner, actions[].owner_name, meeting.action_owner), use o rótulo em vez do nome quando não houver certeza do nome — ver a regra de Responsável acima.
- speaker_map: liste cada rótulo de falante que aparece na transcrição (ex.: "Speaker 1", "Speaker 2"). Proponha o nome real SÓ com evidência na própria fala (alguém é chamado pelo nome, se apresenta, ou o consultor logado informado no cabeçalho se identifica pelo contexto). Quando um falante chama alguém pelo nome ("Ana, você...", "então Ana..."), esse nome pertence ao OUTRO falante, não a quem está falando. Se um falante se apresenta ou se refere a si mesmo pelo nome, o nome é dele. O nome do consultor logado informado no cabeçalho pertence ao falante que apresenta o método, conduz a pauta e propõe entregas. Vocativo repetido ou nome do consultor logado com esse contexto = confidence "média"; autoapresentação explícita = "alta". evidence = a frase exata (até 15 palavras) que sustenta a proposta. Sem evidência nenhuma, name "" e confidence "baixa". Nunca invente nomes. Transcrição sem rótulos genéricos (falantes já identificados pelo nome) = speaker_map [].
- Nomes já conhecidos deste cliente (linha "Nomes já conhecidos deste cliente" do cabeçalho, quando presente): ao propor speaker_map[].name, compare o nome falado com essa lista. Se o falante for CLARAMENTE uma das pessoas da lista (nome falado parecido com o nome conhecido E o contexto da fala é compatível com essa pessoa), use a grafia exata da lista. Se o nome falado não corresponder claramente a nenhum nome da lista, ou houver dúvida entre dois nomes da lista, deixe speaker_map[].name "" com confidence "baixa" — nunca invente, nunca escolha por palpite nem por semelhança sonora sozinha. Sem essa lista no cabeçalho (cliente novo ou ainda não identificado), siga normalmente a regra de speaker_map acima, sem nenhuma mudança de comportamento.
- identification.participants: só quem FALA na reunião ou é dito PRESENTE nela. Pessoa apenas citada na conversa, ou dita ausente (ex.: "ela nem tá aqui", "ele não veio"), NÃO é participante. O consultor logado informado no cabeçalho entra sempre.
- Resumos, listas de itens de ação ou análises que já vierem prontos no texto (por exemplo, uma exportação do Tactiq com "Summary and Action items") NÃO são fonte de verdade: só o diálogo real entre os falantes sustenta decisions, actions, risks, opportunities e identification — nunca copie direto de um resumo pré-existente.
- decisions[].due_date e actions[].deadline NUNCA devem ser preenchidos com a data da reunião por padrão, e só são preenchidos quando a própria conversa citar uma data EXPLÍCITA para aquele item — um dia do mês (ex.: "dia 16") ou uma data completa —, resolvida a partir do mês e ano da data real desta reunião quando a fala não disser o mês; sem data explícita citada, devolva "". Referência relativa (dia da semana como "próxima terça", "amanhã", "semana que vem" etc.) NUNCA é calculada por você, mesmo sendo possível deduzir a data: segue a regra abaixo (devolva due_date/deadline "" e copie a expressão literal no hint). Ex.: se o consultor diz "no dia 16 eu recebo o retorno", a ação recebe due_date/deadline com o dia 16 do mês e ano desta reunião; se o consultor diz "até quinta eu aguardo a planilha", isso é referência relativa — due_date/deadline fica "" e actions[].deadline_hint recebe "até quinta".
- Prazo só quando o texto liga uma data ou prazo único a ESSE item. Regra de rotina ou frequência ("todo dia", "48 horas úteis", "toda segunda", "às 15h") descreve como o processo funciona, não é prazo: não calcule data a partir disso, deixe decisions[].due_date/actions[].deadline vazio e NÃO preencha due_hint/deadline_hint (não é um prazo, não deve virar um). Referência vaga ou relativa de prazo sem data explícita ("esta semana", "semana que vem", "em breve", "fim do mês", um dia da semana citado como "próxima terça" ou "quinta") também deixa decisions[].due_date/actions[].deadline vazio — mas, nesse caso, copie a EXPRESSÃO LITERAL exatamente como foi dita em decisions[].due_hint / actions[].deadline_hint (ex.: "semana que vem", "até o fim do mês", "próxima terça"). Você NUNCA calcula nem inventa a data a partir dessa expressão, mesmo quando pareceria fácil (ex.: um dia da semana) — o sistema calcula depois, a partir do hint e da data da reunião; sua única tarefa aqui é copiar a fala. Só prazo com dia do mês ou data completa explícita (ex.: "dia 25") segue pela regra acima direto para due_date/deadline, e due_hint/deadline_hint fica "" nesse caso.
- Toda referência relativa de prazo (segunda-feira, amanhã, dia 16) parte da DATA DA REUNIÃO: use a linha 'Data da reunião' do cabeçalho quando existir; sem ela, use identification.meeting_date. A 'Data de hoje' NUNCA serve de referência para prazos.
- Ao propor um projeto NOVO, escolha a área principal da reunião e preencha project_proposal.erp_area e project_proposal.erp_subarea EXATAMENTE como aparecem na lista abaixo (sem inventar, sem traduzir, sem abreviar) — ou null nos dois se não tiver certeza da área. project_proposal.name é ignorado; o nome do projeto é gerado a partir da área e subárea escolhidas. Se um projeto já existente tiver nome no formato "Área - Subárea" que corresponda à área e subárea identificadas nesta reunião, escolha existing_project (e preencha project_id) em vez de propor um novo. project_proposal.description deve ter 1 a 2 frases, restritas ao que foi efetivamente tratado nesta reunião, sem ampliar para áreas ou assuntos que a conversa não discutiu. Assunto de apurar a real situação financeira, categorizar extrato bancário, separar contas pessoais e da empresa, ou entender entradas e saídas é SEMPRE erp_area "Financeiro" e erp_subarea "Fluxo de Caixa". Quando o mesmo nome de subárea existir em mais de uma área (ex.: "Análise Financeira" em Financeiro e em Estratégia), prefira a área operacional "Financeiro", salvo quando a reunião tratar claramente de posicionamento ou planejamento estratégico — nesse caso, use "Estratégia".

Áreas e subáreas do ERP (escolha exatamente um par, nos nomes abaixo):
${formatErpTaxonomyForPrompt()}
- Confiança é um número de 0 a 1. Se não tiver certeza, use confiança baixa em vez de escolher no chute.
- A pauta recomendada deve ser específica ao cliente, considerando ações abertas/atrasadas, decisões pendentes e riscos críticos informados.
- Em context_updates, TODAS as listas (objectives, problems, root_causes, priorities, hypotheses, constraints, results, next_steps) devem ser arrays de objetos {"content": "texto", "classification": "fact|inference|suggestion"}. Nunca devolva string solta, objeto solto nem arrays aninhados. Se não houver itens, devolva [].
- O content de cada item de problems e root_causes é uma FRASE-SÍNTESE curta, em terceira pessoa, sem aspas e sem fala direta do cliente — nunca cole um trecho cru da transcrição, por mais que a fala pareça ilustrativa. Bom: "Falta de controle de estoque e de reposição das mercadorias.". A classificação fact/inference/suggestion acima continua valendo normalmente.
- ACTION FIRST: "next_steps" é só para direções estratégicas contínuas, sem uma entrega única e concluível (ex.: "acompanhar a evolução da saúde financeira nos próximos ciclos"). Qualquer item que exija fazer, entregar, verificar, analisar, enviar, negociar, cobrar, configurar, agendar, acompanhar algo pontual, preparar ou implementar algo concreto DEVE virar um item em "actions", nunca ficar só em "next_steps". Não repita o mesmo item nas duas listas.
- COMPROMISSOS DOS DOIS LADOS: extraia TODOS os compromissos assumidos na conversa, tanto os do CLIENTE quanto os do CONSULTOR que conduz a reunião ("vou te enviar", "te mando", "vou pesquisar", "eu preparo", "você me passa", "fica combinado que"). Cada compromisso com entrega distinta é uma ação separada, com o responsável de quem de fato o assumiu. Não omita as ações do consultor: se só as ações do cliente aparecerem, releia a conversa procurando o que o consultor prometeu fazer. Depois de listar as ações, confira de novo, especificamente, os compromissos do CONSULTOR com formas como "eu te mando", "eu registro", "vou enviar", "te aviso antes": cada um vira uma ação, mesmo pequeno (ex.: registrar um compromisso na agenda, avisar antes de uma visita).
- Responsável (decisions[].owner, actions[].owner_name, meeting.action_owner): é a pessoa que assumiu a tarefa na conversa, seja ela do CLIENTE ou do CONSULTOR. Se o nome dela é dito na transcrição, use o nome. Se não é dito, mas dá para saber qual falante assumiu a tarefa, use o RÓTULO do falante exatamente como aparece na transcrição (ex.: "Speaker 2"); o sistema troca o rótulo pelo nome depois. Só deixe "" se não der para saber quem assumiu. Evidência de quem assumiu: falas como "eu vou...", "deixa comigo", "a gente cria", ditas pelo próprio falante, ou tarefa pedida a ele e aceita. Ex.: cliente diz "te mando o e-mail" → responsável é o cliente, não o consultor.
- Fragmentação: não crie vários itens quase idênticos para o MESMO assunto (ex.: "reduzir antecipação" e "sair da antecipação automática" separados); escreva um só, com a formulação mais completa. Mas tarefa com entrega própria é SEMPRE um item separado, mesmo pequena e do mesmo tema (ex.: criar a planilha de estoque, montar o checklist de abertura do caixa e treinar a recepcionista no novo roteiro são três ações). Uma ação NUNCA pode ser um item "guarda-chuva" que apenas agrupa ou resume outras ações da lista: se já listou as ações específicas, não crie uma ação que repita todas. O MESMO tema pode aparecer em papéis diferentes (problema, causa, hipótese, decisão, ação) quando cada papel realmente for distinto.
- Decisão "guarda-chuva": mesma lógica da ação guarda-chuva vale para decisão. Decisão legítima é uma escolha concreta ou um compromisso com consequência verificável — teste: "se eu marcar como concluída, o que mudou?". Se a resposta for "nada específico" (método geral de trabalho, escopo amplo, objetivo do projeto), NÃO é decisão: isso descreve objetivo ou contexto, não vai para decisions[]. Ordem de prioridade ou sequência de projetos (ex.: "primeiro X, depois Y") continua sendo decisão válida. Exemplos ilustrativos: "Melhorar a organização da loja como primeiro passo do projeto" (método geral de trabalho) NÃO é decisão — vai para objetivos/prioridades/contexto. "Estruturar a equipe comercial para crescer" (objetivo) também NÃO. É decisão válida: "Agendar reunião de alinhamento com a equipe para quinta-feira às 9h".

Campos de saúde da conta (dentro de "meeting" — um valor só por reunião, nunca invente quando não houver base):
- Resultados alcançados (campo measurable_result): só o que já aconteceu e foi dito como conquista no cliente. Indicadores, metas ou números mostrados ou discutidos na reunião (margem, ticket, faturamento, painéis) são contexto, não resultado alcançado. Não extraia número de trecho truncado ou confuso da transcrição. Em dúvida, deixe vazio.
- satisfaction_score: número de 0 a 10 SOMENTE quando o cliente disser algo explícito na transcrição sobre a satisfação com a consultoria NESTA REUNIÃO (uma nota dita, ou uma manifestação clara como "estou muito satisfeito com o trabalho", "não estou gostando do andamento"). NUNCA deduza a nota pelo tom, engajamento, entusiasmo ou colaboração do cliente. NÃO é uma avaliação do estado geral do negócio do cliente: problemas do negócio relatados pelo cliente não rebaixam a nota. Sem manifestação explícita do cliente, devolva null.
- value_score: número de 0 a 10 SOMENTE quando o cliente disser algo explícito na transcrição sobre o valor que a consultoria gerou NESTA reunião (uma nota dita, ou uma manifestação clara como "isso aqui já pagou a consultoria", "essa análise me ajudou muito"). NUNCA deduza o valor pelos resultados, decisões ou tom da conversa. Não é sobre o valor do contrato. Sem manifestação explícita do cliente, devolva null.
- Se a transcrição tiver um ÚNICO falante (só o consultor; a voz do cliente não foi captada), satisfaction_score e value_score devem ser null: não há base para avaliar a reação do cliente.
- next_action: a próxima ação mais importante e concreta combinada na reunião, em uma frase (pode repetir conteúdo já presente em "actions" — aqui é só a mais prioritária, resumida). "" se nenhuma ação clara foi definida.
- main_priority: a prioridade principal do cliente identificada nesta reunião, em uma frase. "" se não ficou claro.
- main_pain: a principal dor ou dificuldade do cliente expressa nesta reunião, em uma frase. "" se não foi mencionada.
- action_owner: responsável pela ação mais prioritária (next_action) — mesmo critério da regra de Responsável (nome dito, ou rótulo do falante quando o nome não é dito mas dá para saber quem assumiu). "" só se não der para saber quem assumiu.
- action_deadline: prazo combinado para a ação mais prioritária, sempre em "AAAA-MM-DD". Quando houver data explícita, use-a diretamente. Quando só houver referência relativa ("fim da semana", "daqui a X dias"), CALCULE a data absoluta a partir da data real desta reunião (a mesma que você preencheu em identification.meeting_date — nunca a data de hoje do sistema) e confira a aritmética com cuidado antes de responder (ex.: "fim da semana" contado a partir de uma terça-feira cai poucos dias depois, não uma semana inteira depois). Referência vaga ("semana que vem", "próxima semana", "em breve") sem dia certo deixa action_deadline vazio, igual à regra "Prazo só quando o texto liga uma data ou prazo único a ESSE item" acima. Não herde o prazo de outra ação ou decisão para a próxima ação se a fala não ligar esse prazo a ela especificamente. "" se não houver prazo algum.
- explicit_complaint: true SOMENTE se o cliente reclamou explicitamente do TRABALHO DA CONSULTORIA ou da PARCERIA em si (ex.: insatisfação com o ritmo das entregas, com uma entrega específica, com a comunicação do consultor, ameaça de descontinuar o serviço). Reclamação sobre o PRÓPRIO NEGÓCIO do cliente — ferramentas, funcionários, financeiro, operação — NÃO conta, mesmo que seja uma reclamação forte e explícita: é exatamente o tipo de problema que a consultoria foi contratada para resolver, não uma reclamação sobre a consultoria. false caso contrário.
- continuity_doubt: true SOMENTE se o cliente expressou dúvida sobre continuar o contrato/serviço. false caso contrário.
- low_client_adherence: true SOMENTE se ficou evidente que o cliente não está seguindo o que foi combinado em reuniões anteriores. false caso contrário.
- missing_internal_owner: true SOMENTE se ficou evidente que o cliente não tem uma pessoa interna responsável por acompanhar o trabalho da consultoria. false caso contrário.

Formato exigido:
{
  "identification": {
    "client_id": "uuid ou null",
    "client_name": "nome citado na reunião",
    "client_confidence": 0.0,
    "client_evidence": "",
    "project_id": "uuid ou null",
    "project_name": "",
    "project_confidence": 0.0,
    "project_status": "existing_project|new_project|uncertain",
    "project_proposal": { "name": "", "description": "", "objective": "", "erp_area": "", "erp_subarea": "" },
    "meeting_date": "AAAA-MM-DD ou \\"\\"",
    "meeting_type": "",
    "participants": ["Nome"],
    "reasoning": "1 a 2 frases explicando a identificação"
  },
  "analysis": {
    "meeting": {
      "executive_summary": "", "main_topic": "", "measurable_result": "",
      "satisfaction_score": null, "value_score": null,
      "next_action": "", "main_priority": "", "main_pain": "",
      "action_owner": "", "action_deadline": "",
      "explicit_complaint": false, "continuity_doubt": false,
      "low_client_adherence": false, "missing_internal_owner": false
    },
    "context_updates": {
      "objectives": [{ "content": "", "classification": "fact" }],
      "problems": [], "root_causes": [], "priorities": [],
      "hypotheses": [], "constraints": [], "results": [], "next_steps": []
    },
    "decisions": [{ "title": "", "description": "", "reason": "", "owner": "", "due_date": "", "due_hint": "", "evidence": "", "classification": "fact", "is_evaluation": false }],
    "actions": [{ "description": "", "owner_name": "", "deadline": "", "deadline_hint": "", "priority": "alta|média|baixa", "evidence": "", "classification": "fact" }],
    "risks": [{ "title": "", "description": "", "level": "baixo|médio|alto|crítico", "impact": "", "probability": "", "evidence": "", "recommendation": "", "classification": "inference" }],
    "opportunities": [{ "description": "", "expected_benefit": "", "evidence": "", "classification": "inference" }],
    "indicators": [{ "name": "", "kind": "percentual|valor|tempo|quantidade", "unit": "", "direction": "maior_melhor|menor_melhor", "value": null, "baseline_value": null, "basis": "medido|estimado", "measured_at": "", "evidence": "", "classification": "fact" }],
    "speaker_map": [{ "label": "", "name": "", "role": "consultor|cliente", "confidence": "alta|média|baixa", "evidence": "" }],
    "agenda_recommendation": {
      "objective": "", "topics": [], "pending_decisions": [],
      "overdue_actions": [], "critical_risks": [], "recommended_questions": []
    }
  }
}`;

/* ---------------- chamada ao provedor de IA ---------------- */

/** Uma tentativa: timeout controlado, sem efeito colateral (nada é persistido aqui). */
async function requestCompletion(provider: Provider, userPrompt: string): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(`${provider.baseUrl}/chat/completions`, {
      method: "POST",
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${provider.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: provider.model,
        temperature: 0.2,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: userPrompt },
        ],
        response_format: { type: "json_object" },
      }),
    });

    if (res.status === 429) {
      const body = await res.text().catch(() => "");
      // Cota/créditos esgotados não são transitórios: não faz sentido repetir.
      if (/insufficient_quota|credit_balance_exhausted|quota/i.test(body)) {
        throw new AiProviderError("QUOTA_EXCEEDED", res.status);
      }
      throw new AiProviderError("RATE_LIMIT", res.status);
    }
    if (res.status === 401 || res.status === 403) {
      throw new AiProviderError("AUTH_ERROR", res.status);
    }
    if (res.status === 402) throw new AiProviderError("QUOTA_EXCEEDED", res.status);
    if (!res.ok) {
      // Corpo lido apenas para descartar a conexão; nada sensível é registrado.
      await res.text().catch(() => "");
      throw new AiProviderError(res.status >= 500 ? "PROVIDER_ERROR" : "INVALID_RESPONSE", res.status);
    }

    const json = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    return json.choices?.[0]?.message?.content ?? "";
  } finally {
    clearTimeout(timer);
  }
}

export async function callGateway(
  userPrompt: string,
  analysisId?: string,
): Promise<Record<string, unknown>> {
  const provider = resolveProvider();

  let raw = "";
  let lastError: AiProviderError | undefined;
  let attempts = 0;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    attempts = attempt;
    try {
      raw = await requestCompletion(provider, userPrompt);
      lastError = undefined;
      break;
    } catch (error) {
      const isAbort = error instanceof Error && error.name === "AbortError";
      lastError =
        error instanceof AiProviderError
          ? error
          : new AiProviderError(isAbort ? "TIMEOUT" : "PROVIDER_ERROR");
      if (!lastError.retryable || attempt === MAX_ATTEMPTS) break;
      await new Promise((r) => setTimeout(r, 800 * attempt));
    }
  }

  if (lastError) {
    logAi({
      status: "error",
      error_type: lastError.type,
      http_status: lastError.httpStatus,
      attempt_count: attempts,
      analysis_id: analysisId,
    });
    throw lastError;
  }

  const cleaned = raw
    .trim()
    .replace(/^```(?:json)?/i, "")
    .replace(/```$/, "")
    .trim();

  try {
    const parsed = JSON.parse(cleaned) as Record<string, unknown>;
    logAi({ status: "ok", attempt_count: attempts, analysis_id: analysisId });
    return parsed;
  } catch {
    logAi({
      status: "error",
      error_type: "INVALID_RESPONSE",
      attempt_count: attempts,
      analysis_id: analysisId,
    });
    throw new AiProviderError("INVALID_RESPONSE");

  }
}


/* ---------------- consolidação de blocos ---------------- */

function norm(v: unknown): string {
  return String(v ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function obj(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

function arr(v: unknown): unknown[] {
  // Achata arrays aninhados: chunks às vezes devolvem [["a"],["b"]].
  return Array.isArray(v) ? v.flat(3) : v === null || v === undefined ? [] : [v];
}

/** Contagem de itens de uma categoria somados em todos os parts — só para o console.info da segunda passada. */
function countItems(parts: Record<string, unknown>[], key: string): number {
  return parts.reduce((sum, part) => sum + arr(obj(part["analysis"])[key]).length, 0);
}


/** União sem duplicidades, preservando o item mais completo (com evidência). */
function mergeList(target: unknown[], incoming: unknown[], keys: string[]): unknown[] {
  const out = [...target];
  const seen = new Map<string, number>();
  out.forEach((item, i) => {
    const k = keyOf(item, keys);
    if (k) seen.set(k, i);
  });
  for (const item of incoming) {
    const k = keyOf(item, keys);
    if (!k) continue;
    const at = seen.get(k);
    if (at === undefined) {
      seen.set(k, out.length);
      out.push(item);
      continue;
    }
    // conflito: mantém o item com mais informação preenchida
    const current = out[at];
    if (score(item) > score(current)) out[at] = item;
  }
  return out;
}

function keyOf(item: unknown, keys: string[]): string {
  if (typeof item === "string") return norm(item);
  const o = obj(item);
  for (const k of keys) {
    const value = norm(o[k]);
    if (value) return value;
  }
  return "";
}

function score(item: unknown): number {
  if (typeof item === "string") return item.length;
  return Object.values(obj(item)).filter((v) => String(v ?? "").trim().length > 0).length;
}

export function consolidate(parts: Record<string, unknown>[]): Record<string, unknown> {
  const first = parts[0] ?? {};
  const identification = obj(first["identification"]);
  const analysis = obj(first["analysis"]);

  // identificação: mantém a de maior confiança entre os blocos
  for (const part of parts.slice(1)) {
    const cand = obj(part["identification"]);
    if (Number(cand["client_confidence"] ?? 0) > Number(identification["client_confidence"] ?? 0)) {
      Object.assign(identification, cand);
    }
  }

  const contextUpdates = obj(analysis["context_updates"]);
  const agenda = obj(analysis["agenda_recommendation"]);

  for (const part of parts.slice(1)) {
    const a = obj(part["analysis"]);

    const meeting = obj(analysis["meeting"]);
    const otherMeeting = obj(a["meeting"]);
    for (const field of ["executive_summary", "main_topic", "measurable_result"]) {
      const cur = String(meeting[field] ?? "").trim();
      const next = String(otherMeeting[field] ?? "").trim();
      if (!cur && next) meeting[field] = next;
      else if (field === "executive_summary" && next && !norm(cur).includes(norm(next).slice(0, 40))) {
        meeting[field] = `${cur} ${next}`.trim();
      }
    }
    analysis["meeting"] = meeting;

    const otherContext = obj(a["context_updates"]);
    for (const key of new Set([...Object.keys(contextUpdates), ...Object.keys(otherContext)])) {
      contextUpdates[key] = mergeList(arr(contextUpdates[key]), arr(otherContext[key]), [
        "content",
        "text",
        "description",
      ]);
    }

    analysis["decisions"] = mergeList(arr(analysis["decisions"]), arr(a["decisions"]), [
      "title",
      "description",
    ]);
    analysis["actions"] = mergeList(arr(analysis["actions"]), arr(a["actions"]), ["description"]);
    analysis["risks"] = mergeList(arr(analysis["risks"]), arr(a["risks"]), ["description", "title"]);
    analysis["opportunities"] = mergeList(arr(analysis["opportunities"]), arr(a["opportunities"]), [
      "description",
    ]);

    const otherAgenda = obj(a["agenda_recommendation"]);
    for (const key of [
      "topics",
      "pending_decisions",
      "overdue_actions",
      "critical_risks",
      "recommended_questions",
    ]) {
      agenda[key] = mergeList(arr(agenda[key]), arr(otherAgenda[key]), []);
    }
    if (!String(agenda["objective"] ?? "").trim()) agenda["objective"] = otherAgenda["objective"] ?? "";
  }

  analysis["context_updates"] = contextUpdates;
  analysis["agenda_recommendation"] = agenda;
  return { identification, analysis };
}


/* ---------------- orquestração: chunks → análises → consolidação ---------------- */

export type MeetingAnalysisInput = z.infer<typeof analyzeInput>;

export async function runMeetingAnalysis(data: MeetingAnalysisInput) {
  // stripTactiqSummary/stripTactiqBoilerplate só afetam o texto enviado à IA:
  // a transcrição gravada e o transcriptHash (calculados no cliente, fora
  // deste arquivo) continuam com o texto original, recorte do Tactiq incluído.
  const transcriptForAi = stripTactiqBoilerplate(stripTactiqSummary(data.transcript));
  const blocks = splitTranscript(transcriptForAi).slice(0, MAX_BLOCKS);

  const consultantName = data.consultantName?.trim();

  // Data ORIGINAL do cabeçalho do Tactiq (data.transcript, não
  // transcriptForAi): usada para resolver prazos relativos ("segunda-feira",
  // "dia 16") a partir da data real da reunião, nunca da Data de hoje.
  const meetingDate = extractMeetingDateFromHeader(data.transcript);

  const header = (block: { index: number; total: number }) =>
    [
      `Data de hoje: ${new Date().toISOString().slice(0, 10)}`,
      meetingDate
        ? `Data da reunião (do cabeçalho da transcrição): ${meetingDate.iso} (${meetingDate.weekday}). Resolva TODA referência relativa de prazo (segunda-feira, semana que vem, amanhã, dia 16) a partir DESTA data, NUNCA a partir da Data de hoje.`
        : "",
      data.source
        ? `Origem da transcrição: ${data.source.type === "pdf" ? `PDF ${data.source.file_name ?? ""}` : "texto colado"}`
        : "",
      block.total > 1 ? `Este é o bloco ${block.index} de ${block.total} da transcrição.` : "",
      consultantName ? `Consultor logado (quem conduz a reunião): ${consultantName}` : "",
      consultantName
        ? "O outro falante da conversa é, em geral, o cliente (ou alguém da equipe do cliente), não outro consultor."
        : "",
      `Clientes cadastrados: ${JSON.stringify(data.clients)}`,
      `Projetos cadastrados: ${JSON.stringify(data.projects)}`,
      data.projectContext || data.currentContext
        ? `Contexto atual do projeto: ${data.projectContext ?? data.currentContext}`
        : "",
      data.openActions.length ? `Ações abertas: ${JSON.stringify(data.openActions)}` : "",
      data.overdueActions.length ? `Ações atrasadas: ${JSON.stringify(data.overdueActions)}` : "",
      data.pendingDecisions.length
        ? `Decisões pendentes: ${JSON.stringify(data.pendingDecisions)}`
        : "",
      data.activeRisks.length ? `Riscos ativos: ${JSON.stringify(data.activeRisks)}` : "",
      data.knownNames.length
        ? `Nomes já conhecidos deste cliente: ${JSON.stringify(data.knownNames)}`
        : "",
    ]
      .filter(Boolean)
      .join("\n");

  const parts: Record<string, unknown>[] = [];
  for (const block of blocks) {
    const prompt = [header(block), "", "Transcrição da reunião:", block.text].join("\n");
    parts.push(await callGateway(prompt));
  }

  // Segunda passada "o que faltou?": só em transcrição longa que coube num
  // bloco único (com mais de 1 bloco, o chunking já cobre a cobertura).
  // Só ACRESCENTA — nunca revisa os itens da primeira. consolidate() usa
  // parts[0] para identification/meeting/speaker_map (não alterado aqui);
  // zeramos esses campos no resultado da segunda chamada por garantia,
  // mesmo que a IA não siga a instrução de deixá-los vazios.
  if (shouldRunSecondPass(blocks.length, transcriptForAi.length)) {
    const startedAt = Date.now();
    const categories = ["decisions", "actions", "risks", "opportunities"] as const;
    const countsOf = () =>
      Object.fromEntries(categories.map((k) => [k, countItems(parts, k)]));
    try {
      const secondPrompt = [
        header(blocks[0]!),
        "",
        "Transcrição da reunião:",
        blocks[0]!.text,
        "",
        buildSecondPassInstruction(summarizeExtracted(parts)),
      ].join("\n");
      const before = countsOf();
      const secondResult = await callGateway(secondPrompt);
      secondResult["identification"] = {};
      const secondAnalysis = secondResult["analysis"];
      if (secondAnalysis && typeof secondAnalysis === "object" && !Array.isArray(secondAnalysis)) {
        delete (secondAnalysis as Record<string, unknown>)["meeting"];
        delete (secondAnalysis as Record<string, unknown>)["speaker_map"];
      }
      parts.push(secondResult);
      console.info("[ia] segunda passada", { before, after: countsOf(), ms: Date.now() - startedAt });
    } catch (error) {
      console.warn("[ia] segunda passada falhou, seguindo só com a primeira:", error);
    }
  }

  const mergedByKey = consolidate(parts) as {
    identification?: unknown;
    analysis?: Record<string, unknown>;
  };

  // Cópia para auditoria: mergedByKey é mutado em lugar logo abaixo (GATE 12B
  // escreve embeddings nos próprios itens, e consolidateAnalysisSemantically
  // roda em cima do mesmo objeto) — precisa ser serializado ANTES disso, ou
  // vira o mesmo dado já consolidado/reduzido, perdendo o propósito de
  // auditoria (comparar o que a IA respondeu com o que sobra depois do
  // schema Zod do cliente e da consolidação semântica).
  const rawAnalysisJson = JSON.stringify(mergedByKey);

  // GATE 12B: consolidate() acima só une blocos por CHAVE EXATA normalizada
  // — não reconhece "sair da antecipação automática" e "reduzir antecipação"
  // como o mesmo assunto (poucas palavras em comum). Por isso os embeddings
  // agora são calculados ANTES da consolidação (não depois, como no GATE
  // 12A): reaproveitando a MESMA chamada única a getEmbeddings que já
  // existia para decisions/actions/risks/opportunities, só que estendida
  // para também cobrir os itens de context_updates (objectives...next_steps)
  // — zero chamadas extras ao provedor na imensa maioria dos casos, já que
  // o texto total de uma reunião típica fica bem abaixo do MAX_BATCH=96 de
  // embeddings.server.ts (ver relatório do GATE 12B, Fase 1/12).
  //
  // Os embeddings de context_updates são só TEMPORÁRIOS: usados em memória
  // por consolidateAnalysisSemantically para decidir o que é o mesmo
  // assunto, e removidos antes deste JSON ser devolvido — nunca são
  // persistidos em project_context (sem migration, sem novo campo no banco).
  const rawAnalysis = mergedByKey.analysis ?? {};
  const rawContext = (rawAnalysis["context_updates"] as Record<string, unknown>) ?? {};

  const CONTEXT_LISTS_FOR_EMBEDDING = [
    "objectives",
    "problems",
    "root_causes",
    "priorities",
    "hypotheses",
    "constraints",
    "results",
    "next_steps",
  ] as const;

  const contextArrays: Record<string, Record<string, unknown>[]> = {};
  for (const key of CONTEXT_LISTS_FOR_EMBEDDING) {
    contextArrays[key] = Array.isArray(rawContext[key])
      ? (rawContext[key] as Record<string, unknown>[])
      : [];
  }

  const decisionsOut = Array.isArray(rawAnalysis["decisions"]) ? (rawAnalysis["decisions"] as Record<string, unknown>[]) : [];
  const actionsOut = Array.isArray(rawAnalysis["actions"]) ? (rawAnalysis["actions"] as Record<string, unknown>[]) : [];
  const risksOut = Array.isArray(rawAnalysis["risks"]) ? (rawAnalysis["risks"] as Record<string, unknown>[]) : [];
  const opportunitiesOut = Array.isArray(rawAnalysis["opportunities"])
    ? (rawAnalysis["opportunities"] as Record<string, unknown>[])
    : [];

  // Uma única lista de textos, uma única chamada a getEmbeddings — a ordem
  // aqui só precisa bater com a ordem em que os vetores são escritos de volta abaixo.
  const embeddingTexts: string[] = [];
  for (const key of CONTEXT_LISTS_FOR_EMBEDDING) {
    for (const item of contextArrays[key]!) embeddingTexts.push(String(item["content"] ?? ""));
  }
  embeddingTexts.push(...decisionsOut.map((d) => String(d["title"] ?? "")));
  embeddingTexts.push(...actionsOut.map((a) => String(a["description"] ?? "")));
  embeddingTexts.push(...risksOut.map((r) => String(r["description"] ?? "")));
  embeddingTexts.push(...opportunitiesOut.map((o) => String(o["description"] ?? "")));

  // Nunca lança exceção: falha aqui só significa que a consolidação
  // semântica cai automaticamente para lexical-only (combinedSimilarity já
  // trata embedding nulo) e o dedupe seguinte cai no método por texto —
  // comportamento de fallback que já existia antes do GATE 12.
  const vectors = await getEmbeddings(embeddingTexts).catch(() => embeddingTexts.map(() => null));
  let cursor = 0;
  for (const key of CONTEXT_LISTS_FOR_EMBEDDING) {
    for (const item of contextArrays[key]!) item["__embedding"] = vectors[cursor++] ?? null;
  }
  for (const d of decisionsOut) d["embedding"] = vectors[cursor++] ?? null;
  for (const a of actionsOut) a["embedding"] = vectors[cursor++] ?? null;
  for (const r of risksOut) r["embedding"] = vectors[cursor++] ?? null;
  for (const o of opportunitiesOut) o["embedding"] = vectors[cursor++] ?? null;

  const analysisWithEmbeddings: Record<string, unknown> = {
    ...rawAnalysis,
    context_updates: { ...rawContext, ...contextArrays },
    decisions: decisionsOut,
    actions: actionsOut,
    risks: risksOut,
    opportunities: opportunitiesOut,
  };

  const { result: consolidated, quality, semantic } = consolidateAnalysisSemantically({
    identification: mergedByKey.identification,
    analysis: analysisWithEmbeddings,
  }) as {
    result: { identification?: unknown; analysis?: Record<string, unknown> };
    quality: ReturnType<typeof consolidateAnalysisSemantically>["quality"];
    semantic: ReturnType<typeof consolidateAnalysisSemantically>["semantic"];
  };

  const analysisOut = consolidated.analysis ?? {};
  analysisOut["execution_quality"] = quality;
  analysisOut["semantic_consolidation"] = semantic;

  // Garantia no código: o prompt já instrui a IA a anular as duas notas com
  // falante único, mas isso não é obedecido de forma confiável. A detecção
  // usa a transcrição ORIGINAL (data.transcript), não transcriptForAi.
  const guarded = applySingleSpeakerGuard(consolidated as Record<string, unknown>, data.transcript);

  return { json: JSON.stringify(guarded), blocks: blocks.length, rawAnalysisJson };
}
