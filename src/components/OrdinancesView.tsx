import React, { useState, useMemo } from 'react';
import { Ordinance, Dam } from '../types/dam';
import { Search, Plus, FileText, Calendar, ExternalLink, Edit2, Trash2, CheckCircle2 } from 'lucide-react';

interface OrdinancesViewProps {
  ordinances: Ordinance[];
  dams: Dam[];
  onOpenCreate: () => void;
  onEdit: (ord: Ordinance) => void;
  onDelete: (id: string) => void;
  onViewDam: (dam: Dam) => void;
}

export const OrdinancesView: React.FC<OrdinancesViewProps> = ({
  ordinances,
  dams,
  onOpenCreate,
  onEdit,
  onDelete,
  onViewDam
}) => {
  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('ALL');

  const damMap = useMemo(() => {
    const map = new Map<string, Dam>();
    dams.forEach(d => map.set(d.id, d));
    return map;
  }, [dams]);

  const filtered = useMemo(() => {
    return ordinances.filter(ord => {
      const q = search.toLowerCase();
      const matchesSearch =
        ord.number.toLowerCase().includes(q) ||
        ord.summary.toLowerCase().includes(q) ||
        ord.doeNumber.toLowerCase().includes(q);

      const matchesCat = categoryFilter === 'ALL' || ord.category === categoryFilter;
      return matchesSearch && matchesCat;
    });
  }, [ordinances, search, categoryFilter]);

  return (
    <div className="space-y-5 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-2 border-b border-slate-200">
        <div>
          <div className="flex items-center gap-2 text-xs font-bold text-emerald-700 tracking-wider uppercase mb-1">
            <span className="w-2 h-2 rounded-full bg-emerald-600"></span>
            Atos Oficiais da SEMA-MT
          </div>
          <h1 className="text-2xl font-black text-slate-900 tracking-tight">
            Portarias de Segurança de Barragens ({ordinances.length})
          </h1>
          <p className="text-xs text-slate-500 mt-1">
            Publicações no Diário Oficial de MT com enquadramentos de risco, convocações de planos de emergência e ordens fiscais.
          </p>
        </div>

        <button
          onClick={onOpenCreate}
          className="px-4 py-2 text-xs font-bold text-white bg-emerald-700 hover:bg-emerald-800 rounded-lg shadow-sm transition-colors flex items-center gap-1.5 self-start md:self-auto"
        >
          <Plus size={16} />
          <span>Cadastrar Portaria</span>
        </button>
      </div>

      {/* Search & Filters */}
      <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-xs flex flex-col sm:flex-row items-center gap-3">
        <div className="relative flex-1 w-full">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Buscar por número da portaria, termo da ementa ou DOE..."
            className="w-full pl-9 pr-3 py-2 text-xs border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500"
          />
        </div>

        <select
          value={categoryFilter}
          onChange={e => setCategoryFilter(e.target.value)}
          className="w-full sm:w-64 px-3 py-2 text-xs border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500 bg-white font-medium"
        >
          <option value="ALL">Todas as Categorias</option>
          <option value="Classificação Anual de Barragens">Classificação Anual</option>
          <option value="Convocação PAE/PSB">Convocação PAE / PSB</option>
          <option value="Embargo Preventivo">Embargo Preventivo</option>
          <option value="Procedimento Fiscalizatório">Procedimento Fiscalizatório</option>
        </select>
      </div>

      {/* Ordinance cards */}
      <div className="space-y-4">
        {filtered.map(ord => (
          <div
            key={ord.id}
            className="bg-white rounded-xl border border-slate-200 p-5 shadow-xs hover:border-slate-300 transition-all text-xs"
          >
            <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3 pb-3 border-b border-slate-100">
              <div>
                <div className="flex items-center gap-2">
                  <span className="font-extrabold text-sm text-slate-900">{ord.number}</span>
                  <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-100 text-emerald-800">
                    {ord.status}
                  </span>
                </div>
                <div className="text-slate-500 text-[11px] mt-0.5 flex items-center gap-2">
                  <Calendar size={13} className="text-slate-400" />
                  <span>Publicado em {ord.publishDate}</span>
                  <span>·</span>
                  <span className="font-semibold text-slate-700">{ord.doeNumber}</span>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <span className="text-[10px] font-bold text-slate-500 uppercase bg-slate-100 px-2.5 py-1 rounded">
                  {ord.category}
                </span>
                <button
                  onClick={() => onEdit(ord)}
                  className="p-1.5 text-slate-500 hover:text-slate-900 rounded hover:bg-slate-100"
                  title="Editar"
                >
                  <Edit2 size={14} />
                </button>
                <button
                  onClick={() => {
                    if (window.confirm(`Excluir portaria ${ord.number}?`)) {
                      onDelete(ord.id);
                    }
                  }}
                  className="p-1.5 text-rose-500 hover:text-rose-700 rounded hover:bg-rose-50"
                  title="Excluir"
                >
                  <Trash2 size={14} />
                </button>
              </div>
            </div>

            <p className="text-slate-700 leading-relaxed mt-3 font-medium">
              {ord.summary}
            </p>

            {ord.content && ord.content !== ord.summary && (
              <div className="mt-3 p-3 bg-slate-50 rounded-lg text-slate-600 text-[11px] leading-relaxed border border-slate-100">
                {ord.content}
              </div>
            )}

            {/* Related dams */}
            {ord.relatedDams && ord.relatedDams.length > 0 && (
              <div className="mt-3 pt-3 border-t border-slate-100">
                <span className="font-bold text-slate-600 block mb-1 text-[11px]">
                  Barramentos Objeto deste Ato ({ord.relatedDams.length}):
                </span>
                <div className="flex flex-wrap gap-1.5">
                  {ord.relatedDams.map(damId => {
                    const d = damMap.get(damId);
                    if (!d) return null;
                    return (
                      <button
                        key={d.id}
                        onClick={() => onViewDam(d)}
                        className="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-50 text-emerald-800 hover:bg-emerald-100 border border-emerald-200"
                      >
                        {d.name} ({d.category})
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
};
