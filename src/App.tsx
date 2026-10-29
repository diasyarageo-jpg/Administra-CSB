import React, { useState, useEffect } from 'react';
import {
  notificaDataService,
  loadNotificaDatabase,
  saveNotificaDatabase,
  NotificaDatabase,
  emptyDatabase,
  MigrationSummary
} from './services/notificaDataService';
import {
  isSupabaseConfigured,
  checkSupabaseConnection,
  SupabaseConnectionStatus,
  supabase
} from './services/supabaseClient';
import {
  getUfs,
  getMunicipiosByUf,
  getMatoGrossoMunicipios,
  IbgeUf,
  IbgeMunicipio
} from './services/ibgeService';
import {
  EmpreendedorModal,
  BarragemModal,
  RtModal,
  GenericRecordModal
} from './components/CadastrosModals';
import { authService } from './services/authService';
import { UserRole, AuthUserProfile, PERFIS_PROFISSIONAIS, SETORES } from './types/auth';
import { LoginModal } from './components/LoginModal';
import { LoginPage } from './components/LoginPage';
import { UsuarioModal } from './components/UsuarioModal';

// ============================================================================
// NOTIFICA CSB — AVISO DE TRANSIÇÃO E ARQUITETURA DE DADOS
// 1. Projeto totalmente desvinculado do Supabase anterior; nenhum banco remoto ativo.
// 2. Login e autenticação desativados: o sistema abre diretamente.
// 3. Camada de dados local temporária separada das telas (notificaDataService).
// 4. Cadastros iniciam vazios (sem dados fictícios).
// 5. O sistema não deve ser declarado pronto para produção nesta etapa.
// ============================================================================

export const SURH_PRODUCTS = [
  { code: '1.3', title: 'Cadastro de informações de recursos hídricos em sistemas oficiais (ex.: CNARH e SNISB)', points: 3, level: 1 },
  { code: '1.4', title: 'Parecer Técnico de Indeferimento a pedido do interessado', points: 3, level: 1 },
  { code: '2.5', title: 'Parecer Técnico de Indeferimento por inércia do interessado', points: 5, level: 2 },
  { code: '2.6', title: 'Lavratura de Autos de Infração e outros atos sancionatórios', points: 5, level: 2 },
  { code: '2.7', title: 'Relatório de Vistoria Remota por imagem', points: 5, level: 2 },
  { code: '2.8', title: 'Nota Técnica ou Parecer Técnico diverso', points: 5, level: 2 },
  { code: '2.9', title: 'Parecer de retificação/prorrogação de outorgas, cadastro ou autorização', points: 5, level: 2 },
  { code: '3.3', title: 'Relatório de Fiscalização de contrato (designado por Portaria)', points: 10, level: 3 },
  { code: '3.4', title: 'Relatório Mensal de Gestão de Recursos Hídricos (FEHIDRO)', points: 10, level: 3 },
  { code: '3.5', title: 'Parecer de classificação de barragens simples', points: 10, level: 3 },
  { code: '3.6', title: 'Parecer de Indeferimento Técnico em geral', points: 10, level: 3 },
  { code: '4.4', title: 'Vistoria in loco e emissão de relatório de classificação de barragens e de outorga', points: 15, level: 4 },
  { code: '5.2', title: 'Parecer Técnico de classificação de barragem', points: 20, level: 5 },
  { code: '5.3', title: 'Parecer de cumprimento de metas de parcerias institucionais e/ou relatórios de gestão de recursos hídricos', points: 20, level: 5 },
  { code: '6.1', title: 'Relatório e vistoria in loco de Plano de Segurança de Barragem e de Ação de Emergência', points: 30, level: 6 },
  { code: '6.2', title: 'Relatório e vistoria in loco para dirimir conflito por disponibilidade hídrica', points: 30, level: 6 },
  { code: '6.3', title: 'Parecer Técnico de análise de Plano de Segurança de Barragem e de Ação de Emergência', points: 30, level: 6 },
  { code: '1.2', title: 'Parecer técnico dos produtos do Plano de recursos hídricos (diagnóstico, prognóstico, plano de ações e enquadramento de corpos d’água)', points: 40, level: 7 },
  { code: '8.1', title: 'Relatório final dos produtos do Plano de recursos hídricos (diagnóstico, prognóstico, plano de ações e enquadramento de corpos d’água)', points: 50, level: 8 }
];

export function getProductivityPoints(record: any): number {
  if (record.kind === 'extra') {
    return record.extraStatus === 'Aprovada' ? Number(record.approvedPoints || 0) : 0;
  }
  if (record.kind === 'unscored') return 0;
  return Number(record.unitPoints || 0) * Math.max(1, Number(record.quantity || 1));
}

// Resolução de vínculo entre Barragem e Empreendedor (por ID ou texto legado)
export function resolveDamEntrepreneur(
  rawEmpreendedor: string | undefined | null,
  empreendedores: any[] = []
): { id?: string; displayName: string; isUniqueMatch: boolean; isExactId: boolean } {
  if (!rawEmpreendedor || !String(rawEmpreendedor).trim()) {
    return { displayName: '—', isUniqueMatch: false, isExactId: false };
  }

  const raw = String(rawEmpreendedor).trim();

  // 1. Vínculo direto por ID (preserva tanto empreendedores ativos quanto inativos)
  const byId = empreendedores.find(e => String(e.id) === raw);
  if (byId) {
    const displayName = byId.nome || byId.nomeFantasia || byId.cpfCnpj || byId.id;
    return { id: byId.id, displayName, isUniqueMatch: true, isExactId: true };
  }

  // 2. Registros antigos em texto: busca correspondência por nome, nome fantasia ou documento
  const normalized = raw.toLowerCase();
  const cleanRawDoc = raw.replace(/\D/g, '');
  const matches = empreendedores.filter(e => {
    const nome = String(e.nome || '').trim().toLowerCase();
    const nomeFantasia = String(e.nomeFantasia || '').trim().toLowerCase();
    const cleanEmpDoc = String(e.cpfCnpj || '').replace(/\D/g, '');
    const docMatch = cleanRawDoc.length >= 11 && cleanEmpDoc === cleanRawDoc;
    return (nome && nome === normalized) || (nomeFantasia && nomeFantasia === normalized) || docMatch;
  });

  // Converte para ID somente se houver uma correspondência única
  if (matches.length === 1) {
    const match = matches[0];
    const displayName = match.nome || match.nomeFantasia || raw;
    return { id: match.id, displayName, isUniqueMatch: true, isExactId: false };
  }

  // 3. Ambíguo (mais de uma correspondência) ou sem correspondência:
  // Mantém o texto original visível, sem associar ID
  return { displayName: raw, isUniqueMatch: false, isExactId: false };
}

// Resolução de vínculo entre Barragem e Empreendimento (por ID ou texto legado)
export function resolveDamEmpreendimento(
  rawEmpreendimento: string | undefined | null,
  empreendimentos: any[] = []
): { id?: string; displayName: string; isUniqueMatch: boolean } {
  if (!rawEmpreendimento || !String(rawEmpreendimento).trim()) {
    return { displayName: '—', isUniqueMatch: false };
  }
  const raw = String(rawEmpreendimento).trim();
  // 1. Busca por ID direto
  const byId = empreendimentos.find(e => String(e.id) === raw);
  if (byId) {
    const doc = byId.tipo === 'Rural'
      ? (byId.car ? ` · CAR: ${byId.car}` : '')
      : (byId.escritura ? ` · Escritura: ${byId.escritura}` : '');
    const displayName = `${byId.nome || byId.id}${byId.tipo ? ` (${byId.tipo}${doc})` : ''}`;
    return { id: byId.id, displayName, isUniqueMatch: true };
  }
  // 2. Registros legados por nome exato
  const normalized = raw.toLowerCase();
  const matches = empreendimentos.filter(e => String(e.nome || '').trim().toLowerCase() === normalized);
  if (matches.length === 1) {
    const match = matches[0];
    const doc = match.tipo === 'Rural'
      ? (match.car ? ` · CAR: ${match.car}` : '')
      : (match.escritura ? ` · Escritura: ${match.escritura}` : '');
    const displayName = `${match.nome || match.id}${match.tipo ? ` (${match.tipo}${doc})` : ''}`;
    return { id: match.id, displayName, isUniqueMatch: true };
  }
  return { displayName: raw, isUniqueMatch: false };
}

// Resolução do nome da Barragem para exibição no cadastro de Responsáveis Técnicos
export function resolveDamName(damIdOrName: string | undefined | null, barragens: any[] = []): string {
  if (!damIdOrName || !String(damIdOrName).trim()) return '—';
  const raw = String(damIdOrName).trim();
  const dam = barragens.find(b => String(b.id) === raw || String(b.nome || '').trim().toLowerCase() === raw.toLowerCase());
  return dam ? (dam.nome || dam.id) : raw;
}

interface FieldConfig {
  name: string;
  label: string;
  type?: 'text' | 'email' | 'select' | 'textarea' | 'date';
  required?: boolean;
  options?: string[];
  full?: boolean;
}

interface ModuleConfig {
  title: string;
  singular: string;
  icon: string;
  search: string[];
  fields: FieldConfig[];
  columns: [string, string][];
}

const emptyData = {
  empreendedores: [] as any[],
  barragens: [] as any[],
  rts: [] as any[],
  revisoes: [] as any[],
  usuarios: [] as any[],
  portarias: [] as any[],
  produtividades: [] as any[],
  municipios: [] as any[]
};

const viewNames: Record<string, string> = {
  home: 'Painel de Controle',
  empreendedores: 'Empreendedores',
  barragens: 'Barragens cadastradas',
  rts: 'Responsáveis Técnicos',
  revisoes: 'Conciliação de cadastros',
  produtividade: 'Produtividade',
  portarias: 'Portarias',
  usuarios: 'Usuários',
  integracao: 'Estrutura de integração',
  referencias: 'Referências centrais'
};

const modules: Record<string, ModuleConfig> = {
  empreendedores: {
    title: 'Empreendedores',
    singular: 'empreendedor',
    icon: '◉',
    search: ['nome', 'cpfCnpj', 'tipoPessoa', 'municipio', 'uf'],
    fields: [
      { name: 'tipoPessoa', label: 'Tipo de pessoa', type: 'select', options: ['Pessoa física', 'Pessoa jurídica'] },
      { name: 'nome', label: 'Nome / Razão social', required: true },
      { name: 'cpfCnpj', label: 'CPF/CNPJ', required: true },
      { name: 'nomeFantasia', label: 'Nome fantasia' },
      { name: 'email', label: 'E-mail', type: 'email' },
      { name: 'telefone', label: 'Telefone' },
      { name: 'uf', label: 'UF' },
      { name: 'municipio', label: 'Município de referência' },
      { name: 'observacoes', label: 'Observações', type: 'textarea', full: true }
    ],
    columns: [
      ['nome', 'Nome / Razão social'],
      ['cpfCnpj', 'CPF/CNPJ'],
      ['tipoPessoa', 'Tipo'],
      ['municipio', 'Município / UF'],
      ['empreendimentos', 'Empreendimentos']
    ]
  },
  barragens: {
    title: 'Barragens cadastradas',
    singular: 'barragem',
    icon: '▤',
    search: ['nome', 'car', 'municipio', 'empreendedor', 'empreendimento', 'processo'],
    fields: [
      { name: 'nome', label: 'Identificação / nome da barragem', required: true },
      { name: 'car', label: 'CAR/MT' },
      { name: 'municipio', label: 'Município (Mato Grosso)' },
      { name: 'empreendedor', label: 'Empreendedor vinculado' },
      { name: 'empreendimento', label: 'Empreendimento vinculado' },
      { name: 'processo', label: 'Número do processo' },
      { name: 'snisb', label: 'Identificador SNISB' },
      { name: 'cursoAgua', label: 'Curso d’água' },
      { name: 'latitude', label: 'Latitude (GMS ou coordenada original)' },
      { name: 'longitude', label: 'Longitude (GMS ou coordenada original)' },
      { name: 'situacao', label: 'Situação cadastral', type: 'select', options: ['Ativa', 'Inativa', 'Aguardando confirmação'] },
      { name: 'observacoes', label: 'Observações', type: 'textarea', full: true }
    ],
    columns: [
      ['nome', 'Barragem'],
      ['car', 'CAR/MT'],
      ['municipio', 'Município (MT)'],
      ['empreendedor', 'Empreendedor'],
      ['empreendimento', 'Empreendimento'],
      ['situacao', 'Situação']
    ]
  },
  rts: {
    title: 'Responsáveis Técnicos',
    singular: 'responsável técnico',
    icon: '⌘',
    search: ['nome', 'cpf', 'conselho', 'registro', 'especialidades', 'artRrt', 'barragemVinculada'],
    fields: [
      { name: 'nome', label: 'Nome completo', required: true },
      { name: 'cpf', label: 'CPF' },
      { name: 'conselho', label: 'Conselho profissional' },
      { name: 'ufConselho', label: 'UF do conselho' },
      { name: 'registro', label: 'Número de registro' },
      { name: 'especialidades', label: 'Especialidades' },
      { name: 'email', label: 'E-mail', type: 'email' },
      { name: 'telefone', label: 'Telefone' },
      { name: 'artRrt', label: 'Número da ART/RRT', required: true },
      { name: 'barragemVinculada', label: 'Barragem vinculada (obrigatório)', required: true },
      { name: 'validade', label: 'Validade da ART/RRT', type: 'date' },
      { name: 'situacao', label: 'Situação', type: 'select', options: ['Ativo', 'Inativo', 'Aguardando confirmação'] },
      { name: 'observacoes', label: 'Observações', type: 'textarea', full: true }
    ],
    columns: [
      ['nome', 'Responsável técnico'],
      ['conselho', 'Conselho'],
      ['registro', 'Registro'],
      ['artRrt', 'ART/RRT'],
      ['barragemVinculada', 'Barragem vinculada'],
      ['situacao', 'Situação']
    ]
  },
  usuarios: {
    title: 'Gerenciamento de usuários',
    singular: 'usuário',
    icon: '♙',
    search: ['nome', 'matricula', 'login', 'email', 'papel', 'perfilProfissional', 'setor', 'situacao'],
    fields: [
      { name: 'nome', label: 'Nome completo', required: true },
      { name: 'matricula', label: 'Matrícula funcional', required: true },
      { name: 'login', label: 'Identificação de acesso' },
      { name: 'email', label: 'E-mail institucional', type: 'email', required: true },
      { name: 'perfilProfissional', label: 'Perfil profissional', type: 'select', options: [...PERFIS_PROFISSIONAIS] },
      { name: 'setor', label: 'Setor de lotação', type: 'select', options: [...SETORES] },
      { name: 'papel', label: 'Papel de acesso (RBAC)', type: 'select', options: ['Administrador', 'Usuário', 'Visualizador'] },
      { name: 'situacao', label: 'Situação funcional', type: 'select', options: ['Ativo', 'Inativo', 'Pendente', 'Recusado'] },
      { name: 'observacoes', label: 'Observações', type: 'textarea', full: true }
    ],
    columns: [
      ['nome', 'Nome do servidor'],
      ['matricula', 'Matrícula'],
      ['email', 'E-mail institucional'],
      ['perfilProfissional', 'Perfil profissional'],
      ['setor', 'Setor'],
      ['papel', 'Função / Papel'],
      ['situacao', 'Situação']
    ]
  }
};

export default function App() {
  const [db, setDb] = useState<NotificaDatabase>(() => loadNotificaDatabase());

  const [activeView, setActiveView] = useState('home');
  const [menuOpen, setMenuOpen] = useState(false);
  const [searchTerms, setSearchTerms] = useState<Record<string, string>>({});
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  // Estado de Autenticação e RBAC
  const [currentAuthUser, setCurrentAuthUser] = useState<any | null>(null);
  const [currentUserProfile, setCurrentUserProfile] = useState<AuthUserProfile | null>(null);
  const [userRole, setUserRole] = useState<UserRole>('Administrador');
  const [showLoginModal, setShowLoginModal] = useState(false);
  const [isAuthChecking, setIsAuthChecking] = useState(true);

  // Estados para aprovação e recusa de solicitações de usuários por Administradores
  const [userToApprove, setUserToApprove] = useState<any | null>(null);
  const [approvalRole, setApprovalRole] = useState<UserRole>('Usuário');
  const [isApproving, setIsApproving] = useState(false);
  const [userToReject, setUserToReject] = useState<any | null>(null);
  const [rejectMotivo, setRejectMotivo] = useState('');
  const [isRejecting, setIsRejecting] = useState(false);
  const [usuarioSituacaoFilter, setUsuarioSituacaoFilter] = useState<string>('Todos');

  // Modals state
  const [modalConfig, setModalConfig] = useState<{
    key: string;
    record: any;
    index: number | null;
  } | null>(null);

  const [prodModalIndex, setProdModalIndex] = useState<number | null | 'new'>(null);
  const [prodModalRecord, setProdModalRecord] = useState<any>({});
  const [portariaModalIndex, setPortariaModalIndex] = useState<number | null | 'new'>(null);
  const [portariaModalRecord, setPortariaModalRecord] = useState<any>({});

  // Estado e diagnóstico de conexão com o Supabase
  const [supabaseStatus, setSupabaseStatus] = useState<SupabaseConnectionStatus>({
    configured: isSupabaseConfigured(),
    connected: false,
    message: isSupabaseConfigured()
      ? 'Aguardando autenticação institucional...'
      : 'Supabase não configurado (.env). Operando exclusivamente no armazenamento local.'
  });
  const [isMigrating, setIsMigrating] = useState(false);
  const [migrationSummary, setMigrationSummary] = useState<{
    totalMigrated: number;
    errorCount: number;
    summaries: MigrationSummary[];
  } | null>(null);
  const [confirmLocalClear, setConfirmLocalClear] = useState(false);

  // Inicialização do Supabase Auth e verificação de sessão (sem carregar dados operacionais antes do login)
  useEffect(() => {
    async function initAuth() {
      if (isSupabaseConfigured() && supabase) {
        try {
          const { user } = await authService.getSession();
          if (user) {
            setCurrentAuthUser(user);
            const prof = await authService.getUserProfile(user.id, user.email);
            setCurrentUserProfile(prof);
            setUserRole(prof?.papel || 'Usuário');
          } else {
            setCurrentAuthUser(null);
            setCurrentUserProfile(null);
          }

          const { data: authListener } = supabase.auth.onAuthStateChange(async (event, session) => {
            if (event === 'SIGNED_IN' && session?.user) {
              setCurrentAuthUser(session.user);
              const prof = await authService.getUserProfile(session.user.id, session.user.email);
              setCurrentUserProfile(prof);
              setUserRole(prof?.papel || 'Usuário');
              setShowLoginModal(false);
            } else if (event === 'SIGNED_OUT') {
              setCurrentAuthUser(null);
              setCurrentUserProfile(null);
              setUserRole('Visualizador');
            }
          });

          return () => {
            authListener?.subscription?.unsubscribe();
          };
        } catch (err) {
          console.warn('[App] Erro na verificação de sessão:', err);
        } finally {
          setIsAuthChecking(false);
        }
      } else {
        // Modo local offline (sem Supabase configurado)
        setUserRole('Administrador');
        setIsAuthChecking(false);
      }
    }

    initAuth();
  }, []);

  // Proteção de rota do módulo Usuários
  useEffect(() => {
    if (activeView === 'usuarios' && userRole !== 'Administrador') {
      setActiveView('home');
      showToast('Acesso restrito: o módulo Usuários é restrito a Administradores.');
    }
  }, [activeView, userRole]);

  // Consulta e sincronização de dados com Supabase:
  // EXCLUSIVAMENTE executada após autenticação válida com perfil Ativo.
  // Nenhum dado operacional é consultado ou carregado antes da autenticação.
  useEffect(() => {
    if (isSupabaseConfigured() && currentAuthUser && currentUserProfile?.situacao === 'Ativo') {
      checkSupabaseConnection().then(status => {
        setSupabaseStatus(status);
        if (status.connected) {
          notificaDataService.fetchRemoteDatabase().then(res => {
            if (res.success && res.db) {
              const remoteTotal = Object.values(res.db).reduce(
                (acc: number, arr: any[]) => acc + (Array.isArray(arr) ? arr.length : 0),
                0
              );
              setDb(res.db);
              saveNotificaDatabase(res.db);
              if (remoteTotal > 0) {
                showToast(`Sincronizado com o Supabase (${remoteTotal} registros remotos).`);
              }
            } else if (res.error) {
              showToast(`Aviso Supabase: ${res.error}`);
            }
          });
        }
      });
    }
  }, [currentAuthUser, currentUserProfile]);

  // Persistência local desacoplada das telas (sempre preserva cópia local offline)
  useEffect(() => {
    saveNotificaDatabase(db);
  }, [db]);

  const showToast = (message: string) => {
    setToastMessage(message);
    setTimeout(() => setToastMessage(null), 2800);
  };

  const formatDate = (value: any) => {
    if (!value) return '—';
    const date = new Date(`${value}T00:00:00`);
    return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleDateString('pt-BR');
  };

  const valueLabel = (value: any) => {
    if (value === undefined || value === null || value === '') return '—';
    return String(value);
  };

  // General Collection Modal
  const handleOpenRecordModal = (key: string, index: number | null = null) => {
    const list = db[key as keyof typeof db] || [];
    const record = index === null ? {} : { ...(list[index] as any) };
    if (key === 'barragens' && record.empreendedor) {
      const resolved = resolveDamEntrepreneur(record.empreendedor, db.empreendedores);
      if (resolved.isUniqueMatch && resolved.id) {
        record.empreendedor = resolved.id;
      }
    }
    setModalConfig({ key, record, index });
  };

  const handleSaveRecord = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!modalConfig) return;

    const { key, index } = modalConfig;
    const formData = new FormData(e.currentTarget);
    const record: any = { ...(modalConfig.record || {}) };

    modules[key].fields.forEach(field => {
      record[field.name] = String(formData.get(field.name) || '').trim();
    });

    if (key === 'barragens' && record.empreendedor) {
      const resolved = resolveDamEntrepreneur(record.empreendedor, db.empreendedores);
      if (resolved.isUniqueMatch && resolved.id) {
        record.empreendedor = resolved.id;
      }
    }

    record.id = modalConfig.record.id || (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()));
    record.createdAt = modalConfig.record.createdAt || new Date().toISOString();
    record.updatedAt = new Date().toISOString();
    record.situacao = record.situacao || (key === 'usuarios' ? 'Ativo' : 'Aguardando confirmação');

    if (
      key === 'usuarios' &&
      db.usuarios.some(
        (item: any, i: number) =>
          item.login?.toLowerCase() === record.login.toLowerCase() && i !== index
      )
    ) {
      showToast('Essa identificação de acesso já está cadastrada.');
      return;
    }

    const currentList = [...(db[key as keyof typeof db] || [])];
    if (index === null) {
      currentList.unshift(record);
    } else {
      currentList[index] = record;
    }

    setDb(prev => ({ ...prev, [key]: currentList }));
    setModalConfig(null);

    notificaDataService.saveRecord(db, key as any, record, index, currentAuthUser?.id).then(res => {
      if (res.savedRemote) {
        showToast('Cadastro salvo no Supabase e no cache local.');
      } else if (res.error) {
        showToast(`Salvo localmente. Alerta Supabase: ${res.error}`);
      } else {
        showToast('Cadastro salvo neste navegador.');
      }
    });
  };

  const handleSaveCustomRecord = (savedRecord: any) => {
    if (!modalConfig) return;
    const { key, index } = modalConfig;

    savedRecord.id = savedRecord.id || modalConfig.record.id || (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()));
    savedRecord.createdAt = modalConfig.record.createdAt || new Date().toISOString();
    savedRecord.updatedAt = new Date().toISOString();
    savedRecord.situacao = savedRecord.situacao || 'Ativo';

    const currentList = [...(db[key as keyof typeof db] || [])];
    if (index === null) {
      currentList.unshift(savedRecord);
    } else {
      currentList[index] = savedRecord;
    }

    setDb(prev => ({ ...prev, [key]: currentList }));
    setModalConfig(null);

    notificaDataService.saveRecord(db, key as any, savedRecord, index, currentAuthUser?.id).then(res => {
      if (res.savedRemote) {
        showToast('Cadastro salvo no Supabase e no cache local.');
      } else if (res.error) {
        showToast(`Salvo localmente. Alerta Supabase: ${res.error}`);
      } else {
        showToast('Cadastro salvo neste navegador.');
      }
    });
  };

  const handleArchiveRecord = (key: string, index: number) => {
    const list = [...(db[key as keyof typeof db] || [])];
    const record: any = list[index];

    // Verificação de permissão para Usuário
    if (userRole === 'Usuário' && record.createdBy && currentAuthUser?.id && record.createdBy !== currentAuthUser.id) {
      showToast('Apenas o autor do registro ou um Administrador pode inativar este item.');
      return;
    }

    const label = record.nome || record.login || record.nomeFantasia || 'este registro';
    if (!confirm(`Inativar “${label}”? O registro será mantido na base.`)) return;

    record.situacao = 'Inativo';
    record.updatedAt = new Date().toISOString();
    list[index] = record;

    setDb(prev => ({ ...prev, [key]: list }));

    notificaDataService.saveRecord(db, key as any, record, index, currentAuthUser?.id).then(res => {
      if (res.savedRemote) {
        showToast('Registro inativado no Supabase; os dados foram preservados.');
      } else if (res.error) {
        showToast(`Inativado localmente. Alerta Supabase: ${res.error}`);
      } else {
        showToast('Registro inativado; os dados foram preservados.');
      }
    });
  };

  const handleDeleteRecord = (key: string, index: number) => {
    if (userRole !== 'Administrador') {
      showToast('Apenas Administradores têm permissão para excluir registros.');
      return;
    }

    const list = [...(db[key as keyof typeof db] || [])];
    const record: any = list[index];
    const label = record.nome || record.login || record.nomeFantasia || 'este registro';
    if (!confirm(`Confirma a exclusão definitiva de “${label}”? Esta ação é permanente.`)) return;

    notificaDataService.deleteRecord(db, key as any, index).then(res => {
      setDb(res.updatedDb);
      if (res.deletedRemote) {
        showToast('Registro excluído do Supabase e do cache local.');
      } else if (res.error) {
        showToast(`Removido localmente. Alerta Supabase: ${res.error}`);
      } else {
        showToast('Registro excluído localmente.');
      }
    });
  };

  // Productivity
  const handleOpenProductivityModal = (index: number | null = null) => {
    const record = index === null ? {} : { ...db.produtividades[index] };
    setProdModalIndex(index === null ? 'new' : index);
    setProdModalRecord(record);
  };

  const handleSaveProductivity = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    const kind = String(formData.get('kind') || 'scored') as 'scored' | 'unscored' | 'extra';
    const serverName = String(formData.get('serverName') || '').trim();
    const date = String(formData.get('date') || '');
    const prior: any = prodModalIndex === 'new' ? {} : db.produtividades[prodModalIndex as number] || {};

    if (kind === 'extra') {
      const requestedPoints = Number(formData.get('requestedPoints') || 0);
      if (!formData.get('extraOrder') || !formData.get('extraApproval')) {
        showToast('Para atividade extra, informe a ordem de serviço e a aprovação prévia formal.');
        return;
      }
      if (!Number.isInteger(requestedPoints) || requestedPoints < 1 || requestedPoints > 8) {
        showToast('A atividade extra deve ser informada entre 1 e 8 pontos.');
        return;
      }
    }

    const product = SURH_PRODUCTS.find(item => item.code === String(formData.get('productCode') || ''));
    if (kind === 'scored' && !product) {
      showToast('Selecione um produto do Anexo I – SURH.');
      return;
    }

    const unscoredType = String(formData.get('unscoredType') || '');
    const unscoredDescription = String(formData.get('unscoredDescription') || '').trim();
    if (kind === 'unscored' && unscoredType === 'Outro' && !unscoredDescription) {
      showToast('Descreva a atividade sem pontuação.');
      return;
    }

    const record = {
      id: prior.id || (crypto.randomUUID ? crypto.randomUUID() : String(Date.now())),
      date,
      serverName,
      unit: String(formData.get('unit') || '').trim(),
      kind,
      productCode: kind === 'scored' ? product!.code : kind === 'extra' ? 'ART. 8º' : '',
      productTitle:
        kind === 'scored'
          ? product!.title
          : kind === 'extra'
          ? 'Atividade extra de gestão — art. 8º'
          : unscoredType === 'Ofício'
          ? 'Ofício — atividade sem pontuação'
          : unscoredDescription,
      unitPoints: kind === 'scored' ? product!.points : 0,
      quantity: kind === 'scored' ? Math.max(1, Number(formData.get('quantity') || 1)) : 1,
      unscoredType: kind === 'unscored' ? unscoredType : '',
      unscoredDescription: kind === 'unscored' ? unscoredDescription || unscoredType : '',
      sourceType: (String(formData.get('sourceType') || 'manual') as 'manual' | 'system'),
      sourceName: String(formData.get('sourceName') || '').trim(),
      processRef: String(formData.get('processRef') || '').trim(),
      documentRef: String(formData.get('documentRef') || '').trim(),
      description: String(formData.get('description') || '').trim(),
      notes: String(formData.get('notes') || '').trim(),
      requestedPoints: kind === 'extra' ? Number(formData.get('requestedPoints') || 0) : 0,
      approvedPoints: prior.approvedPoints || 0,
      extraOrder: kind === 'extra' ? String(formData.get('extraOrder') || '').trim() : '',
      extraApproval: kind === 'extra' ? String(formData.get('extraApproval') || '').trim() : '',
      extraStatus: kind === 'extra' ? prior.extraStatus || 'Pendente' : '',
      coordinator: prior.coordinator || '',
      reviewedAt: prior.reviewedAt || '',
      inOfficialSheet: prior.inOfficialSheet || false,
      officialSheetAt: prior.officialSheetAt || '',
      createdAt: prior.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    const duplicate = db.produtividades.some(
      (item: any, i: number) =>
        i !== (prodModalIndex === 'new' ? -1 : prodModalIndex) &&
        item.serverName?.trim().toLowerCase() === serverName.toLowerCase() &&
        item.date === date &&
        item.productCode === record.productCode &&
        item.processRef?.trim().toLowerCase() === record.processRef.toLowerCase() &&
        item.documentRef?.trim().toLowerCase() === record.documentRef.toLowerCase()
    );

    if (
      duplicate &&
      !confirm('Há um lançamento com o mesmo servidor, data, produto e referência. Deseja salvar mesmo assim?')
    ) {
      return;
    }

    const list = [...db.produtividades];
    if (prodModalIndex === 'new') {
      list.unshift(record);
    } else {
      list[prodModalIndex as number] = record;
    }

    setDb(prev => ({ ...prev, produtividades: list }));
    setProdModalIndex(null);

    notificaDataService.saveRecord(db, 'produtividades', record, prodModalIndex, currentAuthUser?.id).then(res => {
      if (res.savedRemote) {
        showToast('Lançamento salvo no Supabase e no cache local.');
      } else if (res.error) {
        showToast(`Salvo localmente. Alerta Supabase: ${res.error}`);
      } else {
        showToast('Lançamento salvo neste navegador.');
      }
    });
  };

  const handleReviewExtra = (index: number, approve: boolean) => {
    const list = [...db.produtividades];
    const record: any = list[index];
    if (!record || record.kind !== 'extra' || (record.extraStatus !== 'Pendente' && record.extraStatus !== 'Aguardando validação')) return;

    const coordinator = prompt('Nome do coordenador responsável pela decisão:');
    if (!coordinator || !coordinator.trim()) {
      showToast('Informe quem registrou a decisão.');
      return;
    }

    if (approve) {
      const pointsInput = prompt(
        `Pontos a aprovar para ${record.serverName}, em ${formatDate(record.date)}. Máximo de 8 pontos por dia:`,
        String(record.requestedPoints)
      );
      if (pointsInput === null) return;

      const approvedPoints = Number(pointsInput);
      if (!Number.isInteger(approvedPoints) || approvedPoints < 1 || approvedPoints > 8) {
        showToast('Informe uma pontuação inteira entre 1 e 8.');
        return;
      }

      const sameDayApproved = db.produtividades
        .filter(
          (item: any, i: number) =>
            i !== index &&
            item.kind === 'extra' &&
            item.extraStatus === 'Aprovada' &&
            item.date === record.date &&
            item.serverName?.trim().toLowerCase() === record.serverName?.trim().toLowerCase()
        )
        .reduce((sum: number, item: any) => sum + Number(item.approvedPoints || 0), 0);

      if (sameDayApproved + approvedPoints > 8) {
        showToast(
          `O limite do art. 8º é 8 pontos por servidor/dia. Já há ${sameDayApproved} ponto(s) extra aprovado(s) nesta data.`
        );
        return;
      }

      record.approvedPoints = approvedPoints;
      record.extraStatus = 'Aprovada';
    } else {
      record.approvedPoints = 0;
      record.extraStatus = 'Não aprovada';
    }

    record.coordinator = coordinator.trim();
    record.reviewedAt = new Date().toISOString();
    record.updatedAt = new Date().toISOString();
    list[index] = record;

    setDb(prev => ({ ...prev, produtividades: list }));

    notificaDataService.saveRecord(db, 'produtividades', record, index).then(res => {
      if (res.savedRemote) {
        showToast(approve ? 'Atividade extra validada e sincronizada no Supabase.' : 'Atividade não aprovada e sincronizada.');
      } else if (res.error) {
        showToast(`Salvo localmente. Alerta Supabase: ${res.error}`);
      } else {
        showToast(approve ? 'Atividade extra validada.' : 'Atividade extra marcada como não aprovada.');
      }
    });
  };

  const handleToggleOfficialSheet = (index: number, checked: boolean) => {
    const list = [...db.produtividades];
    const record = list[index];
    if (!record) return;

    record.inOfficialSheet = checked;
    record.officialSheetAt = checked ? new Date().toISOString() : '';
    record.updatedAt = new Date().toISOString();
    list[index] = record;

    setDb(prev => ({ ...prev, produtividades: list }));

    notificaDataService.saveRecord(db, 'produtividades', record, index).then(res => {
      if (res.error) {
        showToast(`Alterado localmente. Alerta Supabase: ${res.error}`);
      }
    });
  };

  const handleDeleteProductivity = (index: number) => {
    if (!confirm('Excluir este lançamento de produtividade?')) return;
    const list = [...db.produtividades];
    list.splice(index, 1);
    setDb(prev => ({ ...prev, produtividades: list }));

    notificaDataService.deleteRecord(db, 'produtividades', index).then(res => {
      if (res.deletedRemote) {
        showToast('Lançamento excluído no Supabase e localmente.');
      } else if (res.error) {
        showToast(`Excluído localmente. Alerta Supabase: ${res.error}`);
      } else {
        showToast('Lançamento excluído.');
      }
    });
  };

  // Portarias
  const handleOpenPortariaModal = (index: number | null = null) => {
    const record = index === null ? {} : { ...db.portarias[index] };
    setPortariaModalIndex(index === null ? 'new' : index);
    setPortariaModalRecord(record);
  };

  const handleSavePortaria = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    const prior: any = portariaModalIndex === 'new' ? {} : db.portarias[portariaModalIndex as number] || {};

    const secretarySigned = formData.get('secretarySigned') === 'on';
    const extractPublished = formData.get('extractPublished') === 'on';
    const orderPublished = formData.get('orderPublished') === 'on';
    const complete = secretarySigned && extractPublished && orderPublished;

    const record = {
      id: prior.id || (crypto.randomUUID ? crypto.randomUUID() : String(Date.now())),
      processNumber: String(formData.get('processNumber') || '').trim(),
      orderNumber: String(formData.get('orderNumber') || '').trim(),
      sentDate: String(formData.get('sentDate') || ''),
      finalDate: String(formData.get('finalDate') || '') || (complete ? new Date().toISOString().slice(0, 10) : ''),
      secretarySigned,
      extractPublished,
      orderPublished,
      draft: formData.get('draft') === 'on',
      notes: String(formData.get('notes') || '').trim(),
      createdAt: prior.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    const list = [...db.portarias];
    if (portariaModalIndex === 'new') {
      list.unshift(record);
    } else {
      list[portariaModalIndex as number] = record;
    }

    setDb(prev => ({ ...prev, portarias: list }));
    setPortariaModalIndex(null);

    notificaDataService.saveRecord(db, 'portarias', record, portariaModalIndex, currentAuthUser?.id).then(res => {
      if (res.savedRemote) {
        showToast('Trâmite de Portaria salvo no Supabase e no cache local.');
      } else if (res.error) {
        showToast(`Salvo localmente. Alerta Supabase: ${res.error}`);
      } else {
        showToast('Trâmite de Portaria salvo neste navegador.');
      }
    });
  };

  const handleDeletePortaria = (index: number) => {
    if (!confirm('Excluir este trâmite de Portaria?')) return;
    const list = [...db.portarias];
    list.splice(index, 1);
    setDb(prev => ({ ...prev, portarias: list }));

    notificaDataService.deleteRecord(db, 'portarias', index).then(res => {
      if (res.deletedRemote) {
        showToast('Trâmite removido no Supabase e localmente.');
      } else if (res.error) {
        showToast(`Removido localmente. Alerta Supabase: ${res.error}`);
      } else {
        showToast('Trâmite removido.');
      }
    });
  };

  const handleConfirmApproval = async () => {
    if (!userToApprove) return;
    setIsApproving(true);
    try {
      const res = await authService.approveUser(userToApprove.id, approvalRole);
      if (!res.success) {
        showToast(`Erro na aprovação: ${res.error}`);
      } else {
        const updatedUsuarios = db.usuarios.map(u => {
          if (u.id === userToApprove.id) {
            return {
              ...u,
              papel: approvalRole,
              situacao: 'Ativo' as const,
              status: 'Ativo' as const,
              authUserId: res.authUserId || u.authUserId
            };
          }
          return u;
        });
        const newDb = { ...db, usuarios: updatedUsuarios };
        setDb(newDb);
        saveNotificaDatabase(newDb);
        showToast(res.message || 'Usuário aprovado e credencial provisionada com sucesso!');
        setUserToApprove(null);
      }
    } catch (err: any) {
      showToast(`Falha na aprovação: ${err?.message}`);
    } finally {
      setIsApproving(false);
    }
  };

  const handleConfirmRejection = async () => {
    if (!userToReject) return;
    setIsRejecting(true);
    try {
      const res = await authService.rejectUser(userToReject.id, rejectMotivo);
      if (!res.success) {
        showToast(`Erro ao recusar: ${res.error}`);
      } else {
        const updatedUsuarios = db.usuarios.map(u => {
          if (u.id === userToReject.id) {
            return {
              ...u,
              situacao: 'Recusado' as const,
              status: 'Inativo' as const,
              observacoes: rejectMotivo ? `${u.observacoes ? u.observacoes + ' ' : ''}[Recusa: ${rejectMotivo}]` : u.observacoes
            };
          }
          return u;
        });
        const newDb = { ...db, usuarios: updatedUsuarios };
        setDb(newDb);
        saveNotificaDatabase(newDb);
        showToast('Solicitação de acesso recusada.');
        setUserToReject(null);
      }
    } catch (err: any) {
      showToast(`Falha ao recusar: ${err?.message}`);
    } finally {
      setIsRejecting(false);
    }
  };

  const pendingReviewsCount = db.revisoes.filter((item: any) => item.situacao === 'Pendente').length;

  // Se o Supabase estiver configurado e o usuário NÃO estiver autenticado ou seu perfil não for Ativo:
  // Renderiza EXCLUSIVAMENTE a página de login isolada (sem carregar dados ou telas do sistema)
  if (isSupabaseConfigured() && (!currentAuthUser || currentUserProfile?.situacao !== 'Ativo')) {
    if (isAuthChecking) {
      return (
        <div
          style={{
            minHeight: '100vh',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            background: '#064e3b',
            color: '#ffffff',
            fontFamily: 'Inter, system-ui, sans-serif'
          }}
        >
          <div style={{ fontSize: '32px', marginBottom: '12px' }}>⚖</div>
          <div style={{ fontSize: '16px', fontWeight: 700, letterSpacing: '0.04em' }}>ADMINISTRA-CSB</div>
          <div style={{ fontSize: '11px', opacity: 0.8, marginTop: '6px' }}>Verificando autenticação institucional...</div>
        </div>
      );
    }

    const pendingNotice = (currentAuthUser && currentUserProfile?.situacao === 'Pendente')
      ? 'Sua solicitação de acesso está aguardando aprovação da Administração da CSB. Você poderá acessar o sistema assim que seu cadastro for ativado.'
      : (currentAuthUser && currentUserProfile?.situacao === 'Recusado')
      ? 'Sua solicitação de acesso foi recusada pela Administração da CSB.'
      : null;

    return (
      <LoginPage
        onLoginSuccess={(user, profile) => {
          setCurrentAuthUser(user);
          setCurrentUserProfile(profile);
          setUserRole(profile?.papel || 'Usuário');
        }}
        pendingNotice={pendingNotice}
      />
    );
  }

  return (
    <div className="shell">
      {/* Toast Notification */}
      {toastMessage && (
        <div
          style={{
            position: 'fixed',
            right: '20px',
            bottom: '20px',
            zIndex: 100,
            padding: '12px 16px',
            borderRadius: '10px',
            background: '#0f172a',
            color: 'white',
            fontSize: '12px',
            fontWeight: 800,
            boxShadow: '0 10px 30px #0f172a35'
          }}
        >
          {toastMessage}
        </div>
      )}

      {/* Mobile Overlay */}
      <div
        className={`mobile-overlay ${menuOpen ? 'show' : ''}`}
        id="overlay"
        onClick={() => setMenuOpen(false)}
      />

      {/* Sidebar Navigation */}
      <aside className={`sidebar ${menuOpen ? 'open' : ''}`} id="sidebar">
        <div className="brand">
          <div className="brand-lockup">
            <div className="logo">CSB</div>
            <div>
              <h1>
                ADMINISTRA<br />
                <span>BARRAGENS</span>
              </h1>
              <small>SEMA/MT · SURH · CSB</small>
            </div>
          </div>
        </div>

        <div className="userbox">
          <div className="avatar" id="sideAvatar">
            {db.usuarios[0]?.nome?.charAt(0) || 'A'}
          </div>
          <div>
            <strong id="sideName">{currentUserProfile?.nome || currentAuthUser?.email || 'Servidor SEMA'}</strong>
            <small id="sideRole">{currentUserProfile?.perfilProfissional || (userRole === 'Administrador' ? 'Administrador do Sistema' : userRole)}</small>
          </div>
        </div>

        <nav className="nav" id="nav">
          <div className="nav-label">Visão geral</div>
          <button
            className={`navbtn ${activeView === 'home' ? 'active' : ''}`}
            onClick={() => {
              setActiveView('home');
              setMenuOpen(false);
            }}
          >
            <span className="nav-ico">◫</span>Painel de Controle
          </button>

          <div className="nav-label">Cadastros centrais</div>
          <button
            className={`navbtn ${activeView === 'empreendedores' ? 'active' : ''}`}
            onClick={() => {
              setActiveView('empreendedores');
              setMenuOpen(false);
            }}
          >
            <span className="nav-ico">◉</span>Empreendedores
          </button>
          <button
            className={`navbtn ${activeView === 'barragens' ? 'active' : ''}`}
            onClick={() => {
              setActiveView('barragens');
              setMenuOpen(false);
            }}
          >
            <span className="nav-ico">▤</span>Barragens cadastradas
          </button>
          <button
            className={`navbtn ${activeView === 'rts' ? 'active' : ''}`}
            onClick={() => {
              setActiveView('rts');
              setMenuOpen(false);
            }}
          >
            <span className="nav-ico">⌘</span>Responsáveis Técnicos
          </button>
          <button
            className={`navbtn ${activeView === 'revisoes' ? 'active' : ''}`}
            onClick={() => {
              setActiveView('revisoes');
              setMenuOpen(false);
            }}
          >
            <span className="nav-ico">⇄</span>Conciliação de cadastros{' '}
            <span className="badge amber" style={{ marginLeft: 'auto' }}>
              {pendingReviewsCount}
            </span>
          </button>

          <div className="nav-label">Gestão de trabalho</div>
          <button
            className={`navbtn ${activeView === 'produtividade' ? 'active' : ''}`}
            onClick={() => {
              setActiveView('produtividade');
              setMenuOpen(false);
            }}
          >
            <span className="nav-ico">▥</span>Produtividade
          </button>
          <button
            className={`navbtn ${activeView === 'portarias' ? 'active' : ''}`}
            onClick={() => {
              setActiveView('portarias');
              setMenuOpen(false);
            }}
          >
            <span className="nav-ico">▣</span>Portarias
          </button>

          <div className="nav-label">Administração</div>
          {userRole === 'Administrador' && (
            <button
              className={`navbtn ${activeView === 'usuarios' ? 'active' : ''}`}
              onClick={() => {
                setActiveView('usuarios');
                setMenuOpen(false);
              }}
            >
              <span className="nav-ico">♙</span>Usuários
            </button>
          )}
          <button
            className={`navbtn ${activeView === 'integracao' ? 'active' : ''}`}
            onClick={() => {
              setActiveView('integracao');
              setMenuOpen(false);
            }}
          >
            <span className="nav-ico">⛓</span>Estrutura de integração
          </button>
          <button
            className={`navbtn ${activeView === 'referencias' ? 'active' : ''}`}
            onClick={() => {
              setActiveView('referencias');
              setMenuOpen(false);
            }}
          >
            <span className="nav-ico">⌖</span>Referências centrais
          </button>
        </nav>

        <div className="sidefoot">
          Administra como <b>cadastro central</b>
          <br />
          {supabaseStatus.connected ? 'Conectado ao Supabase' : 'Versão local · dados neste navegador'}
        </div>
      </aside>

      {/* Main Content */}
      <main className="main">
        <header className="topbar">
          <div style={{ display: 'flex', alignItems: 'center' }}>
            <button
              className="menu-toggle"
              onClick={() => setMenuOpen(!menuOpen)}
              aria-label="Abrir navegação"
            >
              ☰
            </button>
            <div className="crumb">
              SEMA/MT <span style={{ color: '#cbd5e1', margin: '0 7px' }}>/</span>
              <strong id="crumb">{viewNames[activeView] || 'Painel de Controle'}</strong>
            </div>
          </div>
          <div className="top-right">
            {supabaseStatus.connected ? (
              <span
                className="local-pill"
                style={{ background: '#ecfdf5', color: '#047857', borderColor: '#a7f3d0', cursor: 'pointer' }}
                onClick={() => setActiveView('integracao')}
                title={supabaseStatus.message}
              >
                <i style={{ background: '#10b981' }} /> SUPABASE CONECTADO ({supabaseStatus.latencyMs}ms)
              </span>
            ) : supabaseStatus.configured ? (
              <span
                className="local-pill"
                style={{ background: '#fffbeb', color: '#b45309', borderColor: '#fde68a', cursor: 'pointer' }}
                onClick={() => setActiveView('integracao')}
                title={supabaseStatus.message}
              >
                <i style={{ background: '#f59e0b' }} /> SUPABASE ERRO / LOCAL
              </span>
            ) : (
              <span
                className="local-pill"
                onClick={() => setActiveView('integracao')}
                style={{ cursor: 'pointer' }}
                title="Armazenamento local no navegador. Clique para ver configuração do Supabase."
              >
                <i /> DADOS LOCAIS · SUPABASE PENDENTE
              </span>
            )}

            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', lineHeight: 1.2 }}>
                <span className="topname" style={{ fontWeight: 600 }}>
                  {currentUserProfile?.nome || currentAuthUser?.email || 'Servidor SEMA-MT'}
                </span>
                <span style={{ fontSize: '10px', color: '#64748b' }}>
                  {currentUserProfile?.matricula ? `Matr. ${currentUserProfile.matricula} · ` : ''}
                  <span
                    style={{
                      fontWeight: 600,
                      color:
                        userRole === 'Administrador'
                          ? '#7c3aed'
                          : userRole === 'Usuário'
                          ? '#0284c7'
                          : '#475569'
                    }}
                  >
                    {userRole}
                  </span>
                </span>
              </div>

              {currentAuthUser ? (
                <button
                  type="button"
                  className="btn soft small"
                  style={{ padding: '4px 8px', fontSize: '11px' }}
                  onClick={async () => {
                    await authService.logout();
                    setCurrentAuthUser(null);
                    setCurrentUserProfile(null);
                    setShowLoginModal(true);
                  }}
                  title="Encerrar sessão"
                >
                  Sair
                </button>
              ) : isSupabaseConfigured() ? (
                <button
                  type="button"
                  className="btn green small"
                  style={{ padding: '4px 8px', fontSize: '11px' }}
                  onClick={() => setShowLoginModal(true)}
                >
                  Entrar
                </button>
              ) : (
                <select
                  className="select"
                  style={{ padding: '2px 6px', fontSize: '11px', height: '26px' }}
                  value={userRole}
                  onChange={e => setUserRole(e.target.value as UserRole)}
                  title="Simular papel localmente (modo offline)"
                >
                  <option value="Administrador">Admin (Simulado)</option>
                  <option value="Usuário">Usuário (Simulado)</option>
                  <option value="Visualizador">Visualizador (Simulado)</option>
                </select>
              )}
            </div>
          </div>
        </header>

        <section className="content" id="view">
          {/* HOME */}
          {activeView === 'home' && (
            <div>
              <div className="pagehead">
                <div>
                  <div className="eyebrow">Gestão central · SURH · CSB</div>
                  <h2>Administra Barragens</h2>
                  <p>
                    Base central de cadastros, tramitações e produtividade da Coordenadoria de
                    Segurança de Barragens.
                  </p>
                </div>
                <div className="actions">
                  <button className="btn light" onClick={() => setActiveView('integracao')}>
                    Estrutura de integração
                  </button>
                </div>
              </div>

              <div className="notice amber" style={{ marginBottom: '16px' }}>
                <b>Camada local temporária:</b> os registros são mantidos somente neste navegador. O sistema
                abre diretamente sem exigir login e está desvinculado de banco remoto nesta etapa.
              </div>

              <div className="stats">
                <div className="stat">
                  <div>
                    <div className="label">Empreendedores</div>
                    <div className="value">{db.empreendedores.length}</div>
                  </div>
                  <div className="stat-ico">◉</div>
                </div>

                <div className="stat">
                  <div>
                    <div className="label">Barragens</div>
                    <div className="value">{db.barragens.length}</div>
                  </div>
                  <div className="stat-ico">▤</div>
                </div>

                <div className="stat">
                  <div>
                    <div className="label">Responsáveis técnicos</div>
                    <div className="value">{db.rts.length}</div>
                  </div>
                  <div className="stat-ico">⌘</div>
                </div>

                <div className="stat">
                  <div>
                    <div className="label">Pendências de conciliação</div>
                    <div className="value">{pendingReviewsCount}</div>
                  </div>
                  <div className="stat-ico">⇄</div>
                </div>
              </div>

              <div className="grid2">
                <div className="panel">
                  <div className="panel-head">
                    <h3>Acesso aos cadastros centrais</h3>
                  </div>
                  <div className="panel-body" style={{ display: 'grid', gap: '9px' }}>
                    <button
                      className="rowcard"
                      style={{ width: '100%', textAlign: 'left' }}
                      onClick={() => setActiveView('empreendedores')}
                    >
                      <span>
                        <b style={{ display: 'block', color: '#172338', fontSize: '11px' }}>
                          Empreendedores
                        </b>
                        <span className="micro muted">
                          Cadastro central de pessoas físicas e jurídicas.
                        </span>
                      </span>
                      <span className="badge gray">{db.empreendedores.length} registros</span>
                    </button>

                    <button
                      className="rowcard"
                      style={{ width: '100%', textAlign: 'left' }}
                      onClick={() => setActiveView('barragens')}
                    >
                      <span>
                        <b style={{ display: 'block', color: '#172338', fontSize: '11px' }}>
                          Barragens cadastradas
                        </b>
                        <span className="micro muted">
                          Registros individuais de estruturas e seus vínculos.
                        </span>
                      </span>
                      <span className="badge gray">{db.barragens.length} registros</span>
                    </button>

                    <button
                      className="rowcard"
                      style={{ width: '100%', textAlign: 'left' }}
                      onClick={() => setActiveView('rts')}
                    >
                      <span>
                        <b style={{ display: 'block', color: '#172338', fontSize: '11px' }}>
                          Responsáveis Técnicos
                        </b>
                        <span className="micro muted">
                          Profissionais, registros e documentos técnicos.
                        </span>
                      </span>
                      <span className="badge gray">{db.rts.length} registros</span>
                    </button>
                  </div>
                </div>

                <div className="panel">
                  <div className="panel-head">
                    <h3>Estado inicial</h3>
                  </div>
                  <div className="panel-body">
                    <div className="empty">
                      <div className="empty-icon">⌂</div>
                      <b>Sem cadastros demonstrativos</b>
                      <p>
                        Os módulos começam vazios. Inclua registros apenas quando desejar testar o
                        fluxo.
                      </p>
                    </div>
                  </div>
                </div>
              </div>

              <div className="grid2" style={{ marginTop: '16px' }}>
                <div className="panel">
                  <div className="panel-head">
                    <h3>Gestão de trabalho</h3>
                  </div>
                  <div className="panel-body" style={{ display: 'grid', gap: '9px' }}>
                    <button
                      className="rowcard"
                      style={{ width: '100%', textAlign: 'left' }}
                      onClick={() => setActiveView('produtividade')}
                    >
                      <span>
                        <b style={{ display: 'block', color: '#172338', fontSize: '11px' }}>
                          Produtividade
                        </b>
                        <span className="micro muted">
                          Lançamentos por servidor, inclusive atividades manuais.
                        </span>
                      </span>
                      <span className="badge gray">{db.produtividades.length} registros</span>
                    </button>
                    <button
                      className="rowcard"
                      style={{ width: '100%', textAlign: 'left' }}
                      onClick={() => setActiveView('portarias')}
                    >
                      <span>
                        <b style={{ display: 'block', color: '#172338', fontSize: '11px' }}>
                          Portarias
                        </b>
                        <span className="micro muted">
                          Acompanhamento de assinatura e publicação.
                        </span>
                      </span>
                      <span className="badge gray">{db.portarias.length} registros</span>
                    </button>
                  </div>
                </div>

                <div className="panel">
                  <div className="panel-head">
                    <h3>Referências compartilháveis</h3>
                  </div>
                  <div className="panel-body">
                    <p className="muted" style={{ fontSize: '11px', margin: '0 0 12px' }}>
                      A base de municípios fica centralizada no Administra, sem tela de módulo
                      própria. Após a integração, os sistemas consumidores deverão consultar a
                      referência mantida aqui.
                    </p>
                    <button
                      className="btn soft small"
                      onClick={() => setActiveView('referencias')}
                    >
                      Ver estrutura das referências
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* DYNAMIC MODULE VIEW (empreendedores, barragens, rts, usuarios) */}
          {modules[activeView] && (() => {
            const config = modules[activeView];
            const records: any[] = db[activeView as keyof typeof db] || [];
            const term = (searchTerms[activeView] || '').toLowerCase().trim();

            const filteredRecords = records.filter(rec => {
              if (activeView === 'usuarios' && usuarioSituacaoFilter !== 'Todos') {
                if (rec.situacao !== usuarioSituacaoFilter) return false;
              }
              if (!term) return true;
              if (activeView === 'barragens') {
                const resolvedEmp = resolveDamEntrepreneur(rec.empreendedor, db.empreendedores);
                if (resolvedEmp.displayName.toLowerCase().includes(term)) return true;
                const linkedEmp = db.empreendedores.find(e => String(e.id) === String(rec.empreendedor));
                const resolvedEmpr = resolveDamEmpreendimento(rec.empreendimento, linkedEmp?.empreendimentos || []);
                if (resolvedEmpr.displayName.toLowerCase().includes(term)) return true;
                if (String(rec.municipio || '').toLowerCase().includes(term)) return true;
                if (String(rec.municipioIbge || '').includes(term)) return true;
              }
              if (activeView === 'empreendedores') {
                if (rec.uf && String(rec.uf).toLowerCase().includes(term)) return true;
                if (rec.municipioIbge && String(rec.municipioIbge).includes(term)) return true;
                if (rec.empreendimentos?.some((em: any) =>
                  String(em.nome || '').toLowerCase().includes(term) ||
                  String(em.car || '').toLowerCase().includes(term) ||
                  String(em.escritura || '').toLowerCase().includes(term) ||
                  String(em.tipo || '').toLowerCase().includes(term)
                )) {
                  return true;
                }
              }
              if (activeView === 'rts') {
                const damName = resolveDamName(rec.barragemVinculada, db.barragens);
                if (damName.toLowerCase().includes(term)) return true;
              }
              return config.search.some(f => String(rec[f] || '').toLowerCase().includes(term));
            });

            const pendingUsersCount = activeView === 'usuarios'
              ? records.filter((u: any) => u.situacao === 'Pendente').length
              : 0;

            return (
              <div>
                <div className="pagehead">
                  <div>
                    <div className="eyebrow">Cadastro central</div>
                    <h2>{config.title}</h2>
                    <p>Consulte e mantenha os registros desta base central do Administra.</p>
                  </div>
                  <div className="actions">
                    {userRole !== 'Visualizador' && (
                      <button
                        className="btn green"
                        onClick={() => handleOpenRecordModal(activeView)}
                      >
                        ＋ Novo cadastro
                      </button>
                    )}
                  </div>
                </div>

                {activeView === 'usuarios' && pendingUsersCount > 0 && userRole === 'Administrador' && (
                  <div
                    style={{
                      marginBottom: '16px',
                      padding: '16px',
                      background: '#fffbeb',
                      border: '1px solid #fde68a',
                      borderRadius: '12px'
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '10px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <span style={{ fontSize: '18px' }}>⏳</span>
                        <strong style={{ fontSize: '13px', color: '#92400e' }}>
                          Solicitações de Acesso Pendentes ({pendingUsersCount})
                        </strong>
                      </div>
                      <span style={{ fontSize: '11px', color: '#b45309' }}>
                        Defina a função do usuário para criar/ativar a credencial no Supabase Auth
                      </span>
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                      {records
                        .filter((u: any) => u.situacao === 'Pendente')
                        .map((pu: any) => (
                          <div
                            key={pu.id}
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'space-between',
                              background: '#ffffff',
                              padding: '10px 14px',
                              borderRadius: '8px',
                              border: '1px solid #fcd34d'
                            }}
                          >
                            <div>
                              <strong style={{ fontSize: '13px', color: '#1f2937' }}>{pu.nome}</strong>
                              <span style={{ fontSize: '11px', color: '#6b7280', marginLeft: '8px' }}>
                                Matr. {pu.matricula || '—'} · {pu.email} · {pu.setor || pu.perfilProfissional || 'SEMA-MT'}
                              </span>
                            </div>
                            <div style={{ display: 'flex', gap: '6px' }}>
                              <button
                                type="button"
                                className="btn green small"
                                style={{ padding: '4px 10px', fontSize: '11px' }}
                                onClick={() => {
                                  setUserToApprove(pu);
                                  setApprovalRole('Usuário');
                                }}
                              >
                                Aprovar Acesso
                              </button>
                              <button
                                type="button"
                                className="btn soft small"
                                style={{ padding: '4px 10px', fontSize: '11px', color: '#dc2626' }}
                                onClick={() => {
                                  setUserToReject(pu);
                                  setRejectMotivo('');
                                }}
                              >
                                Recusar
                              </button>
                            </div>
                          </div>
                        ))}
                    </div>
                  </div>
                )}

                {activeView === 'usuarios' && (
                  <div className="notice slate" style={{ marginBottom: '14px', fontSize: '11px' }}>
                    Gestão de usuários da CSB: todos os registros (Ativos, Inativos, Pendentes e Recusados) são listados e protegidos por RLS.
                  </div>
                )}

                <div className="panel">
                  <div className="toolbar" style={{ flexWrap: 'wrap', gap: '10px' }}>
                    <div className="field-search">
                      <span>⌕</span>
                      <input
                        className="input"
                        placeholder="Pesquisar registros..."
                        value={searchTerms[activeView] || ''}
                        onChange={e =>
                          setSearchTerms(prev => ({ ...prev, [activeView]: e.target.value }))
                        }
                      />
                    </div>

                    {activeView === 'usuarios' && (
                      <div style={{ display: 'flex', gap: '6px', alignItems: 'center', flexWrap: 'wrap' }}>
                        {['Todos', 'Pendente', 'Ativo', 'Inativo', 'Recusado'].map(st => {
                          const count = st === 'Todos' ? records.length : records.filter((u: any) => u.situacao === st).length;
                          const isSelected = usuarioSituacaoFilter === st;
                          return (
                            <button
                              key={st}
                              type="button"
                              className={`btn ${isSelected ? 'soft' : 'light'} small`}
                              style={{
                                padding: '3px 8px',
                                fontSize: '11px',
                                fontWeight: isSelected ? 700 : 500,
                                borderColor: isSelected ? '#047857' : undefined,
                                color: isSelected ? '#047857' : undefined
                              }}
                              onClick={() => setUsuarioSituacaoFilter(st)}
                            >
                              {st === 'Todos' ? `Todos (${count})` : `${st}s (${count})`}
                            </button>
                          );
                        })}
                      </div>
                    )}

                    <span className="badge gray" style={{ marginLeft: 'auto' }}>{filteredRecords.length} registros</span>
                  </div>

                  <div className="tablewrap">
                    <table>
                      <thead>
                        <tr>
                          {config.columns.map(([, label], cIdx) => (
                            <th key={cIdx}>{label}</th>
                          ))}
                          <th>Ações</th>
                        </tr>
                      </thead>
                      <tbody>
                        {filteredRecords.length > 0 ? (
                          filteredRecords.map((record, index) => {
                            const originalIndex = records.indexOf(record);
                            return (
                              <tr key={record.id || index}>
                                {config.columns.map(([field], fIdx) => {
                                  let value = record[field];
                                  if (field === 'validade' || field === 'dataPublicacao') {
                                    value = formatDate(value);
                                  }
                                  if (activeView === 'barragens' && field === 'empreendedor') {
                                    value = resolveDamEntrepreneur(record.empreendedor, db.empreendedores).displayName;
                                  }
                                  if (activeView === 'barragens' && field === 'empreendimento') {
                                    const linkedEmp = db.empreendedores.find(e => String(e.id) === String(record.empreendedor));
                                    value = resolveDamEmpreendimento(record.empreendimento, linkedEmp?.empreendimentos || []).displayName;
                                  }
                                  if (activeView === 'barragens' && field === 'municipio') {
                                    value = record.municipio ? `${record.municipio}${record.municipioIbge ? ` (${record.municipioIbge})` : ''}` : '—';
                                  }
                                  if (activeView === 'empreendedores' && field === 'municipio') {
                                    value = record.municipio ? `${record.municipio}${record.uf ? `/${record.uf}` : ''}` : '—';
                                  }
                                  if (activeView === 'empreendedores' && field === 'empreendimentos') {
                                    const count = record.empreendimentos?.length || 0;
                                    value = count > 0 ? `${count} empreendimento(s)` : 'Nenhum';
                                  }
                                  if (activeView === 'rts' && field === 'barragemVinculada') {
                                    value = resolveDamName(record.barragemVinculada, db.barragens);
                                  }
                                  if (activeView === 'usuarios' && field === 'situacao') {
                                    const sit = record.situacao || 'Ativo';
                                    const badgeClass =
                                      sit === 'Ativo'
                                        ? 'green'
                                        : sit === 'Pendente'
                                        ? 'amber'
                                        : sit === 'Recusado'
                                        ? 'red'
                                        : 'gray';
                                    return (
                                      <td key={field}>
                                        <span className={`badge ${badgeClass}`}>{sit}</span>
                                      </td>
                                    );
                                  }
                                  if (activeView === 'usuarios' && field === 'papel') {
                                    const p = record.papel || 'Usuário';
                                    return (
                                      <td key={field}>
                                        <span className={`badge ${p === 'Administrador' ? 'blue' : 'gray'}`}>{p}</span>
                                      </td>
                                    );
                                  }
                                  const className = fIdx === 0 ? 'td-main' : '';
                                  return (
                                    <td key={field} className={className}>
                                      {valueLabel(value)}
                                    </td>
                                  );
                                })}
                                <td>
                                  <div className="row-actions">
                                    {activeView === 'usuarios' && record.situacao === 'Pendente' && userRole === 'Administrador' && (
                                      <>
                                        <button
                                          className="iconbtn"
                                          style={{ color: '#047857', fontWeight: 700 }}
                                          title="Aprovar e ativar usuário no Supabase Auth"
                                          onClick={() => {
                                            setUserToApprove(record);
                                            setApprovalRole('Usuário');
                                          }}
                                        >
                                          Aprovar
                                        </button>
                                        <button
                                          className="iconbtn"
                                          style={{ color: '#dc2626' }}
                                          title="Recusar solicitação"
                                          onClick={() => {
                                            setUserToReject(record);
                                            setRejectMotivo('');
                                          }}
                                        >
                                          Recusar
                                        </button>
                                      </>
                                    )}

                                    {userRole === 'Visualizador' ? (
                                      <button
                                        className="iconbtn"
                                        title="Visualizar detalhes"
                                        onClick={() => handleOpenRecordModal(activeView, originalIndex)}
                                      >
                                        Detalhes
                                      </button>
                                    ) : (
                                      <>
                                        {(userRole === 'Administrador' || !record.createdBy || record.createdBy === currentAuthUser?.id) ? (
                                          <button
                                            className="iconbtn"
                                            title="Editar"
                                            onClick={() => handleOpenRecordModal(activeView, originalIndex)}
                                          >
                                            Editar
                                          </button>
                                        ) : (
                                          <button
                                            className="iconbtn"
                                            title="Registro criado por outro usuário. Somente leitura."
                                            onClick={() => handleOpenRecordModal(activeView, originalIndex)}
                                          >
                                            Visualizar
                                          </button>
                                        )}

                                        {(userRole === 'Administrador' || !record.createdBy || record.createdBy === currentAuthUser?.id) && (
                                          <button
                                            className="iconbtn"
                                            title="Inativar registro"
                                            onClick={() => handleArchiveRecord(activeView, originalIndex)}
                                          >
                                            Inativar
                                          </button>
                                        )}

                                        {userRole === 'Administrador' && (
                                          <button
                                            className="iconbtn"
                                            style={{ color: '#dc2626' }}
                                            title="Excluir definitivamente"
                                            onClick={() => handleDeleteRecord(activeView, originalIndex)}
                                          >
                                            Excluir
                                          </button>
                                        )}
                                      </>
                                    )}
                                  </div>
                                </td>
                              </tr>
                            );
                          })
                        ) : (
                          <tr>
                            <td colSpan={config.columns.length + 1}>
                              <div className="empty">
                                <div className="empty-icon">{config.icon}</div>
                                <b>Nenhum cadastro</b>
                                <p>Esta lista permanece vazia até que um registro seja incluído.</p>
                              </div>
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            );
          })()}

          {/* PRODUTIVIDADE SURH */}
          {activeView === 'produtividade' && (() => {
            const records: any[] = db.produtividades || [];
            const totalPoints = records.reduce((sum, item) => sum + getProductivityPoints(item), 0);
            const pendingExtras = records.filter(item => item.kind === 'extra' && item.extraStatus === 'Pendente').length;
            const checkedForOfficialSheet = records.filter(item => item.inOfficialSheet).length;
            const term = (searchTerms['produtividade'] || '').toLowerCase().trim();

            const filtered = records.filter(rec => {
              if (!term) return true;
              const text = `${rec.serverName || ''} ${rec.productTitle || ''} ${rec.productCode || ''} ${rec.description || ''} ${rec.processRef || ''} ${rec.documentRef || ''}`.toLowerCase();
              return text.includes(term);
            });

            return (
              <div>
                <div className="pagehead">
                  <div>
                    <div className="eyebrow">Gestão de trabalho · SURH</div>
                    <h2>Produtividade</h2>
                    <p>Registre produtos realizados, atividades sem pontuação e atividades extras de gestão.</p>
                  </div>
                  <div className="actions">
                    <button className="btn green" onClick={() => handleOpenProductivityModal()}>
                      ＋ Novo lançamento
                    </button>
                  </div>
                </div>

                <div className="notice amber" style={{ marginBottom: '14px' }}>
                  <b>Pontuação:</b> produtos pontuáveis usam os valores do Anexo I – SURH da Portaria nº 1.480/2026.
                  Ofícios podem ser registrados como atividade sem pontuação. A atividade extra depende de validação
                  e das condições do art. 8º; não é somada enquanto estiver pendente.
                </div>

                <div className="stats">
                  <div className="stat">
                    <div><div className="label">Lançamentos</div><div className="value">{records.length}</div></div>
                    <div className="stat-ico">▥</div>
                  </div>
                  <div className="stat">
                    <div><div className="label">Pontos aprovados</div><div className="value">{totalPoints}</div></div>
                    <div className="stat-ico">✓</div>
                  </div>
                  <div className="stat">
                    <div><div className="label">Extras pendentes</div><div className="value">{pendingExtras}</div></div>
                    <div className="stat-ico">◷</div>
                  </div>
                  <div className="stat">
                    <div><div className="label">Marcados na planilha</div><div className="value">{checkedForOfficialSheet}</div></div>
                    <div className="stat-ico">▣</div>
                  </div>
                </div>

                <div className="panel" style={{ marginBottom: '14px' }}>
                  <div className="panel-head">
                    <h3>Minha produtividade</h3>
                    <span className="badge gray">Filtro pelo nome do servidor</span>
                  </div>
                  <div className="toolbar">
                    <div className="field-search">
                      <span>⌕</span>
                      <input
                        className="input"
                        placeholder="Digite seu nome para filtrar..."
                        value={searchTerms['produtividade'] || ''}
                        onChange={e => setSearchTerms(prev => ({ ...prev, produtividade: e.target.value }))}
                      />
                    </div>
                    <span className="micro muted">Sem autenticação ativa: a identificação é informada no lançamento e no filtro.</span>
                  </div>
                </div>

                <div className="panel">
                  <div className="panel-head">
                    <h3>Lançamentos de produtividade</h3>
                    <span className="badge gray">{records.length} registros</span>
                  </div>
                  <div className="tablewrap">
                    <table>
                      <thead>
                        <tr>
                          <th>Data / Servidor</th>
                          <th>Produto / atividade</th>
                          <th>Origem / referência</th>
                          <th>Pontos</th>
                          <th>Situação</th>
                          <th>Planilha oficial</th>
                          <th>Ações</th>
                        </tr>
                      </thead>
                      <tbody>
                        {filtered.length > 0 ? (
                          filtered.map((record, index) => {
                            const originalIndex = records.indexOf(record);
                            const details = [
                              record.productCode ? `Código ${record.productCode}` : '',
                              record.quantity && record.kind === 'scored' ? `Quantidade: ${record.quantity}` : '',
                              record.description || ''
                            ].filter(Boolean).join(' · ');

                            const refs = [
                              record.sourceType === 'manual' ? 'Manual' : 'Informado como registro de sistema',
                              record.sourceName || '',
                              record.processRef ? `Processo: ${record.processRef}` : '',
                              record.documentRef ? `Documento: ${record.documentRef}` : ''
                            ].filter(Boolean).join(' · ');

                            const points = getProductivityPoints(record);
                            const canApprove = record.kind === 'extra' && record.extraStatus === 'Pendente';

                            return (
                              <tr key={record.id || index}>
                                <td>
                                  <span className="td-main">{formatDate(record.date)}</span>
                                  <span className="td-sub">{valueLabel(record.serverName)}</span>
                                </td>
                                <td>
                                  <span className="td-main">{valueLabel(record.productTitle)}</span>
                                  <span className="td-sub">{details}</span>
                                </td>
                                <td style={{ whiteSpace: 'normal', minWidth: '180px' }}>
                                  <span className="micro">{refs || '—'}</span>
                                  {record.kind === 'extra' && (
                                    <>
                                      <span className="td-sub">Ordem de serviço: {valueLabel(record.extraOrder)}</span>
                                      <span className="td-sub">Aprovação prévia: {valueLabel(record.extraApproval)}</span>
                                    </>
                                  )}
                                </td>
                                <td className="td-main">{points}</td>
                                <td>
                                  {record.kind === 'extra' ? (
                                    record.extraStatus === 'Aprovada' ? (
                                      <span className="badge green">Extra aprovada</span>
                                    ) : record.extraStatus === 'Não aprovada' ? (
                                      <span className="badge red">Extra não aprovada</span>
                                    ) : (
                                      <span className="badge amber">Aguardando validação</span>
                                    )
                                  ) : record.kind === 'unscored' ? (
                                    <span className="badge gray">Sem pontuação</span>
                                  ) : (
                                    <span className="badge blue">Produto SURH</span>
                                  )}
                                  {record.extraStatus === 'Aprovada' && record.coordinator && (
                                    <span className="td-sub">Validada por {record.coordinator}</span>
                                  )}
                                  {record.extraStatus === 'Não aprovada' && record.coordinator && (
                                    <span className="td-sub">Decisão por {record.coordinator}</span>
                                  )}
                                </td>
                                <td>
                                  <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '10px', whiteSpace: 'nowrap', cursor: 'pointer' }}>
                                    <input
                                      type="checkbox"
                                      checked={Boolean(record.inOfficialSheet)}
                                      onChange={e => handleToggleOfficialSheet(originalIndex, e.target.checked)}
                                    />
                                    {record.inOfficialSheet ? 'Inserido' : 'Pendente'}
                                  </label>
                                  {record.officialSheetAt && (
                                    <span className="td-sub">{formatDate(record.officialSheetAt.slice(0, 10))}</span>
                                  )}
                                </td>
                                <td>
                                  <div className="row-actions">
                                    {canApprove && (
                                      <>
                                        <button className="iconbtn" onClick={() => handleReviewExtra(originalIndex, true)}>Validar</button>
                                        <button className="iconbtn" onClick={() => handleReviewExtra(originalIndex, false)}>Recusar</button>
                                      </>
                                    )}
                                    <button className="iconbtn" onClick={() => handleOpenProductivityModal(originalIndex)}>Editar</button>
                                    <button className="iconbtn" onClick={() => handleDeleteProductivity(originalIndex)}>Excluir</button>
                                  </div>
                                </td>
                              </tr>
                            );
                          })
                        ) : (
                          <tr>
                            <td colSpan={7}>
                              <div className="empty">
                                <div className="empty-icon">▥</div>
                                <b>Nenhum lançamento</b>
                                <p>Os registros começam vazios e serão incluídos manualmente ou, futuramente, recebidos de sistemas integrados.</p>
                              </div>
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>

                <div className="panel" style={{ marginTop: '14px' }}>
                  <div className="panel-head">
                    <h3>Referência de pontuação</h3>
                    <span className="badge blue">Anexo I – SURH</span>
                  </div>
                  <div className="panel-body">
                    <p className="muted" style={{ fontSize: '11px', margin: '0 0 10px' }}>
                      O código e a descrição do produto ficam registrados para facilitar a futura organização conforme a planilha oficial da chefia.
                    </p>
                    <div className="tablewrap">
                      <table>
                        <thead>
                          <tr>
                            <th>Nível</th>
                            <th>Código</th>
                            <th>Produto</th>
                            <th>Pontos</th>
                          </tr>
                        </thead>
                        <tbody>
                          {SURH_PRODUCTS.map(product => (
                            <tr key={product.code}>
                              <td>{product.level}</td>
                              <td className="td-main">{product.code}</td>
                              <td style={{ whiteSpace: 'normal', minWidth: '280px' }}>{product.title}</td>
                              <td className="td-main">{product.points}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    <div className="notice slate" style={{ marginTop: '12px' }}>
                      <b>Atividade extra (art. 8º):</b> até 8 pontos por servidor e por dia, mediante requisição ou ordem de serviço,
                      com critério e termos previamente aprovados formalmente. O protótipo exige registrar essas referências e
                      deixa a pontuação fora do total até a validação.
                    </div>
                  </div>
                </div>
              </div>
            );
          })()}

          {/* PORTARIAS */}
          {activeView === 'portarias' && (() => {
            const records: any[] = db.portarias || [];
            const completed = records.filter(item => item.secretarySigned && item.extractPublished && item.orderPublished).length;
            const pending = records.length - completed;
            const term = (searchTerms['portarias'] || '').toLowerCase().trim();

            const filtered = records.filter(rec => {
              if (!term) return true;
              return `${rec.processNumber || ''} ${rec.orderNumber || ''} ${rec.notes || ''}`.toLowerCase().includes(term);
            });

            return (
              <div>
                <div className="pagehead">
                  <div>
                    <div className="eyebrow">Tramitação administrativa</div>
                    <h2>Portarias</h2>
                    <p>Acompanhe os processos, a assinatura e as publicações das Portarias.</p>
                  </div>
                  <div className="actions">
                    <button className="btn green" onClick={() => handleOpenPortariaModal()}>
                      ＋ Novo trâmite
                    </button>
                  </div>
                </div>

                <div className="stats">
                  <div className="stat">
                    <div><div className="label">Total de trâmites</div><div className="value">{records.length}</div></div>
                    <div className="stat-ico">▣</div>
                  </div>
                  <div className="stat">
                    <div><div className="label">Pendentes</div><div className="value">{pending}</div></div>
                    <div className="stat-ico">◷</div>
                  </div>
                  <div className="stat">
                    <div><div className="label">Concluídos</div><div className="value">{completed}</div></div>
                    <div className="stat-ico">✓</div>
                  </div>
                  <div className="stat">
                    <div><div className="label">Rascunhos</div><div className="value">{records.filter((item: any) => item.draft).length}</div></div>
                    <div className="stat-ico">✎</div>
                  </div>
                </div>

                <div className="panel">
                  <div className="panel-head">
                    <h3>Trâmites de Portarias</h3>
                    <span className="badge gray">{records.length} registros</span>
                  </div>
                  <div className="toolbar">
                    <div className="field-search">
                      <span>⌕</span>
                      <input
                        className="input"
                        placeholder="Buscar por processo, portaria ou observação..."
                        value={searchTerms['portarias'] || ''}
                        onChange={e => setSearchTerms(prev => ({ ...prev, portarias: e.target.value }))}
                      />
                    </div>
                  </div>
                  <div className="tablewrap">
                    <table>
                      <thead>
                        <tr>
                          <th>Processo</th>
                          <th>Portaria</th>
                          <th>Envio</th>
                          <th>Etapas</th>
                          <th>Situação</th>
                          <th>Ações</th>
                        </tr>
                      </thead>
                      <tbody>
                        {filtered.length > 0 ? (
                          filtered.map((record, index) => {
                            const originalIndex = records.indexOf(record);
                            const complete = record.secretarySigned && record.extractPublished && record.orderPublished;
                            const status = record.draft ? 'Rascunho' : complete ? 'Concluído' : 'Pendente';
                            const statusClass = record.draft ? 'gray' : complete ? 'green' : 'amber';

                            return (
                              <tr key={record.id || index}>
                                <td className="td-main">{valueLabel(record.processNumber)}</td>
                                <td className="td-main">{valueLabel(record.orderNumber)}</td>
                                <td>{formatDate(record.sentDate)}</td>
                                <td>
                                  <span className={`badge ${record.secretarySigned ? 'green' : 'gray'}`}>
                                    Assinatura {record.secretarySigned ? '✓' : '—'}
                                  </span>{' '}
                                  <span className={`badge ${record.extractPublished ? 'green' : 'gray'}`}>
                                    Extrato {record.extractPublished ? '✓' : '—'}
                                  </span>{' '}
                                  <span className={`badge ${record.orderPublished ? 'green' : 'gray'}`}>
                                    Portaria {record.orderPublished ? '✓' : '—'}
                                  </span>
                                </td>
                                <td><span className={`badge ${statusClass}`}>{status}</span></td>
                                <td>
                                  <div className="row-actions">
                                    <button className="iconbtn" onClick={() => handleOpenPortariaModal(originalIndex)}>Editar</button>
                                    <button className="iconbtn" onClick={() => handleDeletePortaria(originalIndex)}>Excluir</button>
                                  </div>
                                </td>
                              </tr>
                            );
                          })
                        ) : (
                          <tr>
                            <td colSpan={6}>
                              <div className="empty">
                                <div className="empty-icon">▣</div>
                                <b>Nenhum trâmite de Portaria</b>
                                <p>Os registros começam vazios. Use “Novo trâmite” para incluir um registro.</p>
                              </div>
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            );
          })()}

          {/* CONCILIAÇÃO DE CADASTROS */}
          {activeView === 'revisoes' && (
            <div>
              <div className="pagehead">
                <div>
                  <div className="eyebrow">Qualidade cadastral</div>
                  <h2>Conciliação de cadastros</h2>
                  <p>Área prevista para comparar registros de origens diferentes e registrar uma decisão explícita.</p>
                </div>
                <div className="actions">
                  <button
                    className="btn light"
                    onClick={() => showToast('A entrada de registros será habilitada na etapa de integração.')}
                  >
                    Adicionar comparação
                  </button>
                </div>
              </div>

              <div className="notice slate" style={{ marginBottom: '14px' }}>
                Não há sistemas conectados nem registros importados. Nenhuma comparação ou cadastro demonstrativo foi criado.
              </div>

              <div className="panel">
                <div className="panel-head">
                  <h3>Revisões pendentes e concluídas</h3>
                  <span className="badge gray">{db.revisoes.length} registros</span>
                </div>
                <div className="empty">
                  <div className="empty-icon">⇄</div>
                  <b>Nenhuma revisão cadastrada</b>
                  <p>Quando houver registros de fontes distintas, a comparação deverá exibir origem e diferenças sem apagar os dados originais.</p>
                </div>
              </div>
            </div>
          )}

          {/* ESTRUTURA DE INTEGRAÇÃO */}
          {activeView === 'integracao' && (
            <div>
              <div className="pagehead">
                <div>
                  <div className="eyebrow">Arquitetura e banco de dados</div>
                  <h2>Estrutura de integração e Supabase</h2>
                  <p>Configuração do banco de dados relacional Supabase e sincronização com o armazenamento local.</p>
                </div>
              </div>

              {/* PAINEL SUPABASE */}
              <div className="panel" style={{ marginBottom: '20px' }}>
                <div className="panel-head">
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                    <span className="badge green">Supabase</span>
                    <h3>Banco de Dados Central</h3>
                  </div>
                  <button
                    type="button"
                    className="btn light small"
                    onClick={() => {
                      showToast('Testando conexão com o Supabase...');
                      checkSupabaseConnection().then(status => {
                        setSupabaseStatus(status);
                        showToast(status.message);
                      });
                    }}
                  >
                    Testar conexão agora
                  </button>
                </div>
                <div className="panel-body">
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '16px', marginBottom: '18px' }}>
                    <div style={{ padding: '14px', borderRadius: '10px', background: '#f8fafc', border: '1px solid #e2e8f0' }}>
                      <span className="muted" style={{ fontSize: '11px', display: 'block', marginBottom: '4px' }}>Status da Conexão</span>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' }}>
                        <span className={`badge ${supabaseStatus.connected ? 'green' : supabaseStatus.configured ? 'amber' : 'gray'}`}>
                          {supabaseStatus.connected ? 'Conectado' : supabaseStatus.configured ? 'Erro / Não conectado' : 'Não configurado'}
                        </span>
                        {supabaseStatus.latencyMs !== undefined && (
                          <span style={{ fontSize: '11px', color: '#64748b' }}>{supabaseStatus.latencyMs}ms de latência</span>
                        )}
                      </div>
                      <p style={{ margin: 0, fontSize: '11px', color: '#475569' }}>
                        {supabaseStatus.message}
                      </p>
                    </div>

                    <div style={{ padding: '14px', borderRadius: '10px', background: '#f8fafc', border: '1px solid #e2e8f0' }}>
                      <span className="muted" style={{ fontSize: '11px', display: 'block', marginBottom: '4px' }}>Variáveis de Ambiente</span>
                      <div style={{ fontSize: '11px', lineHeight: 1.8 }}>
                        <div>
                          <b>VITE_SUPABASE_URL:</b>{' '}
                          {import.meta.env.VITE_SUPABASE_URL ? (
                            <span style={{ color: '#059669' }}>Configurada</span>
                          ) : (
                            <span style={{ color: '#d97706' }}>Ausente no .env</span>
                          )}
                        </div>
                        <div>
                          <b>VITE_SUPABASE_ANON_KEY:</b>{' '}
                          {import.meta.env.VITE_SUPABASE_ANON_KEY ? (
                            <span style={{ color: '#059669' }}>Configurada (Chave pública anônima)</span>
                          ) : (
                            <span style={{ color: '#d97706' }}>Ausente no .env</span>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* AVISO CRÍTICO DE SEGURANÇA SOBRE RLS E LOGIN */}
                  <div className="notice amber" style={{ marginBottom: '18px' }}>
                    <strong style={{ display: 'block', marginBottom: '4px' }}>
                      Aviso de Segurança · RLS e Operação sem Login:
                    </strong>
                    O sistema está atualmente operando com acesso direto (sem tela de login). Ao conectar o cliente frontend diretamente ao Supabase com a chave pública anônima, todas as requisições utilizam a role PostgreSQL <code>anon</code>.
                    <br />
                    <strong>Atenção:</strong> Criar políticas de acesso irrestrito para <code>anon</code> deixaria os dados legíveis e modificáveis por qualquer pessoa com acesso à URL do sistema. A alternativa mais segura é manter as permissões restritas e implementar a autenticação de usuários (Supabase Auth) na próxima etapa.
                  </div>

                  {/* PAINEL DE MIGRAÇÃO E CONTROLE LOCAL */}
                  <div style={{ borderTop: '1px solid #e2e8f0', paddingTop: '16px' }}>
                    <h4 style={{ fontSize: '13px', fontWeight: 700, margin: '0 0 10px', color: '#0f172a' }}>
                      Migração Segura de Registros Locais para o Supabase
                    </h4>
                    <p style={{ fontSize: '11px', color: '#64748b', margin: '0 0 14px' }}>
                      Os dados salvos no navegador são preservados na chave <code>notifica_csb_local_v1</code>. A migração envia os registros existentes sem criar duplicidades (atualizando registros com o mesmo ID).
                    </p>

                    <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginBottom: '16px' }}>
                      {Object.keys(db).map(k => {
                        const count = Array.isArray(db[k]) ? db[k].length : 0;
                        return (
                          <div
                            key={k}
                            style={{
                              padding: '6px 12px',
                              borderRadius: '8px',
                              background: '#f1f5f9',
                              fontSize: '11px',
                              color: '#334155'
                            }}
                          >
                            <span style={{ textTransform: 'capitalize' }}>{k}:</span> <b>{count}</b> local(is)
                          </div>
                        );
                      })}
                    </div>

                    <div style={{ display: 'flex', gap: '12px', alignItems: 'center', flexWrap: 'wrap' }}>
                      <button
                        type="button"
                        className="btn green"
                        disabled={isMigrating || !isSupabaseConfigured()}
                        onClick={async () => {
                          if (!isSupabaseConfigured()) {
                            showToast('Configure as variáveis VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY primeiro.');
                            return;
                          }
                          setIsMigrating(true);
                          showToast('Iniciando migração dos dados locais para o Supabase...');
                          try {
                            const res = await notificaDataService.migrateLocalToSupabase();
                            setMigrationSummary({
                              totalMigrated: res.totalMigrated,
                              errorCount: res.errorCount,
                              summaries: res.summaries
                            });
                            if (res.success) {
                              showToast(`Migração concluída com sucesso! ${res.totalMigrated} registros enviados.`);
                            } else {
                              showToast(`Migração finalizada com ${res.errorCount} erro(s). Confira os detalhes abaixo.`);
                            }
                          } catch (err: any) {
                            showToast(`Falha na migração: ${err?.message || 'Erro desconhecido'}`);
                          } finally {
                            setIsMigrating(false);
                          }
                        }}
                      >
                        {isMigrating ? 'Migrando registros...' : 'Migrar registros locais para o Supabase'}
                      </button>

                      {migrationSummary && (
                        <span style={{ fontSize: '11px', color: migrationSummary.errorCount > 0 ? '#b45309' : '#059669' }}>
                          Resultado: <b>{migrationSummary.totalMigrated}</b> enviados ·{' '}
                          <b>{migrationSummary.errorCount}</b> erro(s).
                        </span>
                      )}
                    </div>

                    {/* RELATÓRIO DETALHADO DE MIGRAÇÃO */}
                    {migrationSummary && migrationSummary.summaries.length > 0 && (
                      <div style={{ marginTop: '14px', padding: '12px', background: '#f8fafc', borderRadius: '8px', border: '1px solid #e2e8f0', fontSize: '11px' }}>
                        <strong style={{ display: 'block', marginBottom: '8px' }}>Resumo por coleção:</strong>
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '8px' }}>
                          {migrationSummary.summaries.map(s => (
                            <div key={s.collection} style={{ padding: '6px 10px', background: '#ffffff', borderRadius: '6px', border: '1px solid #cbd5e1' }}>
                              <b style={{ textTransform: 'capitalize' }}>{s.collection}</b>: {s.migrated}/{s.totalLocal} migrados
                              {s.errors.length > 0 && (
                                <div style={{ color: '#dc2626', fontSize: '10px', marginTop: '4px' }}>
                                  {s.errors.length} erro(s): {s.errors.slice(0, 2).join('; ')}
                                </div>
                              )}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* SALVAGUARDA DE LIMPEZA LOCAL APENAS APÓS CONFERÊNCIA */}
                    <div style={{ marginTop: '20px', padding: '14px', background: '#fffbeb', borderRadius: '10px', border: '1px solid #fef3c7' }}>
                      <strong style={{ fontSize: '12px', color: '#92400e', display: 'block', marginBottom: '6px' }}>
                        Salvaguarda do Armazenamento Local
                      </strong>
                      <p style={{ fontSize: '11px', color: '#78350f', margin: '0 0 10px' }}>
                        Por segurança, o Administra Barragens nunca apaga o armazenamento local automaticamente. A remoção da cópia local só deve ser realizada após você conferir que todos os registros estão presentes e íntegros no painel do Supabase.
                      </p>
                      <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '11px', color: '#78350f', cursor: 'pointer', marginBottom: '10px' }}>
                        <input
                          type="checkbox"
                          checked={confirmLocalClear}
                          onChange={e => setConfirmLocalClear(e.target.checked)}
                        />
                        <span>Confirmo que conferi os registros no Supabase e desejo remover a cópia local deste navegador.</span>
                      </label>
                      <button
                        type="button"
                        className="btn light small"
                        disabled={!confirmLocalClear}
                        style={{ color: confirmLocalClear ? '#dc2626' : '#94a3b8', borderColor: confirmLocalClear ? '#fca5a5' : '#e2e8f0' }}
                        onClick={() => {
                          if (!confirmLocalClear) return;
                          if (window.confirm('Tem certeza absoluta de que deseja limpar os dados locais deste navegador? Os dados já migrados para o Supabase NÃO serão afetados.')) {
                            const ok = notificaDataService.clearLocalDataAfterConfirmation();
                            if (ok) {
                              setConfirmLocalClear(false);
                              showToast('Armazenamento local deste navegador foi limpo com segurança.');
                            } else {
                              showToast('Falha ao limpar armazenamento local.');
                            }
                          }
                        }}
                      >
                        Limpar dados locais do navegador
                      </button>
                    </div>
                  </div>
                </div>
              </div>

              <div className="notice green" style={{ marginBottom: '16px' }}>
                O Administra será a referência central para empreendedores, barragens, responsáveis técnicos, municípios e perfis de usuários. Os sistemas consumidores continuarão responsáveis por seus próprios documentos e fluxos.
              </div>

              <div className="grid2">
                <div className="panel">
                  <div className="panel-head">
                    <h3>Cadastros centrais previstos</h3>
                  </div>
                  <div className="panel-body" style={{ display: 'grid', gap: '10px' }}>
                    <div className="rowcard">
                      <span>
                        <b>Empreendedores</b>
                        <span className="td-sub">Cadastro central com identificadores e dados de contato.</span>
                      </span>
                      <span className="badge gray">Administra</span>
                    </div>

                    <div className="rowcard">
                      <span>
                        <b>Barragens</b>
                        <span className="td-sub">Registro individual de estruturas, vínculos e identificadores.</span>
                      </span>
                      <span className="badge gray">Administra</span>
                    </div>

                    <div className="rowcard">
                      <span>
                        <b>Responsáveis técnicos</b>
                        <span className="td-sub">Profissionais, conselhos, registros e vínculos técnicos.</span>
                      </span>
                      <span className="badge gray">Administra</span>
                    </div>

                    <div className="rowcard">
                      <span>
                        <b>Municípios</b>
                        <span className="td-sub">Referência mantida no Administra; sem módulo independente.</span>
                      </span>
                      <span className="badge gray">Referência</span>
                    </div>
                  </div>
                </div>

                <div className="panel">
                  <div className="panel-head">
                    <h3>Princípios para a etapa de integração</h3>
                  </div>
                  <div className="panel-body">
                    <ul style={{ paddingLeft: '18px', color: '#64748b', fontSize: '11px', lineHeight: 1.9, margin: 0 }}>
                      <li>Identificadores estáveis para relacionar registros.</li>
                      <li>Origem, data e responsável identificáveis nas alterações.</li>
                      <li>Preservação dos dados originais recebidos de cada sistema.</li>
                      <li>Decisão humana quando houver divergência ou possível duplicidade.</li>
                      <li>Independência operacional dos sistemas consumidores.</li>
                      <li>Contas individuais vinculadas a perfis institucionais.</li>
                    </ul>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* REFERÊNCIAS CENTRAIS */}
          {activeView === 'referencias' && (
            <div>
              <div className="pagehead">
                <div>
                  <div className="eyebrow">Dados de referência</div>
                  <h2>Referências centrais</h2>
                  <p>Informações de domínio comum mantidas no Administra para uso futuro pelos sistemas integrados.</p>
                </div>
              </div>

              <div className="panel">
                <div className="panel-head">
                  <h3>Municípios de Mato Grosso</h3>
                  <span className="badge blue">Base central · sem módulo próprio</span>
                </div>
                <div className="panel-body">
                  <div className="notice slate">
                    O catálogo municipal deve ser mantido nesta referência central e utilizado pelos formulários do Administra. Na integração, Classifica 2.0, Notifica e Fiscaliza Campo consultarão a mesma fonte, evitando manutenção duplicada.
                  </div>
                  <div style={{ marginTop: '14px' }} className="splitline">
                    <span className="muted" style={{ fontSize: '11px' }}>
                      Registros de referência carregados: <b>{db.municipios.length}</b>
                    </span>
                    <span className="badge amber">Aguardando definição da fonte oficial</span>
                  </div>
                  <p className="micro muted" style={{ margin: '12px 0 0' }}>
                    Nenhum município fictício foi incluído. A lista oficial deverá ser incorporada quando a fonte de referência for definida.
                  </p>
                </div>
              </div>
            </div>
          )}
        </section>

        <footer className="footnote">
          Administra · Coordenadoria de Segurança de Barragens · SURH / SEMA-MT · Protótipo funcional
          local; integração e acesso institucional ainda não habilitados.
        </footer>
      </main>

      {/* DYNAMIC RECORD MODAL (for empreendedores, barragens, rts, usuarios) */}
      {modalConfig && (() => {
        if (modalConfig.key === 'empreendedores') {
          return (
            <EmpreendedorModal
              key={`emp-${modalConfig.index ?? 'new'}`}
              record={modalConfig.record}
              isNew={modalConfig.index === null}
              onClose={() => setModalConfig(null)}
              onSave={handleSaveCustomRecord}
            />
          );
        }
        if (modalConfig.key === 'barragens') {
          return (
            <BarragemModal
              key={`barragem-${modalConfig.index ?? 'new'}`}
              record={modalConfig.record}
              isNew={modalConfig.index === null}
              empreendedores={db.empreendedores}
              onClose={() => setModalConfig(null)}
              onSave={handleSaveCustomRecord}
            />
          );
        }
        if (modalConfig.key === 'rts') {
          return (
            <RtModal
              key={`rt-${modalConfig.index ?? 'new'}`}
              record={modalConfig.record}
              isNew={modalConfig.index === null}
              barragens={db.barragens}
              onClose={() => setModalConfig(null)}
              onSave={handleSaveCustomRecord}
            />
          );
        }
        if (modalConfig.key === 'usuarios') {
          return (
            <UsuarioModal
              key={`user-${modalConfig.index ?? 'new'}`}
              record={modalConfig.record}
              isNew={modalConfig.index === null}
              onClose={() => setModalConfig(null)}
              onSave={handleSaveCustomRecord}
            />
          );
        }
        return (
          <GenericRecordModal
            key={`${modalConfig.key}-${modalConfig.index ?? 'new'}`}
            config={modules[modalConfig.key]}
            record={modalConfig.record}
            isNew={modalConfig.index === null}
            onClose={() => setModalConfig(null)}
            onSubmit={handleSaveRecord}
          />
        );
      })()}

      {/* APPROVAL MODAL (Administrador aprova solicitação e define função) */}
      {userToApprove && (
        <div className="modal-back">
          <div className="modal" style={{ maxWidth: '480px', width: '100%' }}>
            <div className="modal-head">
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={{ fontSize: '18px', color: '#047857' }}>✓</span>
                <div>
                  <h3 style={{ margin: 0, fontSize: '15px', fontWeight: 700 }}>Aprovar Solicitação de Acesso</h3>
                  <p style={{ margin: 0, fontSize: '11px', color: '#6b7280' }}>
                    Defina a função para provisionar a credencial no Supabase Auth
                  </p>
                </div>
              </div>
              <button type="button" className="modal-close" onClick={() => setUserToApprove(null)}>×</button>
            </div>
            <div className="modal-body">
              <div
                style={{
                  padding: '12px 14px',
                  background: '#f8fafc',
                  borderRadius: '8px',
                  border: '1px solid #e2e8f0',
                  marginBottom: '14px',
                  fontSize: '12px',
                  lineHeight: '1.6'
                }}
              >
                <div><strong>Servidor:</strong> {userToApprove.nome}</div>
                <div><strong>Matrícula:</strong> {userToApprove.matricula || '—'}</div>
                <div><strong>E-mail institucional:</strong> {userToApprove.email}</div>
                <div><strong>Perfil Profissional:</strong> {userToApprove.perfilProfissional || '—'}</div>
                <div><strong>Setor:</strong> {userToApprove.setor || '—'}</div>
              </div>

              <div className="form-field">
                <label style={{ display: 'block', fontSize: '12px', fontWeight: 700, color: '#374151', marginBottom: '4px' }}>
                  Atribuir Função / Papel Institucional (RBAC) *
                </label>
                <select
                  className="select"
                  value={approvalRole}
                  onChange={e => setApprovalRole(e.target.value as UserRole)}
                  disabled={isApproving}
                >
                  <option value="Administrador">Administrador (Acesso total)</option>
                  <option value="Usuário">Usuário (Operacional: cria e edita próprios)</option>
                  <option value="Visualizador">Visualizador (Somente leitura)</option>
                </select>
              </div>

              <p style={{ fontSize: '11px', color: '#64748b', marginTop: '10px' }}>
                Ao confirmar, a conta é provisionada no Supabase Auth por fluxo seguro de convite institucional e o status é alterado para <strong>Ativo</strong>.
              </p>
            </div>
            <div className="modal-foot">
              <button type="button" className="btn light" onClick={() => setUserToApprove(null)} disabled={isApproving}>
                Cancelar
              </button>
              <button type="button" className="btn green" onClick={handleConfirmApproval} disabled={isApproving}>
                {isApproving ? 'Provisionando no Supabase Auth...' : 'Confirmar Aprovação e Ativar'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* REJECTION MODAL (Administrador recusa solicitação sem conceder acesso) */}
      {userToReject && (
        <div className="modal-back">
          <div className="modal" style={{ maxWidth: '440px', width: '100%' }}>
            <div className="modal-head">
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={{ fontSize: '18px', color: '#dc2626' }}>✕</span>
                <div>
                  <h3 style={{ margin: 0, fontSize: '15px', fontWeight: 700, color: '#991b1b' }}>Recusar Solicitação de Acesso</h3>
                  <p style={{ margin: 0, fontSize: '11px', color: '#6b7280' }}>
                    O usuário não terá acesso concedido ao sistema
                  </p>
                </div>
              </div>
              <button type="button" className="modal-close" onClick={() => setUserToReject(null)}>×</button>
            </div>
            <div className="modal-body">
              <p style={{ fontSize: '12px', color: '#374151', margin: '0 0 12px' }}>
                Confirma a recusa da solicitação de acesso de <strong>{userToReject.nome}</strong> ({userToReject.email})?
              </p>
              <div className="form-field">
                <label style={{ display: 'block', fontSize: '11px', fontWeight: 600, color: '#374151', marginBottom: '4px' }}>
                  Motivo da recusa (opcional)
                </label>
                <input
                  className="input"
                  value={rejectMotivo}
                  onChange={e => setRejectMotivo(e.target.value)}
                  placeholder="Ex.: Matrícula ou vínculo funcional não identificado"
                  disabled={isRejecting}
                />
              </div>
            </div>
            <div className="modal-foot">
              <button type="button" className="btn light" onClick={() => setUserToReject(null)} disabled={isRejecting}>
                Cancelar
              </button>
              <button
                type="button"
                className="btn"
                style={{ background: '#dc2626', color: '#ffffff' }}
                onClick={handleConfirmRejection}
                disabled={isRejecting}
              >
                {isRejecting ? 'Registrando recusa...' : 'Confirmar Recusa'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* PRODUCTIVITY MODAL */}
      {prodModalIndex !== null && (() => {
        const record = prodModalRecord || {};
        return (
          <ProductivityModal
            record={record}
            isNew={prodModalIndex === 'new'}
            onClose={() => setProdModalIndex(null)}
            onSubmit={handleSaveProductivity}
          />
        );
      })()}

      {/* PORTARIA MODAL */}
      {portariaModalIndex !== null && (() => {
        const record = portariaModalRecord || {};
        return (
          <div
            className="modal-back"
            onClick={e => {
              if (e.target === e.currentTarget) setPortariaModalIndex(null);
            }}
          >
            <form className="modal" onSubmit={handleSavePortaria}>
              <div className="modal-head">
                <h3>{portariaModalIndex === 'new' ? 'Novo trâmite' : 'Editar trâmite'} · Portaria</h3>
                <button type="button" className="modal-close" onClick={() => setPortariaModalIndex(null)}>×</button>
              </div>
              <div className="modal-body">
                <div className="form-grid">
                  <div className="form-field">
                    <label>Número do processo</label>
                    <input className="input" name="processNumber" required defaultValue={record.processNumber || ''} />
                  </div>
                  <div className="form-field">
                    <label>Número da Portaria</label>
                    <input className="input" name="orderNumber" required defaultValue={record.orderNumber || ''} />
                  </div>
                  <div className="form-field">
                    <label>Data de envio</label>
                    <input className="input" name="sentDate" type="date" required defaultValue={record.sentDate || new Date().toISOString().slice(0, 10)} />
                  </div>
                  <div className="form-field">
                    <label>Data de finalização</label>
                    <input className="input" name="finalDate" type="date" defaultValue={record.finalDate || ''} />
                  </div>

                  <div className="form-field full">
                    <label>Etapas do trâmite</label>
                    <label className="product-option">
                      <input type="checkbox" name="secretarySigned" defaultChecked={Boolean(record.secretarySigned)} />
                      Assinatura da Secretaria
                    </label>
                    <label className="product-option">
                      <input type="checkbox" name="extractPublished" defaultChecked={Boolean(record.extractPublished)} />
                      Extrato publicado
                    </label>
                    <label className="product-option">
                      <input type="checkbox" name="orderPublished" defaultChecked={Boolean(record.orderPublished)} />
                      Portaria publicada
                    </label>
                    <label className="product-option">
                      <input type="checkbox" name="draft" defaultChecked={Boolean(record.draft)} />
                      Manter como rascunho
                    </label>
                  </div>

                  <div className="form-field full">
                    <label>Observações internas</label>
                    <textarea className="textarea" name="notes" defaultValue={record.notes || ''} />
                  </div>
                </div>
              </div>
              <div className="modal-foot">
                <button type="button" className="btn light" onClick={() => setPortariaModalIndex(null)}>Cancelar</button>
                <button type="submit" className="btn green">Salvar trâmite</button>
              </div>
            </form>
          </div>
        );
      })()}
    </div>
  );
}

// Subcomponent for Productivity Form with reactive field updates
function ProductivityModal({
  record,
  isNew,
  onClose,
  onSubmit
}: {
  record: any;
  isNew: boolean;
  onClose: () => void;
  onSubmit: (e: React.FormEvent<HTMLFormElement>) => void;
}) {
  const [kind, setKind] = useState<string>(record.kind || 'scored');
  const [selectedProductCode, setSelectedProductCode] = useState<string>(record.productCode || '');
  const [unscoredType, setUnscoredType] = useState<string>(record.unscoredType || '');
  const [unscoredDesc, setUnscoredDesc] = useState<string>(record.unscoredDescription || '');

  const product = SURH_PRODUCTS.find(p => p.code === selectedProductCode);

  return (
    <div
      className="modal-back"
      onClick={e => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <form className="modal" onSubmit={onSubmit}>
        <div className="modal-head">
          <h3>{isNew ? 'Novo lançamento' : 'Editar lançamento'} · Produtividade</h3>
          <button type="button" className="modal-close" onClick={onClose}>×</button>
        </div>

        <div className="modal-body">
          <div className="notice slate" style={{ marginBottom: '14px' }}>
            Registre cada produto ou atividade separadamente. Os campos ajudam a identificar o trabalho e a organizar os dados quando a planilha oficial for disponibilizada.
          </div>

          <div className="form-grid">
            <div className="form-field">
              <label>Tipo de lançamento</label>
              <select
                className="select"
                name="kind"
                value={kind}
                onChange={e => setKind(e.target.value)}
              >
                <option value="scored">Produto pontuável — Anexo I SURH</option>
                <option value="unscored">Atividade realizada sem pontuação</option>
                <option value="extra">Atividade extra de gestão — art. 8º</option>
              </select>
            </div>

            <div className="form-field">
              <label>Data de realização</label>
              <input
                className="input"
                name="date"
                type="date"
                required
                defaultValue={record.date || new Date().toISOString().slice(0, 10)}
              />
            </div>

            <div className="form-field">
              <label>Servidor responsável</label>
              <input
                className="input"
                name="serverName"
                required
                defaultValue={record.serverName || ''}
                placeholder="Nome do servidor"
              />
            </div>

            <div className="form-field">
              <label>Unidade / setor</label>
              <input
                className="input"
                name="unit"
                defaultValue={record.unit || ''}
                placeholder="Unidade de lotação"
              />
            </div>

            {kind === 'scored' && (
              <>
                <div className="form-field full">
                  <label>Produto SURH — Anexo I</label>
                  <select
                    className="select"
                    name="productCode"
                    value={selectedProductCode}
                    onChange={e => setSelectedProductCode(e.target.value)}
                    required
                  >
                    <option value="">Selecione o produto...</option>
                    {SURH_PRODUCTS.map(p => (
                      <option key={p.code} value={p.code}>
                        {p.code} · {p.title} — {p.points} pontos
                      </option>
                    ))}
                  </select>
                  <small>
                    {product
                      ? `Nível ${product.level} · ${product.points} ponto(s) por execução. Para Notificações, selecione 2.7 — Relatório de Vistoria Remota por imagem.`
                      : 'A pontuação é definida pelo Anexo I – SURH.'}
                  </small>
                </div>

                <div className="form-field">
                  <label>Quantidade de execuções</label>
                  <input
                    className="input"
                    name="quantity"
                    type="number"
                    min="1"
                    step="1"
                    defaultValue={record.quantity || '1'}
                  />
                  <small>O cálculo usa a pontuação unitária indicada no Anexo I.</small>
                </div>
              </>
            )}

            {kind === 'unscored' && (
              <>
                <div className="form-field full">
                  <label>Atividade sem pontuação</label>
                  <select
                    className="select"
                    name="unscoredType"
                    value={unscoredType}
                    onChange={e => {
                      setUnscoredType(e.target.value);
                      if (e.target.value === 'Ofício' && !unscoredDesc) {
                        setUnscoredDesc('Ofício');
                      }
                    }}
                    required
                  >
                    <option value="">Selecione...</option>
                    <option value="Ofício">Ofício — sem pontuação</option>
                    <option value="Outro">Outro produto/atividade sem pontuação</option>
                  </select>
                </div>

                <div className="form-field full">
                  <label>Identificação da atividade sem pontuação</label>
                  <input
                    className="input"
                    name="unscoredDescription"
                    value={unscoredDesc}
                    onChange={e => setUnscoredDesc(e.target.value)}
                    required={unscoredType === 'Outro'}
                    placeholder="Descreva a atividade, por exemplo: tipo de ofício"
                  />
                  <small>
                    Ofício foi indicado como exemplo de atividade sem pontuação. Outros tipos devem ser identificados pelo usuário, sem atribuição automática de pontos.
                  </small>
                </div>
              </>
            )}

            <div className="form-field">
              <label>Origem do registro</label>
              <select className="select" name="sourceType" defaultValue={record.sourceType || 'manual'}>
                <option value="manual">Manual — atividade fora de sistema</option>
                <option value="system">Registro realizado em sistema</option>
              </select>
            </div>

            <div className="form-field">
              <label>Sistema de origem, se aplicável</label>
              <input
                className="input"
                name="sourceName"
                defaultValue={record.sourceName || ''}
                placeholder="Nome do sistema ou ferramenta"
              />
            </div>

            <div className="form-field">
              <label>Número do processo</label>
              <input className="input" name="processRef" defaultValue={record.processRef || ''} />
            </div>

            <div className="form-field">
              <label>Número / identificação do documento</label>
              <input className="input" name="documentRef" defaultValue={record.documentRef || ''} />
            </div>

            {kind === 'extra' && (
              <>
                <div className="form-field full">
                  <label>Pontos extras solicitados (máximo de 8 por servidor/dia)</label>
                  <input
                    className="input"
                    name="requestedPoints"
                    type="number"
                    min="1"
                    max="8"
                    step="1"
                    defaultValue={record.requestedPoints || '1'}
                  />
                </div>

                <div className="form-field full">
                  <label>Identificação da requisição ou ordem de serviço</label>
                  <input className="input" name="extraOrder" defaultValue={record.extraOrder || ''} />
                </div>

                <div className="form-field full">
                  <label>Referência e data da aprovação prévia formal</label>
                  <input className="input" name="extraApproval" defaultValue={record.extraApproval || ''} />
                  <small>
                    Informação prevista no art. 8º: critério e termos previamente aprovados formalmente pelo superintendente imediato e pelo(a) secretário(a) adjunto(a).
                  </small>
                </div>
              </>
            )}

            <div className="form-field full">
              <label>Descrição complementar / resultado</label>
              <textarea
                className="textarea"
                name="description"
                placeholder="Detalhes que ajudem a identificar o produto realizado"
                defaultValue={record.description || ''}
              />
            </div>

            <div className="form-field full">
              <label>Observações</label>
              <textarea className="textarea" name="notes" defaultValue={record.notes || ''} />
            </div>
          </div>
        </div>

        <div className="modal-foot">
          <button type="button" className="btn light" onClick={onClose}>Cancelar</button>
          <button type="submit" className="btn green">Salvar lançamento</button>
        </div>
      </form>
    </div>
  );
}
