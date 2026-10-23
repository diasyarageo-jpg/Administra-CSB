import React, { useState, useMemo } from 'react';
import { Entrepreneur, Dam } from '../types/dam';
import { Search, Plus, Building2, Phone, Mail, MapPin, Database, Edit2, Trash2 } from 'lucide-react';

interface EntrepreneursViewProps {
  entrepreneurs: Entrepreneur[];
  dams: Dam[];
  onOpenCreate: () => void;
  onEdit: (e: Entrepreneur) => void;
  onDelete: (id: string) => void;
  onViewDam: (dam: Dam) => void;
}

export const EntrepreneursView: React.FC<EntrepreneursViewProps> = ({
  entrepreneurs,
  dams,
  onOpenCreate,
  onEdit,
  onDelete,
  onViewDam
}) => {
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [selectedEntrepreneurId, setSelectedEntrepreneurId] = useState<string | null>(null);

  const damsByEntrepreneur = useMemo(() => {
    const map = new Map<string, Dam[]>();
    dams.forEach(d => {
      const list = map.get(d.entrepreneurId) || [];
      list.push(d);
      map.set(d.entrepreneurId, list);
    });
    return map;
  }, [dams]);

  const filtered = useMemo(() => {
    return entrepreneurs.filter(emp => {
      const q = search.toLowerCase();
      const matchesSearch =
        emp.name.toLowerCase().includes(q) ||
        emp.tradeName.toLowerCase().includes(q) ||
        emp.document.toLowerCase().includes(q) ||
        emp.municipality.toLowerCase().includes(q) ||
        emp.legalRepresentative.toLowerCase().includes(q);

      const matchesStatus = statusFilter === 'ALL' || emp.status === statusFilter;
      return matchesSearch && matchesStatus;
    });
  }, [entrepreneurs, search, statusFilter]);

  return (
    <div className="space-y-5 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-2 border-b border-slate-200">
        <div>
          <div className="flex items-center gap-2 text-xs font-bold text-emerald-700 tracking-wider uppercase mb-1">
            <span className="w-2 h-2 rounded-full bg-emerald-600"></span>
            Pessoas Físicas e Jurídicas Reguladas
          </div>
          <h1 className="text-2xl font-black text-slate-900 tracking-tight">
            Empreendedores Cadastrados ({entrepreneurs.length})
          </h1>
          <p className="text-xs text-slate-500 mt-1">
            Gestão dos titulares outorgados, responsáveis legais e vínculos com barramentos ativos.
          </p>
        </div>

        <button
          onClick={onOpenCreate}
          className="px-4 py-2 text-xs font-bold text-white bg-emerald-700 hover:bg-emerald-800 rounded-lg shadow-sm transition-colors flex items-center gap-1.5 self-start md:self-auto"
        >
          <Plus size={16} />
          <span>Novo Empreendedor</span>
        </button>
      </div>

      {/* Search and Filters */}
      <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-xs flex flex-col sm:flex-row items-center gap-3">
        <div className="relative flex-1 w-full">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Buscar por razão social, nome fantasia, CNPJ/CPF, município..."
            className="w-full pl-9 pr-3 py-2 text-xs border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500"
          />
        </div>

        <select
          value={statusFilter}
          onChange={e => setStatusFilter(e.target.value)}
          className="w-full sm:w-56 px-3 py-2 text-xs border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500 bg-white font-medium"
        >
          <option value="ALL">Todas as Situações</option>
          <option value="Regular">Regular</option>
          <option value="Notificado">Notificado</option>
          <option value="Irregular">Irregular</option>
          <option value="Suspenso">Suspenso</option>
        </select>
      </div>

      {/* List of Entrepreneurs */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {filtered.map(emp => {
          const linkedDams = damsByEntrepreneur.get(emp.id) || [];
          return (
            <div
              key={emp.id}
              className="bg-white rounded-xl border border-slate-200 p-5 shadow-xs hover:border-slate-300 transition-all flex flex-col justify-between"
            >
              <div>
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h3 className="font-extrabold text-sm text-slate-900 leading-snug">
                      {emp.name}
                    </h3>
                    <div className="text-xs text-slate-500 mt-0.5">
                      {emp.tradeName && emp.tradeName !== emp.name && <span>{emp.tradeName} · </span>}
                      <span className="font-mono font-medium">{emp.docType}: {emp.document}</span>
                    </div>
                  </div>

                  <span className={`px-2 py-0.5 rounded text-[10px] font-black shrink-0 ${
                    emp.status === 'Regular' ? 'bg-emerald-100 text-emerald-800' :
                    emp.status === 'Notificado' ? 'bg-amber-100 text-amber-800' : 'bg-rose-100 text-rose-800'
                  }`}>
                    {emp.status}
                  </span>
                </div>

                {/* Details */}
                <div className="mt-4 space-y-1.5 text-xs text-slate-600">
                  <div className="flex items-center gap-2">
                    <MapPin size={14} className="text-slate-400 shrink-0" />
                    <span>{emp.municipality} — MT {emp.address ? `(${emp.address})` : ''}</span>
                  </div>
                  {emp.legalRepresentative && (
                    <div className="text-slate-500">
                      Representante: <strong className="text-slate-700">{emp.legalRepresentative}</strong>
                    </div>
                  )}
                  <div className="flex items-center gap-4 pt-1 text-slate-500">
                    {emp.phone && (
                      <span className="flex items-center gap-1 font-mono text-[11px]">
                        <Phone size={12} /> {emp.phone}
                      </span>
                    )}
                    {emp.email && (
                      <span className="flex items-center gap-1 truncate text-[11px]">
                        <Mail size={12} /> {emp.email}
                      </span>
                    )}
                  </div>
                </div>

                {/* Linked Dams Pill List */}
                <div className="mt-4 pt-3 border-t border-slate-100">
                  <div className="text-[11px] font-bold text-slate-700 flex items-center justify-between mb-2">
                    <span>Barragens Vinculadas:</span>
                    <span className="font-mono text-emerald-700">{linkedDams.length} estruturas</span>
                  </div>
                  {linkedDams.length > 0 ? (
                    <div className="flex flex-wrap gap-1.5">
                      {linkedDams.map(d => (
                        <button
                          key={d.id}
                          onClick={() => onViewDam(d)}
                          className="px-2 py-1 text-[10px] font-bold bg-slate-100 hover:bg-emerald-100 hover:text-emerald-800 text-slate-700 rounded transition-colors text-left"
                        >
                          {d.name} ({d.category})
                        </button>
                      ))}
                    </div>
                  ) : (
                    <p className="text-[11px] text-slate-400 italic">Nenhum barramento atribuído.</p>
                  )}
                </div>
              </div>

              {/* Actions */}
              <div className="mt-4 pt-3 border-t border-slate-100 flex items-center justify-end gap-2">
                <button
                  onClick={() => onEdit(emp)}
                  className="px-3 py-1.5 text-xs font-semibold text-slate-700 bg-slate-50 hover:bg-slate-100 rounded-lg transition-colors flex items-center gap-1"
                >
                  <Edit2 size={13} />
                  <span>Editar</span>
                </button>
                <button
                  onClick={() => {
                    if (window.confirm(`Deseja remover o empreendedor "${emp.name}"?`)) {
                      onDelete(emp.id);
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
