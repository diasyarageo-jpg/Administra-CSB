import React from 'react';
import {
  LayoutDashboard,
  Building2,
  Database,
  UserCheck,
  GitCompare,
  TrendingUp,
  FileText,
  Users,
  Network,
  BookOpen,
  Waves,
  X
} from 'lucide-react';
import { SystemUser } from '../types/dam';

export type NavView =
  | 'home'
  | 'empreendedores'
  | 'barragens'
  | 'rts'
  | 'revisoes'
  | 'produtividade'
  | 'portarias'
  | 'usuarios'
  | 'integracao'
  | 'referencias';

interface SidebarProps {
  currentView: NavView;
  onNavigate: (view: NavView) => void;
  isOpen: boolean;
  onClose: () => void;
  activeUser: SystemUser;
  pendingReconciliationsCount: number;
  onOpenProfileModal: () => void;
}

export const Sidebar: React.FC<SidebarProps> = ({
  currentView,
  onNavigate,
  isOpen,
  onClose,
  activeUser,
  pendingReconciliationsCount,
  onOpenProfileModal
}) => {
  const navItems: {
    section?: string;
    items: { id: NavView; label: string; icon: React.ReactNode; badge?: number }[];
  }[] = [
    {
      section: 'Visão geral',
      items: [
        { id: 'home', label: 'Painel de Controle', icon: <LayoutDashboard size={17} /> }
      ]
    },
    {
      section: 'Cadastros centrais',
      items: [
        { id: 'empreendedores', label: 'Empreendedores', icon: <Building2 size={17} /> },
        { id: 'barragens', label: 'Barragens cadastradas', icon: <Database size={17} /> },
        { id: 'rts', label: 'Responsáveis Técnicos', icon: <UserCheck size={17} /> },
        {
          id: 'revisoes',
          label: 'Conciliação de cadastros',
          icon: <GitCompare size={17} />,
          badge: pendingReconciliationsCount
        }
      ]
    },
    {
      section: 'Gestão de trabalho',
      items: [
        { id: 'produtividade', label: 'Produtividade', icon: <TrendingUp size={17} /> },
        { id: 'portarias', label: 'Portarias', icon: <FileText size={17} /> }
      ]
    },
    {
      section: 'Administração',
      items: [
        { id: 'usuarios', label: 'Usuários', icon: <Users size={17} /> },
        { id: 'integracao', label: 'Estrutura de integração', icon: <Network size={17} /> },
        { id: 'referencias', label: 'Referências centrais', icon: <BookOpen size={17} /> }
      ]
    }
  ];

  const getInitials = (name: string) => {
    return name
      .split(' ')
      .filter(Boolean)
      .slice(0, 2)
      .map(n => n[0].toUpperCase())
      .join('');
  };

  return (
    <>
      {/* Mobile Backdrop */}
      {isOpen && (
        <div
          onClick={onClose}
          className="fixed inset-0 bg-slate-950/60 backdrop-blur-sm z-30 lg:hidden transition-opacity"
        />
      )}

      {/* Sidebar Container */}
      <aside
        className={`fixed inset-y-0 left-0 z-40 w-64 bg-slate-900 text-slate-200 flex flex-col border-r border-slate-800 shadow-2xl transition-transform duration-200 ease-in-out lg:translate-x-0 ${
          isOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        {/* Brand Lockup */}
        <div className="p-5 border-b border-slate-800 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-emerald-500 to-teal-700 p-0.5 shadow-md flex items-center justify-center text-white shrink-0">
              <Waves size={24} className="stroke-[2.5]" />
            </div>
            <div>
              <h1 className="text-sm font-extrabold tracking-tight text-white leading-tight">
                ADMINISTRA<br />
                <span className="text-emerald-400 font-black">BARRAGENS</span>
              </h1>
              <p className="text-[10px] tracking-widest uppercase font-semibold text-slate-400 mt-0.5">
                SEMA/MT · SURH · CSB
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="lg:hidden p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800"
            aria-label="Fechar navegação"
          >
            <X size={18} />
          </button>
        </div>

        {/* User Card */}
        <div className="mx-3 my-3 p-2.5 rounded-xl bg-slate-800/60 border border-slate-700/60 flex items-center gap-3 hover:bg-slate-800 transition-colors cursor-pointer group"
          onClick={onOpenProfileModal}
          title="Clique para alterar seu perfil"
        >
          <div className="w-9 h-9 rounded-full bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 flex items-center justify-center text-xs font-bold shrink-0">
            {getInitials(activeUser.name)}
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-xs font-bold text-slate-100 truncate group-hover:text-emerald-300">
              {activeUser.name}
            </div>
            <div className="text-[10px] text-slate-400 truncate">
              {activeUser.role}
            </div>
          </div>
          <span className="text-[10px] font-bold text-emerald-400 bg-emerald-950/70 px-1.5 py-0.5 rounded border border-emerald-800/40">
            MT
          </span>
        </div>

        {/* Navigation Items */}
        <nav className="flex-1 px-3 py-1 overflow-y-auto space-y-4">
          {navItems.map((group, gIdx) => (
            <div key={gIdx} className="space-y-1">
              {group.section && (
                <div className="px-2 pt-2 pb-1 text-[10px] font-extrabold tracking-wider text-slate-400 uppercase">
                  {group.section}
                </div>
              )}
              {group.items.map(item => {
                const isActive = currentView === item.id;
                return (
                  <button
                    key={item.id}
                    onClick={() => {
                      onNavigate(item.id);
                      onClose();
                    }}
                    className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-xs font-medium transition-all ${
                      isActive
                        ? 'bg-emerald-600 text-white font-semibold shadow-md shadow-emerald-950/40'
                        : 'text-slate-300 hover:bg-slate-800/70 hover:text-white'
                    }`}
                  >
                    <span className={isActive ? 'text-white' : 'text-slate-400'}>
                      {item.icon}
                    </span>
                    <span className="truncate">{item.label}</span>
                    {item.badge !== undefined && item.badge > 0 && (
                      <span className="ml-auto bg-amber-500/90 text-slate-950 text-[10px] font-black px-1.5 py-0.5 rounded-full">
                        {item.badge}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          ))}
        </nav>

        {/* Sidebar Footer */}
        <div className="p-3.5 border-t border-slate-800 text-[10px] text-slate-400 flex items-center justify-between bg-slate-950/40">
          <div>
            <span className="text-slate-300 font-semibold">Administra</span> · CSB Central
            <div className="text-slate-400 text-[9px] mt-0.5">Mato Grosso · Lei 12.334/10</div>
          </div>
          <span className="w-2 h-2 rounded-full bg-emerald-500" title="Sistema local operacional"></span>
        </div>
      </aside>
    </>
  );
};
