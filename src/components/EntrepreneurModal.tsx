import React, { useState, useEffect } from 'react';
import { Entrepreneur } from '../types/dam';
import { X } from 'lucide-react';

interface EntrepreneurModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (entrepreneur: Entrepreneur) => void;
  editingEntrepreneur?: Entrepreneur | null;
}

export const EntrepreneurModal: React.FC<EntrepreneurModalProps> = ({
  isOpen,
  onClose,
  onSave,
  editingEntrepreneur
}) => {
  const [name, setName] = useState('');
  const [tradeName, setTradeName] = useState('');
  const [docType, setDocType] = useState<'CNPJ' | 'CPF'>('CNPJ');
  const [document, setDocument] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [address, setAddress] = useState('');
  const [municipality, setMunicipality] = useState('Cuiabá');
  const [legalRepresentative, setLegalRepresentative] = useState('');
  const [status, setStatus] = useState<'Regular' | 'Notificado' | 'Irregular' | 'Suspenso'>('Regular');
  const [notes, setNotes] = useState('');

  useEffect(() => {
    if (editingEntrepreneur) {
      setName(editingEntrepreneur.name);
      setTradeName(editingEntrepreneur.tradeName);
      setDocType(editingEntrepreneur.docType);
      setDocument(editingEntrepreneur.document);
      setEmail(editingEntrepreneur.email);
      setPhone(editingEntrepreneur.phone);
      setAddress(editingEntrepreneur.address);
      setMunicipality(editingEntrepreneur.municipality);
      setLegalRepresentative(editingEntrepreneur.legalRepresentative);
      setStatus(editingEntrepreneur.status);
      setNotes(editingEntrepreneur.notes);
    } else {
      setName('');
      setTradeName('');
      setDocType('CNPJ');
      setDocument('');
      setEmail('');
      setPhone('');
      setAddress('');
      setMunicipality('Cuiabá');
      setLegalRepresentative('');
      setStatus('Regular');
      setNotes('');
    }
  }, [editingEntrepreneur, isOpen]);

  if (!isOpen) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;

    const saved: Entrepreneur = {
      id: editingEntrepreneur ? editingEntrepreneur.id : `EMP-${String(Math.floor(Math.random() * 900) + 100)}`,
      name: name.trim(),
      tradeName: tradeName.trim() || name.trim(),
      docType,
      document: document.trim(),
      email: email.trim(),
      phone: phone.trim(),
      address: address.trim(),
      municipality: municipality.trim(),
      state: 'MT',
      legalRepresentative: legalRepresentative.trim(),
      status,
      notes: notes.trim()
    };

    onSave(saved);
  };

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-slate-950/70 backdrop-blur-xs flex items-center justify-center p-4">
      <div className="relative w-full max-w-2xl bg-white rounded-2xl shadow-2xl border border-slate-200 overflow-hidden my-6">
        <div className="px-6 py-4 bg-slate-900 text-white flex items-center justify-between border-b border-slate-800">
          <div>
            <span className="text-[10px] font-bold tracking-widest text-emerald-400 uppercase">
              SEMA/MT · Cadastro de Empreendedores
            </span>
            <h3 className="text-base sm:text-lg font-bold">
              {editingEntrepreneur ? 'Editar Empreendedor' : 'Cadastrar Novo Empreendedor'}
            </h3>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg text-slate-400 hover:text-white">
            <X size={20} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4 max-h-[80vh] overflow-y-auto text-xs">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="md:col-span-2">
              <label className="block font-semibold text-slate-700 mb-1">
                Razão Social / Nome Completo *
              </label>
              <input
                type="text"
                required
                value={name}
                onChange={e => setName(e.target.value)}
                placeholder="Ex: Centrais Elétricas Matogrossenses Renováveis S.A."
                className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-emerald-500"
              />
            </div>

            <div>
              <label className="block font-semibold text-slate-700 mb-1">Nome Fantasia</label>
              <input
                type="text"
                value={tradeName}
                onChange={e => setTradeName(e.target.value)}
                placeholder="Ex: CEMAT Renováveis"
                className="w-full px-3 py-2 border border-slate-300 rounded-lg"
              />
            </div>

            <div className="grid grid-cols-3 gap-2">
              <div>
                <label className="block font-semibold text-slate-700 mb-1">Tipo Doc.</label>
                <select
                  value={docType}
                  onChange={e => setDocType(e.target.value as any)}
                  className="w-full px-2 py-2 border border-slate-300 rounded-lg bg-white"
                >
                  <option value="CNPJ">CNPJ</option>
                  <option value="CPF">CPF</option>
                </select>
              </div>
              <div className="col-span-2">
                <label className="block font-semibold text-slate-700 mb-1">Número do Documento *</label>
                <input
                  type="text"
                  required
                  value={document}
                  onChange={e => setDocument(e.target.value)}
                  placeholder="00.000.000/0001-00"
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg font-mono"
                />
              </div>
            </div>

            <div>
              <label className="block font-semibold text-slate-700 mb-1">Representante Legal</label>
              <input
                type="text"
                value={legalRepresentative}
                onChange={e => setLegalRepresentative(e.target.value)}
                placeholder="Nome do diretor ou proprietário"
                className="w-full px-3 py-2 border border-slate-300 rounded-lg"
              />
            </div>

            <div>
              <label className="block font-semibold text-slate-700 mb-1">Situação de Regularidade</label>
              <select
                value={status}
                onChange={e => setStatus(e.target.value as any)}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg bg-white font-medium"
              >
                <option value="Regular">Regular</option>
                <option value="Notificado">Notificado</option>
                <option value="Irregular">Irregular</option>
                <option value="Suspenso">Suspenso</option>
              </select>
            </div>

            <div>
              <label className="block font-semibold text-slate-700 mb-1">E-mail Institucional</label>
              <input
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder="contato@empresa.com.br"
                className="w-full px-3 py-2 border border-slate-300 rounded-lg"
              />
            </div>

            <div>
              <label className="block font-semibold text-slate-700 mb-1">Telefone de Contato</label>
              <input
                type="text"
                value={phone}
                onChange={e => setPhone(e.target.value)}
                placeholder="(65) 0000-0000"
                className="w-full px-3 py-2 border border-slate-300 rounded-lg"
              />
            </div>

            <div>
              <label className="block font-semibold text-slate-700 mb-1">Município (MT)</label>
              <input
                type="text"
                value={municipality}
                onChange={e => setMunicipality(e.target.value)}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg"
              />
            </div>

            <div>
              <label className="block font-semibold text-slate-700 mb-1">Endereço / Logradouro</label>
              <input
                type="text"
                value={address}
                onChange={e => setAddress(e.target.value)}
                placeholder="Av, Rua, Km de Rodovia..."
                className="w-full px-3 py-2 border border-slate-300 rounded-lg"
              />
            </div>
          </div>

          <div>
            <label className="block font-semibold text-slate-700 mb-1">Observações / Histórico</label>
            <textarea
              rows={2}
              value={notes}
              onChange={e => setNotes(e.target.value)}
              placeholder="Histórico institucional, processos judiciais ou notificações..."
              className="w-full px-3 py-2 border border-slate-300 rounded-lg"
            />
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
              Salvar Empreendedor
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
