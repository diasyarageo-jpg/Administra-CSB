import React, { useState } from 'react';
import {
  Dam,
  Entrepreneur,
  TechnicalResponsible,
  InspectionLog
} from '../types/dam';
import {
  X,
  MapPin,
  Building2,
  UserCheck,
  ShieldAlert,
  FileText,
  Calendar,
  Layers,
  Activity,
  Printer,
  ExternalLink,
  Edit,
  CheckCircle2,
  AlertTriangle
} from 'lucide-react';

interface DamDetailsModalProps {
  dam: Dam | null;
  onClose: () => void;
  onEdit: (dam: Dam) => void;
  entrepreneur?: Entrepreneur;
  rt?: TechnicalResponsible;
  inspectionLogs: InspectionLog[];
}

export const DamDetailsModal: React.FC<DamDetailsModalProps> = ({
  dam,
  onClose,
  onEdit,
  entrepreneur,
  rt,
  inspectionLogs
}) => {
  const [activeTab, setActiveTab] = useState<'geral' | 'seguranca' | 'vistorias' | 'mapa'>('geral');

  if (!dam) return null;

  const relevantLogs = inspectionLogs.filter(log => log.damId === dam.id);

  const handlePrint = () => {
    window.print();
  };

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-slate-950/70 backdrop-blur-xs flex items-center justify-center p-3 sm:p-5">
      <div className="relative w-full max-w-4xl bg-white rounded-2xl shadow-2xl border border-slate-200 overflow-hidden my-6">
        {/* Header */}
        <div className="p-6 bg-slate-900 text-white flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-800">
          <div>
            <div className="flex items-center gap-2 text-xs font-semibold text-emerald-400">
              <span className="font-mono">{dam.codeSema}</span>
              <span>·</span>
              <span>{dam.municipality} (MT)</span>
              <span>·</span>
              <span>{dam.basin}</span>
            </div>
            <h3 className="text-xl font-black tracking-tight text-white mt-1">
              {dam.name}
            </h3>
            <p className="text-xs text-slate-300 mt-0.5">
              Uso: {dam.mainUse} · Estrutura: {dam.structureType}
            </p>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={handlePrint}
              className="p-2 text-slate-300 hover:text-white hover:bg-slate-800 rounded-lg transition-colors"
              title="Imprimir Ficha Técnica"
            >
              <Printer size={18} />
            </button>
            <button
              onClick={() => onEdit(dam)}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold rounded-lg transition-colors"
            >
              <Edit size={14} />
              <span>Editar</span>
            </button>
            <button
              onClick={onClose}
              className="p-2 text-slate-400 hover:text-white hover:bg-slate-800 rounded-lg transition-colors"
            >
              <X size={20} />
            </button>
          </div>
        </div>

        {/* Tab Navigation */}
        <div className="flex items-center px-6 border-b border-slate-200 bg-slate-50 gap-2 overflow-x-auto">
          <button
            onClick={() => setActiveTab('geral')}
            className={`py-3 px-3 text-xs font-bold border-b-2 transition-colors whitespace-nowrap ${
              activeTab === 'geral'
                ? 'border-emerald-600 text-emerald-800 bg-white'
                : 'border-transparent text-slate-600 hover:text-slate-900'
            }`}
          >
            Ficha Técnica Geral
          </button>
          <button
            onClick={() => setActiveTab('seguranca')}
            className={`py-3 px-3 text-xs font-bold border-b-2 transition-colors whitespace-nowrap ${
              activeTab === 'seguranca'
                ? 'border-emerald-600 text-emerald-800 bg-white'
                : 'border-transparent text-slate-600 hover:text-slate-900'
            }`}
          >
            Classificação & Instrumentos (CRI/DPA)
          </button>
          <button
            onClick={() => setActiveTab('vistorias')}
            className={`py-3 px-3 text-xs font-bold border-b-2 transition-colors whitespace-nowrap ${
              activeTab === 'vistorias'
                ? 'border-emerald-600 text-emerald-800 bg-white'
                : 'border-transparent text-slate-600 hover:text-slate-900'
            }`}
          >
            Vistorias & Inspeções ({relevantLogs.length})
          </button>
          <button
            onClick={() => setActiveTab('mapa')}
            className={`py-3 px-3 text-xs font-bold border-b-2 transition-colors whitespace-nowrap ${
              activeTab === 'mapa'
                ? 'border-emerald-600 text-emerald-800 bg-white'
                : 'border-transparent text-slate-600 hover:text-slate-900'
            }`}
          >
            Localização & Coordenadas
          </button>
        </div>

        {/* Tab Contents */}
        <div className="p-6 max-h-[70vh] overflow-y-auto space-y-6">
          {/* TAB 1: GERAL */}
          {activeTab === 'geral' && (
            <div className="space-y-6 text-xs">
              {/* Cards Grid */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* Empreendedor */}
                <div className="p-4 rounded-xl border border-slate-200 bg-slate-50/50">
                  <div className="flex items-center gap-2 text-slate-800 font-bold mb-2">
                    <Building2 size={16} className="text-emerald-700" />
                    <span>Empreendedor Titular</span>
                  </div>
                  {entrepreneur ? (
                    <div className="space-y-1">
                      <div className="text-sm font-extrabold text-slate-900">{entrepreneur.name}</div>
                      <div className="text-slate-600">Doc: {entrepreneur.document} ({entrepreneur.docType})</div>
                      <div className="text-slate-600">Representante: {entrepreneur.legalRepresentative}</div>
                      <div className="text-slate-600">Contato: {entrepreneur.email} · {entrepreneur.phone}</div>
                    </div>
                  ) : (
                    <div className="text-slate-400">Empreendedor não vinculado.</div>
                  )}
                </div>

                {/* RT */}
                <div className="p-4 rounded-xl border border-slate-200 bg-slate-50/50">
                  <div className="flex items-center gap-2 text-slate-800 font-bold mb-2">
                    <UserCheck size={16} className="text-emerald-700" />
                    <span>Responsável Técnico (RT / ART)</span>
                  </div>
                  {rt ? (
                    <div className="space-y-1">
                      <div className="text-sm font-extrabold text-slate-900">{rt.name}</div>
                      <div className="text-slate-600">Registro: CREA {rt.creaNumber} · {rt.specialty}</div>
                      <div className="text-slate-600">ART Vinculada: <span className="font-mono font-bold text-slate-800">{rt.artNumber}</span></div>
                      <div className="text-slate-600">Validade da ART: {rt.validUntil}</div>
                    </div>
                  ) : (
                    <div className="text-slate-400">Responsável técnico não vinculado.</div>
                  )}
                </div>
              </div>

              {/* Dimensões Construtivas */}
              <div className="p-4 rounded-xl border border-slate-200 bg-white">
                <h4 className="text-xs font-black uppercase tracking-wider text-slate-800 mb-3">
                  Parâmetros Geométricos e Hidráulicos
                </h4>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-center">
                  <div className="p-3 bg-slate-50 rounded-lg border border-slate-100">
                    <span className="text-[10px] font-bold text-slate-500 uppercase">Altura do Maciço</span>
                    <div className="text-xl font-black text-slate-900 mt-1 tabular-nums">{dam.height} m</div>
                  </div>
                  <div className="p-3 bg-slate-50 rounded-lg border border-slate-100">
                    <span className="text-[10px] font-bold text-slate-500 uppercase">Crista</span>
                    <div className="text-xl font-black text-slate-900 mt-1 tabular-nums">{dam.crestLength} m</div>
                  </div>
                  <div className="p-3 bg-slate-50 rounded-lg border border-slate-100">
                    <span className="text-[10px] font-bold text-slate-500 uppercase">Volume Reservado</span>
                    <div className="text-xl font-black text-slate-900 mt-1 tabular-nums">{dam.reservoirVolume.toLocaleString()} mil m³</div>
                  </div>
                  <div className="p-3 bg-slate-50 rounded-lg border border-slate-100">
                    <span className="text-[10px] font-bold text-slate-500 uppercase">Espelho d'Água</span>
                    <div className="text-xl font-black text-slate-900 mt-1 tabular-nums">{dam.reservoirArea} ha</div>
                  </div>
                </div>
              </div>

              {/* Atos autorizativos */}
              <div className="p-4 rounded-xl border border-slate-200 bg-white">
                <h4 className="text-xs font-black uppercase tracking-wider text-slate-800 mb-2">
                  Atos Autorizativos e Licenciamento SEMA
                </h4>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  <div>
                    <span className="text-slate-500 text-[10px] uppercase font-bold block">Código SNISB</span>
                    <span className="font-mono font-bold text-slate-900">{dam.codeSnisb || 'Não informado'}</span>
                  </div>
                  <div>
                    <span className="text-slate-500 text-[10px] uppercase font-bold block">Portaria de Outorga</span>
                    <span className="font-semibold text-slate-900">{dam.outorgaNumber || 'Não informada'}</span>
                  </div>
                  <div>
                    <span className="text-slate-500 text-[10px] uppercase font-bold block">Licença Ambiental</span>
                    <span className="font-semibold text-slate-900">{dam.environmentalLicense || 'Não informada'}</span>
                  </div>
                </div>
              </div>

              {/* Observações */}
              {dam.notes && (
                <div className="p-4 rounded-xl border border-slate-200 bg-amber-50/40 text-amber-950">
                  <div className="font-bold mb-1">Anotações do Fiscal SEMA / CSB:</div>
                  <p className="leading-relaxed">{dam.notes}</p>
                </div>
              )}
            </div>
          )}

          {/* TAB 2: SEGURANÇA */}
          {activeTab === 'seguranca' && (
            <div className="space-y-6 text-xs">
              {/* Classification Banner */}
              <div className="p-5 rounded-xl border border-slate-200 bg-slate-900 text-white flex flex-col sm:flex-row items-center justify-between gap-4">
                <div>
                  <span className="text-[10px] font-bold uppercase tracking-wider text-emerald-400">
                    Enquadramento Nacional de Segurança (Res. CNRH 143/2012)
                  </span>
                  <div className="text-2xl font-black mt-1">
                    Categoria Classe {dam.category}
                  </div>
                  <div className="text-slate-300 mt-0.5">
                    Classificação de Risco (CRI): <strong className="text-white">{dam.cri}</strong> · Dano Potencial Associado (DPA): <strong className="text-white">{dam.dpa}</strong>
                  </div>
                </div>

                <div className="px-4 py-2 rounded-lg bg-slate-800 border border-slate-700 text-center">
                  <span className="text-[10px] text-slate-400 block font-bold">Nível de Alerta</span>
                  <span className={`text-base font-black ${
                    dam.alertLevel === 'Normal' ? 'text-emerald-400' :
                    dam.alertLevel === 'Atenção' ? 'text-amber-400' : 'text-rose-400'
                  }`}>
                    {dam.alertLevel}
                  </span>
                </div>
              </div>

              {/* Instruments checklist */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className={`p-4 rounded-xl border ${dam.hasPSB ? 'bg-emerald-50/50 border-emerald-200' : 'bg-rose-50/50 border-rose-200'}`}>
                  <div className="flex items-center gap-2 mb-2">
                    {dam.hasPSB ? (
                      <CheckCircle2 size={18} className="text-emerald-700" />
                    ) : (
                      <AlertTriangle size={18} className="text-rose-700" />
                    )}
                    <h5 className="font-bold text-slate-900 text-sm">Plano de Segurança de Barragens (PSB)</h5>
                  </div>
                  <p className="text-slate-600 mb-2 leading-relaxed">
                    Exigido para todos os barramentos submetidos à PNSB. Inclui manual de operação, fichas de inspeção e monitoramento geotécnico.
                  </p>
                  <div className="text-[11px] font-bold text-slate-800">
                    Status: {dam.hasPSB ? `Protocolado e Vigente (${dam.psbDate || 'Data não registrada'})` : 'PENDENTE DE APRESENTAÇÃO'}
                  </div>
                </div>

                <div className={`p-4 rounded-xl border ${dam.hasPAE ? 'bg-blue-50/50 border-blue-200' : 'bg-slate-50 border-slate-200'}`}>
                  <div className="flex items-center gap-2 mb-2">
                    {dam.hasPAE ? (
                      <CheckCircle2 size={18} className="text-blue-700" />
                    ) : (
                      <AlertTriangle size={18} className="text-slate-400" />
                    )}
                    <h5 className="font-bold text-slate-900 text-sm">Plano de Ação de Emergência (PAE)</h5>
                  </div>
                  <p className="text-slate-600 mb-2 leading-relaxed">
                    Obrigatório para estruturas com DPA Médio ou Alto. Estabelece a zona de autossalvamento (ZAS) e integração com a Defesa Civil.
                  </p>
                  <div className="text-[11px] font-bold text-slate-800">
                    Status: {dam.hasPAE ? `Aprovado e Notificado (${dam.paeDate || 'Data não registrada'})` : (dam.dpa === 'Baixo' ? 'Não exigível para DPA Baixo' : 'OBRIGATÓRIO / NÃO APRESENTADO')}
                  </div>
                </div>
              </div>

              {/* Periodicidade exigida */}
              <div className="p-4 rounded-xl border border-slate-200 bg-white">
                <h4 className="text-xs font-black uppercase tracking-wider text-slate-800 mb-3">
                  Prazos e Obrigações Regulatórias para Classe {dam.category}
                </h4>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div className="p-3 bg-slate-50 rounded-lg">
                    <span className="font-bold text-slate-900 block">Inspeção Regular (ISR)</span>
                    <span className="text-slate-600 text-[11px]">Periodicidade: Anual (protocolo até 31 de dezembro)</span>
                  </div>
                  <div className="p-3 bg-slate-50 rounded-lg">
                    <span className="font-bold text-slate-900 block">Revisão Periódica (RPSB)</span>
                    <span className="text-slate-600 text-[11px]">
                      {dam.category === 'A' ? 'A cada 3 anos' : dam.category === 'B' ? 'A cada 5 anos' : 'A cada 7 anos'}
                    </span>
                  </div>
                  <div className="p-3 bg-slate-50 rounded-lg">
                    <span className="font-bold text-slate-900 block">Fiscalização Ordinária SEMA</span>
                    <span className="text-slate-600 text-[11px]">
                      {dam.category === 'A' ? 'Semestral / In loco' : 'Conforme plano anual de fiscalização'}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* TAB 3: VISTORIAS */}
          {activeTab === 'vistorias' && (
            <div className="space-y-4 text-xs">
              <div className="flex items-center justify-between pb-2 border-b border-slate-200">
                <span className="font-bold text-slate-800">Histórico de Vistorias e Relatórios de Inspeção</span>
                <span className="text-slate-500">Última inspeção: {dam.lastInspectionDate} ({dam.lastInspectionType})</span>
              </div>

              {relevantLogs.length > 0 ? (
                <div className="space-y-3">
                  {relevantLogs.map(log => (
                    <div key={log.id} className="p-4 rounded-xl border border-slate-200 bg-slate-50/70 space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="font-bold text-slate-900 text-sm">{log.type} — {log.date}</span>
                        <span className="text-[11px] font-semibold text-emerald-800 bg-emerald-100 px-2 py-0.5 rounded">
                          {log.scoreOrOutcome}
                        </span>
                      </div>
                      <div className="text-slate-600">Inspetor / Equipe: <strong>{log.inspector}</strong></div>
                      <p className="text-slate-700 bg-white p-2.5 rounded-lg border border-slate-200/60 leading-relaxed">
                        {log.notes}
                      </p>
                      {log.recommendations.length > 0 && (
                        <div className="mt-2">
                          <span className="font-bold text-slate-800 block mb-1">Recomendações técnicas:</span>
                          <ul className="list-disc pl-4 space-y-0.5 text-slate-600">
                            {log.recommendations.map((rec, idx) => (
                              <li key={idx}>{rec}</li>
                            ))}
                          </ul>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              ) : (
                <div className="p-8 text-center bg-slate-50 rounded-xl border border-slate-200 text-slate-500">
                  <Activity size={32} className="mx-auto mb-2 text-slate-400" />
                  <p className="font-semibold">Nenhuma vistoria arquivada localmente para este barramento.</p>
                  <p className="text-[11px] mt-1">A última data informada no cadastro é {dam.lastInspectionDate}.</p>
                </div>
              )}
            </div>
          )}

          {/* TAB 4: MAPA */}
          {activeTab === 'mapa' && (
            <div className="space-y-4 text-xs">
              <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <MapPin size={18} className="text-emerald-700" />
                    <span className="font-bold text-slate-900">Coordenadas Geográficas (SIRGAS 2000)</span>
                  </div>
                  <a
                    href={`https://www.google.com/maps?q=${dam.coordinates.lat},${dam.coordinates.lng}`}
                    target="_blank"
                    rel="noreferrer"
                    className="flex items-center gap-1 text-emerald-700 hover:text-emerald-800 font-bold"
                  >
                    <span>Abrir no Google Maps</span>
                    <ExternalLink size={14} />
                  </a>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="p-3 bg-white rounded-lg border border-slate-200 font-mono text-center">
                    <span className="text-[10px] text-slate-500 font-sans uppercase font-bold block">Latitude</span>
                    <span className="text-base font-bold text-slate-900">{dam.coordinates.lat}</span>
                  </div>
                  <div className="p-3 bg-white rounded-lg border border-slate-200 font-mono text-center">
                    <span className="text-[10px] text-slate-500 font-sans uppercase font-bold block">Longitude</span>
                    <span className="text-base font-bold text-slate-900">{dam.coordinates.lng}</span>
                  </div>
                </div>

                {/* Simulated Geolocation Canvas / Map view */}
                <div className="relative h-64 bg-slate-800 rounded-xl overflow-hidden flex items-center justify-center border border-slate-700">
                  <div className="absolute inset-0 opacity-20 bg-[radial-gradient(#10b981_1px,transparent_1px)] [background-size:16px_16px]" />
                  <div className="text-center z-10 text-white space-y-2 p-4">
                    <div className="w-12 h-12 rounded-full bg-emerald-500/20 text-emerald-400 border border-emerald-500/40 flex items-center justify-center mx-auto">
                      <MapPin size={24} />
                    </div>
                    <div className="font-bold text-sm">{dam.name}</div>
                    <div className="text-xs text-slate-300">
                      {dam.river ? `Curso hídrico: ${dam.river}` : 'Rio não identificado'} · {dam.municipality} — MT
                    </div>
                    <div className="text-[11px] font-mono text-emerald-300">
                      Lat: {dam.coordinates.lat.toFixed(4)} | Lng: {dam.coordinates.lng.toFixed(4)}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-4 bg-slate-50 border-t border-slate-200 flex justify-between items-center text-xs">
          <span className="text-slate-500">
            Atualizado em: {new Date(dam.updatedAt).toLocaleDateString()}
          </span>
          <button
            onClick={onClose}
            className="px-4 py-2 bg-slate-800 hover:bg-slate-900 text-white font-bold rounded-lg transition-colors"
          >
            Fechar Ficha
          </button>
        </div>
      </div>
    </div>
  );
};
