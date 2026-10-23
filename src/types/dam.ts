export type RiskClassification = 'Baixo' | 'Médio' | 'Alto';
export type AssociatedPotentialDamage = 'Baixo' | 'Médio' | 'Alto';
export type DamCategory = 'A' | 'B' | 'C' | 'D';
export type AlertLevel = 'Normal' | 'Atenção' | 'Alerta' | 'Emergência';
export type ComplianceStatus = 'Regular' | 'Pendente de Documentação' | 'Notificado' | 'Sob Embargo' | 'Em Análise';

export type MainUse = 
  | 'Geração de Energia'
  | 'Irrigação'
  | 'Mineração / Rejeito'
  | 'Aquicultura / Dessedentação'
  | 'Abastecimento Público'
  | 'Industrial';

export type StructureType =
  | 'Terra homogênea'
  | 'Terra zoneada'
  | 'Enrocamento com face de concreto (CFRD)'
  | 'Concreto gravidade'
  | 'Rejeito - Linha de centro'
  | 'Rejeito - Jusante'
  | 'Alvenaria de pedra';

export interface Dam {
  id: string;
  name: string;
  codeSema: string;
  codeSnisb: string;
  entrepreneurId: string;
  rtId: string;
  municipality: string;
  basin: string;
  river: string;
  coordinates: {
    lat: number;
    lng: number;
  };
  mainUse: MainUse;
  structureType: StructureType;
  height: number; // metros
  crestLength: number; // metros
  reservoirVolume: number; // mil m³
  reservoirArea: number; // hectares
  constructionYear: number;
  cri: RiskClassification; // Categoria de Risco
  dpa: AssociatedPotentialDamage; // Dano Potencial Associado
  category: DamCategory; // Classe A, B, C, D
  alertLevel: AlertLevel;
  hasPSB: boolean; // Plano de Segurança de Barragens
  psbDate?: string;
  hasPAE: boolean; // Plano de Ação de Emergência
  paeDate?: string;
  lastInspectionDate: string;
  lastInspectionType: 'ISR' | 'ISE' | 'Fiscalização SEMA' | 'Rotina';
  complianceStatus: ComplianceStatus;
  outorgaNumber: string;
  environmentalLicense: string;
  notes: string;
  updatedAt: string;
}

export interface Entrepreneur {
  id: string;
  name: string;
  tradeName: string;
  docType: 'CNPJ' | 'CPF';
  document: string;
  email: string;
  phone: string;
  address: string;
  municipality: string;
  state: 'MT';
  legalRepresentative: string;
  status: 'Regular' | 'Notificado' | 'Irregular' | 'Suspenso';
  notes: string;
}

export interface TechnicalResponsible {
  id: string;
  name: string;
  cpf: string;
  creaNumber: string;
  creaUf: string;
  specialty: 'Engenharia Civil' | 'Engenharia Geotécnica' | 'Engenharia de Minas' | 'Engenharia Hídrica/Sanitária' | 'Geologia';
  email: string;
  phone: string;
  artNumber: string;
  status: 'Ativo' | 'Inativo' | 'Suspenso';
  validUntil: string;
}

export interface ReconciliationItem {
  id: string;
  damId: string;
  damName: string;
  field: string;
  sourceSEMA: string;
  sourceDeclaredOrSNISB: string;
  origin: 'SIRIEMA' | 'SNISB/ANA' | 'Declaração Anual' | 'Fiscalização In Loco';
  severity: 'Crítica' | 'Moderada' | 'Informativa';
  status: 'Pendente' | 'Aprovado SEMA' | 'Aceito Declarado' | 'Notificado Empreendedor' | 'Retificado';
  dateDetected: string;
  resolutionNotes?: string;
  resolvedBy?: string;
  resolvedAt?: string;
}

export interface ProductivityRecord {
  id: string;
  agentName: string;
  matricula: string;
  role: string;
  period: string;
  vistoriasRealizadas: number;
  pareceresEmitidos: number;
  notificacoesExpedidas: number;
  autosInfracao: number;
  processosConcluidos: number;
  metaAlcancadaPct: number;
}

export interface Ordinance {
  id: string;
  number: string;
  publishDate: string;
  doeNumber: string;
  category: 
    | 'Classificação Anual de Barragens'
    | 'Convocação PAE/PSB'
    | 'Embargo Preventivo'
    | 'Procedimento Fiscalizatório'
    | 'Desembargo / Regularização';
  summary: string;
  content: string;
  relatedDams: string[];
  status: 'Vigente' | 'Revogada' | 'Em Consulta';
}

export interface SystemUser {
  id: string;
  name: string;
  email: string;
  matricula: string;
  department: string;
  role: 'Coordenador CSB' | 'Fiscal de Segurança' | 'Analista Ambiental' | 'Administrador de TI';
  status: 'Ativo' | 'Inativo';
  lastAccess: string;
}

export interface InspectionLog {
  id: string;
  damId: string;
  date: string;
  type: 'ISR' | 'ISE' | 'Fiscalização SEMA' | 'Vistoria Preventiva';
  inspector: string;
  scoreOrOutcome: string;
  notes: string;
  recommendations: string[];
}
