import React from 'react';
import {
  Dam,
  Entrepreneur,
  TechnicalResponsible,
  ReconciliationItem,
  Ordinance
} from '../types/dam';
import {
  ShieldAlert,
  Database,
  Building2,
  GitCompare,
  AlertTriangle,
  CheckCircle2,
  FileCheck2,
  MapPin,
  Flame,
  ArrowRight,
  Droplets,
  Zap,
  Wheat,
  Pickaxe
} from 'lucide-react';
import { NavView } from './Sidebar';

interface DashboardViewProps {
  dams: Dam[];
  entrepreneurs: Entrepreneur[];
  rts: TechnicalResponsible[];
  reconciliations: ReconciliationItem[];
  ordinances: Ordinance[];
  onNavigate: (view: NavView) => void;
  onSelectDam: (dam: Dam) => void;
}

export const DashboardView: React.FC<DashboardViewProps> = ({
  dams,
  entrepreneurs,
  rts,
  reconciliations,
  ordinances,
  onNavigate,
  onSelectDam
}) => {
  // Key Stats
  const totalDams = dams.length;
  const pendingReconciliations = reconciliations.filter(r => r.status === 'Pendente').length;
  const attentionOrAlertDams = dams.filter(d => d.alertLevel !== 'Normal');
  const classA = dams.filter(d => d.category === 'A').length;
  const classB = dams.filter(d => d.category === 'B').length;
  const classC = dams.filter(d => d.category === 'C').length;
  const classD = dams.filter(d => d.category === 'D').length;

  const withPSB = dams.filter(d => d.hasPSB).length;
  const withPAE = dams.filter(d => d.hasPAE).length;
  const requiringPAE = dams.filter(d => d.dpa === 'Alto' || d.dpa === 'Médio').length;
  const paeCompliancePct = requiringPAE > 0 ? Math.round((withPAE / requiringPAE) * 100) : 100;
  const psbCompliancePct = totalDams > 0 ? Math.round((withPSB / totalDams) * 100) : 0;

  // Basin distribution
  const basinCounts: Record<string, number> = {};
  dams.forEach(d => {
    basinCounts[d.basin] = (basinCounts[d.basin] || 0) + 1;
  });

  // Main use distribution
  const useCounts: Record<string, number> = {};
  dams.forEach(d => {
    useCounts[d.mainUse] = (useCounts[d.mainUse] || 0) + 1;
  });

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      {/* Page Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-2 border-b border-slate-200">
        <div>
          <div className="flex items-center gap-2 text-xs font-bold text-emerald-700 tracking-wider uppercase mb-1">
            <span className="w-2 h-2 rounded-full bg-emerald-600"></span>
            Coordenadoria de Segurança de Barragens — CSB
          </div>
          <h1 className="text-2xl sm:text-3xl font-extrabold text-slate-900 tracking-tight">
            Painel Central de Gestão e Segurança
          </h1>
          <p className="text-xs sm:text-sm text-slate-500 mt-1">
            Supervisão contínua de barramentos em Mato Grosso conforme Lei Federal nº 12.334/2010 e Resoluções CNRH.
          </p>
        </div>

        <div className="flex items-center gap-2.5">
          <button
            onClick={() => onNavigate('barragens')}
            className="px-3.5 py-2 text-xs font-bold text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 rounded-lg shadow-2xs transition-colors flex items-center gap-1.5"
          >
            <span>Ver Inventário Completo</span>
            <ArrowRight size={14} />
          </button>
        </div>
      </div>

      {/* 4 Primary Stats Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Total Barragens */}
        <div className="bg-white p-4 sm:p-5 rounded-xl border border-slate-200 shadow-xs flex items-start justify-between">
          <div>
            <span className="text-[11px] font-bold tracking-wider text-slate-500 uppercase">
              Barragens sob Jurisdição
            </span>
            <div className="text-3xl font-black text-slate-900 tracking-tight tabular-nums mt-1">
              {totalDams}
            </div>
            <div className="flex items-center gap-1.5 text-[11px] text-slate-500 mt-2 font-medium">
              <span className="text-emerald-700 font-bold">Classe A: {classA}</span>
              <span>·</span>
              <span>Classe B: {classB}</span>
              <span>·</span>
              <span>C/D: {classC + classD}</span>
            </div>
          </div>
          <div className="w-10 h-10 rounded-xl bg-emerald-50 text-emerald-700 flex items-center justify-center shrink-0">
            <Database size={20} />
          </div>
        </div>

        {/* Empreendedores e RTs */}
        <div className="bg-white p-4 sm:p-5 rounded-xl border border-slate-200 shadow-xs flex items-start justify-between">
          <div>
            <span className="text-[11px] font-bold tracking-wider text-slate-500 uppercase">
              Agentes Regulados
            </span>
            <div className="text-3xl font-black text-slate-900 tracking-tight tabular-nums mt-1">
              {entrepreneurs.length}
            </div>
            <div className="flex items-center gap-2 text-[11px] text-slate-500 mt-2 font-medium">
              <span>{rts.length} Responsáveis Técnicos com ART</span>
            </div>
          </div>
          <div className="w-10 h-10 rounded-xl bg-blue-50 text-blue-700 flex items-center justify-center shrink-0">
            <Building2 size={20} />
          </div>
        </div>

        {/* Conciliações Pendentes */}
        <div className="bg-white p-4 sm:p-5 rounded-xl border border-slate-200 shadow-xs flex items-start justify-between cursor-pointer hover:border-amber-300 transition-colors"
          onClick={() => onNavigate('revisoes')}
        >
          <div>
            <span className="text-[11px] font-bold tracking-wider text-slate-500 uppercase">
              Conciliações de Cadastro
            </span>
            <div className="text-3xl font-black text-amber-600 tracking-tight tabular-nums mt-1">
              {pendingReconciliations}
            </div>
            <div className="flex items-center gap-1 text-[11px] text-amber-700 font-semibold mt-2">
              <span>Divergências SEMA × SNISB</span>
              <ArrowRight size={12} />
            </div>
          </div>
          <div className="w-10 h-10 rounded-xl bg-amber-50 text-amber-700 flex items-center justify-center shrink-0">
            <GitCompare size={20} />
          </div>
        </div>

        {/* Nível de Alerta / Atenção */}
        <div className="bg-white p-4 sm:p-5 rounded-xl border border-slate-200 shadow-xs flex items-start justify-between">
          <div>
            <span className="text-[11px] font-bold tracking-wider text-slate-500 uppercase">
              Alerta Operacional
            </span>
            <div className={`text-3xl font-black tracking-tight tabular-nums mt-1 ${
              attentionOrAlertDams.length > 0 ? 'text-rose-600' : 'text-emerald-700'
            }`}>
              {attentionOrAlertDams.length}
            </div>
            <div className="flex items-center gap-1.5 text-[11px] text-slate-500 mt-2 font-medium">
              {attentionOrAlertDams.length > 0 ? (
                <span className="text-rose-600 font-bold">1 estrutura sob notificação</span>
              ) : (
                <span className="text-emerald-600 font-bold">Nenhum evento anômalo crítico</span>
              )}
            </div>
          </div>
          <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${
            attentionOrAlertDams.length > 0 ? 'bg-rose-50 text-rose-600' : 'bg-emerald-50 text-emerald-700'
          }`}>
            <ShieldAlert size={20} />
          </div>
        </div>
      </div>

      {/* Main Grid: Classification & Compliance */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left Column: CNRH Matrix and Category distribution */}
        <div className="lg:col-span-2 space-y-6">
          {/* Categoria de Risco e DPA Card */}
          <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-xs">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-3 border-b border-slate-100">
              <div>
                <h2 className="text-sm font-bold text-slate-900 uppercase tracking-wider">
                  Matriz de Enquadramento Oficial (Res. CNRH nº 143/2012)
                </h2>
                <p className="text-xs text-slate-500">
                  Cruzamento entre Categoria de Risco (CRI) e Dano Potencial Associado (DPA)
                </p>
              </div>
              <span className="text-[11px] font-semibold text-slate-500 bg-slate-100 px-2 py-0.5 rounded">
                Critério PNSB
              </span>
            </div>

            {/* Matrix representation */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 my-4">
              <div className="p-3 rounded-lg bg-rose-50/70 border border-rose-200">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-rose-800">Classe A</span>
                  <span className="text-xs font-extrabold text-rose-900 bg-rose-200/60 px-1.5 py-0.5 rounded tabular-nums">
                    {classA}
                  </span>
                </div>
                <div className="text-[11px] text-rose-700 mt-1">CRI Alto + DPA Alto</div>
                <div className="text-[10px] text-rose-600/80 mt-2 font-medium">Fiscalização prioritária semestral</div>
              </div>

              <div className="p-3 rounded-lg bg-amber-50/70 border border-amber-200">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-amber-800">Classe B</span>
                  <span className="text-xs font-extrabold text-amber-900 bg-amber-200/60 px-1.5 py-0.5 rounded tabular-nums">
                    {classB}
                  </span>
                </div>
                <div className="text-[11px] text-amber-700 mt-1">DPA Alto + CRI Médio/Baixo</div>
                <div className="text-[10px] text-amber-600/80 mt-2 font-medium">Vistoria e PAE obrigatórios</div>
              </div>

              <div className="p-3 rounded-lg bg-blue-50/70 border border-blue-200">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-blue-800">Classe C</span>
                  <span className="text-xs font-extrabold text-blue-900 bg-blue-200/60 px-1.5 py-0.5 rounded tabular-nums">
                    {classC}
                  </span>
                </div>
                <div className="text-[11px] text-blue-700 mt-1">DPA Médio ou CRI Alto</div>
                <div className="text-[10px] text-blue-600/80 mt-2 font-medium">Inspeção regular periódica</div>
              </div>

              <div className="p-3 rounded-lg bg-slate-50 border border-slate-200">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-slate-800">Classe D</span>
                  <span className="text-xs font-extrabold text-slate-900 bg-slate-200/70 px-1.5 py-0.5 rounded tabular-nums">
                    {classD}
                  </span>
                </div>
                <div className="text-[11px] text-slate-600 mt-1">DPA Baixo + CRI Baixo</div>
                <div className="text-[10px] text-slate-500 mt-2 font-medium">Monitoramento simplificado</div>
              </div>
            </div>

            {/* Document Compliance Bars */}
            <div className="mt-4 pt-4 border-t border-slate-100 grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <div className="flex items-center justify-between text-xs mb-1.5">
                  <span className="font-semibold text-slate-700">Planos de Segurança (PSB) Vigentes</span>
                  <span className="font-bold text-slate-900 tabular-nums">{withPSB} de {totalDams} ({psbCompliancePct}%)</span>
                </div>
                <div className="h-2 w-full bg-slate-100 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-emerald-600 rounded-full transition-all duration-500"
                    style={{ width: `${psbCompliancePct}%` }}
                  />
                </div>
              </div>

              <div>
                <div className="flex items-center justify-between text-xs mb-1.5">
                  <span className="font-semibold text-slate-700">Planos de Emergência (PAE) Exigidos</span>
                  <span className="font-bold text-slate-900 tabular-nums">{withPAE} de {requiringPAE} ({paeCompliancePct}%)</span>
                </div>
                <div className="h-2 w-full bg-slate-100 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-blue-600 rounded-full transition-all duration-500"
                    style={{ width: `${paeCompliancePct}%` }}
                  />
                </div>
              </div>
            </div>
          </div>

          {/* Recent Dams Table */}
          <div className="bg-white rounded-xl border border-slate-200 overflow-hidden shadow-xs">
            <div className="p-4 border-b border-slate-200 flex items-center justify-between">
              <div>
                <h2 className="text-sm font-bold text-slate-900 uppercase tracking-wider">
                  Barramentos Prioritários em Acompanhamento
                </h2>
                <p className="text-xs text-slate-500">Última atualização cadastral e situação de conformidade</p>
              </div>
              <button
                onClick={() => onNavigate('barragens')}
                className="text-xs font-bold text-emerald-700 hover:text-emerald-800 transition-colors"
              >
                Gerenciar todas →
              </button>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-50/80 text-slate-500 font-semibold border-b border-slate-200">
                  <tr>
                    <th className="px-4 py-3">Código & Nome</th>
                    <th className="px-4 py-3">Município / Bacia</th>
                    <th className="px-4 py-3">Classe</th>
                    <th className="px-4 py-3">Nível Alerta</th>
                    <th className="px-4 py-3">Última Inspeção</th>
                    <th className="px-4 py-3 text-right">Ação</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 text-slate-700">
                  {dams.slice(0, 5).map(dam => (
                    <tr key={dam.id} className="hover:bg-slate-50/80 transition-colors">
                      <td className="px-4 py-3">
                        <div className="font-bold text-slate-900">{dam.name}</div>
                        <div className="text-[10px] text-slate-500 font-mono">{dam.codeSema} · {dam.mainUse}</div>
                      </td>
                      <td className="px-4 py-3">
                        <div className="font-medium text-slate-800">{dam.municipality}</div>
                        <div className="text-[10px] text-slate-500">{dam.basin}</div>
                      </td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex px-2 py-0.5 rounded text-[10px] font-extrabold ${
                          dam.category === 'A' ? 'bg-rose-100 text-rose-800' :
                          dam.category === 'B' ? 'bg-amber-100 text-amber-800' :
                          dam.category === 'C' ? 'bg-blue-100 text-blue-800' :
                          'bg-slate-100 text-slate-700'
                        }`}>
                          Classe {dam.category}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex items-center gap-1 text-[11px] font-semibold ${
                          dam.alertLevel === 'Normal' ? 'text-emerald-700' :
                          dam.alertLevel === 'Atenção' ? 'text-amber-700' : 'text-rose-700'
                        }`}>
                          <span className={`w-1.5 h-1.5 rounded-full ${
                            dam.alertLevel === 'Normal' ? 'bg-emerald-600' :
                            dam.alertLevel === 'Atenção' ? 'bg-amber-500' : 'bg-rose-600'
                          }`} />
                          {dam.alertLevel}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <div className="tabular-nums font-medium text-slate-800">{dam.lastInspectionDate}</div>
                        <div className="text-[10px] text-slate-500">{dam.lastInspectionType}</div>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <button
                          onClick={() => onSelectDam(dam)}
                          className="px-2.5 py-1 text-[11px] font-bold text-emerald-700 bg-emerald-50 hover:bg-emerald-100 rounded-md transition-colors"
                        >
                          Detalhes
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        {/* Right Column: Basin distribution, Use types & Quick Links */}
        <div className="space-y-6">
          {/* Basin distribution */}
          <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-xs">
            <h2 className="text-sm font-bold text-slate-900 uppercase tracking-wider pb-3 border-b border-slate-100 flex items-center justify-between">
              <span>Bacias Hidrográficas</span>
              <Droplets size={16} className="text-emerald-600" />
            </h2>

            <div className="space-y-3 mt-4">
              {Object.entries(basinCounts).map(([basin, count]) => {
                const pct = Math.round((count / totalDams) * 100);
                return (
                  <div key={basin} className="space-y-1">
                    <div className="flex justify-between text-xs">
                      <span className="font-semibold text-slate-700">{basin}</span>
                      <span className="font-bold text-slate-900 tabular-nums">{count} ({pct}%)</span>
                    </div>
                    <div className="h-1.5 w-full bg-slate-100 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-slate-700 rounded-full"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Main Uses */}
          <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-xs">
            <h2 className="text-sm font-bold text-slate-900 uppercase tracking-wider pb-3 border-b border-slate-100">
              Distribuição por Uso Principal
            </h2>

            <div className="space-y-2.5 mt-3">
              {Object.entries(useCounts).map(([use, count]) => (
                <div key={use} className="flex items-center justify-between p-2 rounded-lg bg-slate-50 border border-slate-100 text-xs">
                  <span className="font-semibold text-slate-700">{use}</span>
                  <span className="font-black text-slate-900 bg-white px-2 py-0.5 rounded border border-slate-200 tabular-nums">
                    {count}
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* Portarias Recentes */}
          <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-xs">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <h2 className="text-sm font-bold text-slate-900 uppercase tracking-wider">
                Atos Oficiais e Portarias SEMA
              </h2>
              <button
                onClick={() => onNavigate('portarias')}
                className="text-xs font-bold text-emerald-700 hover:text-emerald-800"
              >
                Ver todas →
              </button>
            </div>

            <div className="space-y-3 mt-3">
              {ordinances.slice(0, 2).map(ord => (
                <div key={ord.id} className="p-3 rounded-lg bg-slate-50 border border-slate-200/70 text-xs">
                  <div className="font-bold text-slate-900">{ord.number}</div>
                  <div className="text-[10px] text-slate-500 mt-0.5">Publicado em {ord.publishDate} · {ord.doeNumber}</div>
                  <p className="text-slate-600 line-clamp-2 mt-1.5 text-[11px] leading-relaxed">
                    {ord.summary}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
