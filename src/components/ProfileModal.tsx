import React, { useState } from 'react';
import { SystemUser } from '../types/dam';
import { X, User, Check, Shield } from 'lucide-react';

interface ProfileModalProps {
  isOpen: boolean;
  onClose: () => void;
  activeUser: SystemUser;
  allUsers: SystemUser[];
  onSelectActiveUser: (userId: string) => void;
  onUpdateActiveUser: (user: SystemUser) => void;
}

export const ProfileModal: React.FC<ProfileModalProps> = ({
  isOpen,
  onClose,
  activeUser,
  allUsers,
  onSelectActiveUser,
  onUpdateActiveUser
}) => {
  const [name, setName] = useState(activeUser.name);
  const [email, setEmail] = useState(activeUser.email);
  const [matricula, setMatricula] = useState(activeUser.matricula);
  const [role, setRole] = useState(activeUser.role);
  const [department, setDepartment] = useState(activeUser.department);

  if (!isOpen) return null;

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    onUpdateActiveUser({
      ...activeUser,
      name,
      email,
      matricula,
      role,
      department
    });
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-slate-950/70 backdrop-blur-xs flex items-center justify-center p-4">
      <div className="relative w-full max-w-lg bg-white rounded-2xl shadow-2xl border border-slate-200 overflow-hidden my-6 text-xs">
        {/* Header */}
        <div className="p-4 bg-slate-900 text-white flex justify-between items-center">
          <div>
            <span className="text-[10px] font-bold tracking-widest text-emerald-400 uppercase">
              Operador Local · Administra CSB
            </span>
            <h3 className="text-base font-bold">Perfil do Operador Ativo</h3>
          </div>
          <button onClick={onClose} className="p-1 rounded-lg text-slate-400 hover:text-white">
            <X size={18} />
          </button>
        </div>

        <div className="p-5 space-y-5">
          {/* Switch quickly between team members */}
          <div>
            <label className="block font-bold text-slate-700 uppercase text-[10px] mb-2">
              Alternar para outro perfil da equipe:
            </label>
            <div className="space-y-1.5">
              {allUsers.map(u => (
                <button
                  key={u.id}
                  onClick={() => {
                    onSelectActiveUser(u.id);
                    setName(u.name);
                    setEmail(u.email);
                    setMatricula(u.matricula);
                    setRole(u.role);
                    setDepartment(u.department);
                  }}
                  className={`w-full flex items-center justify-between p-2.5 rounded-lg border text-left transition-colors ${
                    u.id === activeUser.id
                      ? 'border-emerald-500 bg-emerald-50/70 text-emerald-950'
                      : 'border-slate-200 hover:bg-slate-50 text-slate-700'
                  }`}
                >
                  <div className="flex items-center gap-2.5">
                    <div className="w-7 h-7 rounded-full bg-slate-800 text-white flex items-center justify-center font-bold text-[10px]">
                      {u.name.charAt(0)}
                    </div>
                    <div>
                      <div className="font-bold">{u.name}</div>
                      <div className="text-[10px] text-slate-500">{u.role} · {u.matricula}</div>
                    </div>
                  </div>
                  {u.id === activeUser.id && (
                    <span className="text-emerald-700 font-bold flex items-center gap-1 text-[11px]">
                      <Check size={14} /> Ativo
                    </span>
                  )}
                </button>
              ))}
            </div>
          </div>

          {/* Form to edit profile details */}
          <form onSubmit={handleSave} className="pt-4 border-t border-slate-200 space-y-3">
            <h4 className="font-bold text-slate-900 text-xs">Editar Dados do Operador Selecionado</h4>

            <div>
              <label className="block font-semibold text-slate-700 mb-1">Nome Completo</label>
              <input
                type="text"
                required
                value={name}
                onChange={e => setName(e.target.value)}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-xs"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block font-semibold text-slate-700 mb-1">Matrícula SEMA</label>
                <input
                  type="text"
                  required
                  value={matricula}
                  onChange={e => setMatricula(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg font-mono text-xs"
                />
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">Cargo / Função</label>
                <select
                  value={role}
                  onChange={e => setRole(e.target.value as any)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-xs bg-white"
                >
                  <option value="Coordenador CSB">Coordenador CSB</option>
                  <option value="Fiscal de Segurança">Fiscal de Segurança</option>
                  <option value="Analista Ambiental">Analista Ambiental</option>
                  <option value="Administrador de TI">Administrador de TI</option>
                </select>
              </div>
            </div>

            <div>
              <label className="block font-semibold text-slate-700 mb-1">E-mail Institucional</label>
              <input
                type="email"
                required
                value={email}
                onChange={e => setEmail(e.target.value)}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-xs"
              />
            </div>

            <div>
              <label className="block font-semibold text-slate-700 mb-1">Lotação / Departamento</label>
              <input
                type="text"
                value={department}
                onChange={e => setDepartment(e.target.value)}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-xs"
              />
            </div>

            <div className="pt-3 border-t border-slate-100 flex justify-end gap-2">
              <button
                type="button"
                onClick={onClose}
                className="px-3.5 py-1.5 border border-slate-300 rounded-lg text-slate-700 font-semibold"
              >
                Fechar
              </button>
              <button
                type="submit"
                className="px-4 py-1.5 bg-emerald-700 hover:bg-emerald-800 text-white font-bold rounded-lg"
              >
                Salvar Alterações
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
};
