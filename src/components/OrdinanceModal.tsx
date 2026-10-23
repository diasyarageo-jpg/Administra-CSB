import React, { useState, useEffect } from 'react';
import { Ordinance, Dam } from '../types/dam';
import { X } from 'lucide-react';

interface OrdinanceModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (ord: Ordinance) => void;
  editingOrdinance?: Ordinance | null;
  dams: Dam[];
}

export const OrdinanceModal: React.FC<OrdinanceModalProps> = ({
  isOpen,
  onClose,
  onSave,
  editingOrdinance,
  dams
}) => {
  const [number, setNumber] = useState('');
  const [publishDate, setPublishDate] = useState('');
  const [doeNumber, setDoeNumber] = useState('');
  const [category, setCategory] = useState<Ordinance['category']>('Classificação Anual de Barragens');
  const [summary, setSummary] = useState('');
  const [content, setContent] = useState('');
  const [status, setStatus] = useState<Ordinance['status']>('Vigente');
  const [selectedDams, setSelectedDams] = useState<string[]>([]);

  useEffect(() => {
    if (editingOrdinance) {
      setNumber(editingOrdinance.number);
      setPublishDate(editingOrdinance.publishDate);
      setDoeNumber(editingOrdinance.doeNumber);
      setCategory(editingOrdinance.category);
      setSummary(editingOrdinance.summary);
      setContent(editingOrdinance.content);
      setStatus(editingOrdinance.status);
      setSelectedDams(editingOrdinance.relatedDams || []);
    } else {
      setNumber(`Portaria SEMA-MT nº ${Math.floor(Math.random() * 800) + 200}/2026`);
      setPublishDate(new Date().toISOString().split('T')[0]);
      setDoeNumber(`DOE nº 28.${Math.floor(Math.random() * 800) + 100} - Caderno 1`);
      setCategory('Classificação Anual de Barragens');
      setSummary('');
      setContent('');
      setStatus('Vigente');
      setSelectedDams([]);
    }
  }, [editingOrdinance, isOpen]);

  if (!isOpen) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!number.trim() || !summary.trim()) return;

    const saved: Ordinance = {
      id: editingOrdinance ? editingOrdinance.id : `ORD-${String(Math.floor(Math.random() * 900) + 100)}`,
      number: number.trim(),
      publishDate,
      doeNumber: doeNumber.trim(),
      category,
      summary: summary.trim(),
      content: content.trim() || summary.trim(),
      relatedDams: selectedDams,
      status
    };

    onSave(saved);
  };

  const toggleDam = (id: string) => {
    if (selectedDams.includes(id)) {
      setSelectedDams(selectedDams.filter(d => d !== id));
    } else {
      setSelectedDams([...selectedDams, id]);
    }
  };

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-slate-950/70 backdrop-blur-xs flex items-center justify-center p-4">
      <div className="relative w-full max-w-2xl bg-white rounded-2xl shadow-2xl border border-slate-200 overflow-hidden my-6">
        <div className="px-6 py-4 bg-slate-900 text-white flex items-center justify-between border-b border-slate-800">
          <div>
            <span className="text-[10px] font-bold tracking-widest text-emerald-400 uppercase">
              SEMA/MT · Atos e Publicações Oficiais
            </span>
            <h3 className="text-base sm:text-lg font-bold">
              {editingOrdinance ? 'Editar Portaria' : 'Publicar Nova Portaria'}
            </h3>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg text-slate-400 hover:text-white">
            <X size={20} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4 text-xs max-h-[80vh] overflow-y-auto">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block font-semibold text-slate-700 mb-1">Identificação da Portaria *</label>
              <input
                type="text"
                required
                value={number}
                onChange={e => setNumber(e.target.value)}
                placeholder="Ex: Portaria SEMA-MT nº 892/2026"
                className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-emerald-500"
              />
            </div>

            <div>
              <label className="block font-semibold text-slate-700 mb-1">Categoria do Ato *</label>
              <select
                value={category}
                onChange={e => setCategory(e.target.value as any)}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg bg-white"
              >
                <option value="Classificação Anual de Barragens">Classificação Anual de Barragens</option>
                <option value="Convocação PAE/PSB">Convocação PAE / PSB</option>
                <option value="Embargo Preventivo">Embargo Preventivo</option>
                <option value="Procedimento Fiscalizatório">Procedimento Fiscalizatório</option>
                <option value="Desembargo / Regularização">Desembargo / Regularização</option>
              </select>
            </div>

            <div>
              <label className="block font-semibold text-slate-700 mb-1">Data de Publicação</label>
              <input
                type="date"
                required
                value={publishDate}
                onChange={e => setPublishDate(e.target.value)}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg"
              />
            </div>

            <div>
              <label className="block font-semibold text-slate-700 mb-1">Edição do Diário Oficial (DOE-MT)</label>
              <input
                type="text"
                value={doeNumber}
                onChange={e => setDoeNumber(e.target.value)}
                placeholder="DOE nº 28.914 - Caderno 1"
                className="w-full px-3 py-2 border border-slate-300 rounded-lg"
              />
            </div>
          </div>

          <div>
            <label className="block font-semibold text-slate-700 mb-1">Ementa / Resumo Executivo *</label>
            <textarea
              required
              rows={2}
              value={summary}
              onChange={e => setSummary(e.target.value)}
              placeholder="Descreva resumidamente o objetivo ou ordem da portaria..."
              className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-emerald-500"
            />
          </div>

          <div>
            <label className="block font-semibold text-slate-700 mb-1">Texto Normativo / Despacho na Íntegra</label>
            <textarea
              rows={4}
              value={content}
              onChange={e => setContent(e.target.value)}
              placeholder="O Secretário de Estado do Meio Ambiente de Mato Grosso..."
              className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-emerald-500"
            />
          </div>

          {/* Dam selection checklist */}
          <div>
            <label className="block font-semibold text-slate-700 mb-1">
              Barragens Alcançadas por este Ato ({selectedDams.length} selecionadas)
            </label>
            <div className="max-h-36 overflow-y-auto p-2 border border-slate-200 rounded-lg space-y-1 bg-slate-50">
              {dams.map(dam => (
                <label key={dam.id} className="flex items-center gap-2 text-xs text-slate-700 p-1 hover:bg-white rounded cursor-pointer">
                  <input
                    type="checkbox"
                    checked={selectedDams.includes(dam.id)}
                    onChange={() => toggleDam(dam.id)}
                    className="rounded text-emerald-600 focus:ring-emerald-500"
                  />
                  <span className="font-bold text-slate-900">{dam.name}</span>
                  <span className="text-slate-500">({dam.municipality} · Classe {dam.category})</span>
                </label>
              ))}
            </div>
          </div>

          <div className="pt-4 border-t border-slate-200 flex justify-end gap-3">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-xs font-semibold text-slate-700 bg-white border border-slate-300 rounded-lg"
            >
              Cancelar
            </button>
            <button
              type="submit"
              className="px-5 py-2 text-xs font-bold text-white bg-emerald-700 hover:bg-emerald-800 rounded-lg"
            >
              Publicar Portaria
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
