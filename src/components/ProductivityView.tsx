import React, { useState } from 'react';
import { ProductivityRecord } from '../types/dam';
import { TrendingUp, Award, CheckCircle, FileText, AlertOctagon, Users, Calendar, Download } from 'lucide-react';

interface ProductivityViewProps {
  productivity: ProductivityRecord[];
  onUpdateRecord: (record: ProductivityRecord) => void;
}

export const ProductivityView: React.FC<ProductivityViewProps> = ({
  productivity,
  onUpdateRecord
}) => {
  const [selectedPeriod, setSelectedPeriod] = useState('Outubro / 2026');

  const totalVistorias = productivity.reduce((acc, p) => acc + p.vistoriasRealizadas, 0);
  const totalPareceres = productivity.reduce((acc, p) => acc + p.pareceresEmitidos, 0);
  const totalNotificacoes = productivity.reduce((acc, p) => acc + p.notificacoesExpedidas, 0);
  const totalAutos = productivity.reduce((acc, p) => acc + p.autosInfracao, 0);
  const totalProcessos = productivity.reduce((acc, p) => acc + p.processosConcluidos, 0);
  const avgMeta = Math.round(productivity.reduce((acc, p) => acc + p.metaAlcancadaPct, 0) / productivity.length);

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-2 border-b border-slate-200">
        <div>
          <div className="flex items-center gap-2 text-xs font-bold text-emerald-700 tracking-wider uppercase mb-1">
            <span className="w-2 h-2 rounded-full bg-emerald-600"></span>
            Gestão de Metas & Indicadores Institucionais
          </div>
          <h1 className="text-2xl font-black text-slate-900 tracking-tight">
            Produtividade da Coordenadoria de Segurança (CSB)
          </h1>
          <p className="text-xs text-slate-500 mt-1">
            Acompanhamento de vistorias em campo, pareceres técnicos emitidos, notificações e processos instruídos.
          </p>
        </div>

        <div className="flex items-center gap-2.5">
          <div className="flex items-center gap-2 bg-white px-3 py-1.5 rounded-lg border border-slate-200 text-xs font-semibold">
            <Calendar size={14} className="text-slate-500" />
            <span>Período: {selectedPeriod}</span>
          </div>
        </div>
      </div>

      {/* Summary KPI Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-xs">
          <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block">Vistorias Campo</span>
          <div className="text-2xl font-black text-slate-900 tabular-nums mt-1">{totalVistorias}</div>
          <span className="text-[10px] text-emerald-700 font-semibold">In loco no estado</span>
        </div>

        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-xs">
          <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block">Pareceres Emitidos</span>
          <div className="text-2xl font-black text-slate-900 tabular-nums mt-1">{totalPareceres}</div>
          <span className="text-[10px] text-blue-700 font-semibold">Laudos de outorga e PAE</span>
        </div>

        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-xs">
          <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block">Notificações</span>
          <div className="text-2xl font-black text-amber-600 tabular-nums mt-1">{totalNotificacoes}</div>
          <span className="text-[10px] text-amber-700 font-semibold">Adequação documental</span>
        </div>

        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-xs">
          <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block">Autos de Infração</span>
          <div className="text-2xl font-black text-rose-600 tabular-nums mt-1">{totalAutos}</div>
          <span className="text-[10px] text-rose-700 font-semibold">Descumprimento grave</span>
        </div>

        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-xs">
          <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block">Processos Concluídos</span>
          <div className="text-2xl font-black text-emerald-700 tabular-nums mt-1">{totalProcessos}</div>
          <span className="text-[10px] text-emerald-700 font-semibold">Finalizados no mês</span>
        </div>

        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-xs">
          <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block">Meta Global</span>
          <div className="text-2xl font-black text-emerald-700 tabular-nums mt-1">{avgMeta}%</div>
          <span className="text-[10px] text-emerald-800 font-semibold">Índice de cumprimento</span>
        </div>
      </div>

      {/* Agents Productivity Table */}
      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden shadow-xs">
        <div className="p-4 border-b border-slate-200 flex items-center justify-between">
          <div>
            <h3 className="text-xs font-bold text-slate-900 uppercase tracking-wider">
              Desempenho Individual dos Técnicos e Fiscais da CSB
            </h3>
            <p className="text-xs text-slate-500">Métricas validadas pela chefia da Superintendência de Recursos Hídricos (SURH)</p>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-50 text-slate-600 font-bold border-b border-slate-200">
              <tr>
                <th className="px-4 py-3">Servidor / Matrícula</th>
                <th className="px-4 py-3">Cargo / Função</th>
                <th className="px-4 py-3 text-center">Vistorias</th>
                <th className="px-4 py-3 text-center">Pareceres</th>
                <th className="px-4 py-3 text-center">Notificações</th>
                <th className="px-4 py-3 text-center">Autos</th>
                <th className="px-4 py-3 text-center">Concluídos</th>
                <th className="px-4 py-3 text-right">Atingimento da Meta</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-slate-700">
              {productivity.map(record => (
                <tr key={record.id} className="hover:bg-slate-50/80 transition-colors">
                  <td className="px-4 py-3">
                    <div className="font-bold text-slate-900">{record.agentName}</div>
                    <div className="text-[10px] text-slate-500 font-mono">{record.matricula}</div>
                  </td>

                  <td className="px-4 py-3 font-medium text-slate-800">
                    {record.role}
                  </td>

                  <td className="px-4 py-3 text-center font-bold text-slate-900 tabular-nums">
                    {record.vistoriasRealizadas}
                  </td>

                  <td className="px-4 py-3 text-center font-bold text-slate-900 tabular-nums">
                    {record.pareceresEmitidos}
                  </td>

                  <td className="px-4 py-3 text-center font-bold text-amber-700 tabular-nums">
                    {record.notificacoesExpedidas}
                  </td>

                  <td className="px-4 py-3 text-center font-bold text-rose-700 tabular-nums">
                    {record.autosInfracao}
                  </td>

                  <td className="px-4 py-3 text-center font-bold text-emerald-800 tabular-nums">
                    {record.processosConcluidos}
                  </td>

                  <td className="px-4 py-3 text-right">
                    <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full font-black text-[11px] bg-emerald-100 text-emerald-800 tabular-nums">
                      <CheckCircle size={12} />
                      {record.metaAlcancadaPct}%
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
