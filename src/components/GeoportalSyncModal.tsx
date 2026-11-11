// src/components/GeoportalSyncModal.tsx
import React, { useState, useEffect } from 'react';
import {
  dispararSincronizacaoGeoportal,
  obterStatusSincronizacaoGeoportal
} from '../services/carLookupService';

interface GeoportalSyncModalProps {
  userRole?: string;
  onClose: () => void;
  onSuccess?: (msg: string) => void;
}

export function GeoportalSyncModal({
  userRole,
  onClose,
  onSuccess
}: GeoportalSyncModalProps) {
  const [isConfirming, setIsConfirming] = useState<boolean>(true);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [syncResult, setSyncResult] = useState<any | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [lastSyncInfo, setLastSyncInfo] = useState<{
    ultimaSincronizacao?: string;
    status: string;
    registrosSincronizados: number;
  }>({ status: 'ocioso', registrosSincronizados: 0 });

  const isAuthorized = userRole === 'Administrador' || userRole === 'Analista';

  useEffect(() => {
    obterStatusSincronizacaoGeoportal().then(info => {
      setLastSyncInfo(info);
    }).catch(() => {});
  }, []);

  const handleStartSync = async () => {
    if (!isAuthorized) {
      setErrorMsg('Ação restrita: apenas Analistas ou Administradores têm permissão para atualizar a base do Geoportal.');
      return;
    }

    setIsConfirming(false);
    setIsLoading(true);
    setErrorMsg(null);
    setSyncResult(null);

    try {
      const res = await dispararSincronizacaoGeoportal();
      if (!res.sucesso && res.status === 'falha') {
        setErrorMsg(res.mensagemErro || 'Falha ao sincronizar com o Geoportal SEMA-MT.');
      } else {
        setSyncResult(res);
        setLastSyncInfo({
          ultimaSincronizacao: res.sincronizadoEm,
          status: res.status,
          registrosSincronizados: res.registrosProcessados
        });
        if (onSuccess) {
          onSuccess(`Sincronização concluída com sucesso: ${res.registrosProcessados} registros processados.`);
        }
      }
    } catch (err: any) {
      setErrorMsg(err?.message || 'Erro durante a sincronização com o Geoportal.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="modal-back" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={{ width: 'min(580px, 100%)' }}>
        <div className="modal-head">
          <h3>Atualização da Base Local · Geoportal SEMA-MT</h3>
          <button type="button" className="modal-close" onClick={onClose}>×</button>
        </div>

        <div className="modal-body" style={{ maxHeight: '78vh', overflowY: 'auto' }}>
          {/* Informações da última sincronização */}
          <div style={{
            padding: '12px',
            backgroundColor: '#f8fafc',
            border: '1px solid #e2e8f0',
            borderRadius: '6px',
            marginBottom: '16px',
            fontSize: '12px'
          }}>
            <div style={{ color: '#64748b', fontWeight: 600, marginBottom: '6px' }}>
              Estado da Base Local de Consulta:
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
              <div>
                <span style={{ color: '#64748b' }}>Última sincronização: </span>
                <strong>
                  {lastSyncInfo.ultimaSincronizacao
                    ? new Date(lastSyncInfo.ultimaSincronizacao).toLocaleString('pt-BR')
                    : 'Nenhuma sincronização recente registrada'}
                </strong>
              </div>
              <div>
                <span style={{ color: '#64748b' }}>Situação: </span>
                <span className={`badge ${lastSyncInfo.status === 'sucesso' ? 'green' : lastSyncInfo.status === 'em_andamento' ? 'blue' : 'gray'}`}>
                  {lastSyncInfo.status.toUpperCase()}
                </span>
              </div>
            </div>
          </div>

          {/* Estado de confirmação inicial */}
          {isConfirming && !isLoading && !syncResult && (
            <div>
              <p style={{ fontSize: '13px', color: '#334155', lineHeight: '1.5', marginBottom: '14px' }}>
                Esta rotina consulta o serviço WFS do <strong>Geoportal da SEMA-MT</strong> (camadas confirmadas CAR_ATP, Fiscalização e Licenciamento) e atualiza a base local de referência em lotes seguros.
              </p>

              <div style={{
                padding: '10px 12px',
                backgroundColor: '#f0fdf4',
                border: '1px solid #bbf7d0',
                borderRadius: '6px',
                fontSize: '12px',
                color: '#166534',
                marginBottom: '14px'
              }}>
                ✓ <strong>Operação segura:</strong> Não altera nem exclui registros das tabelas operacionais de empreendedores ou barragens. As credenciais e authkeys permanecem estritamente no servidor.
              </div>

              {!isAuthorized && (
                <div style={{
                  padding: '10px 12px',
                  backgroundColor: '#fef2f2',
                  border: '1px solid #fecaca',
                  borderRadius: '6px',
                  fontSize: '12px',
                  color: '#991b1b',
                  marginBottom: '14px'
                }}>
                  ⚠️ Ação bloqueada: seu perfil atual não possui privilégios de Analista ou Administrador para disparar a sincronização.
                </div>
              )}
            </div>
          )}

          {/* Estado de carregamento / em progresso */}
          {isLoading && (
            <div style={{ textAlign: 'center', padding: '24px 10px' }}>
              <div style={{ fontSize: '28px', marginBottom: '10px' }}>🔄</div>
              <strong style={{ fontSize: '14px', color: '#0369a1', display: 'block', marginBottom: '6px' }}>
                Sincronizando com o Geoportal SEMA-MT...
              </strong>
              <span style={{ fontSize: '12px', color: '#64748b' }}>
                Processando camadas oficiais em lotes seguros. Por favor, aguarde sem fechar a janela.
              </span>
            </div>
          )}

          {/* Resultado com Sucesso */}
          {syncResult && (
            <div style={{
              padding: '14px',
              backgroundColor: '#f0fdf4',
              border: '1px solid #bbf7d0',
              borderRadius: '6px',
              marginBottom: '14px'
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: '#166534', fontWeight: 600, fontSize: '14px', marginBottom: '6px' }}>
                <span>✓</span>
                <span>Sincronização concluída com sucesso!</span>
              </div>
              <div style={{ fontSize: '12px', color: '#15803d', lineHeight: '1.5' }}>
                <div><strong>Horário:</strong> {new Date(syncResult.sincronizadoEm).toLocaleString('pt-BR')}</div>
                <div><strong>Registros consultados/processados:</strong> {syncResult.registrosProcessados}</div>
                <div><strong>Camadas abrangidas:</strong> {syncResult.camadas?.join(', ') || 'CAR_ATP'}</div>
                <div style={{ marginTop: '6px', fontSize: '11px', color: '#166534' }}>
                  A base local de consulta foi atualizada e está pronta para uso pelos analistas.
                </div>
              </div>
            </div>
          )}

          {/* Exibição de Erro */}
          {errorMsg && (
            <div style={{
              padding: '12px',
              backgroundColor: '#fef2f2',
              border: '1px solid #fecaca',
              borderRadius: '6px',
              color: '#991b1b',
              fontSize: '12px',
              marginBottom: '14px'
            }}>
              <strong>Falha na operação:</strong> {errorMsg}
            </div>
          )}
        </div>

        <div className="modal-foot">
          <button type="button" className="btn light" onClick={onClose} disabled={isLoading}>
            {syncResult ? 'Fechar' : 'Cancelar'}
          </button>
          {!syncResult && (
            <button
              type="button"
              className="btn green"
              onClick={handleStartSync}
              disabled={isLoading || !isAuthorized}
            >
              {isLoading ? 'Sincronizando...' : 'Confirmar e Atualizar'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
