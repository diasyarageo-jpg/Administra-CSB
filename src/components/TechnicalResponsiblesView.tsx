import React, { useState, useMemo } from 'react';
import { TechnicalResponsible, Dam } from '../types/dam';
import { Search, Plus, UserCheck, ShieldCheck, Mail, Phone, Edit2, Trash2 } from 'lucide-react';

interface TechnicalResponsiblesViewProps {
  rts: TechnicalResponsible[];
  dams: Dam[];
  onOpenCreate: () => void;
  onEdit: (rt: TechnicalResponsible) => void;
  onDelete: (id: string) => void;
  onViewDam: (dam: Dam) => void;
}

export const TechnicalResponsiblesView: React.FC<TechnicalResponsiblesViewProps> = ({
  rts,
  dams,
  onOpenCreate,
  onEdit,
  onDelete,
  onViewDam
}) => {
  const [search, setSearch] = useState('');
  const [specialtyFilter, setSpecialtyFilter] = useState('ALL');

  const damsByRT = useMemo(() => {
    const map = new Map<string, Dam[]>();
    dams.forEach(d => {
      const list = map.get(d.rtId) || [];
      list.push(d);
      map.set(d.rtId, list);
    });
    return map;
  }, [dams]);

  const filtered = useMemo(() => {
    return rts.filter(rt => {
      const q = search.toLowerCase();
      const matchesSearch =
        rt.name.toLowerCase().includes(q) ||
        rt.creaNumber.toLowerCase().includes(q) ||
        rt.artNumber.toLowerCase().includes(q) ||
        rt.specialty.toLowerCase().includes(q);

      const matchesSpec = specialtyFilter === 'ALL' || rt.specialty === specialtyFilter;
      return matchesSearch && matchesSpec;
    });
  }, [rts, search, specialtyFilter]);

  return (
    <div className="space-y-5 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-2 border-b border-slate-200">
        <div>
          <div className="flex items-center gap-2 text-xs font-bold text-emerald-700 tracking-wider uppercase mb-1">
            <span className="w-2 h-2 rounded-full bg-emerald-600"></span>
            Engenheiros e Geólogos Habilitados
          </div>
          <h1 className="text-2xl font-black text-slate-900 tracking-tight">
            Responsáveis Técnicos — RTs ({rts.length})
          </h1>
          <p className="text-xs text-slate-500 mt-1">
            Profissionais com Anotação de Responsabilidade Técnica (ART) válida para segurança de barragens.
          </p>
        </div>

        <button
          onClick={onOpenCreate}
          className="px-4 py-2 text-xs font-bold text-white bg-emerald-700 hover:bg-emerald-800 rounded-lg shadow-sm transition-colors flex items-center gap-1.5 self-start md:self-auto"
        >
          <Plus size={16} />
          <span>Cadastrar Novo RT</span>
        </button>
      </div>

      {/* Filter and Search */}
      <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-xs flex flex-col sm:flex-row items-center gap-3">
        <div className="relative flex-1 w-full">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Buscar por nome, registro CREA, ART ou especialidade..."
            className="w-full pl-9 pr-3 py-2 text-xs border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500"
          />
        </div>

        <select
          value={specialtyFilter}
          onChange={e => setSpecialtyFilter(e.target.value)}
          className="w-full sm:w-64 px-3 py-2 text-xs border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500 bg-white font-medium"
        >
          <option value="ALL">Todas as Especialidades</option>
          <option value="Engenharia Geotécnica">Engenharia Geotécnica</option>
          <option value="Engenharia Civil">Engenharia Civil</option>
          <option value="Engenharia de Minas">Engenharia de Minas</option>
          <option value="Engenharia Hídrica/Sanitária">Engenharia Hídrica</option>
          <option value="Geologia">Geologia</option>
        </select>
      </div>

      {/* RTs Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {filtered.map(rt => {
          const linkedDams = damsByRT.get(rt.id) || [];
          return (
            <div
              key={rt.id}
              className="bg-white rounded-xl border border-slate-200 p-5 shadow-xs hover:border-slate-300 transition-all flex flex-col justify-between"
            >
              <div>
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-start gap-3">
                    <div className="w-10 h-10 rounded-full bg-emerald-50 text-emerald-700 flex items-center justify-center font-bold text-sm shrink-0 border border-emerald-200">
                      <UserCheck size={18} />
                    </div>
                    <div>
                      <h3 className="font-extrabold text-sm text-slate-900 leading-snug">
                        {rt.name}
                      </h3>
                      <div className="text-xs text-slate-600 font-medium">
                        CREA: <strong className="text-slate-800 font-mono">{rt.creaNumber}</strong>/{rt.creaUf} · {rt.specialty}
                      </div>
                    </div>
                  </div>

                  <span className={`px-2 py-0.5 rounded text-[10px] font-black shrink-0 ${
                    rt.status === 'Ativo' ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-100 text-slate-700'
                  }`}>
                    {rt.status}
                  </span>
                </div>

                {/* ART info */}
                <div className="mt-4 p-3 rounded-lg bg-slate-50 border border-slate-100 text-xs space-y-1">
                  <div className="flex items-center justify-between">
                    <span className="text-slate-500 font-bold uppercase text-[10px]">Anotação Técnica (ART)</span>
                    <span className="font-mono font-bold text-slate-900">{rt.artNumber}</span>
                  </div>
                  <div className="flex items-center justify-between text-slate-600">
                    <span>Validade da ART:</span>
                    <span className="tabular-nums font-semibold">{rt.validUntil}</span>
                  </div>
                </div>

                {/* Contacts */}
                <div className="mt-3 flex items-center gap-4 text-xs text-slate-600">
                  {rt.phone && (
                    <span className="flex items-center gap-1 font-mono text-[11px]">
                      <Phone size={12} className="text-slate-400" /> {rt.phone}
                    </span>
                  )}
                  {rt.email && (
                    <span className="flex items-center gap-1 truncate text-[11px]">
                      <Mail size={12} className="text-slate-400" /> {rt.email}
                    </span>
                  )}
                </div>

                {/* Linked Dams */}
                <div className="mt-4 pt-3 border-t border-slate-100">
                  <div className="text-[11px] font-bold text-slate-700 flex items-center justify-between mb-2">
                    <span>Barragens sob Responsabilidade Ativa:</span>
                    <span className="font-mono text-emerald-700">{linkedDams.length} estruturas</span>
                  </div>
                  {linkedDams.length > 0 ? (
                    <div className="flex flex-wrap gap-1.5">
                      {linkedDams.map(d => (
                        <button
                          key={d.id}
                          onClick={() => onViewDam(d)}
                          className="px-2 py-1 text-[10px] font-bold bg-slate-100 hover:bg-emerald-100 hover:text-emerald-800 text-slate-700 rounded transition-colors"
                        >
                          {d.name} ({d.category})
                        </button>
                      ))}
                    </div>
                  ) : (
                    <p className="text-[11px] text-slate-400 italic">Nenhuma barragem vinculada no momento.</p>
                  )}
                </div>
              </div>

              {/* Actions */}
              <div className="mt-4 pt-3 border-t border-slate-100 flex items-center justify-end gap-2">
                <button
                  onClick={() => onEdit(rt)}
                  className="px-3 py-1.5 text-xs font-semibold text-slate-700 bg-slate-50 hover:bg-slate-100 rounded-lg transition-colors flex items-center gap-1"
                >
                  <Edit2 size={13} />
                  <span>Editar</span>
                </button>
                <button
                  onClick={() => {
                    if (window.confirm(`Deseja remover o RT "${rt.name}"?`)) {
                      onDelete(rt.id);
                    }
                  }}
                  className="px-2.5 py-1.5 text-xs font-semibold text-rose-600 hover:bg-rose-50 rounded-lg transition-colors"
                >
                  <Trash2 size={13} />
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
