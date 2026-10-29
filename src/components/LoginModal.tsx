import React, { useState } from 'react';
import { authService } from '../services/authService';

interface LoginModalProps {
  isOpen: boolean;
  onSuccess: (session: any) => void;
  onClose?: () => void;
  allowClose?: boolean;
}

export function LoginModal({ isOpen, onSuccess, onClose, allowClose = false }: LoginModalProps) {
  const [mode, setMode] = useState<'login' | 'forgot' | 'reset'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setSuccessMsg(null);

    if (!email.trim() || !password) {
      setErrorMsg('Informe o e-mail institucional e a senha.');
      return;
    }

    setLoading(true);
    try {
      const res = await authService.loginWithPassword(email, password);
      if (!res.success) {
        setErrorMsg(res.error || 'Falha na autenticação.');
      } else {
        onSuccess(res);
      }
    } catch (err: any) {
      setErrorMsg(err?.message || 'Erro ao conectar ao serviço de autenticação.');
    } finally {
      setLoading(false);
    }
  };

  const handleForgot = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setSuccessMsg(null);

    if (!email.trim()) {
      setErrorMsg('Informe o e-mail institucional cadastrado.');
      return;
    }

    setLoading(true);
    try {
      const res = await authService.sendPasswordReset(email);
      if (!res.success) {
        setErrorMsg(res.error || 'Não foi possível enviar o e-mail de recuperação.');
      } else {
        setSuccessMsg('Instruções e link de recuperação enviados para o e-mail institucional.');
      }
    } catch (err: any) {
      setErrorMsg(err?.message || 'Falha ao solicitar recuperação de senha.');
    } finally {
      setLoading(false);
    }
  };

  const handleUpdatePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setSuccessMsg(null);

    if (newPassword.length < 6) {
      setErrorMsg('A nova senha deve ter no mínimo 6 caracteres.');
      return;
    }

    setLoading(true);
    try {
      const res = await authService.updatePassword(newPassword);
      if (!res.success) {
        setErrorMsg(res.error || 'Não foi possível atualizar a senha.');
      } else {
        setSuccessMsg('Senha atualizada com sucesso. Você já pode acessar o sistema.');
        setTimeout(() => {
          setMode('login');
          setSuccessMsg(null);
        }, 2000);
      }
    } catch (err: any) {
      setErrorMsg(err?.message || 'Erro ao redefinir a senha.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="modal-back">
      <div className="modal" style={{ maxWidth: '440px', width: '100%' }}>
        <div className="modal-head">
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{ fontSize: '20px' }}>🔒</span>
            <div>
              <h3 style={{ margin: 0, fontSize: '16px', fontWeight: 700 }}>
                {mode === 'login' && 'Autenticação de Usuário'}
                {mode === 'forgot' && 'Recuperação de Senha'}
                {mode === 'reset' && 'Definição de Nova Senha'}
              </h3>
              <p style={{ margin: 0, fontSize: '11px', color: '#6b7280' }}>
                Administra-CSB · SEMA-MT / SURH / CSB
              </p>
            </div>
          </div>
          {allowClose && onClose && (
            <button type="button" className="modal-close" onClick={onClose}>
              ×
            </button>
          )}
        </div>

        <div className="modal-body">
          {errorMsg && (
            <div className="notice red" style={{ marginBottom: '16px' }}>
              <strong>Atenção:</strong> {errorMsg}
            </div>
          )}

          {successMsg && (
            <div className="notice green" style={{ marginBottom: '16px' }}>
              {successMsg}
            </div>
          )}

          {mode === 'login' && (
            <form onSubmit={handleLogin}>
              <div className="form-field" style={{ marginBottom: '14px' }}>
                <label>E-mail institucional</label>
                <input
                  className="input"
                  type="email"
                  autoComplete="username"
                  required
                  placeholder="servidor@sema.mt.gov.br"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  disabled={loading}
                />
              </div>

              <div className="form-field" style={{ marginBottom: '14px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <label>Senha</label>
                  <button
                    type="button"
                    onClick={() => {
                      setMode('forgot');
                      setErrorMsg(null);
                      setSuccessMsg(null);
                    }}
                    style={{
                      background: 'none',
                      border: 'none',
                      color: '#2563eb',
                      fontSize: '11px',
                      cursor: 'pointer',
                      padding: 0
                    }}
                  >
                    Esqueceu a senha?
                  </button>
                </div>
                <input
                  className="input"
                  type="password"
                  autoComplete="current-password"
                  required
                  placeholder="••••••••"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  disabled={loading}
                />
              </div>

              <div style={{ marginTop: '20px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                <button
                  type="submit"
                  className="btn green"
                  style={{ width: '100%', justifyContent: 'center' }}
                  disabled={loading}
                >
                  {loading ? 'Validando acesso...' : 'Entrar no sistema'}
                </button>
              </div>

              <p style={{ marginTop: '14px', fontSize: '11px', color: '#6b7280', textAlign: 'center' }}>
                Cadastro público desativado. Contas de acesso são criadas exclusivamente pela Administração da CSB.
              </p>
            </form>
          )}

          {mode === 'forgot' && (
            <form onSubmit={handleForgot}>
              <p style={{ fontSize: '12px', color: '#4b5563', marginBottom: '14px' }}>
                Informe o seu e-mail institucional cadastrado. Enviaremos um link seguro para você redefinir sua senha de acesso.
              </p>

              <div className="form-field" style={{ marginBottom: '14px' }}>
                <label>E-mail institucional cadastrado</label>
                <input
                  className="input"
                  type="email"
                  required
                  placeholder="servidor@sema.mt.gov.br"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  disabled={loading}
                />
              </div>

              <div style={{ display: 'flex', gap: '8px', marginTop: '16px' }}>
                <button
                  type="button"
                  className="btn light"
                  onClick={() => {
                    setMode('login');
                    setErrorMsg(null);
                    setSuccessMsg(null);
                  }}
                  disabled={loading}
                >
                  Voltar ao login
                </button>
                <button
                  type="submit"
                  className="btn green"
                  style={{ flex: 1, justifyContent: 'center' }}
                  disabled={loading}
                >
                  {loading ? 'Enviando...' : 'Enviar link de recuperação'}
                </button>
              </div>
            </form>
          )}

          {mode === 'reset' && (
            <form onSubmit={handleUpdatePassword}>
              <div className="form-field" style={{ marginBottom: '14px' }}>
                <label>Nova senha (mínimo de 6 caracteres)</label>
                <input
                  className="input"
                  type="password"
                  required
                  placeholder="••••••••"
                  value={newPassword}
                  onChange={e => setNewPassword(e.target.value)}
                  disabled={loading}
                />
              </div>

              <div style={{ display: 'flex', gap: '8px', marginTop: '16px' }}>
                <button
                  type="button"
                  className="btn light"
                  onClick={() => setMode('login')}
                  disabled={loading}
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="btn green"
                  style={{ flex: 1, justifyContent: 'center' }}
                  disabled={loading}
                >
                  {loading ? 'Salvando...' : 'Salvar nova senha'}
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
