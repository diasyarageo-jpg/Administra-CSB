import React from 'react';
import { Menu, HardDrive, Download, Plus, ShieldCheck, User } from 'lucide-react';
import { NavView } from './Sidebar';
import { SystemUser } from '../types/dam';

interface TopbarProps {
  currentView: NavView;
  onOpenMobileMenu: () => void;
  activeUser: SystemUser;
  onQuickAction: () => void;
  quickActionLabel?: string;
  onExportData: () => void;
  onOpenProfileModal: () => void;
}

const VIEW_TITLES: Record<NavView, { title: string; section: string }> = {
  home: { title: 'Painel de Controle', section: 'Visão Geral' },
  empreendedores: { title: 'Empreendedores', section: 'Cadastros Centrais' },
  barragens: { title: 'Barragens Cadastradas', section: 'Cadastros Centrais' },
  rts: { title: 'Responsáveis Técnicos', section: 'Cadastros Centrais' },
  revisoes: { title: 'Conciliação de Cadastros', section: 'Cadastros Centrais' },
  produtividade: { title: 'Produtividade da Equipe', section: 'Gestão de Trabalho' },
  portarias: { title: 'Portarias e Atos Normativos', section: 'Gestão de Trabalho' },
  usuarios: { title: 'Usuários do Sistema', section: 'Administração' },
  integracao: { title: 'Estrutura de Integração', section: 'Administração' },
  referencias: { title: 'Referências Centrais & Normativas', section: 'Administração' }
};

export const Topbar: React.FC<TopbarProps> = ({
  currentView,
  onOpenMobileMenu,
  activeUser,
  onQuickAction,
  quickActionLabel = '+ Nova Barragem',
  onExportData,
  onOpenProfileModal
}) => {
  const current = VIEW_TITLES[currentView] || { title: 'Painel', section: 'SEMA/MT' };

  return (
    <header className="sticky top-0 z-20 h-16 bg-white/95 backdrop-blur border-b border-slate-200 px-4 sm:px-6 flex items-center justify-between shadow-xs">
      {/* Left side: Mobile Toggle & Breadcrumbs */}
      <div className="flex items-center gap-3">
        <button
          onClick={onOpenMobileMenu}
          className="lg:hidden p-2 rounded-lg text-slate-600 hover:text-slate-900 hover:bg-slate-100 transition-colors"
          aria-label="Abrir menu"
        >
          <Menu size={20} />
        </button>

        <div className="flex items-center gap-1.5 text-xs text-slate-500 font-medium">
          <span className="font-semibold text-slate-700 hidden sm:inline">SEMA/MT</span>
          <span className="text-slate-300 hidden sm:inline">/</span>
          <span className="text-slate-500 hidden md:inline">{current.section}</span>
          <span className="text-slate-300 hidden md:inline">/</span>
          <h2 className="text-slate-900 font-bold text-sm tracking-tight inline-block">
            {current.title}
          </h2>
        </div>
      </div>

      {/* Right side: Persistence pill, Profile indicator & Actions */}
      <div className="flex items-center gap-2.5">
        {/* Persistence Status */}
        <div className="hidden sm:flex items-center gap-1.5 px-2.5 py-1 bg-emerald-50 border border-emerald-200 rounded-full text-[11px] font-semibold text-emerald-800">
          <span className="w-2 h-2 rounded-full bg-emerald-500"></span>
          <span>DADOS LOCAIS ATIVOS</span>
        </div>

        {/* Export JSON quick button */}
        <button
          onClick={onExportData}
          className="hidden md:flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-slate-700 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 hover:text-slate-900 transition-colors shadow-2xs"
          title="Exportar backup completo do banco de dados (JSON)"
        >
          <Download size={14} className="text-slate-500" />
          <span>Exportar</span>
        </button>

        {/* Primary Action Button */}
        {quickActionLabel && (
          <button
            onClick={onQuickAction}
            className="flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-bold text-white bg-emerald-700 hover:bg-emerald-800 rounded-lg shadow-sm transition-all whitespace-nowrap"
          >
            <Plus size={15} className="stroke-[2.5]" />
            <span>{quickActionLabel}</span>
          </button>
        )}

        {/* User Profile Chip */}
        <button
          onClick={onOpenProfileModal}
          className="flex items-center gap-2 pl-2 pr-2.5 py-1 rounded-lg hover:bg-slate-100 text-slate-700 transition-colors text-xs border border-transparent hover:border-slate-200"
          title="Configurações do perfil"
        >
          <div className="w-7 h-7 rounded-full bg-slate-900 text-white flex items-center justify-center text-[10px] font-bold">
            {activeUser.name.charAt(0)}
          </div>
          <span className="hidden xl:inline font-semibold text-slate-800 max-w-[120px] truncate">
            {activeUser.name.split(' ')[0]}
          </span>
        </button>
      </div>
    </header>
  );
};
