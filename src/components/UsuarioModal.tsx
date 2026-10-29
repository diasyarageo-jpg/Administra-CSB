import React, { useState } from 'react';
import { UsuarioRecord } from '../services/notificaDataService';
import { authService } from '../services/authService';
import {
  PERFIS_PROFISSIONAIS,
  SETORES,
  UserRole,
  PerfilProfissional,
  SetorLotacao
} from '../types/auth';

interface UsuarioModalProps {
  record: Partial<UsuarioRecord>;
  isNew: boolean;
  onClose: () => void;
  onSave: (savedRecord: any) => void;
}

export function UsuarioModal({ record, isNew, onClose, onSave }: UsuarioModalProps) {
  const [nome, setNome] = useState(record.nome || '');
  const [matricula, setMatricula] = useState(record.matricula || '');
  const [email, setEmail] = useState(record.email || '');
  const [login, setLogin] = useState(record.login || '');
  const [perfilProfissional, setPerfilProfissional] = useState(
    record.perfilProfissional || PERFIS_PROFISSIONAIS[0]
  );
  const [setor, setSetor] = useState(record.setor || SETORES[0]);
  const [papel, setPapel] = useState<UserRole>((record.papel as UserRole) || 'Usuário');
  const [situacao, setSituacao] = useState(record.situacao || 'Ativo');
  const [observacoes, setObservacoes] = useState(record.observacoes || '');

  // Ações de criação no Supabase Auth
  const [authAction, setAuthAction] = useState<'invite' | 'password' | 'db_only'>('invite');
  const [temporaryPassword, setTemporaryPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [statusMessage, setStatusMessage] = useState<{ type: 'error' | 'success' | 'info'; text: string } | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setStatusMessage(null);

    if (!nome.trim()) {
      setStatusMessage({ type: 'error', text: 'Informe o nome completo do usuário.' });
      return;
    }

    if (!matricula.trim()) {
      setStatusMessage({ type: 'error', text: 'Informe o número de matrícula funcional.' });
      return;
    }

    if (!email.trim()) {
      setStatusMessage({ type: 'error', text: 'Informe o e-mail institucional.' });
      return;
    }

    setLoading(true);

    try {
      let authUserId = record.authUserId;

      // Se for novo cadastro e selecionou convite ou senha temporária via Supabase Auth
      if (isNew && authAction !== 'db_only') {
        setStatusMessage({ type: 'info', text: 'Comunicando com Supabase Auth...' });
        const res = await authService.adminCreateUser({
          nome: nome.trim(),
          matricula: matricula.trim(),
          email: email.trim(),
          login: login.trim() || email.trim(),
          perfilProfissional,
          setor,
          papel,
          situacao,
          observacoes,
          sendInviteEmail: authAction === 'invite',
          temporaryPassword: authAction === 'password' ? temporaryPassword : undefined
        });

        if (!res.success) {
          setStatusMessage({
            type: 'error',
            text: `Atenção: Não foi possível provisionar no Supabase Auth (${res.error}). O registro será salvo apenas no cadastro interno.`
          });
        } else if (res.authUserId) {
          authUserId = res.authUserId;
        }
      }

      const updatedRecord: Partial<UsuarioRecord> = {
        ...record,
        nome: nome.trim(),
        matricula: matricula.trim(),
        email: email.trim().toLowerCase(),
        login: (login.trim() || email.trim()).toLowerCase(),
        perfilProfissional,
        setor,
        papel,
        situacao: situacao as any,
        status: (situacao === 'Inativo' ? 'Inativo' : 'Ativo') as any,
        authUserId,
        observacoes: observacoes.trim()
      };

      onSave(updatedRecord);
    } catch (err: any) {
      setStatusMessage({
        type: 'error',
        text: err?.message || 'Erro ao processar o cadastro do usuário.'
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="modal-back" onClick={e => e.target === e.currentTarget && onClose()}>
      <form className="modal" onSubmit={handleSubmit} style={{ maxWidth: '680px', width: '100%' }}>
        <div className="modal-head">
          <h3>
            {isNew ? 'Novo usuário institucional' : 'Editar usuário'} · SEMA-MT
          </h3>
          <button type="button" className="modal-close" onClick={onClose}>
            ×
          </button>
        </div>

        <div className="modal-body">
          {statusMessage && (
            <div
              className={`notice ${
                statusMessage.type === 'error'
                  ? 'red'
                  : statusMessage.type === 'success'
                  ? 'green'
                  : 'amber'
              }`}
              style={{ marginBottom: '14px' }}
            >
              {statusMessage.text}
            </div>
          )}

          <div className="form-grid">
            <div className="form-field full">
              <label>Nome completo · obrigatório</label>
              <input
                className="input"
                required
                value={nome}
                onChange={e => setNome(e.target.value)}
                placeholder="Ex.: Carlos Eduardo da Silva"
                disabled={loading}
              />
            </div>

            <div className="form-field">
              <label>Matrícula funcional · obrigatório</label>
              <input
                className="input"
                required
                value={matricula}
                onChange={e => setMatricula(e.target.value)}
                placeholder="Ex.: 248910"
                disabled={loading}
              />
            </div>

            <div className="form-field">
              <label>E-mail institucional · obrigatório</label>
              <input
                className="input"
                type="email"
                required
                value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder="nome@sema.mt.gov.br"
                disabled={loading}
              />
            </div>

            <div className="form-field">
              <label>Identificação de acesso (login)</label>
              <input
                className="input"
                value={login}
                onChange={e => setLogin(e.target.value)}
                placeholder="usuario.sobrenome (opcional)"
                disabled={loading}
              />
            </div>

            <div className="form-field">
              <label>Perfil profissional</label>
              <select
                className="select"
                value={perfilProfissional}
                onChange={e => setPerfilProfissional(e.target.value as PerfilProfissional)}
                disabled={loading}
              >
                {PERFIS_PROFISSIONAIS.map(perf => (
                  <option key={perf} value={perf}>
                    {perf}
                  </option>
                ))}
              </select>
            </div>

            <div className="form-field">
              <label>Setor de lotação</label>
              <select
                className="select"
                value={setor}
                onChange={e => setSetor(e.target.value as SetorLotacao)}
                disabled={loading}
              >
                {SETORES.map(s => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </div>

            <div className="form-field">
              <label>Papel e permissão de acesso · RBAC</label>
              <select
                className="select"
                value={papel}
                onChange={e => setPapel(e.target.value as UserRole)}
                disabled={loading}
              >
                <option value="Administrador">Administrador (Acesso total)</option>
                <option value="Usuário">Usuário (Operacional: cria e edita próprios)</option>
                <option value="Visualizador">Visualizador (Somente leitura)</option>
              </select>
            </div>

            <div className="form-field">
              <label>Situação funcional</label>
              <select
                className="select"
                value={situacao}
                onChange={e => setSituacao(e.target.value as any)}
                disabled={loading}
              >
                <option value="Ativo">Ativo</option>
                <option value="Inativo">Inativo</option>
                <option value="Pendente">Pendente</option>
              </select>
            </div>

            {/* Status do vínculo com o Supabase Auth */}
            <div className="form-field full">
              <div
                style={{
                  background: '#f9fafb',
                  border: '1px solid #e5e7eb',
                  borderRadius: '6px',
                  padding: '12px'
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <span style={{ fontSize: '12px', fontWeight: 600, color: '#374151' }}>
                    Vínculo com Supabase Auth:
                  </span>
                  <span
                    style={{
                      fontSize: '11px',
                      padding: '2px 8px',
                      borderRadius: '4px',
                      background: record.authUserId ? '#dcfce7' : '#fef3c7',
                      color: record.authUserId ? '#166534' : '#92400e',
                      fontWeight: 600
                    }}
                  >
                    {record.authUserId ? `Vinculado (${record.authUserId.substring(0, 8)}...)` : 'Não vinculado ao Auth'}
                  </span>
                </div>

                {isNew && (
                  <div style={{ marginTop: '10px' }}>
                    <div style={{ fontSize: '11px', color: '#6b7280', marginBottom: '8px' }}>
                      Como deseja provisionar a autenticação deste servidor?
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                      <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '12px', cursor: 'pointer' }}>
                        <input
                          type="radio"
                          name="authAction"
                          checked={authAction === 'invite'}
                          onChange={() => setAuthAction('invite')}
                          disabled={loading}
                        />
                        <span>Enviar convite automático por e-mail (Supabase Auth invite)</span>
                      </label>

                      <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '12px', cursor: 'pointer' }}>
                        <input
                          type="radio"
                          name="authAction"
                          checked={authAction === 'password'}
                          onChange={() => setAuthAction('password')}
                          disabled={loading}
                        />
                        <span>Definir senha inicial temporária</span>
                      </label>

                      {authAction === 'password' && (
                        <div style={{ marginLeft: '24px', marginTop: '4px' }}>
                          <input
                            className="input"
                            type="password"
                            placeholder="Mínimo 6 caracteres"
                            value={temporaryPassword}
                            onChange={e => setTemporaryPassword(e.target.value)}
                            disabled={loading}
                            style={{ maxWidth: '280px' }}
                          />
                        </div>
                      )}

                      <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '12px', cursor: 'pointer' }}>
                        <input
                          type="radio"
                          name="authAction"
                          checked={authAction === 'db_only'}
                          onChange={() => setAuthAction('db_only')}
                          disabled={loading}
                        />
                        <span>Salvar apenas o cadastro de servidor (sem convite imediato)</span>
                      </label>
                    </div>
                  </div>
                )}
              </div>
            </div>

            <div className="form-field full">
              <label>Observações</label>
              <textarea
                className="textarea"
                rows={2}
                value={observacoes}
                onChange={e => setObservacoes(e.target.value)}
                placeholder="Observações administrativas ou histórico do servidor"
                disabled={loading}
              />
            </div>
          </div>
        </div>

        <div className="modal-foot">
          <button type="button" className="btn light" onClick={onClose} disabled={loading}>
            Cancelar
          </button>
          <button type="submit" className="btn green" disabled={loading}>
            {loading ? 'Salvando...' : 'Salvar usuário'}
          </button>
        </div>
      </form>
    </div>
  );
}
