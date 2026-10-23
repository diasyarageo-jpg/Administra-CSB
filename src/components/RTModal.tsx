import React, { useState, useEffect } from 'react';
import { TechnicalResponsible } from '../types/dam';
import { X } from 'lucide-react';

interface RTModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (rt: TechnicalResponsible) => void;
  editingRT?: TechnicalResponsible | null;
}

export const RTModal: React.FC<RTModalProps> = ({
  isOpen,
  onClose,
  onSave,
  editingRT
}) => {
  const [name, setName] = useState('');
  const [cpf, setCpf] = useState('');
  const [creaNumber, setCreaNumber] = useState('');
  const [creaUf, setCreaUf] = useState('MT');
  const [specialty, setSpecialty] = useState<TechnicalResponsible['specialty']>('Engenharia Geotécnica');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [artNumber, setArtNumber] = useState('');
  const [status, setStatus] = useState<'Ativo' | 'Inativo' | 'Suspenso'>('Ativo');
  const [validUntil, setValidUntil] = useState('2027-12-31');

  useEffect(() => {
    if (editingRT) {
      setName(editingRT.name);
      setCpf(editingRT.cpf);
      setCreaNumber(editingRT.creaNumber);
      setCreaUf(editingRT.creaUf);
      setSpecialty(editingRT.specialty);
      setEmail(editingRT.email);
      setPhone(editingRT.phone);
      setArtNumber(editingRT.artNumber);
      setStatus(editingRT.status);
      setValidUntil(editingRT.validUntil);
    } else {
      setName('');
      setCpf('');
      setCreaNumber('');
      setCreaUf('MT');
      setSpecialty('Engenharia Geotécnica');
      setEmail('');
      setPhone('');
      setArtNumber(`ART-MT-${new Date().getFullYear()}-${Math.floor(Math.random() * 90000) + 10000}`);
      setStatus('Ativo');
      setValidUntil('2027-12-31');
    }
  }, [editingRT, isOpen]);

  if (!isOpen) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;

    const saved: TechnicalResponsible = {
      id: editingRT ? editingRT.id : `RT-${String(Math.floor(Math.random() * 900) + 100)}`,
      name: name.trim(),
      cpf: cpf.trim(),
      creaNumber: creaNumber.trim(),
      creaUf,
      specialty,
      email: email.trim(),
      phone: phone.trim(),
      artNumber: artNumber.trim(),
      status,
      validUntil
    };

    onSave(saved);
  };

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-slate-950/70 backdrop-blur-xs flex items-center justify-center p-4">
      <div className="relative w-full max-w-xl bg-white rounded-2xl shadow-2xl border border-slate-200 overflow-hidden my-6">
        <div className="px-6 py-4 bg-slate-900 text-white flex items-center justify-between border-b border-slate-800">
          <div>
            <span className="text-[10px] font-bold tracking-widest text-emerald-400 uppercase">
              SEMA/MT · Cadastro de Profissionais RT
            </span>
            <h3 className="text-base sm:text-lg font-bold">
              {editingRT ? 'Editar Responsável Técnico' : 'Cadastrar Novo Responsável Técnico'}
            </h3>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg text-slate-400 hover:text-white">
            <X size={20} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4 text-xs">
          <div>
            <label className="block font-semibold text-slate-700 mb-1">Nome Completo do Profissional *</label>
            <input
              type="text"
              required
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="Ex: Dra. Camila Nogueira Dantas"
              className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-emerald-500"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block font-semibold text-slate-700 mb-1">Registro CREA / UF *</label>
              <div className="flex gap-2">
                <input
                  type="text"
                  required
                  value={creaNumber}
                  onChange={e => setCreaNumber(e.target.value)}
                  placeholder="120489/D"
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg font-mono"
                />
                <input
                  type="text"
                  value={creaUf}
                  onChange={e => setCreaUf(e.target.value)}
                  className="w-16 px-2 py-2 border border-slate-300 rounded-lg text-center uppercase font-bold"
                />
              </div>
            </div>

            <div>
              <label className="block font-semibold text-slate-700 mb-1">CPF</label>
              <input
                type="text"
                value={cpf}
                onChange={e => setCpf(e.target.value)}
                placeholder="000.000.000-00"
                className="w-full px-3 py-2 border border-slate-300 rounded-lg font-mono"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block font-semibold text-slate-700 mb-1">Especialidade Técnica *</label>
              <select
                value={specialty}
                onChange={e => setSpecialty(e.target.value as any)}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg bg-white"
              >
                <option value="Engenharia Geotécnica">Engenharia Geotécnica</option>
                <option value="Engenharia Civil">Engenharia Civil</option>
                <option value="Engenharia de Minas">Engenharia de Minas</option>
                <option value="Engenharia Hídrica/Sanitária">Engenharia Hídrica/Sanitária</option>
                <option value="Geologia">Geologia</option>
              </select>
            </div>

            <div>
              <label className="block font-semibold text-slate-700 mb-1">Número da ART / RRT</label>
              <input
                type="text"
                value={artNumber}
                onChange={e => setArtNumber(e.target.value)}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg font-mono"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block font-semibold text-slate-700 mb-1">E-mail Profissional</label>
              <input
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder="contato@eng.com.br"
                className="w-full px-3 py-2 border border-slate-300 rounded-lg"
              />
            </div>

            <div>
              <label className="block font-semibold text-slate-700 mb-1">Telefone / WhatsApp</label>
              <input
                type="text"
                value={phone}
                onChange={e => setPhone(e.target.value)}
                placeholder="(65) 90000-0000"
                className="w-full px-3 py-2 border border-slate-300 rounded-lg"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block font-semibold text-slate-700 mb-1">Status Profissional</label>
              <select
                value={status}
                onChange={e => setStatus(e.target.value as any)}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg bg-white font-medium"
              >
                <option value="Ativo">Ativo e Regular</option>
                <option value="Inativo">Inativo</option>
                <option value="Suspenso">Suspenso</option>
              </select>
            </div>

            <div>
              <label className="block font-semibold text-slate-700 mb-1">Validade da ART</label>
              <input
                type="date"
                value={validUntil}
                onChange={e => setValidUntil(e.target.value)}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg"
              />
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
              Salvar RT
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
