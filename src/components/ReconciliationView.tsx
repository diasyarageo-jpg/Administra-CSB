import React, { useState } from 'react';
import { ReconciliationItem, Dam } from '../types/dam';
import {
  GitCompare,
  CheckCircle2,
  AlertTriangle,
  Send,
  Plus,
  Filter,
  Check,
  FileCheck,
  ArrowRight,
  ShieldAlert
} from 'lucide-react';

interface ReconciliationViewProps {
  reconciliations: ReconciliationItem[];
  dams: Dam[];
  onUpdateReconciliation: (item: ReconciliationItem) => void;
  onAddReconciliation: (item: ReconciliationItem) => void;
  onViewDam: (dam: Dam) => void;
  activeUserName: string;
}

export const ReconciliationView: React.FC<ReconciliationViewProps> = ({
  reconciliations,
  dams,
  onUpdateReconciliation,
  onAddReconciliation,
  onViewDam,
  activeUserName
}) => {
  const [filterStatus, setFilterStatus] = useState<'ALL' | 'Pendente' | 'Resolvidos'>('Pendente');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [resolvingItem, setResolvingItem] = useState<ReconciliationItem | null>(null);
  const [resolutionComment, setResolutionComment] = useState('');
  const [resolutionAction, setResolutionAction] = useState<'Aprovado SEMA' | 'Aceito Declarado' | 'Notificado Empreendedor'>('Aprovado SEMA');

  // Form states for new reconciliation item
  const [newDamId, setNewDamId] = useState(dams[0]?.id || '');
  const [newField, setNewField] = useState('Altura do Maciço');
  const [newSourceSEMA, setNewSourceSEMA] = useState('');
  const [newSourceDeclared, setNewSourceDeclared] = useState('');
  const [newOrigin, setNewOrigin] = useState<ReconciliationItem['origin']>('SNISB/ANA');
  const [newSeverity, setNewSeverity] = useState<ReconciliationItem['severity']>('Moderada');

  const filtered = reconciliations.filter(item => {
    if (filterStatus === 'Pendente') return item.status === 'Pendente';
    if (filterStatus === 'Resolvidos') return item.status !== 'Pendente';
    return true;
  });

  const pendingCount = reconciliations.filter(r => r.status === 'Pendente').length;
  const resolvedCount = reconciliations.filter(r => r.status !== 'Pendente').length;

  const handleResolveSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!resolvingItem) return;

    const updated: ReconciliationItem = {
      ...resolvingItem,
      status: resolutionAction,
      resolutionNotes: resolutionComment.trim() || `Conciliado e registrado por ${activeUserName}`,
      resolvedBy: activeUserName,
      resolvedAt: new Date().toISOString().split('T')[0]
    };

    onUpdateReconciliation(updated);
    setResolvingItem(null);
    setResolutionComment('');
  };

  const handleCreateSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const selectedDam = dams.find(d => d.id === newDamId);
    if (!selectedDam) return;

    const item: ReconciliationItem = {
      id: `REC-${String(Math.floor(Math.random() * 900) + 100)}`,
      damId: selectedDam.id,
      damName: selectedDam.name,
      field: newField,
      sourceSEMA: newSourceSEMA.trim(),
      sourceDeclaredOrSNISB: newSourceDeclared.trim(),
      origin: newOrigin,
      severity: newSeverity,
      status: 'Pendente',
      dateDetected: new Date().toISOString().split('T')[0]
    };

    onAddReconciliation(item);
    setIsModalOpen(false);
    setNewSourceSEMA('');
    setNewSourceDeclared('');
  };

  return (
    <div className="space-y-5 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-2 border-b border-slate-200">
        <div>
          <div className="flex items-center gap-2 text-xs font-bold text-amber-700 tracking-wider uppercase mb-1">
            <span className="w-2 h-2 rounded-full bg-amber-600"></span>
            Auditoria & Cruzamento de Informações
          </div>
          <h1 className="text-2xl font-black text-slate-900 tracking-tight">
            Conciliação de Cadastros ({reconciliations.length})
          </h1>
          <p className="text-xs text-slate-500 mt-1">
            Identificação e harmonização de divergências entre o Cadastro Central SEMA/MT e o SNISB/ANA ou dados declarados.
          </p>
        </div>

        <div className="flex items-center gap-2.5">
          <button
            onClick={() => setIsModalOpen(true)}
            className="px-4 py-2 text-xs font-bold text-white bg-amber-600 hover:bg-amber-700 rounded-lg shadow-sm transition-colors flex items-center gap-1.5"
          >
            <Plus size={16} />
            <span>Apontar Nova Divergência</span>
          </button>
        </div>
      </div>

      {/* Summary KPI Strip */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <button
          onClick={() => setFilterStatus('Pendente')}
          className={`p-4 rounded-xl border text-left transition-all ${
            filterStatus === 'Pendente'
              ? 'bg-amber-50/80 border-amber-300 ring-2 ring-amber-500/30'
              : 'bg-white border-slate-200 hover:border-slate-300'
          }`}
        >
          <div className="text-[11px] font-bold uppercase text-amber-800">Pendentes de Conciliação</div>
          <div className="text-2xl font-black text-amber-700 tabular-nums mt-1">{pendingCount} casos</div>
          <p className="text-[10px] text-slate-500 mt-1">Aguardando parecer do fiscal ou retificação</p>
        </button>

        <button
          onClick={() => setFilterStatus('Resolvidos')}
          className={`p-4 rounded-xl border text-left transition-all ${
            filterStatus === 'Resolvidos'
              ? 'bg-emerald-50/80 border-emerald-300 ring-2 ring-emerald-500/30'
              : 'bg-white border-slate-200 hover:border-slate-300'
          }`}
        >
          <div className="text-[11px] font-bold uppercase text-emerald-800">Casos Conciliados</div>
          <div className="text-2xl font-black text-emerald-700 tabular-nums mt-1">{resolvedCount} harmonizados</div>
          <p className="text-[10px] text-slate-500 mt-1">Dados validados ou atualizados no sistema</p>
        </button>

        <button
          onClick={() => setFilterStatus('ALL')}
          className={`p-4 rounded-xl border text-left transition-all ${
            filterStatus === 'ALL'
              ? 'bg-slate-100 border-slate-400 ring-2 ring-slate-400/30'
              : 'bg-white border-slate-200 hover:border-slate-300'
          }`}
        >
          <div className="text-[11px] font-bold uppercase text-slate-700">Total de Registros de Auditoria</div>
          <div className="text-2xl font-black text-slate-900 tabular-nums mt-1">{reconciliations.length} itens</div>
          <p className="text-[10px] text-slate-500 mt-1">Histórico completo de auditoria cadastral</p>
        </button>
      </div>

      {/* Discrepancy Cards List */}
      <div className="space-y-4">
        {filtered.map(item => {
          const associatedDam = dams.find(d => d.id === item.damId);
          const isPending = item.status === 'Pendente';

          return (
            <div
              key={item.id}
              className={`bg-white rounded-xl border p-5 shadow-xs transition-all ${
                isPending ? 'border-amber-200 hover:border-amber-300' : 'border-slate-200'
              }`}
            >
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-slate-100">
                <div className="flex items-center gap-3">
                  <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${
                    item.severity === 'Crítica' ? 'bg-rose-100 text-rose-700' :
                    item.severity === 'Moderada' ? 'bg-amber-100 text-amber-700' : 'bg-blue-100 text-blue-700'
                  }`}>
                    <GitCompare size={16} />
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <h3 className="font-extrabold text-sm text-slate-900">
                        {item.damName}
                      </h3>
                      {associatedDam && (
                        <button
                          onClick={() => onViewDam(associatedDam)}
                          className="text-[10px] font-bold text-emerald-700 hover:underline"
                        >
                          (Ver ficha técnica)
                        </button>
                      )}
                    </div>
                    <div className="text-xs text-slate-500 mt-0.5">
                      Campo Divergente: <strong className="text-slate-800">{item.field}</strong> · Detectado em {item.dateDetected}
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <span className={`px-2 py-0.5 rounded text-[10px] font-black uppercase ${
                    item.severity === 'Crítica' ? 'bg-rose-100 text-rose-800' :
                    item.severity === 'Moderada' ? 'bg-amber-100 text-amber-800' : 'bg-blue-100 text-blue-800'
                  }`}>
                    Severidade {item.severity}
                  </span>

                  <span className={`px-2.5 py-0.5 rounded-full text-[10px] font-extrabold ${
                    item.status === 'Pendente' ? 'bg-amber-100 text-amber-900' :
                    item.status === 'Aprovado SEMA' ? 'bg-emerald-100 text-emerald-900' :
                    item.status === 'Aceito Declarado' ? 'bg-blue-100 text-blue-900' : 'bg-slate-100 text-slate-800'
                  }`}>
                    {item.status}
                  </span>
                </div>
              </div>

              {/* Side-by-Side comparison */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4 text-xs">
                {/* SEMA Baseline */}
                <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200">
                  <div className="flex items-center justify-between text-slate-500 font-bold uppercase text-[10px] mb-1">
                    <span>Base Oficial SEMA-MT (SIRIEMA / SIGA)</span>
                    <span className="text-emerald-700 font-black">CSB MT</span>
                  </div>
                  <div className="text-slate-900 font-bold text-sm bg-white p-2.5 rounded-lg border border-slate-200/80">
                    {item.sourceSEMA}
                  </div>
                </div>

                {/* External / Declared Source */}
                <div className="p-3.5 rounded-xl bg-amber-50/40 border border-amber-200/70">
                  <div className="flex items-center justify-between text-amber-900 font-bold uppercase text-[10px] mb-1">
                    <span>Origem Externa / Declarada ({item.origin})</span>
                    <span className="text-amber-700 font-black">{item.origin}</span>
                  </div>
                  <div className="text-slate-900 font-bold text-sm bg-white p-2.5 rounded-lg border border-amber-200">
                    {item.sourceDeclaredOrSNISB}
                  </div>
                </div>
              </div>

              {/* Resolution details or Actions */}
              <div className="mt-4 pt-3 border-t border-slate-100 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs">
                {item.status !== 'Pendente' ? (
                  <div className="text-slate-600 text-[11px]">
                    <span className="font-semibold text-emerald-800">Parecer de Conciliação: </span>
                    <span>{item.resolutionNotes}</span>
                    {item.resolvedBy && (
                      <span className="text-slate-400 block mt-0.5">Harmonizado por {item.resolvedBy} em {item.resolvedAt}</span>
                    )}
                  </div>
                ) : (
                  <div className="text-[11px] text-amber-800 font-medium">
                    Necessária análise técnica para definir prevalência do dado ou emissão de notificação.
                  </div>
                )}

                {isPending && (
                  <button
                    onClick={() => {
                      setResolvingItem(item);
                      setResolutionAction('Aprovado SEMA');
                      setResolutionComment('');
                    }}
                    className="px-4 py-1.5 text-xs font-bold text-white bg-slate-900 hover:bg-emerald-700 rounded-lg transition-colors flex items-center gap-1.5 self-start sm:self-auto"
                  >
                    <CheckCircle2 size={14} />
                    <span>Deliberar e Conciliar</span>
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Modal: Deliberar Conciliação */}
      {resolvingItem && (
        <div className="fixed inset-0 z-50 overflow-y-auto bg-slate-950/70 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="w-full max-w-lg bg-white rounded-2xl shadow-2xl border border-slate-200 overflow-hidden text-xs">
            <div className="p-4 bg-slate-900 text-white flex justify-between items-center">
              <h3 className="font-bold text-sm">Deliberação de Conciliação Cadastral</h3>
              <button onClick={() => setResolvingItem(null)} className="text-slate-400 hover:text-white">✕</button>
            </div>
            <form onSubmit={handleResolveSubmit} className="p-5 space-y-4">
              <div>
                <span className="text-slate-500 text-[10px] uppercase font-bold block">Estrutura em Análise</span>
                <span className="font-bold text-slate-900 text-sm">{resolvingItem.damName}</span>
                <p className="text-slate-600 mt-0.5">Divergência: <strong>{resolvingItem.field}</strong></p>
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">Decisão Técnica do Fiscal</label>
                <select
                  value={resolutionAction}
                  onChange={e => setResolutionAction(e.target.value as any)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg bg-white font-bold"
                >
                  <option value="Aprovado SEMA">Aprovar e Manter Dado SEMA-MT (Vistoria / Outorga Oficial)</option>
                  <option value="Aceito Declarado">Aceitar Dado Externo / Declarado (Atualizar Base SEMA)</option>
                  <option value="Notificado Empreendedor">Notificar Empreendedor para Retificação em 15 dias</option>
                </select>
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">Justificativa Técnica / Despacho</label>
                <textarea
                  required
                  rows={3}
                  value={resolutionComment}
                  onChange={e => setResolutionComment(e.target.value)}
                  placeholder="Ex: Dado conferido in loco durante vistoria técnica. Prevalece medição com trena a laser e GNSS..."
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-emerald-500"
                />
              </div>

              <div className="flex justify-end gap-2 pt-3 border-t border-slate-200">
                <button
                  type="button"
                  onClick={() => setResolvingItem(null)}
                  className="px-4 py-2 border border-slate-300 rounded-lg text-slate-700 font-semibold"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 bg-emerald-700 text-white font-bold rounded-lg hover:bg-emerald-800"
                >
                  Concluir Conciliação
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Apontar Nova Divergência */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 overflow-y-auto bg-slate-950/70 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="w-full max-w-lg bg-white rounded-2xl shadow-2xl border border-slate-200 overflow-hidden text-xs">
            <div className="p-4 bg-slate-900 text-white flex justify-between items-center">
              <h3 className="font-bold text-sm">Registrar Nova Divergência de Cadastro</h3>
              <button onClick={() => setIsModalOpen(false)} className="text-slate-400 hover:text-white">✕</button>
            </div>
            <form onSubmit={handleCreateSubmit} className="p-5 space-y-3">
              <div>
                <label className="block font-semibold text-slate-700 mb-1">Barragem com Inconsistência *</label>
                <select
                  value={newDamId}
                  onChange={e => setNewDamId(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg bg-white font-medium"
                >
                  {dams.map(d => (
                    <option key={d.id} value={d.id}>{d.name} ({d.codeSema})</option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Campo com Divergência</label>
                  <input
                    type="text"
                    required
                    value={newField}
                    onChange={e => setNewField(e.target.value)}
                    placeholder="Ex: Altura, Volume, Coordenadas..."
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Origem do Dado Divergente</label>
                  <select
                    value={newOrigin}
                    onChange={e => setNewOrigin(e.target.value as any)}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg bg-white"
                  >
                    <option value="SNISB/ANA">SNISB / ANA</option>
                    <option value="SIRIEMA">SIRIEMA</option>
                    <option value="Declaração Anual">Declaração Anual do Empreendedor</option>
                    <option value="Fiscalização In Loco">Fiscalização In Loco</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">Valor Atual no Cadastro SEMA</label>
                <input
                  type="text"
                  required
                  value={newSourceSEMA}
                  onChange={e => setNewSourceSEMA(e.target.value)}
                  placeholder="Ex: 14.5 metros"
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg"
                />
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">Valor Encontrado na Outra Fonte</label>
                <input
                  type="text"
                  required
                  value={newSourceDeclared}
                  onChange={e => setNewSourceDeclared(e.target.value)}
                  placeholder="Ex: 18.0 metros (SNISB)"
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg"
                />
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">Nível de Severidade</label>
                <select
                  value={newSeverity}
                  onChange={e => setNewSeverity(e.target.value as any)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg bg-white"
                >
                  <option value="Moderada">Moderada (Ajuste técnico normal)</option>
                  <option value="Crítica">Crítica (Impacto direto em enquadramento CRI/DPA)</option>
                  <option value="Informativa">Informativa (Padronização cadastral)</option>
                </select>
              </div>

              <div className="flex justify-end gap-2 pt-3 border-t border-slate-200">
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  className="px-4 py-2 border border-slate-300 rounded-lg text-slate-700"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 bg-amber-600 text-white font-bold rounded-lg hover:bg-amber-700"
                >
                  Registrar Divergência
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
