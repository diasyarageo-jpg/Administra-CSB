import React, { useState, useMemo } from 'react';
import {
  Dam,
  Entrepreneur,
  TechnicalResponsible,
  DamCategory,
  RiskClassification,
  AssociatedPotentialDamage,
  AlertLevel
} from '../types/dam';
import {
  Search,
  Filter,
  Plus,
  Download,
  Eye,
  Edit2,
  Trash2,
  SlidersHorizontal,
  MapPin,
  AlertCircle,
  FileSpreadsheet
} from 'lucide-react';

interface DamsViewProps {
  dams: Dam[];
  entrepreneurs: Entrepreneur[];
  rts: TechnicalResponsible[];
  onSelectDam: (dam: Dam) => void;
  onEditDam: (dam: Dam) => void;
  onDeleteDam: (damId: string) => void;
  onOpenCreateModal: () => void;
}

export const DamsView: React.FC<DamsViewProps> = ({
  dams,
  entrepreneurs,
  rts,
  onSelectDam,
  onEditDam,
  onDeleteDam,
  onOpenCreateModal
}) => {
  const [search, setSearch] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string>('ALL');
  const [selectedAlert, setSelectedAlert] = useState<string>('ALL');
  const [selectedUse, setSelectedUse] = useState<string>('ALL');
  const [selectedBasin, setSelectedBasin] = useState<string>('ALL');

  const entrepreneurMap = useMemo(() => {
    const map = new Map<string, string>();
    entrepreneurs.forEach(e => map.set(e.id, e.name));
    return map;
  }, [entrepreneurs]);

  const filteredDams = useMemo(() => {
    return dams.filter(dam => {
      const q = search.toLowerCase();
      const empName = (entrepreneurMap.get(dam.entrepreneurId) || '').toLowerCase();
      const matchesSearch =
        dam.name.toLowerCase().includes(q) ||
        dam.codeSema.toLowerCase().includes(q) ||
        dam.codeSnisb.toLowerCase().includes(q) ||
        dam.municipality.toLowerCase().includes(q) ||
        dam.river.toLowerCase().includes(q) ||
        empName.includes(q);

      const matchesCat = selectedCategory === 'ALL' || dam.category === selectedCategory;
      const matchesAlert = selectedAlert === 'ALL' || dam.alertLevel === selectedAlert;
      const matchesUse = selectedUse === 'ALL' || dam.mainUse === selectedUse;
      const matchesBasin = selectedBasin === 'ALL' || dam.basin === selectedBasin;

      return matchesSearch && matchesCat && matchesAlert && matchesUse && matchesBasin;
    });
  }, [dams, search, selectedCategory, selectedAlert, selectedUse, selectedBasin, entrepreneurMap]);

  // Export filtered dams as CSV
  const handleExportCSV = () => {
    const headers = [
      'Codigo SEMA',
      'Codigo SNISB',
      'Nome da Barragem',
      'Empreendedor',
      'Municipio',
      'Bacia',
      'Uso Principal',
      'Tipo Estrutura',
      'Altura (m)',
      'Volume (mil m3)',
      'CRI',
      'DPA',
      'Classe',
      'Nivel Alerta',
      'PSB Vigente',
      'PAE Vigente'
    ];

    const rows = filteredDams.map(d => [
      d.codeSema,
      d.codeSnisb || '',
      `"${d.name.replace(/"/g, '""')}"`,
      `"${(entrepreneurMap.get(d.entrepreneurId) || '').replace(/"/g, '""')}"`,
      d.municipality,
      `"${d.basin}"`,
      d.mainUse,
      d.structureType,
      d.height,
      d.reservoirVolume,
      d.cri,
      d.dpa,
      d.category,
      d.alertLevel,
      d.hasPSB ? 'Sim' : 'Nao',
      d.hasPAE ? 'Sim' : 'Nao'
    ]);

    const csvContent = 'data:text/csv;charset=utf-8,\uFEFF' + [headers.join(';'), ...rows.map(e => e.join(';'))].join('\n');
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `barragens_sema_mt_${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div className="space-y-5 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-2 border-b border-slate-200">
        <div>
          <div className="flex items-center gap-2 text-xs font-bold text-emerald-700 tracking-wider uppercase mb-1">
            <span className="w-2 h-2 rounded-full bg-emerald-600"></span>
            Inventário Oficial do Estado de Mato Grosso
          </div>
          <h1 className="text-2xl font-black text-slate-900 tracking-tight">
            Barragens Cadastradas ({dams.length})
          </h1>
          <p className="text-xs text-slate-500 mt-1">
            Controle integrado com classificação de risco, outorgas e planos de segurança vigentes.
          </p>
        </div>

        <div className="flex items-center gap-2.5">
          <button
            onClick={handleExportCSV}
            className="px-3.5 py-2 text-xs font-bold text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 rounded-lg shadow-2xs transition-colors flex items-center gap-1.5"
            title="Exportar inventário filtrado em planilha CSV"
          >
            <FileSpreadsheet size={15} className="text-emerald-700" />
            <span>Exportar CSV</span>
          </button>
          <button
            onClick={onOpenCreateModal}
            className="px-4 py-2 text-xs font-bold text-white bg-emerald-700 hover:bg-emerald-800 rounded-lg shadow-sm transition-colors flex items-center gap-1.5"
          >
            <Plus size={16} />
            <span>Novo Barramento</span>
          </button>
        </div>
      </div>

      {/* Filter and Search Bar */}
      <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-xs space-y-3">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
          {/* Search box */}
          <div className="relative sm:col-span-2 lg:col-span-2">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Buscar por nome, código SEMA/SNISB, município ou empreendedor..."
              className="w-full pl-9 pr-3 py-2 text-xs border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500"
            />
          </div>

          {/* Filter Categoria */}
          <div>
            <select
              value={selectedCategory}
              onChange={e => setSelectedCategory(e.target.value)}
              className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500 bg-white font-medium"
            >
              <option value="ALL">Todas as Classes (CNRH)</option>
              <option value="A">Classe A (Crítica)</option>
              <option value="B">Classe B</option>
              <option value="C">Classe C</option>
              <option value="D">Classe D</option>
            </select>
          </div>

          {/* Filter Nível Alerta */}
          <div>
            <select
              value={selectedAlert}
              onChange={e => setSelectedAlert(e.target.value)}
              className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500 bg-white font-medium"
            >
              <option value="ALL">Todos os Níveis de Alerta</option>
              <option value="Normal">Normal</option>
              <option value="Atenção">Atenção</option>
              <option value="Alerta">Alerta</option>
              <option value="Emergência">Emergência</option>
            </select>
          </div>

          {/* Filter Uso Principal */}
          <div>
            <select
              value={selectedUse}
              onChange={e => setSelectedUse(e.target.value)}
              className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500 bg-white font-medium"
            >
              <option value="ALL">Todos os Usos Principais</option>
              <option value="Geração de Energia">Geração de Energia</option>
              <option value="Irrigação">Irrigação</option>
              <option value="Mineração / Rejeito">Mineração / Rejeito</option>
              <option value="Aquicultura / Dessedentação">Aquicultura</option>
              <option value="Abastecimento Público">Abastecimento Público</option>
              <option value="Industrial">Industrial</option>
            </select>
          </div>
        </div>

        {/* Active Filters count and Reset button */}
        {(search || selectedCategory !== 'ALL' || selectedAlert !== 'ALL' || selectedUse !== 'ALL') && (
          <div className="flex items-center justify-between text-xs text-slate-500 pt-2 border-t border-slate-100">
            <span>Exibindo {filteredDams.length} de {dams.length} barragens encontradas</span>
            <button
              onClick={() => {
                setSearch('');
                setSelectedCategory('ALL');
                setSelectedAlert('ALL');
                setSelectedUse('ALL');
                setSelectedBasin('ALL');
              }}
              className="text-emerald-700 hover:text-emerald-800 font-bold"
            >
              Limpar todos os filtros
            </button>
          </div>
        )}
      </div>

      {/* Dams Table */}
      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden shadow-xs">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-50 text-slate-600 font-bold border-b border-slate-200">
              <tr>
                <th className="px-4 py-3">Código & Nome</th>
                <th className="px-4 py-3">Empreendedor Titular</th>
                <th className="px-4 py-3">Município / Bacia</th>
                <th className="px-4 py-3">Altura / Volume</th>
                <th className="px-4 py-3 text-center">Enquadramento</th>
                <th className="px-4 py-3 text-center">Nível Alerta</th>
                <th className="px-4 py-3 text-center">PSB / PAE</th>
                <th className="px-4 py-3 text-right">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-slate-700">
              {filteredDams.length > 0 ? (
                filteredDams.map(dam => (
                  <tr key={dam.id} className="hover:bg-slate-50/80 transition-colors">
                    <td className="px-4 py-3">
                      <div className="font-bold text-slate-900">{dam.name}</div>
                      <div className="text-[10px] text-slate-500 font-mono">
                        {dam.codeSema} {dam.codeSnisb && `· ${dam.codeSnisb}`}
                      </div>
                      <span className="inline-block mt-0.5 text-[10px] text-slate-600 font-medium">
                        {dam.mainUse}
                      </span>
                    </td>

                    <td className="px-4 py-3">
                      <div className="font-semibold text-slate-800">
                        {entrepreneurMap.get(dam.entrepreneurId) || 'Não atribuído'}
                      </div>
                      <div className="text-[10px] text-slate-500">
                        Estrutura: {dam.structureType}
                      </div>
                    </td>

                    <td className="px-4 py-3">
                      <div className="font-medium text-slate-900">{dam.municipality}</div>
                      <div className="text-[10px] text-slate-500 truncate max-w-[140px]">{dam.basin}</div>
                    </td>

                    <td className="px-4 py-3">
                      <div className="tabular-nums font-semibold text-slate-900">{dam.height} m alt.</div>
                      <div className="text-[10px] text-slate-500 tabular-nums">
                        {dam.reservoirVolume.toLocaleString()} mil m³
                      </div>
                    </td>

                    <td className="px-4 py-3 text-center">
                      <span className={`inline-flex px-2 py-0.5 rounded text-[10px] font-black ${
                        dam.category === 'A' ? 'bg-rose-100 text-rose-800 border border-rose-300' :
                        dam.category === 'B' ? 'bg-amber-100 text-amber-800 border border-amber-300' :
                        dam.category === 'C' ? 'bg-blue-100 text-blue-800 border border-blue-300' :
                        'bg-slate-100 text-slate-800 border border-slate-300'
                      }`}>
                        Classe {dam.category}
                      </span>
                      <div className="text-[9px] text-slate-500 mt-0.5">
                        CRI {dam.cri[0]} / DPA {dam.dpa[0]}
                      </div>
                    </td>

                    <td className="px-4 py-3 text-center">
                      <span className={`inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full ${
                        dam.alertLevel === 'Normal' ? 'bg-emerald-50 text-emerald-800' :
                        dam.alertLevel === 'Atenção' ? 'bg-amber-50 text-amber-800' : 'bg-rose-50 text-rose-800'
                      }`}>
                        <span className={`w-1.5 h-1.5 rounded-full ${
                          dam.alertLevel === 'Normal' ? 'bg-emerald-500' :
                          dam.alertLevel === 'Atenção' ? 'bg-amber-500' : 'bg-rose-500'
                        }`} />
                        {dam.alertLevel}
                      </span>
                    </td>

                    <td className="px-4 py-3 text-center">
                      <div className="flex items-center justify-center gap-1.5">
                        <span className={`px-1.5 py-0.5 rounded text-[9px] font-extrabold ${
                          dam.hasPSB ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-100 text-slate-500'
                        }`} title="Plano de Segurança de Barragens">
                          PSB
                        </span>
                        <span className={`px-1.5 py-0.5 rounded text-[9px] font-extrabold ${
                          dam.hasPAE ? 'bg-blue-100 text-blue-800' : (dam.dpa === 'Baixo' ? 'bg-slate-100 text-slate-400' : 'bg-rose-100 text-rose-800')
                        }`} title="Plano de Ação de Emergência">
                          PAE
                        </span>
                      </div>
                    </td>

                    <td className="px-4 py-3 text-right">
                      <div className="flex items-center justify-end gap-1">
                        <button
                          onClick={() => onSelectDam(dam)}
                          className="p-1.5 rounded-md text-slate-600 hover:text-emerald-700 hover:bg-emerald-50 transition-colors"
                          title="Ficha Técnica Completa"
                        >
                          <Eye size={15} />
                        </button>
                        <button
                          onClick={() => onEditDam(dam)}
                          className="p-1.5 rounded-md text-slate-600 hover:text-blue-700 hover:bg-blue-50 transition-colors"
                          title="Editar Cadastro"
                        >
                          <Edit2 size={15} />
                        </button>
                        <button
                          onClick={() => {
                            if (window.confirm(`Tem certeza que deseja remover o cadastro da barragem "${dam.name}"?`)) {
                              onDeleteDam(dam.id);
                            }
                          }}
                          className="p-1.5 rounded-md text-slate-600 hover:text-rose-700 hover:bg-rose-50 transition-colors"
                          title="Excluir Registro"
                        >
                          <Trash2 size={15} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={8} className="p-8 text-center text-slate-500">
                    <AlertCircle size={28} className="mx-auto text-slate-400 mb-2" />
                    <p className="font-semibold text-slate-700">Nenhum barramento encontrado para os critérios selecionados.</p>
                    <p className="text-xs text-slate-500 mt-1">Experimente alterar os termos de busca ou filtros.</p>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
