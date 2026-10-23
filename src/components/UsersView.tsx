import React, { useState } from 'react';
import { SystemUser } from '../types/dam';
import { Users, Plus, Shield, Check, Edit2, Trash2, Key } from 'lucide-react';

interface UsersViewProps {
  users: SystemUser[];
  activeUserId: string;
  onSelectActiveUser: (id: string) => void;
  onAddUser: (user: SystemUser) => void;
  onDeleteUser: (id: string) => void;
}

export const UsersView: React.FC<UsersViewProps> = ({
  users,
  activeUserId,
  onSelectActiveUser,
  onAddUser,
  onDeleteUser
}) => {
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [newName, setNewName] = useState('');
  const [newEmail, setNewEmail] = useState('');
  const [newMatricula, setNewMatricula] = useState('');
  const [newRole, setNewRole] = useState<SystemUser['role']>('Fiscal de Segurança');
  const [newDepartment, setNewDepartment] = useState('SURH / CSB — Fiscalização');

  const handleAddSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newName.trim() || !newEmail.trim()) return;

    const user: SystemUser = {
      id: `USR-${String(Math.floor(Math.random() * 900) + 100)}`,
      name: newName.trim(),
      email: newEmail.trim(),
      matricula: newMatricula.trim() || `SEMA ${Math.floor(Math.random() * 90000) + 10000}`,
      department: newDepartment.trim(),
      role: newRole,
      status: 'Ativo',
      lastAccess: 'Recém-criado'
    };

    onAddUser(user);
    setIsAddModalOpen(false);
    setNewName('');
    setNewEmail('');
    setNewMatricula('');
  };

  return (
    <div className="space-y-5 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-2 border-b border-slate-200">
        <div>
          <div className="flex items-center gap-2 text-xs font-bold text-emerald-700 tracking-wider uppercase mb-1">
            <span className="w-2 h-2 rounded-full bg-emerald-600"></span>
            Controle de Acesso Institucional
          </div>
          <h1 className="text-2xl font-black text-slate-900 tracking-tight">
            Usuários e Fiscais Autorizados ({users.length})
          </h1>
          <p className="text-xs text-slate-500 mt-1">
            Servidores da SEMA-MT com credenciais para emissão de notificações, despachos e relatórios técnicos.
          </p>
        </div>

        <button
          onClick={() => setIsAddModalOpen(true)}
          className="px-4 py-2 text-xs font-bold text-white bg-emerald-700 hover:bg-emerald-800 rounded-lg shadow-sm transition-colors flex items-center gap-1.5 self-start md:self-auto"
        >
          <Plus size={16} />
          <span>Novo Servidor</span>
        </button>
      </div>

      {/* Users list */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {users.map(u => {
          const isActive = u.id === activeUserId;
          return (
            <div
              key={u.id}
              className={`p-5 rounded-xl border bg-white shadow-xs transition-all flex flex-col justify-between ${
                isActive ? 'border-emerald-500 ring-2 ring-emerald-500/20' : 'border-slate-200'
              }`}
            >
              <div>
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-full bg-slate-900 text-white flex items-center justify-center font-bold text-sm">
                      {u.name.charAt(0)}
                    </div>
                    <div>
                      <h3 className="font-extrabold text-sm text-slate-900 flex items-center gap-2">
                        <span>{u.name}</span>
                        {isActive && (
                          <span className="px-2 py-0.5 rounded-full text-[10px] font-black bg-emerald-100 text-emerald-800">
                            Sessão Atual
                          </span>
                        )}
                      </h3>
                      <div className="text-xs text-slate-500 font-mono mt-0.5">
                        {u.matricula} · <span className="font-sans font-medium text-slate-700">{u.role}</span>
                      </div>
                    </div>
                  </div>

                  <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-slate-100 text-slate-700">
                    {u.status}
                  </span>
                </div>

                <div className="mt-4 space-y-1 text-xs text-slate-600 bg-slate-50 p-3 rounded-lg border border-slate-100">
                  <div>Lotação: <strong>{u.department}</strong></div>
                  <div>E-mail: <strong className="font-mono">{u.email}</strong></div>
                  <div className="text-slate-400 text-[11px] pt-1">Último acesso: {u.lastAccess}</div>
                </div>
              </div>

              <div className="mt-4 pt-3 border-t border-slate-100 flex items-center justify-between">
                {!isActive ? (
                  <button
                    onClick={() => onSelectActiveUser(u.id)}
                    className="px-3 py-1.5 text-xs font-bold text-emerald-700 bg-emerald-50 hover:bg-emerald-100 rounded-lg transition-colors flex items-center gap-1"
                  >
                    <Check size={14} />
                    <span>Usar esta Sessão</span>
                  </button>
                ) : (
                  <span className="text-xs font-bold text-emerald-700">Operando como este usuário</span>
                )}

                {users.length > 1 && !isActive && (
                  <button
                    onClick={() => {
                      if (window.confirm(`Excluir usuário ${u.name}?`)) {
                        onDeleteUser(u.id);
                      }
                    }}
                    className="p-1.5 text-slate-400 hover:text-rose-600 transition-colors"
                    title="Excluir"
                  >
                    <Trash2 size={15} />
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Add User Modal */}
      {isAddModalOpen && (
        <div className="fixed inset-0 z-50 overflow-y-auto bg-slate-950/70 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="w-full max-w-md bg-white rounded-2xl shadow-2xl border border-slate-200 overflow-hidden text-xs">
            <div className="p-4 bg-slate-900 text-white flex justify-between items-center">
              <h3 className="font-bold text-sm">Cadastrar Servidor / Usuário</h3>
              <button onClick={() => setIsAddModalOpen(false)} className="text-slate-400 hover:text-white">✕</button>
            </div>
            <form onSubmit={handleAddSubmit} className="p-5 space-y-3">
              <div>
                <label className="block font-semibold text-slate-700 mb-1">Nome Completo *</label>
                <input
                  type="text"
                  required
                  value={newName}
                  onChange={e => setNewName(e.target.value)}
                  placeholder="Ex: Dra. Juliana Miranda"
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg"
                />
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">E-mail Institucional (@sema.mt.gov.br) *</label>
                <input
                  type="email"
                  required
                  value={newEmail}
                  onChange={e => setNewEmail(e.target.value)}
                  placeholder="juliana.miranda@sema.mt.gov.br"
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Matrícula SEMA</label>
                  <input
                    type="text"
                    value={newMatricula}
                    onChange={e => setNewMatricula(e.target.value)}
                    placeholder="SEMA 99.112-0"
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg font-mono"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Perfil / Cargo</label>
                  <select
                    value={newRole}
                    onChange={e => setNewRole(e.target.value as any)}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg bg-white"
                  >
                    <option value="Fiscal de Segurança">Fiscal de Segurança</option>
                    <option value="Analista Ambiental">Analista Ambiental</option>
                    <option value="Coordenador CSB">Coordenador CSB</option>
                    <option value="Administrador de TI">Administrador de TI</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">Lotação / Setor</label>
                <input
                  type="text"
                  value={newDepartment}
                  onChange={e => setNewDepartment(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg"
                />
              </div>

              <div className="flex justify-end gap-2 pt-3 border-t border-slate-200">
                <button
                  type="button"
                  onClick={() => setIsAddModalOpen(false)}
                  className="px-4 py-2 border border-slate-300 rounded-lg text-slate-700 font-semibold"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 bg-emerald-700 text-white font-bold rounded-lg hover:bg-emerald-800"
                >
                  Adicionar Usuário
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
