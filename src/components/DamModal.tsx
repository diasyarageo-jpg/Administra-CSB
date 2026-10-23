import React, { useState, useEffect } from 'react';
import {
  Dam,
  Entrepreneur,
  TechnicalResponsible,
  MainUse,
  StructureType,
  RiskClassification,
  AssociatedPotentialDamage,
  AlertLevel,
  ComplianceStatus
} from '../types/dam';
import { calculateDamCategory } from '../services/storageService';
import { X, Calculator, Info, CheckCircle2 } from 'lucide-react';

interface DamModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (dam: Dam) => void;
  editingDam?: Dam | null;
  entrepreneurs: Entrepreneur[];
  rts: TechnicalResponsible[];
}

const MT_MUNICIPALITIES = [
  'Cuiabá',
  'Várzea Grande',
  'Rondonópolis',
  'Sinop',
  'Sorriso',
  'Tangará da Serra',
  'Primavera do Leste',
  'Barra do Garças',
  'Alta Floresta',
  'Campo Novo do Parecis',
  'Poconé',
  'Juína',
  'Lucas do Rio Verde',
  'Nova Mutum',
  'Salto do Céu',
  'Santo Antônio de Leverger',
  'Cáceres',
  'Diamantino',
  'Campo Verde'
];

const BASINS = [
  'Bacia do Rio Paraguai',
  'Bacia Hidrográfica do Teles Pires / Tapajós',
  'Bacia do Rio Araguaia',
  'Bacia do Rio Guaporé',
  'Bacia do Rio Juruena',
  'Bacia do Rio Xingu'
];

const MAIN_USES: MainUse[] = [
  'Geração de Energia',
  'Irrigação',
  'Mineração / Rejeito',
  'Aquicultura / Dessedentação',
  'Abastecimento Público',
  'Industrial'
];

const STRUCTURE_TYPES: StructureType[] = [
  'Terra homogênea',
  'Terra zoneada',
  'Enrocamento com face de concreto (CFRD)',
  'Concreto gravidade',
  'Rejeito - Linha de centro',
  'Rejeito - Jusante',
  'Alvenaria de pedra'
];

export const DamModal: React.FC<DamModalProps> = ({
  isOpen,
  onClose,
  onSave,
  editingDam,
  entrepreneurs,
  rts
}) => {
  const [name, setName] = useState('');
  const [codeSema, setCodeSema] = useState('');
  const [codeSnisb, setCodeSnisb] = useState('');
  const [entrepreneurId, setEntrepreneurId] = useState('');
  const [rtId, setRtId] = useState('');
  const [municipality, setMunicipality] = useState('Cuiabá');
  const [basin, setBasin] = useState('Bacia do Rio Paraguai');
  const [river, setRiver] = useState('');
  const [lat, setLat] = useState(-15.6014);
  const [lng, setLng] = useState(-56.0978);
  const [mainUse, setMainUse] = useState<MainUse>('Irrigação');
  const [structureType, setStructureType] = useState<StructureType>('Terra homogênea');
  const [height, setHeight] = useState<number>(12);
  const [crestLength, setCrestLength] = useState<number>(300);
  const [reservoirVolume, setReservoirVolume] = useState<number>(5000);
  const [reservoirArea, setReservoirArea] = useState<number>(100);
  const [constructionYear, setConstructionYear] = useState<number>(2018);
  const [cri, setCri] = useState<RiskClassification>('Baixo');
  const [dpa, setDpa] = useState<AssociatedPotentialDamage>('Médio');
  const [alertLevel, setAlertLevel] = useState<AlertLevel>('Normal');
  const [hasPSB, setHasPSB] = useState<boolean>(true);
  const [psbDate, setPsbDate] = useState<string>('');
  const [hasPAE, setHasPAE] = useState<boolean>(false);
  const [paeDate, setPaeDate] = useState<string>('');
  const [lastInspectionDate, setLastInspectionDate] = useState<string>('');
  const [lastInspectionType, setLastInspectionType] = useState<'ISR' | 'ISE' | 'Fiscalização SEMA' | 'Rotina'>('ISR');
  const [complianceStatus, setComplianceStatus] = useState<ComplianceStatus>('Regular');
  const [outorgaNumber, setOutorgaNumber] = useState('');
  const [environmentalLicense, setEnvironmentalLicense] = useState('');
  const [notes, setNotes] = useState('');

  // Auto-calculated category based on CNRH 143/2012
  const computedCategory = calculateDamCategory(cri, dpa);

  useEffect(() => {
    if (editingDam) {
      setName(editingDam.name);
      setCodeSema(editingDam.codeSema);
      setCodeSnisb(editingDam.codeSnisb);
      setEntrepreneurId(editingDam.entrepreneurId);
      setRtId(editingDam.rtId);
      setMunicipality(editingDam.municipality);
      setBasin(editingDam.basin);
      setRiver(editingDam.river);
      setLat(editingDam.coordinates.lat);
      setLng(editingDam.coordinates.lng);
      setMainUse(editingDam.mainUse);
      setStructureType(editingDam.structureType);
      setHeight(editingDam.height);
      setCrestLength(editingDam.crestLength);
      setReservoirVolume(editingDam.reservoirVolume);
      setReservoirArea(editingDam.reservoirArea);
      setConstructionYear(editingDam.constructionYear);
      setCri(editingDam.cri);
      setDpa(editingDam.dpa);
      setAlertLevel(editingDam.alertLevel);
      setHasPSB(editingDam.hasPSB);
      setPsbDate(editingDam.psbDate || '');
      setHasPAE(editingDam.hasPAE);
      setPaeDate(editingDam.paeDate || '');
      setLastInspectionDate(editingDam.lastInspectionDate);
      setLastInspectionType(editingDam.lastInspectionType);
      setComplianceStatus(editingDam.complianceStatus);
      setOutorgaNumber(editingDam.outorgaNumber);
      setEnvironmentalLicense(editingDam.environmentalLicense);
      setNotes(editingDam.notes);
    } else {
      // Defaults for new dam
      const nextId = `BAR-MT-${String(Math.floor(Math.random() * 900) + 100)}`;
      setName('');
      setCodeSema(`SEMA-MT-2026-${String(Math.floor(Math.random() * 900) + 100)}`);
      setCodeSnisb(`SNISB-MT-0${String(Math.floor(Math.random() * 9000) + 1000)}`);
      setEntrepreneurId(entrepreneurs[0]?.id || '');
      setRtId(rts[0]?.id || '');
      setMunicipality('Cuiabá');
      setBasin('Bacia do Rio Paraguai');
      setRiver('Rio Cuiabá');
      setLat(-15.596);
      setLng(-56.096);
      setMainUse('Irrigação');
      setStructureType('Terra homogênea');
      setHeight(14.5);
      setCrestLength(350);
      setReservoirVolume(4200);
      setReservoirArea(85);
      setConstructionYear(2020);
      setCri('Baixo');
      setDpa('Médio');
      setAlertLevel('Normal');
      setHasPSB(true);
      setPsbDate(new Date().toISOString().split('T')[0]);
      setHasPAE(false);
      setPaeDate('');
      setLastInspectionDate(new Date().toISOString().split('T')[0]);
      setLastInspectionType('ISR');
      setComplianceStatus('Regular');
      setOutorgaNumber(`OUT-SEMA-2026-${String(Math.floor(Math.random() * 900) + 100)}`);
      setEnvironmentalLicense(`LO nº ${Math.floor(Math.random() * 800) + 100}/2026`);
      setNotes('');
    }
  }, [editingDam, isOpen, entrepreneurs, rts]);

  if (!isOpen) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;

    const savedDam: Dam = {
      id: editingDam ? editingDam.id : `BAR-MT-${String(Date.now()).slice(-4)}`,
      name: name.trim(),
      codeSema: codeSema.trim(),
      codeSnisb: codeSnisb.trim(),
      entrepreneurId,
      rtId,
      municipality,
      basin,
      river: river.trim(),
      coordinates: {
        lat: Number(lat),
        lng: Number(lng)
      },
      mainUse,
      structureType,
      height: Number(height),
      crestLength: Number(crestLength),
      reservoirVolume: Number(reservoirVolume),
      reservoirArea: Number(reservoirArea),
      constructionYear: Number(constructionYear),
      cri,
      dpa,
      category: computedCategory,
      alertLevel,
      hasPSB,
      psbDate: hasPSB ? psbDate : undefined,
      hasPAE,
      paeDate: hasPAE ? paeDate : undefined,
      lastInspectionDate: lastInspectionDate || new Date().toISOString().split('T')[0],
      lastInspectionType,
      complianceStatus,
      outorgaNumber: outorgaNumber.trim(),
      environmentalLicense: environmentalLicense.trim(),
      notes: notes.trim(),
      updatedAt: new Date().toISOString()
    };

    onSave(savedDam);
  };

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-slate-950/70 backdrop-blur-xs flex items-center justify-center p-3 sm:p-5">
      <div className="relative w-full max-w-4xl bg-white rounded-2xl shadow-2xl border border-slate-200 overflow-hidden my-6">
        {/* Modal Header */}
        <div className="px-6 py-4 bg-slate-900 text-white flex items-center justify-between border-b border-slate-800">
          <div>
            <span className="text-[10px] font-bold tracking-widest text-emerald-400 uppercase">
              SEMA/MT · Cadastro Oficial de Barramentos
            </span>
            <h3 className="text-base sm:text-lg font-bold">
              {editingDam ? 'Editar Cadastro de Barragem' : 'Cadastrar Nova Barragem'}
            </h3>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
          >
            <X size={20} />
          </button>
        </div>

        {/* Form Body */}
        <form onSubmit={handleSubmit} className="p-6 space-y-6 max-h-[80vh] overflow-y-auto">
          {/* Section 1: Identification */}
          <div>
            <h4 className="text-xs font-black uppercase tracking-wider text-slate-800 border-b border-slate-200 pb-2 mb-3">
              1. Identificação Geral e Atos Autorizativos
            </h4>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs">
              <div className="md:col-span-2">
                <label className="block font-semibold text-slate-700 mb-1">
                  Nome da Barragem / Barramento *
                </label>
                <input
                  type="text"
                  required
                  value={name}
                  onChange={e => setName(e.target.value)}
                  placeholder="Ex: PCH Salto do Céu — Barramento Principal"
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:outline-none"
                />
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">
                  Código SEMA / Processo *
                </label>
                <input
                  type="text"
                  required
                  value={codeSema}
                  onChange={e => setCodeSema(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg font-mono focus:ring-2 focus:ring-emerald-500 focus:outline-none"
                />
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">
                  Código SNISB (ANA)
                </label>
                <input
                  type="text"
                  value={codeSnisb}
                  onChange={e => setCodeSnisb(e.target.value)}
                  placeholder="SNISB-MT-00000"
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg font-mono focus:ring-2 focus:ring-emerald-500 focus:outline-none"
                />
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">
                  Número da Portaria de Outorga
                </label>
                <input
                  type="text"
                  value={outorgaNumber}
                  onChange={e => setOutorgaNumber(e.target.value)}
                  placeholder="Ex: OUT-SEMA-2024-0129"
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:outline-none"
                />
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">
                  Licença Ambiental (LO / LI)
                </label>
                <input
                  type="text"
                  value={environmentalLicense}
                  onChange={e => setEnvironmentalLicense(e.target.value)}
                  placeholder="Ex: LO nº 148/2023"
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:outline-none"
                />
              </div>
            </div>
          </div>

          {/* Section 2: Agentes Regulados (Empreendedor & RT) */}
          <div>
            <h4 className="text-xs font-black uppercase tracking-wider text-slate-800 border-b border-slate-200 pb-2 mb-3">
              2. Vínculo com Agentes Regulados
            </h4>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
              <div>
                <label className="block font-semibold text-slate-700 mb-1">
                  Empreendedor Responsável (Pessoa Física ou Jurídica) *
                </label>
                <select
                  required
                  value={entrepreneurId}
                  onChange={e => setEntrepreneurId(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:outline-none bg-white"
                >
                  <option value="">Selecione o empreendedor cadastrado...</option>
                  {entrepreneurs.map(emp => (
                    <option key={emp.id} value={emp.id}>
                      {emp.name} ({emp.document})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">
                  Responsável Técnico com ART Registrada *
                </label>
                <select
                  required
                  value={rtId}
                  onChange={e => setRtId(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:outline-none bg-white"
                >
                  <option value="">Selecione o RT cadastrado...</option>
                  {rts.map(rt => (
                    <option key={rt.id} value={rt.id}>
                      {rt.name} — CREA {rt.creaNumber} ({rt.specialty})
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </div>

          {/* Section 3: Geographic Location */}
          <div>
            <h4 className="text-xs font-black uppercase tracking-wider text-slate-800 border-b border-slate-200 pb-2 mb-3">
              3. Localização Geográfica e Bacia Hidrográfica
            </h4>
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4 text-xs">
              <div>
                <label className="block font-semibold text-slate-700 mb-1">
                  Município de Mato Grosso *
                </label>
                <select
                  value={municipality}
                  onChange={e => setMunicipality(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:outline-none bg-white"
                >
                  {MT_MUNICIPALITIES.map(m => (
                    <option key={m} value={m}>{m}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">
                  Bacia Hidrográfica *
                </label>
                <select
                  value={basin}
                  onChange={e => setBasin(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:outline-none bg-white"
                >
                  {BASINS.map(b => (
                    <option key={b} value={b}>{b}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">
                  Curso Hídrico / Rio Barreado
                </label>
                <input
                  type="text"
                  value={river}
                  onChange={e => setRiver(e.target.value)}
                  placeholder="Ex: Rio Branco / Córrego..."
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:outline-none"
                />
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Latitude</label>
                  <input
                    type="number"
                    step="0.0001"
                    value={lat}
                    onChange={e => setLat(parseFloat(e.target.value) || 0)}
                    className="w-full px-2 py-2 border border-slate-300 rounded-lg text-xs font-mono"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Longitude</label>
                  <input
                    type="number"
                    step="0.0001"
                    value={lng}
                    onChange={e => setLng(parseFloat(e.target.value) || 0)}
                    className="w-full px-2 py-2 border border-slate-300 rounded-lg text-xs font-mono"
                  />
                </div>
              </div>
            </div>
          </div>

          {/* Section 4: Physical Characteristics */}
          <div>
            <h4 className="text-xs font-black uppercase tracking-wider text-slate-800 border-b border-slate-200 pb-2 mb-3">
              4. Características Construtivas e Dimensões
            </h4>
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4 text-xs">
              <div>
                <label className="block font-semibold text-slate-700 mb-1">Uso Principal *</label>
                <select
                  value={mainUse}
                  onChange={e => setMainUse(e.target.value as MainUse)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:outline-none bg-white"
                >
                  {MAIN_USES.map(u => (
                    <option key={u} value={u}>{u}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">Tipo de Estrutura *</label>
                <select
                  value={structureType}
                  onChange={e => setStructureType(e.target.value as StructureType)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:outline-none bg-white"
                >
                  {STRUCTURE_TYPES.map(st => (
                    <option key={st} value={st}>{st}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">Altura do Maciço (m) *</label>
                <input
                  type="number"
                  step="0.1"
                  required
                  value={height}
                  onChange={e => setHeight(parseFloat(e.target.value) || 0)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg font-mono focus:ring-2 focus:ring-emerald-500 focus:outline-none"
                />
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">Comprimento da Crista (m)</label>
                <input
                  type="number"
                  step="1"
                  value={crestLength}
                  onChange={e => setCrestLength(parseFloat(e.target.value) || 0)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg font-mono focus:ring-2 focus:ring-emerald-500 focus:outline-none"
                />
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">Volume do Reservatório (mil m³)</label>
                <input
                  type="number"
                  step="10"
                  value={reservoirVolume}
                  onChange={e => setReservoirVolume(parseFloat(e.target.value) || 0)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg font-mono focus:ring-2 focus:ring-emerald-500 focus:outline-none"
                />
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">Área do Espelho d'Água (ha)</label>
                <input
                  type="number"
                  step="1"
                  value={reservoirArea}
                  onChange={e => setReservoirArea(parseFloat(e.target.value) || 0)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg font-mono focus:ring-2 focus:ring-emerald-500 focus:outline-none"
                />
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">Ano de Construção</label>
                <input
                  type="number"
                  value={constructionYear}
                  onChange={e => setConstructionYear(parseInt(e.target.value) || 2020)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg font-mono focus:ring-2 focus:ring-emerald-500 focus:outline-none"
                />
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">Situação de Conformidade</label>
                <select
                  value={complianceStatus}
                  onChange={e => setComplianceStatus(e.target.value as ComplianceStatus)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:outline-none bg-white font-medium"
                >
                  <option value="Regular">Regular</option>
                  <option value="Pendente de Documentação">Pendente de Documentação</option>
                  <option value="Notificado">Notificado</option>
                  <option value="Sob Embargo">Sob Embargo</option>
                  <option value="Em Análise">Em Análise</option>
                </select>
              </div>
            </div>
          </div>

          {/* Section 5: Risk Classification (CRI, DPA, Category, Alert) */}
          <div className="p-4 bg-emerald-50/50 rounded-xl border border-emerald-200">
            <div className="flex items-center gap-2 mb-3">
              <Calculator size={18} className="text-emerald-700" />
              <h4 className="text-xs font-black uppercase tracking-wider text-emerald-950">
                5. Classificação de Segurança (Resolução CNRH nº 143/2012)
              </h4>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 md:grid-cols-4 gap-4 text-xs">
              <div>
                <label className="block font-semibold text-slate-700 mb-1">
                  Categoria de Risco (CRI)
                </label>
                <select
                  value={cri}
                  onChange={e => setCri(e.target.value as RiskClassification)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg font-bold bg-white focus:ring-2 focus:ring-emerald-500"
                >
                  <option value="Baixo">Baixo</option>
                  <option value="Médio">Médio</option>
                  <option value="Alto">Alto</option>
                </select>
                <span className="text-[10px] text-slate-500 mt-1 block">Estado construtivo e conservação</span>
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">
                  Dano Potencial Associado (DPA)
                </label>
                <select
                  value={dpa}
                  onChange={e => setDpa(e.target.value as AssociatedPotentialDamage)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg font-bold bg-white focus:ring-2 focus:ring-emerald-500"
                >
                  <option value="Baixo">Baixo</option>
                  <option value="Médio">Médio</option>
                  <option value="Alto">Alto</option>
                </select>
                <span className="text-[10px] text-slate-500 mt-1 block">Vidas e impacto socioambiental</span>
              </div>

              {/* Automatic Category Result */}
              <div>
                <label className="block font-semibold text-slate-700 mb-1">
                  Enquadramento Oficial
                </label>
                <div className={`px-3 py-2 rounded-lg font-black text-sm flex items-center justify-between border ${
                  computedCategory === 'A' ? 'bg-rose-100 text-rose-900 border-rose-300' :
                  computedCategory === 'B' ? 'bg-amber-100 text-amber-900 border-amber-300' :
                  computedCategory === 'C' ? 'bg-blue-100 text-blue-900 border-blue-300' :
                  'bg-slate-100 text-slate-800 border-slate-300'
                }`}>
                  <span>Classe {computedCategory}</span>
                  <span className="text-[10px] uppercase font-bold tracking-wider opacity-80">
                    CRI {cri} × DPA {dpa}
                  </span>
                </div>
                <span className="text-[10px] text-emerald-800 font-medium mt-1 block">
                  Calculado conforme norma nacional
                </span>
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">
                  Nível de Alerta Atual
                </label>
                <select
                  value={alertLevel}
                  onChange={e => setAlertLevel(e.target.value as AlertLevel)}
                  className={`w-full px-3 py-2 border rounded-lg font-bold bg-white focus:ring-2 ${
                    alertLevel === 'Normal' ? 'border-emerald-300 text-emerald-800' :
                    alertLevel === 'Atenção' ? 'border-amber-300 text-amber-800' : 'border-rose-300 text-rose-800'
                  }`}
                >
                  <option value="Normal">Normal</option>
                  <option value="Atenção">Atenção</option>
                  <option value="Alerta">Alerta</option>
                  <option value="Emergência">Emergência</option>
                </select>
                <span className="text-[10px] text-slate-500 mt-1 block">Condição física monitorada</span>
              </div>
            </div>

            {/* Instruments Checkboxes */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4 pt-3 border-t border-emerald-200/60 text-xs">
              <div className="flex items-center gap-3 bg-white p-3 rounded-lg border border-slate-200">
                <input
                  type="checkbox"
                  id="hasPSB"
                  checked={hasPSB}
                  onChange={e => setHasPSB(e.target.checked)}
                  className="w-4 h-4 text-emerald-600 rounded focus:ring-emerald-500"
                />
                <div className="flex-1">
                  <label htmlFor="hasPSB" className="font-bold text-slate-900 cursor-pointer">
                    Possui Plano de Segurança de Barragens (PSB)
                  </label>
                  <p className="text-[10px] text-slate-500">Documento técnico obrigatório pela Lei 12.334/10</p>
                </div>
                {hasPSB && (
                  <input
                    type="date"
                    value={psbDate}
                    onChange={e => setPsbDate(e.target.value)}
                    className="px-2 py-1 border border-slate-200 rounded text-xs"
                    title="Data de elaboração/revisão do PSB"
                  />
                )}
              </div>

              <div className="flex items-center gap-3 bg-white p-3 rounded-lg border border-slate-200">
                <input
                  type="checkbox"
                  id="hasPAE"
                  checked={hasPAE}
                  onChange={e => setHasPAE(e.target.checked)}
                  className="w-4 h-4 text-emerald-600 rounded focus:ring-emerald-500"
                />
                <div className="flex-1">
                  <label htmlFor="hasPAE" className="font-bold text-slate-900 cursor-pointer">
                    Possui Plano de Ação de Emergência (PAE)
                  </label>
                  <p className="text-[10px] text-slate-500">Obrigatório para DPA Médio e Alto</p>
                </div>
                {hasPAE && (
                  <input
                    type="date"
                    value={paeDate}
                    onChange={e => setPaeDate(e.target.value)}
                    className="px-2 py-1 border border-slate-200 rounded text-xs"
                    title="Data de protocolo do PAE"
                  />
                )}
              </div>
            </div>
          </div>

          {/* Section 6: Inspection & Notes */}
          <div>
            <h4 className="text-xs font-black uppercase tracking-wider text-slate-800 border-b border-slate-200 pb-2 mb-3">
              6. Última Inspeção e Observações Técnicas
            </h4>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-xs mb-3">
              <div>
                <label className="block font-semibold text-slate-700 mb-1">
                  Data da Última Inspeção
                </label>
                <input
                  type="date"
                  value={lastInspectionDate}
                  onChange={e => setLastInspectionDate(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-xs"
                />
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">
                  Tipo de Inspeção
                </label>
                <select
                  value={lastInspectionType}
                  onChange={e => setLastInspectionType(e.target.value as any)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-xs bg-white"
                >
                  <option value="ISR">ISR (Inspeção de Segurança Regular)</option>
                  <option value="ISE">ISE (Inspeção de Segurança Especial)</option>
                  <option value="Fiscalização SEMA">Fiscalização SEMA in loco</option>
                  <option value="Rotina">Vistoria de Rotina</option>
                </select>
              </div>

              <div className="sm:col-span-1">
                <label className="block font-semibold text-slate-700 mb-1">
                  Instrumentação Existente
                </label>
                <input
                  type="text"
                  placeholder="Ex: Piezômetros, réguas, vertedouro"
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-xs"
                />
              </div>
            </div>

            <div className="text-xs">
              <label className="block font-semibold text-slate-700 mb-1">
                Parecer / Observações do Fiscal da CSB
              </label>
              <textarea
                rows={2}
                value={notes}
                onChange={e => setNotes(e.target.value)}
                placeholder="Anotações técnicas, ressalvas de vistorias, anomalias identificadas, etc."
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-xs focus:ring-2 focus:ring-emerald-500 focus:outline-none"
              />
            </div>
          </div>

          {/* Modal Footer */}
          <div className="pt-4 border-t border-slate-200 flex items-center justify-end gap-3">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-xs font-semibold text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 transition-colors"
            >
              Cancelar
            </button>
            <button
              type="submit"
              className="px-5 py-2 text-xs font-bold text-white bg-emerald-700 hover:bg-emerald-800 rounded-lg shadow-sm transition-colors"
            >
              {editingDam ? 'Atualizar Cadastro' : 'Salvar no Cadastro Central'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
