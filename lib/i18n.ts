/**
 * Athena Tools Hub — pt-BR dictionary.
 *
 * Namespaced, typed dictionary structured for future locales:
 * adding a new language means creating `t` with the same `Dict` shape.
 * All UI strings in the shell must come from here — never hardcode pt-BR
 * text in components.
 */

export const t = {
  common: {
    appName: "Athena Tools Hub",
    shortName: "Tools Hub",
    loading: "Carregando…",
    save: "Salvar",
    cancel: "Cancelar",
    close: "Fechar",
    confirm: "Confirmar",
    retry: "Tentar novamente",
    viewAll: "Ver tudo",
    back: "Voltar",
    search: "Buscar",
    searchPlaceholder: "Buscar ferramentas…",
    actions: "Ações",
    none: "Nenhum",
    notConfigured: "Não configurado",
    mvpNote: "MVP em construção",
  },
  nav: {
    dashboard: "Dashboard",
    catalog: "Catálogo",
    jobs: "Execuções",
    approvals: "Aprovações",
    results: "Resultados",
    integrations: "Integrações",
    reverseEngineering: "Engenharia Reversa",
    settings: "Configurações",
    main: "Principal",
    tools: "Ferramentas",
    admin: "Administração",
    login: "Entrar",
    logout: "Sair",
  },
  auth: {
    loginTitle: "Acesse o Athena Tools Hub",
    loginSubtitle: "Entre com seu e-mail e senha para continuar.",
    email: "E-mail",
    password: "Senha",
    emailPlaceholder: "voce@exemplo.com",
    submit: "Entrar",
    invalidCredentials: "E-mail ou senha inválidos.",
    unexpectedError: "Algo deu errado. Tente novamente.",
    showPassword: "Mostrar senha",
    hidePassword: "Ocultar senha",
    forgotPassword: "Esqueceu a senha?",
    forgotPasswordTitle: "Recuperar acesso",
    forgotPasswordBody:
      "Informa o teu e-mail. Se existir uma conta com esse e-mail, vais receber um link para definir uma nova senha.",
    sendRecoveryLink: "Enviar link de recuperação",
    recoveryLinkSent:
      "Se existir uma conta com esse e-mail, acabaste de receber um link de recuperação. Verifica a tua caixa de entrada (e o spam).",
    backToLogin: "Voltar ao login",
    resetPasswordTitle: "Definir nova senha",
    resetPasswordSubtitle: "Escolhe uma senha nova para a tua conta.",
    newPassword: "Nova senha",
    confirmPassword: "Confirmar nova senha",
    passwordsDoNotMatch: "As senhas não coincidem.",
    passwordTooShort: "A senha tem de ter pelo menos 8 caracteres.",
    resetSuccess: "Senha redefinida com sucesso. Entra com a nova senha.",
    saveNewPassword: "Guardar nova senha",
    resetLinkInvalidTitle: "Link inválido ou expirado",
    resetLinkInvalidBody:
      "Este link de recuperação já não é válido. Pede um novo link na tela de login, em “Esqueceu a senha?”.",
    requestNewLink: "Pedir novo link",
    saving: "A guardar…",
    sending: "A enviar…",
    setupRequiredTitle: "Supabase ainda não configurado",
    setupRequiredBody:
      "O login depende do Supabase. Configure NEXT_PUBLIC_SUPABASE_URL e NEXT_PUBLIC_SUPABASE_ANON_KEY nas variáveis de ambiente e acesse Configurações para concluir a conexão.",
    goToSettings: "Ir para Configurações",
  },
  setup: {
    bannerTitle: "Conecte o Supabase para ativar dados reais",
    bannerBody:
      "Sem o Supabase, o painel mostra estados vazios. Nenhum dado de exemplo é exibido como real.",
    bannerAction: "Abrir Configurações",
    dismiss: "Dispensar aviso",
  },
  notifications: {
    title: "Notificações",
    empty: "Nenhuma notificação",
    emptyHint: "Você verá aqui alertas de execuções, aprovações e integrações.",
    unavailable: "Notificações indisponíveis no momento.",
  },
  dashboard: {
    title: "Dashboard",
    subtitle: "Visão geral da plataforma",
    stats: {
      tools: "Ferramentas",
      integrations: "Integrações",
      activeJobs: "Tarefas ativas",
      pendingApprovals: "Aprovações pendentes",
    },
    noData: "Sem dados — configure o Supabase",
    noDataHint:
      "Conecte o Supabase nas Configurações para ver números reais aqui.",
    loadError: "Não foi possível carregar os dados.",
    recentJobs: "Tarefas recentes",
    runningJobs: "Tarefas em execução",
    pendingApprovals: "Aprovações pendentes",
    recentResults: "Resultados recentes",
    emptyJobs: "Nenhuma tarefa ainda",
    emptyApprovals: "Nenhuma aprovação pendente",
    emptyResults: "Nenhum resultado ainda",
  },
  jobs: {
    states: {
      created: "Criada",
      queued: "Na fila",
      running: "Em execução",
      waitingApproval: "Aguardando aprovação",
      approved: "Aprovada",
      rejected: "Rejeitada",
      completed: "Concluída",
      failed: "Falhou",
      canceled: "Cancelada",
    },
  },
  approvals: {
    states: {
      pending: "Pendente",
      approved: "Aprovada",
      rejected: "Rejeitada",
      expired: "Expirada",
    },
    approve: "Aprovar",
    reject: "Rejeitar",
  },
  integrations: {
    states: {
      connected: "Conectada",
      disconnected: "Desconectada",
      error: "Erro",
      testing: "Testando…",
    },
  },
  tools: {
    states: {
      active: "Ativa",
      inactive: "Inativa",
      draft: "Rascunho",
    },
  },
  landing: {
    badge: "MVP em construção",
    heroTitle: "Sua central de ferramentas de IA",
    heroSubtitle:
      "Catálogo, execuções, aprovações, resultados e integrações em um só lugar — com governança pronta para Athena Control.",
    enter: "Entrar",
    viewCatalog: "Ver catálogo",
    honestNote:
      "Versão inicial em desenvolvimento ativo: Catálogo, Execuções, Aprovações, Resultados e Governança usam dados reais; Integrações e Engenharia Reversa têm partes ainda em construção — marcadas como tal na interface.",
    modules: {
      catalog: {
        title: "Catálogo",
        body: "Descubra e configure ferramentas de IA organizadas por categoria.",
      },
      jobs: {
        title: "Execuções",
        body: "Acompanhe cada execução com estados honestos, do início ao fim.",
      },
      approvals: {
        title: "Aprovações",
        body: "Nada é publicado sem aprovação humana explícita.",
      },
      results: {
        title: "Resultados",
        body: "Histórico completo de resultados das suas ferramentas.",
      },
      integrations: {
        title: "Integrações",
        body: "Conecte provedores externos com testes de conexão reais.",
      },
      reverse: {
        title: "Engenharia Reversa",
        body: "Desconstrua fluxos vencedores em módulos reutilizáveis.",
      },
      governance: {
        title: "Governança",
        body: "Trilha de auditoria e controle preparados para Athena Control.",
      },
    },
  },
  a11y: {
    toggleSidebar: "Alternar barra lateral",
    closeMenu: "Fechar menu",
    openMenu: "Abrir menu",
    userMenu: "Menu do usuário",
    notifications: "Notificações",
    skipToContent: "Pular para o conteúdo",
  },
} as const;

export type Dict = typeof t;
