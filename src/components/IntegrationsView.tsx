import React, { useState } from 'react';
import {
  Network,
  RefreshCw,
  CheckCircle2,
  AlertCircle,
  Download,
  Upload,
  RotateCcw,
  Database,
  ArrowRight,
  Shield,
  Layers,
  Terminal
} from 'lucide-react';
import { StorageService } from '../services/storageService';

interface IntegrationsViewProps {
  onDataReset: () => void;
  onDataImportSuccess: () => void;
}

interface IntegrationService {
  id: string;
  name: string;
  acronym: string;
  scope: string;
  status: 'Conectado' | 'Sincronizado' | 'Em Fila' | 'Manutenção';
  lastSync: string;
  latencyMs: number;
  description: string;
  endpoint: string;
}

export const IntegrationsView: React.FC<IntegrationsViewProps> = ({
  onDataReset,
  onDataImportSuccess
}) => {
  const [testingId, setTestingId] = useState<string | null>(null);
  const [syncLogs, setSyncLogs] = useState<string[]>([
    '[2026-10-23 13:30:12] [SIRIEMA-MT] Sincronização incremental concluída: 6 outorgas verificadas.',
    '[2026-10-23 12:15:00] [SNISB/ANA] Interoperabilidade com Barramento Nacional: Fichas ISR enviadas com sucesso.',
    '[2026-10-23 09:44:28] [CREA-MT] Consulta de ARTs de segurança de barragens: 4 ARTs ativas autenticadas.',
    '[2026-10-22 17:00:19] [Defesa Civil] Atualização das Zonas de Autossalvamento (ZAS) enviada ao COBOM-MT.'
  ]);

  const [services, setServices] = useState<IntegrationService[]>([
    {
      id: 'siriema',
      name: 'Sistema Integrado de Regularização e Informações Ambientais',
      acronym: 'SIRIEMA',
      scope: 'SEMA-MT Estadual',
      status: 'Sincronizado',
      lastSync: 'Hoje, às 13:30',
      latencyMs: 42,
      description: 'Fonte oficial para números de outorga, poligonais e CAR de propriedades rurais.',
      endpoint: 'https://siriema.sema.mt.gov.br/api/v2/interoperabilidade'
    },
    {
      id: 'snisb',
      name: 'Sistema Nacional de Informações sobre Segurança de Barragens',
      acronym: 'SNISB / ANA',
      scope: 'Federal (Agência Nacional de Águas)',
      status: 'Sincronizado',
      lastSync: 'Hoje, às 12:15',
      latencyMs: 88,
      description: 'Barramento de envio das fichas anuais de classificação CRI/DPA e dados PNSB.',
      endpoint: 'https://snisb.ana.gov.br/ws/v1/barragens/mt'
    },
    {
      id: 'siga',
      name: 'Sistema Integrado de Gestão Ambiental',
      acronym: 'SIGA',
      scope: 'SEMA-MT Estadual',
      status: 'Conectado',
      lastSync: 'Hoje, às 08:00',
      latencyMs: 35,
      description: 'Verificação em tempo real de licenças ambientais prévias, de instalação e operação.',
      endpoint: 'https://siga.sema.mt.gov.br/rest/licencas'
    },
    {
      id: 'crea',
      name: 'Conselho Regional de Engenharia e Agronomia de Mato Grosso',
      acronym: 'CREA-MT',
      scope: 'Conselho de Classe',
      status: 'Conectado',
      lastSync: 'Hoje, às 09:44',
      latencyMs: 65,
      description: 'Validação de habilitação técnica e anotações de responsabilidade técnica (ART).',
      endpoint: 'https://servicos.crea-mt.org.br/api/art/seguranca-barragens'
    },
    {
      id: 'defesa-civil',
      name: 'Superintendência de Proteção e Defesa Civil de MT',
      acronym: 'Defesa Civil MT',
      scope: 'Secretaria de Segurança Pública / CBMMT',
      status: 'Conectado',
      lastSync: 'Ontem, às 17:00',
      latencyMs: 50,
      description: 'Notificação instantânea de níveis de alerta, acionamento do PAE e planos de contingência.',
      endpoint: 'https://defesacivil.mt.gov.br/integracao/alertas-barragens'
    }
  ]);

  const handleTestService = (srv: IntegrationService) => {
    setTestingId(srv.id);
    setTimeout(() => {
      setTestingId(null);
      const timestamp = new Date().toISOString().replace('T', ' ').substring(0, 19);
      setSyncLogs(prev => [
        `[${timestamp}] [${srv.acronym}] Teste de integridade de barramento concluído com sucesso (Status: 200 OK · Latência: ${Math.floor(Math.random() * 40) + 30}ms).`,
        ...prev.slice(0, 9)
      ]);
    }, 800);
  };

  const handleExportBackup = () => {
    const json = StorageService.exportFullDatabase();
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `backup_administra_barragens_${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleImportFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = event => {
      const content = event.target?.result as string;
      if (content) {
        const success = StorageService.importDatabase(content);
        if (success) {
          alert('Backup importado com sucesso! Os dados foram atualizados.');
          onDataImportSuccess();
        } else {
          alert('Erro ao importar backup: arquivo JSON inválido.');
        }
      }
    };
    reader.readAsText(file);
  };

  const handleReset = () => {
    if (window.confirm('Atenção: deseja restaurar todos os dados para o padrão de demonstração da SEMA/MT? As alterações feitas serão substituídas.')) {
      StorageService.resetAll();
      onDataReset();
      alert('Banco de dados restaurado com sucesso para a base padrão da SEMA-MT.');
    }
  };

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-2 border-b border-slate-200">
        <div>
          <div className="flex items-center gap-2 text-xs font-bold text-emerald-700 tracking-wider uppercase mb-1">
            <span className="w-2 h-2 rounded-full bg-emerald-600"></span>
            Arquitetura & Conectividade Satélite
          </div>
          <h1 className="text-2xl font-black text-slate-900 tracking-tight">
            Estrutura de Integração — Cadastro Central
          </h1>
          <p className="text-xs text-slate-500 mt-1">
            Administra como repositório canônico de barramentos em Mato Grosso, interoperando com órgãos federais e estaduais.
          </p>
        </div>
      </div>

      {/* Concept Architecture Banner */}
      <div className="p-5 rounded-2xl bg-gradient-to-r from-slate-900 to-slate-800 text-white shadow-md border border-slate-700 flex flex-col md:flex-row items-center justify-between gap-6">
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <span className="px-2.5 py-0.5 rounded-full text-[10px] font-black bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 uppercase tracking-wider">
              Single Source of Truth
            </span>
            <span className="text-xs text-slate-400 font-mono">SEMA/MT · SURH · CSB</span>
          </div>
          <h3 className="text-lg font-black text-white">
            Modelo Federado com Centralidade Estadual
          </h3>
          <p className="text-xs text-slate-300 max-w-2xl leading-relaxed">
            O <strong>Administra Barragens</strong> atua como cadastro unificador. Todas as outorgas do SIRIEMA, processos do SIGA e ARTs do CREA convergem para cá antes de serem transmitidos ao Sistema Nacional (SNISB/ANA).
          </p>
        </div>

        <div className="flex flex-col sm:flex-row items-center gap-2 shrink-0">
          <button
            onClick={handleExportBackup}
            className="w-full sm:w-auto px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-xs font-bold flex items-center justify-center gap-2 transition-colors shadow-sm"
          >
            <Download size={15} />
            <span>Exportar Backup (JSON)</span>
          </button>
        </div>
      </div>

      {/* Connected Services List */}
      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden shadow-xs">
        <div className="p-4 border-b border-slate-200 flex items-center justify-between">
          <div>
            <h3 className="text-xs font-bold text-slate-900 uppercase tracking-wider">
              Sistemas Satélites e Barramentos Conectados
            </h3>
            <p className="text-xs text-slate-500">APIs de consulta de outorga, ARTs, licenças e defesa civil</p>
          </div>
        </div>

        <div className="divide-y divide-slate-100">
          {services.map(srv => {
            const isTesting = testingId === srv.id;
            return (
              <div key={srv.id} className="p-4 hover:bg-slate-50/70 transition-colors flex flex-col sm:flex-row sm:items-center justify-between gap-4 text-xs">
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="font-extrabold text-sm text-slate-900">{srv.acronym}</span>
                    <span className="text-slate-400">·</span>
                    <span className="font-semibold text-slate-700">{srv.name}</span>
                    <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-slate-100 text-slate-600">
                      {srv.scope}
                    </span>
                  </div>
                  <p className="text-slate-500 text-[11px]">{srv.description}</p>
                  <div className="text-[10px] text-slate-400 font-mono flex items-center gap-3">
                    <span>Endpoint: {srv.endpoint}</span>
                    <span>·</span>
                    <span className="text-emerald-700 font-semibold">Latência: {srv.latencyMs}ms</span>
                  </div>
                </div>

                <div className="flex items-center gap-3 shrink-0">
                  <div className="text-right">
                    <span className="inline-flex items-center gap-1 font-bold text-[11px] text-emerald-800 bg-emerald-50 px-2 py-0.5 rounded-full border border-emerald-200">
                      <CheckCircle2 size={12} className="text-emerald-600" />
                      {srv.status}
                    </span>
                    <div className="text-[10px] text-slate-400 mt-0.5">{srv.lastSync}</div>
                  </div>

                  <button
                    disabled={isTesting}
                    onClick={() => handleTestService(srv)}
                    className="px-3 py-1.5 border border-slate-200 hover:bg-slate-100 rounded-lg text-slate-700 font-semibold text-xs flex items-center gap-1.5 transition-colors disabled:opacity-50"
                  >
                    <RefreshCw size={13} className={isTesting ? 'animate-spin' : ''} />
                    <span>{isTesting ? 'Testando...' : 'Verificar'}</span>
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Integration Terminal Logs */}
      <div className="bg-slate-950 text-slate-200 rounded-xl p-4 shadow-sm border border-slate-800 font-mono text-[11px] space-y-2">
        <div className="flex items-center justify-between pb-2 border-b border-slate-800 text-slate-400 text-xs">
          <div className="flex items-center gap-2">
            <Terminal size={14} className="text-emerald-400" />
            <span className="font-bold text-slate-300">Log de Eventos de Interoperabilidade e Sincronismo</span>
          </div>
          <span className="text-[10px] text-emerald-400">Tempo Real</span>
        </div>
        <div className="space-y-1 text-slate-400 max-h-36 overflow-y-auto pt-1">
          {syncLogs.map((log, idx) => (
            <div key={idx} className="leading-relaxed">
              <span className="text-emerald-400 font-semibold">{log.slice(0, 22)}</span>
              <span>{log.slice(22)}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Data Management & Backup Center */}
      <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-xs">
        <h3 className="text-xs font-bold text-slate-900 uppercase tracking-wider mb-2">
          Gestão e Portabilidade do Banco de Dados Local
        </h3>
        <p className="text-xs text-slate-500 mb-4">
          Como este protótipo funciona com dados locais persistentes no navegador (HTML5 LocalStorage), você pode exportar, importar ou redefinir a base a qualquer momento.
        </p>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
          {/* Export */}
          <button
            onClick={handleExportBackup}
            className="p-3.5 rounded-xl border border-slate-200 bg-slate-50/50 hover:bg-slate-100 text-left transition-colors flex items-start gap-3"
          >
            <Download size={18} className="text-emerald-700 shrink-0 mt-0.5" />
            <div>
              <span className="font-bold text-slate-900 block">Exportar Backup JSON</span>
              <span className="text-slate-500 text-[11px]">Download de todas as barragens, RTs e conciliações</span>
            </div>
          </button>

          {/* Import */}
          <label className="p-3.5 rounded-xl border border-slate-200 bg-slate-50/50 hover:bg-slate-100 text-left transition-colors flex items-start gap-3 cursor-pointer">
            <Upload size={18} className="text-blue-700 shrink-0 mt-0.5" />
            <div>
              <span className="font-bold text-slate-900 block">Restaurar de Arquivo JSON</span>
              <span className="text-slate-500 text-[11px]">Carrega backup gerado anteriormente</span>
              <input type="file" accept=".json" onChange={handleImportFile} className="hidden" />
            </div>
          </label>

          {/* Reset */}
          <button
            onClick={handleReset}
            className="p-3.5 rounded-xl border border-rose-200 bg-rose-50/40 hover:bg-rose-50 text-left transition-colors flex items-start gap-3"
          >
            <RotateCcw size={18} className="text-rose-700 shrink-0 mt-0.5" />
            <div>
              <span className="font-bold text-rose-900 block">Redefinir Base Padrão</span>
              <span className="text-rose-700/80 text-[11px]">Restaura os dados originais oficiais de MT</span>
            </div>
          </button>
        </div>
      </div>
    </div>
  );
};
