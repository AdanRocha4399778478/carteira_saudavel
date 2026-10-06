/**
 * ERP oficial da Resultados S/A em 3 niveis: area > subarea > item (terceiro nivel).
 * Gerado a partir do documento "ERP - Sumario detalhado.docx".
 * Ajustes aplicados na conversao (decididos pelo dono):
 *  - 3 linhas de TI digitadas como subarea viraram itens de "Gestao de Redes e Conectividade";
 *  - subarea "Outros" acrescentada nas areas que nao a tinham;
 *  - o texto-lista de "Outros" (Marketing, Financeiro, Projetos) virou "descricao", nao item;
 *  - 1 item repetido em Administrativo removido.
 * A ordem das areas e subareas e a do documento (a subarea "Outros" fica por ultimo).
 */
export type ErpSubarea = {
  readonly nome: string;
  readonly itens: readonly string[];
  /** Texto de apoio (ex.: o que cabe em "Outros"); nao e um item selecionavel. */
  readonly descricao?: string;
};

export type ErpArea = { readonly area: string; readonly subareas: readonly ErpSubarea[] };

export const ERP_OFICIAL: readonly ErpArea[] = [
  {
    area: "Pessoas",
    subareas: [
      {
        nome: "Recrutamento e Seleção",
        itens: [
          "Análise de necessidades e descrição de cargos",
          "Estratégias de recrutamento (interno, externo, indicações)",
          "Triagem de currículos e testes iniciais",
          "Entrevistas de seleção",
          "Avaliação de competências (testes psicométricos, dinâmicas e estudos de caso)",
          "Verificação de referências",
          "Oferta, negociação e integração (onboarding)",
          "Análise e melhoria contínua do processo",
        ],
      },
      {
        nome: "Integração (Onboarding)",
        itens: [
          "Programas de boas-vindas e trilha de integração",
          "Manual do colaborador e apresentação da cultura organizacional",
          "Acompanhamento do desempenho inicial",
        ],
      },
      {
        nome: "Gestão de Benefícios",
        itens: [
          "Planos de saúde, odontológico, vale-alimentação, vale-transporte",
          "Seguro de vida, convênios e benefícios flexíveis",
          "Comunicação e adesão aos benefícios",
        ],
      },
      {
        nome: "Folha de Pagamento e Controle de Frequência",
        itens: [
          "Cálculo de salários, encargos e benefícios",
          "Gestão de ponto eletrônico e banco de horas",
          "Férias, 13º salário e obrigações trabalhistas",
        ],
      },
      {
        nome: "Treinamento e Desenvolvimento",
        itens: [
          "Levantamento de necessidades de treinamento",
          "Desenvolvimento de trilhas de aprendizagem, cursos, workshops e e-learning",
          "Avaliação de impacto e indicadores de efetividade",
        ],
      },
      {
        nome: "Desenvolvimento Organizacional",
        itens: [
          "Programas de engajamento e cultura",
          "Análise de clima organizacional",
          "Revisão de estrutura e processos",
        ],
      },
      {
        nome: "Gestão de Conflitos",
        itens: [
          "Políticas de relacionamento interpessoal",
          "Mediação e resolução de conflitos",
          "Canais de denúncia",
        ],
      },
      {
        nome: "Cultura Organizacional",
        itens: [
          "Definição de valores e comportamentos esperados",
          "Comunicação interna e eventos corporativos",
          "Programas de reconhecimento e valores",
        ],
      },
      {
        nome: "Estrutura de Cargos e Planos de Carreira",
        itens: [
          "Descrição de cargos, níveis e trilhas de carreira",
          "Faixas salariais e políticas de promoção",
        ],
      },
      {
        nome: "Retenção de Talentos",
        itens: [
          "Programas de reconhecimento e recompensa",
          "Desenvolvimento de carreira e feedback contínuo",
          "Pesquisa de satisfação e planos de sucessão",
        ],
      },
      {
        nome: "Outros",
        itens: [],
      },
    ],
  },
  {
    area: "Comercial",
    subareas: [
      {
        nome: "Gestão de Pipeline",
        itens: [
          "Definição de etapas do funil (prospecção, qualificação, proposta, negociação, fechamento)",
          "Priorização e acompanhamento de oportunidades",
          "Ferramentas de CRM e KPIs (taxa de conversão, tempo de ciclo, valor médio)",
        ],
      },
      {
        nome: "Planejamento Estratégico de Vendas",
        itens: [
          "Definição de objetivos de vendas e metas (SMART, alinhadas à estratégia)",
          "Análise de mercado e concorrência",
          "Segmentação de clientes/público-alvo",
          "Estratégias de abordagem (inbound/outbound) e canais de aquisição",
          "Definição de indicadores (KPIs) e dashboards",
          "Integração com marketing e revisão contínua",
        ],
      },
      {
        nome: "Prospecção de Clientes",
        itens: [
          "Definição de público-alvo e ICP",
          "Estratégias de prospecção (telefone, e-mail, social selling, eventos)",
          "Uso de scripts e cadências de contato",
          "Técnicas de geração de leads (inbound/outbound, SDR/BDR)",
          "Ferramentas de automação, CRM e LinkedIn",
          "Criação de conteúdo para prospecção e participação em eventos",
          "Métricas de conversão e qualificação",
        ],
      },
      {
        nome: "Atendimento ao Cliente",
        itens: [
          "Canais de atendimento (telefone, e-mail, chat, presencial)",
          "Escuta ativa e resolução de problemas",
          "Programas de fidelização e pós-venda",
        ],
      },
      {
        nome: "Negociação e Fechamento",
        itens: [
          "Técnicas de negociação e contorno de objeções",
          "Apresentação de propostas e condições comerciais",
          "Formalização e assinatura de contratos",
        ],
      },
      {
        nome: "Gestão de Carteira de Clientes",
        itens: [
          "Segmentação e priorização da carteira",
          "Upselling e cross-selling",
          "Relacionamento contínuo e retenção",
        ],
      },
      {
        nome: "Treinamento de Vendas e Gestão de Equipe",
        itens: [
          "Capacitação em produtos e técnicas de vendas",
          "Coaching e acompanhamento de performance",
        ],
      },
      {
        nome: "Gestão de Relacionamento com o Cliente (CRM)",
        itens: [
          "Registro de interações e histórico de compras",
          "Personalização de ofertas e comunicação",
        ],
      },
      {
        nome: "Gestão de Preços e Propostas",
        itens: [
          "Definição de políticas de preços, descontos e promoções",
          "Estratégias de precificação de valor",
        ],
      },
      {
        nome: "Análise de Desempenho",
        itens: [
          "KPIs de vendas, churn, ciclo de vendas e forecasting",
          "Relatórios e melhoria contínua",
        ],
      },
      {
        nome: "Outros",
        itens: [],
      },
    ],
  },
  {
    area: "Operações",
    subareas: [
      {
        nome: "Planejamento Operacional",
        itens: [
          "Análise de recursos (humanos, financeiros e materiais)",
          "Definição de objetivos e metas operacionais",
          "Elaboração de planos de ação e cronogramas",
          "Alocação de recursos e gestão de riscos",
          "Comunicação e monitoramento; benefícios como eficiência e redução de custos",
        ],
      },
      {
        nome: "Gestão de Produção",
        itens: [
          "Planejamento e previsão de demanda",
          "Ajuste de capacidade e layout industrial",
          "Controle de produção (OEE, desperdícios) e melhoria contínua (Lean, Kaizen)",
        ],
      },
      {
        nome: "Gestão de Estoque",
        itens: [
          "Controle de inventário e níveis de estoque (FIFO/LIFO)",
          "Previsão de demanda e inventário rotativo",
          "Otimização de armazenagem e redução de desperdícios",
        ],
      },
      {
        nome: "Gestão de Fornecedores",
        itens: [
          "Seleção, avaliação e contratos",
          "Negociação de preços e condições",
          "Parcerias estratégicas e desenvolvimento de fornecedores",
        ],
      },
      {
        nome: "Manutenção de Equipamentos",
        itens: [
          "Planos de manutenção preventiva, corretiva e preditiva",
          "Gestão de peças sobressalentes e confiabilidade",
        ],
      },
      {
        nome: "Gestão de Processos",
        itens: [
          "Mapeamento, padronização e melhoria contínua (BPM)",
        ],
      },
      {
        nome: "Entrega de Produtos e Serviços",
        itens: [
          "Planejamento de logística e distribuição",
          "SLAs de entrega e qualidade",
        ],
      },
      {
        nome: "Controle de Custos",
        itens: [
          "Identificação de custos diretos e indiretos",
          "Redução de desperdícios e otimização de recursos",
        ],
      },
      {
        nome: "Gestão de Segurança e Meio Ambiente",
        itens: [
          "Programas de segurança do trabalho e normas NR",
          "Gestão de resíduos e emissões",
        ],
      },
      {
        nome: "Controle de Qualidade, Capacidade e Inovação Operacional",
        itens: [
          "Inspeção, testes e indicadores de qualidade",
          "Gestão de capacidade, escalabilidade e inovação tecnológica",
          "Indicadores operacionais (OEE, lead time, OTIF), compliance e regulamentos",
        ],
      },
      {
        nome: "Outros",
        itens: [],
      },
    ],
  },
  {
    area: "Marketing",
    subareas: [
      {
        nome: "Planejamento de Estratégia",
        itens: [
          "Análise de ambiente interno e externo (SWOT, PESTEL, 5 Forças)",
          "Definição de missão, visão, valores e objetivos de longo prazo",
          "Desenvolvimento de estratégias competitivas e posicionamento",
          "Alocação de recursos e elaboração de planos de ação (4P/7P)",
          "Monitoramento de KPIs e utilização de ferramentas tecnológicas",
        ],
      },
      {
        nome: "Criação de Conteúdo",
        itens: [
          "Planejamento editorial para blogs, mídias sociais, vídeos e e-books",
          "Storytelling, copywriting e SEO",
          "Produção multimídia e calendário de publicações",
          "Análise de engajamento e métricas",
        ],
      },
      {
        nome: "Marketing Digital",
        itens: [
          "SEO/SEM, redes sociais (orgânico e pago) e e-mail marketing",
          "Automação de marketing e funil inbound",
          "Mídia programática e analytics",
        ],
      },
      {
        nome: "Gestão da Marca (Branding)",
        itens: [
          "Posicionamento e identidade visual (logo, cores, tom de voz)",
          "Arquitetura de marcas e guidelines",
          "Gestão de reputação e experiência de marca",
        ],
      },
      {
        nome: "Pesquisa de Mercado",
        itens: [
          "Pesquisas qualitativas e quantitativas",
          "Análise de personas, tendências de mercado e concorrência",
          "Ferramentas de pesquisa (surveys, focus groups)",
        ],
      },
      {
        nome: "Marketing Offline",
        itens: [
          "Mídia tradicional (TV, rádio, impresso)",
          "Eventos, feiras, marketing de guerrilha e OOH",
        ],
      },
      {
        nome: "Publicidade e Promoções",
        itens: [
          "Campanhas publicitárias e planejamento de mídia",
          "Promoções de vendas, programas de fidelidade, parcerias e patrocínios",
        ],
      },
      {
        nome: "Gestão de Orçamentos",
        itens: [
          "Planejamento e controle de custos",
          "Cálculo de ROI de campanhas",
          "Forecasting e alocação de recursos",
        ],
      },
      {
        nome: "Gestão de Parcerias",
        itens: [
          "Co-marketing, eventos colaborativos e canais de distribuição",
        ],
      },
      {
        nome: "Outros",
        descricao: "Análise de Desempenho, Desenvolvimento de Novos Produtos ou Serviços, Relacionamento com Imprensa, Segmentação e Personalização, Reputação Online, Gestão de Influenciadores",
        itens: [],
      },
    ],
  },
  {
    area: "Financeiro",
    subareas: [
      {
        nome: "Fluxo de Caixa",
        itens: [
          "Planejamento e projeção de receitas/despesas",
          "Monitoramento diário de entradas e saídas",
          "Análise do ciclo de caixa e gestão de prazos de pagamento/recebimento",
          "Controle de picos de pagamento e recebimento, reservas e fundos",
          "Ferramentas de gestão e indicadores (capital de giro, saldo médio)",
        ],
      },
      {
        nome: "Contas a Pagar",
        itens: [
          "Processamento, aprovação e programação de despesas",
          "Negociação de prazos e condições",
          "Controle de fornecedores e relatórios",
        ],
      },
      {
        nome: "Contas a Receber",
        itens: [
          "Emissão de notas fiscais e faturas",
          "Políticas de crédito e cobrança",
          "Negociação com clientes",
        ],
      },
      {
        nome: "Conciliação Bancária",
        itens: [
          "Conferência de extratos e saldos",
          "Ajustes e lançamentos",
          "Identificação de irregularidades",
        ],
      },
      {
        nome: "Orçamento",
        itens: [
          "Planejamento orçamentário anual e revisões",
          "Acompanhamento de receitas e despesas",
          "Controle e ajustes",
        ],
      },
      {
        nome: "Análise Financeira",
        itens: [
          "Demonstrações financeiras (DRE, Balanço, DFC)",
          "Indicadores de liquidez, rentabilidade e alavancagem",
          "Análise de custos e margens",
        ],
      },
      {
        nome: "Investimentos",
        itens: [
          "Avaliação de oportunidades (TIR, payback)",
          "Tesouraria e aplicações de curto prazo",
          "Gerenciamento de riscos e capital de expansão",
        ],
      },
      {
        nome: "Tributos e Obrigações Fiscais",
        itens: [
          "Planejamento tributário e cumprimento de obrigações",
          "Escrituração e monitoramento de legislação",
        ],
      },
      {
        nome: "Contabilidade Gerencial",
        itens: [
          "Contabilidade de custos e resultados por centro de custo",
          "Análises de variações e relatórios gerenciais",
        ],
      },
      {
        nome: "Dívidas e Financiamentos",
        itens: [
          "Gestão de dívidas (curto e longo prazo)",
          "Negociação com instituições financeiras e garantias",
        ],
      },
      {
        nome: "Outros",
        descricao: "Relatórios financeiros, compliance e auditoria, controle de custos, capital de giro, relacionamento com bancos e instituições",
        itens: [],
      },
    ],
  },
  {
    area: "Estratégia",
    subareas: [
      {
        nome: "Gestão de Implementação",
        itens: [
          "Planejamento de projetos estratégicos e alocação de recursos",
          "Monitoramento de execução e comunicação com stakeholders",
        ],
      },
      {
        nome: "Análise de Mercado e Concorrência",
        itens: [
          "Estudos de setor e forças competitivas (Porter)",
          "Benchmarking e inteligência de mercado",
          "Identificação de oportunidades e ameaças",
        ],
      },
      {
        nome: "Planejamento Estratégico",
        itens: [
          "Definição de objetivos comuns e metas",
          "Mapeamento de processos e responsabilidades",
          "Foco no cliente e integração entre áreas",
          "Uso de ferramentas de gestão (BSC, OKRs)",
          "Equipes multidisciplinares, gestão de conflitos, liderança colaborativa",
        ],
      },
      {
        nome: "Análise Financeira",
        itens: [
          "Viabilidade econômica e análise de investimentos",
          "Avaliação de riscos e cenários",
        ],
      },
      {
        nome: "Expansão e Novos Mercados",
        itens: [
          "Estudos de potencial de mercado e estratégias de entrada",
          "Parcerias, franquias e regulamentação",
        ],
      },
      {
        nome: "Desenvolvimento e Inovação de Modelos de Negócio",
        itens: [
          "Revisão da proposta de valor e monetização",
          "Inovação de modelos (plataformas, assinaturas)",
        ],
      },
      {
        nome: "Gestão de Iniciativas e Portfólio",
        itens: [
          "Priorização e acompanhamento de projetos estratégicos",
          "Gestão de stakeholders e Balanced Scorecard",
        ],
      },
      {
        nome: "Propostas de Valor",
        itens: [
          "Criação, diferenciação e comunicação de valor",
          "Alinhamento com o público-alvo",
        ],
      },
      {
        nome: "Cultura Organizacional Alinhada",
        itens: [
          "Programas de mudança e engajamento",
          "Comunicação de valores e comportamentos",
        ],
      },
      {
        nome: "Análise de Desempenho",
        itens: [
          "KPIs, OKRs e relatórios de performance",
          "Revisão de estratégias e correção de rumos",
        ],
      },
      {
        nome: "Gestão de Riscos",
        itens: [
          "Identificação, avaliação e mitigação de riscos",
          "Planos de contingência e compliance",
        ],
      },
      {
        nome: "Inovação de Estratégia e Pensamento Disruptivo",
        itens: [
          "Incentivo à criatividade e exploração de tecnologias emergentes",
        ],
      },
      {
        nome: "Fusões, Aquisições e Parcerias",
        itens: [
          "Due diligence, integração e geração de sinergias",
        ],
      },
      {
        nome: "Análise de Sustentabilidade e Responsabilidade Social",
        itens: [
          "Práticas ESG e relatórios de sustentabilidade",
        ],
      },
      {
        nome: "Relacionamento com Stakeholders",
        itens: [
          "Mapeamento, comunicação e gestão de expectativas",
        ],
      },
      {
        nome: "Outros",
        itens: [],
      },
    ],
  },
  {
    area: "Inovação e Pesquisas",
    subareas: [
      {
        nome: "Desenvolvimento de Novos Produtos e Serviços",
        itens: [
          "Identificação de necessidades de mercado e geração de ideias",
          "Seleção, planejamento e prototipagem",
          "Validação, testes e lançamento",
        ],
      },
      {
        nome: "Gestão de Projetos de Inovação",
        itens: [
          "Metodologias (Design Thinking, Stage-Gate)",
          "Priorização, cronogramas e indicadores",
        ],
      },
      {
        nome: "Pesquisa de Mercado",
        itens: [
          "Identificação de tendências e oportunidades",
          "Benchmarking e estudos de viabilidade",
        ],
      },
      {
        nome: "Identificação de Oportunidades de Inovação",
        itens: [
          "Análise interna e externa (PESTEL, SWOT)",
          "Engajamento de colaboradores (workshops, sugestões)",
          "Big Data e analytics",
          "Foco no cliente e exploração de tecnologias emergentes",
          "Estudo de tendências e cenários, co-criação com stakeholders",
          "Análise de viabilidade e experimentação",
        ],
      },
      {
        nome: "Cultura de Inovação",
        itens: [
          "Políticas de incentivo e hackathons",
          "Espaços de inovação e governança",
        ],
      },
      {
        nome: "Parcerias com Instituições de Pesquisa",
        itens: [
          "Cooperação com universidades e centros de pesquisa",
          "Desenvolvimento conjunto e transferências de tecnologia",
        ],
      },
      {
        nome: "Gestão de Propriedade Intelectual",
        itens: [
          "Patentes, marcas e direitos autorais",
          "Proteção e licenciamento",
        ],
      },
      {
        nome: "Captação de Recursos para Inovação",
        itens: [
          "Editais, incentivos fiscais e capital de risco",
        ],
      },
      {
        nome: "Monitoramento e Avaliação de Resultados",
        itens: [
          "Métricas de inovação e retorno sobre investimento",
        ],
      },
      {
        nome: "Sustentabilidade e Inovação Social",
        itens: [
          "Projetos com impacto socioambiental positivo",
        ],
      },
      {
        nome: "Implementação de Tecnologias Disruptivas",
        itens: [
          "IA, blockchain, IoT, realidade aumentada e virtual",
        ],
      },
      {
        nome: "Análise de Viabilidade e Retorno sobre Investimento",
        itens: [
          "Modelagem financeira e avaliação de riscos",
        ],
      },
      {
        nome: "Inovação de Modelos de Negócio",
        itens: [
          "Plataformas digitais, modelos de assinatura e transformação digital",
        ],
      },
      {
        nome: "Outros",
        itens: [],
      },
    ],
  },
  {
    area: "Jurídica",
    subareas: [
      {
        nome: "Assessoria e Consultoria",
        itens: [
          "Suporte jurídico interno para contratos, compliance e processos",
          "Pareceres e orientações para outras áreas",
        ],
      },
      {
        nome: "Gestão de Contratos",
        itens: [
          "Elaboração, revisão, negociação e arquivamento de contratos",
          "Controle de prazos e obrigações",
        ],
      },
      {
        nome: "Gestão de Contencioso e Processos Judiciais",
        itens: [
          "Acompanhamento de processos, prazos e audiências",
          "Negociação de acordos e interface com escritórios externos",
        ],
      },
      {
        nome: "Compliance e Conformidade Legal",
        itens: [
          "Monitoramento de legislação e normativos",
          "Programas de ética, anticorrupção e políticas internas",
        ],
      },
      {
        nome: "Gestão de Riscos Legais",
        itens: [
          "Identificação e mitigação de riscos trabalhistas, fiscais e ambientais",
          "Planos de contingência e controles internos",
        ],
      },
      {
        nome: "Direito Trabalhista e Relações com Colaboradores",
        itens: [
          "Legislação trabalhista, CCTs, demissões e acordos",
          "Relações sindicais e políticas de RH",
        ],
      },
      {
        nome: "Direito Tributário e Fiscal",
        itens: [
          "Planejamento tributário e obrigações acessórias",
          "Consultoria sobre legislação de impostos",
        ],
      },
      {
        nome: "Direito Societário",
        itens: [
          "Constituição e alteração de sociedades",
          "Governança corporativa e acordos de sócios",
        ],
      },
      {
        nome: "Propriedade Intelectual",
        itens: [
          "Registro de marcas, patentes e proteção de know-how",
        ],
      },
      {
        nome: "Direito Ambiental",
        itens: [
          "Licenciamento, gestão de resíduos e compliance ambiental",
        ],
      },
      {
        nome: "Elaboração e Revisão de Políticas Internas",
        itens: [
          "Códigos de ética, manuais e regimentos internos",
        ],
      },
      {
        nome: "Mediação e Arbitragem",
        itens: [
          "Métodos alternativos de resolução de conflitos e cláusulas contratuais",
        ],
      },
      {
        nome: "Licitação e Contratos Públicos",
        itens: [
          "Participação em licitações e gestão de contratos públicos",
        ],
      },
      {
        nome: "Proteção de Dados e Privacidade",
        itens: [
          "Adequação à LGPD, políticas de privacidade e gestão de dados",
        ],
      },
      {
        nome: "Treinamento e Capacitação Jurídica",
        itens: [
          "Cursos, workshops e atualização legislativa",
        ],
      },
      {
        nome: "Outros",
        itens: [],
      },
    ],
  },
  {
    area: "Logística e Suprimentos",
    subareas: [
      {
        nome: "Gestão de Almoxarifado",
        itens: [
          "Organização de estoque, layout e logística interna",
          "Recebimento, expedição e controle de inventário",
        ],
      },
      {
        nome: "Gestão de Compras e Suprimentos",
        itens: [
          "Planejamento de compras (necessidades, previsão e prioridades)",
          "Seleção e avaliação de fornecedores e processos de aquisição",
          "Negociação de preços, prazos e condições",
          "Sustentabilidade e responsabilidade nas compras",
          "Gestão de riscos de abastecimento e análise de desempenho",
          "Uso de tecnologias (ERP, Big Data, e-procurement)",
        ],
      },
      {
        nome: "Gestão de Estoque",
        itens: [
          "Níveis de estoque e modelos de reposição (MRP, Just-in-time)",
          "Previsão de demanda, contagem física e inventário",
          "Otimização de armazenagem e redução de desperdícios",
        ],
      },
      {
        nome: "Gestão de Transporte",
        itens: [
          "Planejamento de rotas e gestão de frota",
          "Fretes, contratos e monitoramento de entregas",
          "Indicadores de tempo, custo e qualidade",
        ],
      },
      {
        nome: "Gestão de Distribuição",
        itens: [
          "Centros de distribuição, cross-docking e last mile delivery",
          "Integração com canais de vendas",
        ],
      },
      {
        nome: "Gestão de Custos Logísticos",
        itens: [
          "Cálculo de custos de transporte e armazenagem",
          "Otimização e análise de rentabilidade",
        ],
      },
      {
        nome: "Gestão de Demandas e Previsões",
        itens: [
          "Ferramentas de forecasting e ajuste de produção",
        ],
      },
      {
        nome: "Automatização e Sistemas de Gestão",
        itens: [
          "WMS, TMS, ERP, RFID, IoT e automação de armazéns",
        ],
      },
      {
        nome: "Gestão de Riscos Logísticos",
        itens: [
          "Identificação de interrupções e acidentes",
          "Planos de contingência e seguros",
        ],
      },
      {
        nome: "Análise e Otimização de Processos Logísticos",
        itens: [
          "Mapeamento, indicadores de eficiência e melhoria contínua",
        ],
      },
      {
        nome: "Compliance e Normas Regulatórias",
        itens: [
          "Legislação de transporte, armazenamento e normas sanitárias",
        ],
      },
      {
        nome: "Parcerias Logísticas",
        itens: [
          "3PL, 4PL e colaboração com fornecedores e clientes",
        ],
      },
      {
        nome: "Sustentabilidade e Responsabilidade Ambiental",
        itens: [
          "Logística reversa, emissões e embalagens sustentáveis",
        ],
      },
      {
        nome: "Coordenação entre Setores",
        itens: [
          "Integração logística com vendas, produção e compras",
        ],
      },
      {
        nome: "Monitoramento e Gestão de Desempenho",
        itens: [
          "KPIs, relatórios e dashboards",
        ],
      },
      {
        nome: "Outros",
        itens: [],
      },
    ],
  },
  {
    area: "Projetos",
    subareas: [
      {
        nome: "Planejamento de Projetos",
        itens: [
          "Definição de escopo, objetivos e entregáveis",
          "Cronograma (WBS, Gantt) e orçamento",
          "Seleção de metodologias (Waterfall, Agile)",
        ],
      },
      {
        nome: "Gerenciamento de Recursos",
        itens: [
          "Alocação de equipe, materiais e orçamento",
          "Aquisição e gestão de fornecedores de projeto",
        ],
      },
      {
        nome: "Execução e Acompanhamento",
        itens: [
          "Implementação das atividades, sprints e status reports",
          "Comunicação com stakeholders e ajustes de cronograma",
          "Atualização de informações para acompanhamento",
        ],
      },
      {
        nome: "Gestão de Riscos",
        itens: [
          "Identificação, análise e mitigação de riscos",
          "Monitoramento contínuo",
        ],
      },
      {
        nome: "Controle de Qualidade",
        itens: [
          "Planejamento, garantia e auditorias de qualidade",
          "Lições aprendidas e melhoria contínua",
        ],
      },
      {
        nome: "Gestão de Escopo e Mudanças",
        itens: [
          "Controle de solicitações de mudança",
          "Avaliação de impacto e aprovação",
        ],
      },
      {
        nome: "Ferramentas e Metodologias de Gerenciamento",
        itens: [
          "PMBOK, PRINCE2, Scrum, Kanban",
          "MS Project, Jira, Trello, Asana",
        ],
      },
      {
        nome: "Gerenciamento de Stakeholders",
        itens: [
          "Identificação e engajamento de partes interessadas",
          "Plano de comunicação e negociação",
        ],
      },
      {
        nome: "Outros",
        descricao: "Encerramento de projetos, gestão de cronogramas, orçamento e custos, integração entre áreas, projetos de inovação e capacitação de equipes",
        itens: [],
      },
    ],
  },
  {
    area: "Qualidade",
    subareas: [
      {
        nome: "Implementação de Sistemas de Gestão da Qualidade",
        itens: [
          "Diagnóstico do estado atual e definição de objetivos",
          "Engajamento da liderança e documentação de processos",
          "Treinamento e capacitação",
          "Ações corretivas, melhoria contínua, controle e monitoramento",
          "Auditorias e certificação, integração com outros sistemas e benefícios",
        ],
      },
      {
        nome: "Controle de Qualidade de Produtos e Serviços",
        itens: [
          "Inspeção e testes (físicos, químicos, funcionais)",
          "Definição de padrões e tolerâncias",
          "Monitoramento de indicadores e padronização de procedimentos",
        ],
      },
      {
        nome: "Monitoramento e Controle de Processos",
        itens: [
          "Indicadores de processo, sistema de medição e análises estatísticas",
        ],
      },
      {
        nome: "Certificação de Qualidade",
        itens: [
          "Normas ISO (9001, 14001, 45001) e auditorias internas/externas",
        ],
      },
      {
        nome: "Gestão de Não Conformidades",
        itens: [
          "Identificação, registro, análise de causa raiz e plano de ação",
        ],
      },
      {
        nome: "Gestão de Melhoria Contínua",
        itens: [
          "Programas Kaizen, PDCA e círculos de qualidade",
        ],
      },
      {
        nome: "Treinamento e Capacitação",
        itens: [
          "Qualificação e reciclagem de colaboradores",
        ],
      },
      {
        nome: "Gestão de Reclamações e Satisfação do Cliente",
        itens: [
          "Recepção, classificação e resposta a reclamações",
          "Monitoramento de satisfação e melhoria de serviços",
        ],
      },
      {
        nome: "Padronização e Documentação",
        itens: [
          "Procedimentos operacionais padrão (POPs) e registros de qualidade",
        ],
      },
      {
        nome: "Auditorias de Qualidade",
        itens: [
          "Auditorias internas e externas com planos de ação",
        ],
      },
      {
        nome: "Sustentabilidade e Qualidade",
        itens: [
          "Ecoeficiência e compliance ambiental",
        ],
      },
      {
        nome: "Análise de Custo da Qualidade",
        itens: [
          "Custos de falhas internas e externas, prevenção e avaliação",
        ],
      },
      {
        nome: "Segurança e Qualidade no Trabalho",
        itens: [
          "Programas de segurança (EPI, ergonomia)",
        ],
      },
      {
        nome: "Inovação e Qualidade",
        itens: [
          "Novas tecnologias e automação para controle de qualidade",
        ],
      },
      {
        nome: "Outros",
        itens: [],
      },
    ],
  },
  {
    area: "Sustentabilidade",
    subareas: [
      {
        nome: "Planejamento de Sustentabilidade",
        itens: [
          "Diagnóstico de práticas atuais, definição de metas e benchmarking ESG",
          "Planos de ação para redução de impactos e eficiência",
          "Engajamento de stakeholders",
        ],
      },
      {
        nome: "Responsabilidade Social",
        itens: [
          "Programas de voluntariado e inclusão social",
          "Diversidade, equidade e apoio comunitário",
        ],
      },
      {
        nome: "Gestão de Emissões de Gases de Efeito Estufa",
        itens: [
          "Inventário de emissões e estratégias de redução",
          "Compensação de carbono e relatórios",
        ],
      },
      {
        nome: "Sustentabilidade nos Suprimentos",
        itens: [
          "Critérios de sustentabilidade para fornecedores e cadeia",
          "Logística reversa e compras responsáveis",
        ],
      },
      {
        nome: "Inovação e Eficiência Energética",
        itens: [
          "Tecnologias de baixo consumo e energias renováveis",
          "Otimização de consumo energético",
        ],
      },
      {
        nome: "Compliance e Conformidade Ambiental",
        itens: [
          "Legislação ambiental, licenciamento e certificações",
        ],
      },
      {
        nome: "Gestão de Impactos Ambientais",
        itens: [
          "Avaliação de impactos e planos de mitigação",
          "Monitoramento contínuo",
        ],
      },
      {
        nome: "Desenvolvimento de Políticas Sustentáveis",
        itens: [
          "Políticas internas e compromissos públicos (Pacto Global)",
        ],
      },
      {
        nome: "Relatório de Sustentabilidade",
        itens: [
          "Padrões GRI e indicadores ESG",
          "Transparência e prestação de contas",
        ],
      },
      {
        nome: "Economia Circular",
        itens: [
          "Redução, reutilização, reciclagem e design circular",
          "Parcerias para logística reversa",
        ],
      },
      {
        nome: "Educação e Conscientização Ambiental",
        itens: [
          "Programas de treinamento e campanhas de sensibilização",
        ],
      },
      {
        nome: "Sustentabilidade Financeira",
        itens: [
          "Financiamento de projetos sustentáveis e avaliação de riscos ESG",
        ],
      },
      {
        nome: "Engajamento com Clientes",
        itens: [
          "Comunicação de práticas sustentáveis e produtos verdes",
        ],
      },
      {
        nome: "Inovação Sustentável",
        itens: [
          "Desenvolvimento de produtos sustentáveis e modelos circulares",
        ],
      },
      {
        nome: "Atuação em Redes e Certificações",
        itens: [
          "Participação em iniciativas (CDP, Pacto Global) e certificações (B Corp)",
        ],
      },
      {
        nome: "Outros",
        itens: [],
      },
    ],
  },
  {
    area: "Tecnologia da Informação",
    subareas: [
      {
        nome: "Gestão de Software e Aplicações",
        itens: [
          "Desenvolvimento, aquisição e manutenção de softwares",
          "Governança de sistemas e gestão de licenças",
        ],
      },
      {
        nome: "Segurança da Informação",
        itens: [
          "Políticas de segurança, proteção contra ameaças e gestão de acessos",
          "Criptografia, backups e conscientização de usuários",
          "Planos de resposta a incidentes e compliance (LGPD, PCI)",
        ],
      },
      {
        nome: "Gestão de Infraestrutura de TI",
        itens: [
          "Planejamento de requisitos, arquitetura escalável e orçamento",
          "Implementação (seleção de hardware, configuração, testes)",
          "Monitoramento com ferramentas, alertas e logs",
          "Gestão de redes (configuração, segurança e otimização)",
          "Gestão de armazenamento (SAN/NAS/cloud) e segurança de infraestrutura",
          "Manutenção preventiva, suporte técnico e automação de scripts",
          "Escalabilidade, inovação e migração para cloud",
        ],
      },
      {
        nome: "Suporte Técnico e Help Desk",
        itens: [
          "Estrutura de níveis de suporte e SLAs",
          "Ferramentas de ITSM e gestão de chamados",
          "Base de conhecimento e treinamento de usuários",
        ],
      },
      {
        nome: "Automação de Processos",
        itens: [
          "Robotic Process Automation (RPA) e orquestração de workflows",
          "Benefícios de eficiência e redução de custos",
        ],
      },
      {
        nome: "Gestão de Sistemas em Nuvem",
        itens: [
          "Modelos de cloud (pública, privada, híbrida)",
          "Serviços (IaaS, PaaS, SaaS) e migração",
          "Otimização de custos e segurança em cloud",
        ],
      },
      {
        nome: "Desenvolvimento e Manutenção de Sites",
        itens: [
          "Design e usabilidade (UX/UI)",
          "SEO, codificação e hospedagem",
          "Testes e monitoramento",
        ],
      },
      {
        nome: "Gestão de Redes e Conectividade",
        itens: [
          "Redes LAN, WAN e Wi-Fi",
          "Monitoramento de tráfego e otimização de banda",
          "Prioridade de tráfego e QoS",
        ],
      },
      {
        nome: "Compliance e Normas de TI",
        itens: [
          "Normas ISO/IEC 27001/20000, ITIL, LGPD, PCI-DSS",
        ],
      },
      {
        nome: "Gestão de Telecomunicações",
        itens: [
          "Telefonia IP, contratos e gestão de custos",
        ],
      },
      {
        nome: "Planejamento e Gestão de Projetos de TI",
        itens: [
          "Alinhamento estratégico de TI com o negócio",
          "Priorização e metodologias (Agile, PMBOK)",
        ],
      },
      {
        nome: "Suporte e Inovação Tecnológica",
        itens: [
          "Pesquisa de novas tecnologias, provas de conceito e inovação aberta",
        ],
      },
      {
        nome: "Gestão de Orçamentos de TI",
        itens: [
          "Planejamento e controle de CAPEX/OPEX",
        ],
      },
      {
        nome: "Gestão de Contratos e Fornecedores de TI",
        itens: [
          "Seleção, negociação e gestão de SLAs",
        ],
      },
      {
        nome: "Gestão de Comunicação Interna",
        itens: [
          "Ferramentas de colaboração e produtividade",
          "Treinamentos e comunicação de políticas",
        ],
      },
      {
        nome: "Monitoramento e Análise de Desempenho de Sistemas",
        itens: [
          "Ferramentas APM, logs e métricas de performance",
        ],
      },
      {
        nome: "Outros",
        itens: [],
      },
    ],
  },
  {
    area: "Administrativo",
    subareas: [
      {
        nome: "Documentos e Arquivos",
        itens: [
          "Classificação e organização de documentos",
          "Digitalização de documentos físicos",
          "Armazenamento seguro e backup de dados",
          "Controle de acesso e permissões",
          "Gerenciamento de ciclo de vida do documento",
          "Automação de fluxo de documentos",
          "Digitalização de assinaturas e aprovações",
          "Política de retenção de documentos",
          "Benefícios de uma gestão eficiente de documentos e arquivos",
        ],
      },
      {
        nome: "Gestão de Contratos e Fornecedores",
        itens: [
          "Planejamento e seleção de fornecedores",
          "Elaboração e formalização de contratos",
          "Monitoramento e acompanhamento do desempenho",
          "Gestão de riscos contratuais",
          "Controle de custos e negociação",
          "Gerenciamento de conflitos e resolução de problemas",
          "Avaliação contínua de fornecedores",
          "Automação e digitalização da gestão de contratos",
          "Renovação e revisão de contratos",
          "Benefícios de uma gestão eficaz de contratos e fornecedores",
        ],
      },
      {
        nome: "Gestão de Infraestrutura e Patrimônio",
        itens: [
          "Inventário e registro de ativos",
          "Planejamento de manutenção",
          "Gestão de depreciação e valorização de ativos",
          "Controle de movimentação e localização de ativos",
          "Gestão de espaço e layout de infraestrutura",
          "Monitoramento de custos operacionais",
          "Conformidade com normas e regulamentações",
          "Digitalização e automação de processos de gestão",
          "Descarte e substituição de ativos",
          "Benefícios de uma gestão eficaz de infraestrutura e patrimônio",
        ],
      },
      {
        nome: "Gestão de Compras de Materiais",
        itens: [
          "Planejamento de necessidades de materiais",
          "Seleção e qualificação de fornecedores",
          "Cotação e negociação de preços",
          "Controle e acompanhamento de pedidos",
          "Gestão de estoque e armazenamento",
          "Análise de fornecedores e avaliação de desempenho",
          "Automação e uso de sistemas de gestão",
          "Gestão de custos e orçamento de compras",
          "Conformidade e sustentabilidade nas compras",
          "Benefícios de uma gestão eficiente de compras de materiais",
        ],
      },
      {
        nome: "Comunicação Interna",
        itens: [
          "Alinhamento com a cultura organizacional",
          "Definição de canais de comunicação",
          "Planejamento de comunicação",
          "Promoção da comunicação bidirecional",
          "Compartilhamento de informações estratégicas",
          "Reconhecimento e valorização dos colaboradores",
          "Gestão de crises e comunicação transparente",
          "Integração de novos colaboradores",
          "Monitoramento e avaliação da comunicação",
          "Benefícios de uma comunicação interna eficaz",
        ],
      },
      {
        nome: "Compliance Administrativo",
        itens: [
          "Gestão de riscos e avaliação de conformidade",
          "Treinamento e capacitação dos colaboradores",
          "Monitoramento e auditoria de processos administrativos",
          "Canal de denúncias e transparência",
          "Implementação de políticas e procedimentos internos",
          "Compliance tributário e financeiro",
          "Compliance com normas de saúde e segurança",
          "Política de ética e código de conduta",
          "Benefícios de um compliance administrativo eficaz",
          "Gestão de documentação e arquivamento",
        ],
      },
      {
        nome: "Controle de Ativos e Inventário",
        itens: [
          "Catalogação e identificação dos ativos",
          "Gestão de aquisição e entrada de ativos",
          "Rastreamento e localização de ativos",
          "Controle de estoque e inventário rotativo",
          "Gestão de manutenção de ativos",
          "Depreciação e avaliação de ativos",
          "Controle de inventário e redução de perdas",
          "Automação e sistemas de gestão de ativos",
          "Política de descarte e substituição de ativos",
          "Benefícios de um controle eficaz de ativos e inventário",
        ],
      },
      {
        nome: "Controle de Serviços Terceirizados",
        itens: [
          "Estabelecimento de indicadores de desempenho (SLAs)",
          "Negociação de termos e condições",
          "Supervisão e monitoramento contínuo",
          "Gestão de conflitos e solução de problemas",
          "Definição clara de escopo e responsabilidades",
          "Renovação e revisão de contratos",
          "Gestão de custos e orçamento",
          "Compliance e conformidade legal",
          "Benefícios de uma gestão eficiente de contratos de serviços",
          "Avaliação de qualidade e satisfação",
        ],
      },
      {
        nome: "Relatórios Administrativos",
        itens: [
          "Definição de objetivos e indicadores de desempenho (KPIs)",
          "Coleta e organização de dados",
          "Análise e interpretação dos dados",
          "Geração de relatórios periódicos",
          "Uso de ferramentas de visualização de dados",
          "Acompanhamento de desempenho e comparação com metas",
          "Revisão e validação de dados",
          "Comunicação dos resultados",
          "Armazenamento e arquivamento dos relatórios",
        ],
      },
      {
        nome: "Outros",
        itens: [],
      },
    ],
  },
];
