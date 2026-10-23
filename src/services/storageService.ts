import {
  Dam,
  Entrepreneur,
  TechnicalResponsible,
  ReconciliationItem,
  ProductivityRecord,
  Ordinance,
  SystemUser,
  InspectionLog,
  DamCategory,
  RiskClassification,
  AssociatedPotentialDamage
} from '../types/dam';
import {
  initialDams,
  initialEntrepreneurs,
  initialTechnicalResponsibles,
  initialReconciliations,
  initialProductivity,
  initialOrdinances,
  initialUsers,
  initialInspectionLogs
} from '../data/initialData';

const KEYS = {
  DAMS: 'csb_dams_data',
  ENTREPRENEURS: 'csb_entrepreneurs_data',
  RTS: 'csb_rts_data',
  RECONCILIATIONS: 'csb_reconciliations_data',
  PRODUCTIVITY: 'csb_productivity_data',
  ORDINANCES: 'csb_ordinances_data',
  USERS: 'csb_users_data',
  INSPECTIONS: 'csb_inspections_data',
  ACTIVE_USER: 'csb_active_user_id'
};

export function calculateDamCategory(cri: RiskClassification, dpa: AssociatedPotentialDamage): DamCategory {
  if (dpa === 'Alto') {
    if (cri === 'Alto') return 'A';
    return 'B';
  } else if (dpa === 'Médio') {
    if (cri === 'Alto') return 'B';
    return 'C';
  } else {
    // DPA Baixo
    if (cri === 'Alto') return 'C';
    return 'D';
  }
}

export const StorageService = {
  getDams(): Dam[] {
    try {
      const stored = localStorage.getItem(KEYS.DAMS);
      if (!stored) {
        this.saveDams(initialDams);
        return initialDams;
      }
      return JSON.parse(stored);
    } catch {
      return initialDams;
    }
  },

  saveDams(dams: Dam[]): void {
    localStorage.setItem(KEYS.DAMS, JSON.stringify(dams));
  },

  getEntrepreneurs(): Entrepreneur[] {
    try {
      const stored = localStorage.getItem(KEYS.ENTREPRENEURS);
      if (!stored) {
        this.saveEntrepreneurs(initialEntrepreneurs);
        return initialEntrepreneurs;
      }
      return JSON.parse(stored);
    } catch {
      return initialEntrepreneurs;
    }
  },

  saveEntrepreneurs(items: Entrepreneur[]): void {
    localStorage.setItem(KEYS.ENTREPRENEURS, JSON.stringify(items));
  },

  getTechnicalResponsibles(): TechnicalResponsible[] {
    try {
      const stored = localStorage.getItem(KEYS.RTS);
      if (!stored) {
        this.saveTechnicalResponsibles(initialTechnicalResponsibles);
        return initialTechnicalResponsibles;
      }
      return JSON.parse(stored);
    } catch {
      return initialTechnicalResponsibles;
    }
  },

  saveTechnicalResponsibles(items: TechnicalResponsible[]): void {
    localStorage.setItem(KEYS.RTS, JSON.stringify(items));
  },

  getReconciliations(): ReconciliationItem[] {
    try {
      const stored = localStorage.getItem(KEYS.RECONCILIATIONS);
      if (!stored) {
        this.saveReconciliations(initialReconciliations);
        return initialReconciliations;
      }
      return JSON.parse(stored);
    } catch {
      return initialReconciliations;
    }
  },

  saveReconciliations(items: ReconciliationItem[]): void {
    localStorage.setItem(KEYS.RECONCILIATIONS, JSON.stringify(items));
  },

  getProductivity(): ProductivityRecord[] {
    try {
      const stored = localStorage.getItem(KEYS.PRODUCTIVITY);
      if (!stored) {
        this.saveProductivity(initialProductivity);
        return initialProductivity;
      }
      return JSON.parse(stored);
    } catch {
      return initialProductivity;
    }
  },

  saveProductivity(items: ProductivityRecord[]): void {
    localStorage.setItem(KEYS.PRODUCTIVITY, JSON.stringify(items));
  },

  getOrdinances(): Ordinance[] {
    try {
      const stored = localStorage.getItem(KEYS.ORDINANCES);
      if (!stored) {
        this.saveOrdinances(initialOrdinances);
        return initialOrdinances;
      }
      return JSON.parse(stored);
    } catch {
      return initialOrdinances;
    }
  },

  saveOrdinances(items: Ordinance[]): void {
    localStorage.setItem(KEYS.ORDINANCES, JSON.stringify(items));
  },

  getUsers(): SystemUser[] {
    try {
      const stored = localStorage.getItem(KEYS.USERS);
      if (!stored) {
        this.saveUsers(initialUsers);
        return initialUsers;
      }
      return JSON.parse(stored);
    } catch {
      return initialUsers;
    }
  },

  saveUsers(items: SystemUser[]): void {
    localStorage.setItem(KEYS.USERS, JSON.stringify(items));
  },

  getActiveUserId(): string {
    return localStorage.getItem(KEYS.ACTIVE_USER) || 'USR-001';
  },

  setActiveUserId(id: string): void {
    localStorage.setItem(KEYS.ACTIVE_USER, id);
  },

  getInspectionLogs(): InspectionLog[] {
    try {
      const stored = localStorage.getItem(KEYS.INSPECTIONS);
      if (!stored) {
        this.saveInspectionLogs(initialInspectionLogs);
        return initialInspectionLogs;
      }
      return JSON.parse(stored);
    } catch {
      return initialInspectionLogs;
    }
  },

  saveInspectionLogs(items: InspectionLog[]): void {
    localStorage.setItem(KEYS.INSPECTIONS, JSON.stringify(items));
  },

  // Export all system database as formatted JSON file
  exportFullDatabase(): string {
    const backup = {
      version: '1.0',
      exportedAt: new Date().toISOString(),
      organization: 'SEMA/MT · SURH · CSB',
      dams: this.getDams(),
      entrepreneurs: this.getEntrepreneurs(),
      technicalResponsibles: this.getTechnicalResponsibles(),
      reconciliations: this.getReconciliations(),
      productivity: this.getProductivity(),
      ordinances: this.getOrdinances(),
      users: this.getUsers(),
      inspections: this.getInspectionLogs()
    };
    return JSON.stringify(backup, null, 2);
  },

  // Import JSON database backup
  importDatabase(jsonString: string): boolean {
    try {
      const parsed = JSON.parse(jsonString);
      if (parsed.dams && Array.isArray(parsed.dams)) {
        this.saveDams(parsed.dams);
      }
      if (parsed.entrepreneurs && Array.isArray(parsed.entrepreneurs)) {
        this.saveEntrepreneurs(parsed.entrepreneurs);
      }
      if (parsed.technicalResponsibles && Array.isArray(parsed.technicalResponsibles)) {
        this.saveTechnicalResponsibles(parsed.technicalResponsibles);
      }
      if (parsed.reconciliations && Array.isArray(parsed.reconciliations)) {
        this.saveReconciliations(parsed.reconciliations);
      }
      if (parsed.productivity && Array.isArray(parsed.productivity)) {
        this.saveProductivity(parsed.productivity);
      }
      if (parsed.ordinances && Array.isArray(parsed.ordinances)) {
        this.saveOrdinances(parsed.ordinances);
      }
      if (parsed.users && Array.isArray(parsed.users)) {
        this.saveUsers(parsed.users);
      }
      if (parsed.inspections && Array.isArray(parsed.inspections)) {
        this.saveInspectionLogs(parsed.inspections);
      }
      return true;
    } catch (e) {
      console.error('Falha ao importar backup:', e);
      return false;
    }
  },

  // Reset to initial factory seed data
  resetAll(): void {
    this.saveDams(initialDams);
    this.saveEntrepreneurs(initialEntrepreneurs);
    this.saveTechnicalResponsibles(initialTechnicalResponsibles);
    this.saveReconciliations(initialReconciliations);
    this.saveProductivity(initialProductivity);
    this.saveOrdinances(initialOrdinances);
    this.saveUsers(initialUsers);
    this.saveInspectionLogs(initialInspectionLogs);
    this.setActiveUserId('USR-001');
  }
};
