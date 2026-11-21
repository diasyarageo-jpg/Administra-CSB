import React, { useState } from 'react';
import { authService } from '../services/authService';
import { isSupabaseConfigured } from '../services/supabaseClient';

interface LoginPageProps {
  onLoginSuccess: (user: any, profile: any) => void;
  pendingNotice?: string | null;
  authConfigured?: boolean;
}

export function LoginPage({
  onLoginSuccess,
  pendingNotice,
  authConfigured = isSupabaseConfigured()
}: LoginPageProps) {
  const [tab, setTab] = useState<'login' | 'forgot'>('login');

  // Estados do formulário de login
  const [loginEmail, setLoginEmail] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  const [showLoginPassword, setShowLoginPassword] = useState(false);

  // Estados de recuperação de senha
  const [forgotEmail, setForgotEmail] = useState('');

  // Estados de interface
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const handleLoginSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setSuccessMsg(null);

    if (!authConfigured) {
      setErrorMsg(
        'Serviço de autenticação não configurado no ambiente. Contate o administrador técnico.'
      );
      return;
    }

    if (!loginEmail.trim() || !loginPassword) {
      setErrorMsg('Informe o e-mail institucional e a senha.');
      return;
    }

    setLoading(true);
    try {
      const res = await authService.loginWithPassword(loginEmail, loginPassword);
      if (!res.success || !res.profile) {
        setErrorMsg(res.error || 'Não foi possível validar seu acesso.');
      } else {
        onLoginSuccess(res.user, res.profile);
      }
    } catch (err: any) {
      setErrorMsg(err?.message || 'Falha temporária ao autenticar.');
    } finally {
      setLoading(false);
    }
  };

  const handleForgotSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setSuccessMsg(null);

    if (!authConfigured) {
      setErrorMsg('Serviço de autenticação não configurado no ambiente.');
      return;
    }

    if (!forgotEmail.trim()) {
      setErrorMsg('Informe o e-mail institucional cadastrado.');
      return;
    }

    setLoading(true);
    try {
      const res = await authService.sendPasswordReset(forgotEmail);
      if (!res.success) {
        setErrorMsg(res.error || 'Falha ao solicitar recuperação.');
      } else {
        setSuccessMsg(
          'Se o e-mail estiver habilitado, enviaremos as instruções de redefinição de senha.'
        );
      }
    } catch (err: any) {
      setErrorMsg(err?.message || 'Erro ao processar solicitação de recuperação.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      style={{
        minHeight: '100vh',
        width: '100%',
        background: '#0b1426',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '20px 14px',
        boxSizing: 'border-box',
        fontFamily: 'Inter, system-ui, -apple-system, sans-serif'
      }}
    >
      <div
        style={{
          width: '100%',
          maxWidth: '430px',
          background: '#ffffff',
          borderRadius: '20px',
          boxShadow: '0 25px 60px -15px rgba(0, 0, 0, 0.65)',
          overflow: 'hidden',
          transition: 'all 0.25s ease'
        }}
      >
        {/* Faixa institucional superior sutil */}
        <div
          style={{
            background: '#f8fafc',
            borderBottom: '1px solid #e2e8f0',
            padding: '10px 20px',
            display: 'flex',
            flexWrap: 'wrap',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '4px 12px',
            fontSize: '11px',
            color: '#64748b'
          }}
        >
          <span style={{ fontWeight: 700, color: '#0f172a', letterSpacing: '0.02em' }}>
            ADMINISTRA-CSB
          </span>
          <span style={{ fontSize: '10px', letterSpacing: '0.04em' }}>
            SEMA-MT · SURH · SEGURANÇA DE BARRAGENS
          </span>
        </div>

        {/* Abas Superiores de Navegação (sem autocadastro público) */}
        <div
          style={{
            display: 'flex',
            borderBottom: '1px solid #e2e8f0',
            background: '#ffffff'
          }}
        >
          <button
            type="button"
            onClick={() => {
              setTab('login');
              setErrorMsg(null);
              setSuccessMsg(null);
            }}
            style={{
              flex: 1,
              padding: '12px 16px',
              border: 'none',
              background: tab === 'login' ? '#ffffff' : '#f8fafc',
              borderBottom: tab === 'login' ? '2.5px solid #00875a' : '1px solid transparent',
              fontWeight: tab === 'login' ? 700 : 500,
              color: tab === 'login' ? '#00875a' : '#64748b',
              cursor: 'pointer',
              fontSize: '13px',
              transition: 'all 0.15s ease'
            }}
          >
            Acessar Sistema
          </button>
          <button
            type="button"
            onClick={() => {
              setTab('forgot');
              setForgotEmail(loginEmail);
              setErrorMsg(null);
              setSuccessMsg(null);
            }}
            style={{
              flex: 1,
              padding: '12px 16px',
              border: 'none',
              background: tab === 'forgot' ? '#ffffff' : '#f8fafc',
              borderBottom: tab === 'forgot' ? '2.5px solid #00875a' : '1px solid transparent',
              fontWeight: tab === 'forgot' ? 700 : 500,
              color: tab === 'forgot' ? '#00875a' : '#64748b',
              cursor: 'pointer',
              fontSize: '13px',
              transition: 'all 0.15s ease'
            }}
          >
            Redefinir Senha
          </button>
        </div>

        {/* Conteúdo Principal */}
        <div style={{ padding: '32px 32px 28px' }}>
          <div style={{ textAlign: 'center', marginBottom: '20px' }}>
            <div
              style={{
                width: '60px',
                height: '60px',
                borderRadius: '16px',
                background: '#f0f4f8',
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                padding: '6px',
                marginBottom: '16px',
                overflow: 'hidden'
              }}
            >
              <img
                src="/assets/aistudio/SISBAM-MT_S__DESENHO_76e8031e.png"
                alt="Logo Administra-CSB"
                style={{ width: '100%', height: '100%', objectFit: 'contain' }}
              />
            </div>

            <h1
              style={{
                margin: '0 0 6px 0',
                fontSize: '20px',
                fontWeight: 800,
                letterSpacing: '0.08em',
                color: '#0a192f',
                textTransform: 'uppercase'
              }}
            >
              ACESSO RESTRITO
            </h1>

            <p
              style={{
                margin: 0,
                fontSize: '11px',
                fontWeight: 700,
                letterSpacing: '0.12em',
                color: '#7b91a7',
                textTransform: 'uppercase'
              }}
            >
              ÁREA DE USO EXCLUSIVO E MONITORADO
            </p>
          </div>

          <div
            style={{
              marginBottom: '22px',
              padding: '10px 14px',
              background: '#fef9c3',
              border: '1px solid #fef08a',
              borderRadius: '8px',
              textAlign: 'center'
            }}
          >
            <p
              style={{
                margin: 0,
                fontStyle: 'italic',
                fontSize: '11.5px',
                color: '#a16207',
                lineHeight: '1.45',
                fontWeight: 500
              }}
            >
              Este sistema é de uso institucional. O acesso exige sessão autenticada e cadastro ativo vinculado.
            </p>
          </div>

          {!authConfigured && (
            <div
              role="alert"
              style={{
                marginBottom: '16px',
                padding: '12px',
                background: '#fee2e2',
                border: '1px solid #ef4444',
                color: '#991b1b',
                borderRadius: '8px',
                fontSize: '12px',
                fontWeight: 600,
                lineHeight: '1.45'
              }}
            >
              Serviço de autenticação indisponível: verifique a configuração de ambiente (VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY). Acesso bloqueado por segurança.
            </div>
          )}

          {pendingNotice && (
            <div
              role="alert"
              style={{
                marginBottom: '16px',
                padding: '12px',
                background: '#fef3c7',
                border: '1px solid #f59e0b',
                color: '#92400e',
                borderRadius: '8px',
                fontSize: '12px',
                fontWeight: 600,
                lineHeight: '1.45'
              }}
            >
              {pendingNotice}
            </div>
          )}

          {errorMsg && (
            <div
              role="alert"
              style={{
                marginBottom: '16px',
                padding: '12px',
                background: '#fee2e2',
                border: '1px solid #ef4444',
                color: '#b91c1c',
                borderRadius: '8px',
                fontSize: '12px',
                fontWeight: 600,
                lineHeight: '1.45'
              }}
            >
              {errorMsg}
            </div>
          )}

          {successMsg && (
            <div
              style={{
                marginBottom: '16px',
                padding: '12px',
                background: '#dcfce7',
                border: '1px solid #10b981',
                color: '#166534',
                borderRadius: '8px',
                fontSize: '12px',
                fontWeight: 600,
                lineHeight: '1.45'
              }}
            >
              {successMsg}
            </div>
          )}

          {tab === 'login' && (
            <form onSubmit={handleLoginSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              <div>
                <label
                  htmlFor="login-email-input"
                  style={{
                    display: 'block',
                    fontSize: '13px',
                    fontWeight: 600,
                    color: '#334155',
                    marginBottom: '6px'
                  }}
                >
                  E-mail institucional *
                </label>
                <div style={{ position: 'relative' }}>
                  <span
                    style={{
                      position: 'absolute',
                      left: '14px',
                      top: '50%',
                      transform: 'translateY(-50%)',
                      color: '#94a3b8',
                      display: 'flex',
                      alignItems: 'center',
                      pointerEvents: 'none'
                    }}
                  >
                    <svg
                      width="18"
                      height="18"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
                      <circle cx="12" cy="7" r="4" />
                    </svg>
                  </span>
                  <input
                    id="login-email-input"
                    type="email"
                    required
                    autoComplete="username"
                    value={loginEmail}
                    onChange={e => setLoginEmail(e.target.value)}
                    placeholder="servidor@sema.mt.gov.br"
                    disabled={loading || !authConfigured}
                    style={{
                      width: '100%',
                      height: '46px',
                      padding: '10px 14px 10px 42px',
                      borderRadius: '10px',
                      border: '1.5px solid #cbd5e1',
                      fontSize: '13.5px',
                      color: '#1e293b',
                      boxSizing: 'border-box',
                      outline: 'none',
                      transition: 'border-color 0.15s ease'
                    }}
                    onFocus={e => (e.currentTarget.style.borderColor = '#00875a')}
                    onBlur={e => (e.currentTarget.style.borderColor = '#cbd5e1')}
                  />
                </div>
              </div>

              <div>
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    marginBottom: '6px'
                  }}
                >
                  <label
                    htmlFor="login-password-input"
                    style={{ fontSize: '13px', fontWeight: 600, color: '#334155' }}
                  >
                    Senha *
                  </label>
                  <button
                    type="button"
                    onClick={() => {
                      setTab('forgot');
                      setForgotEmail(loginEmail);
                      setErrorMsg(null);
                      setSuccessMsg(null);
                    }}
                    style={{
                      background: 'none',
                      border: 'none',
                      color: '#00875a',
                      fontSize: '11.5px',
                      fontWeight: 600,
                      cursor: 'pointer',
                      padding: 0
                    }}
                  >
                    Esqueceu a senha?
                  </button>
                </div>
                <div style={{ position: 'relative' }}>
                  <span
                    style={{
                      position: 'absolute',
                      left: '14px',
                      top: '50%',
                      transform: 'translateY(-50%)',
                      color: '#94a3b8',
                      display: 'flex',
                      alignItems: 'center',
                      pointerEvents: 'none'
                    }}
                  >
                    <svg
                      width="18"
                      height="18"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                    </svg>
                  </span>
                  <input
                    id="login-password-input"
                    type={showLoginPassword ? 'text' : 'password'}
                    required
                    autoComplete="current-password"
                    value={loginPassword}
                    onChange={e => setLoginPassword(e.target.value)}
                    placeholder="••••••••"
                    disabled={loading || !authConfigured}
                    style={{
                      width: '100%',
                      height: '46px',
                      padding: '10px 42px 10px 42px',
                      borderRadius: '10px',
                      border: '1.5px solid #cbd5e1',
                      fontSize: '13.5px',
                      color: '#1e293b',
                      boxSizing: 'border-box',
                      outline: 'none',
                      transition: 'border-color 0.15s ease'
                    }}
                    onFocus={e => (e.currentTarget.style.borderColor = '#00875a')}
                    onBlur={e => (e.currentTarget.style.borderColor = '#cbd5e1')}
                  />
                  <button
                    type="button"
                    onClick={() => setShowLoginPassword(!showLoginPassword)}
                    style={{
                      position: 'absolute',
                      right: '12px',
                      top: '50%',
                      transform: 'translateY(-50%)',
                      background: 'none',
                      border: 'none',
                      cursor: 'pointer',
                      color: showLoginPassword ? '#00875a' : '#94a3b8',
                      display: 'flex',
                      alignItems: 'center',
                      padding: '4px'
                    }}
                    title={showLoginPassword ? 'Ocultar senha' : 'Ver senha'}
                  >
                    <svg
                      width="18"
                      height="18"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                      <circle cx="12" cy="12" r="3" />
                      {showLoginPassword && <line x1="1" y1="1" x2="23" y2="23" />}
                    </svg>
                  </button>
                </div>
              </div>

              <button
                type="submit"
                disabled={loading || !authConfigured}
                style={{
                  marginTop: '8px',
                  width: '100%',
                  height: '46px',
                  padding: '12px',
                  background: '#00875a',
                  color: '#ffffff',
                  border: 'none',
                  borderRadius: '10px',
                  fontWeight: 700,
                  fontSize: '14px',
                  cursor: loading || !authConfigured ? 'not-allowed' : 'pointer',
                  opacity: loading || !authConfigured ? 0.65 : 1,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '8px',
                  boxShadow: '0 4px 12px rgba(0, 135, 90, 0.25)',
                  transition: 'background-color 0.15s ease'
                }}
              >
                {loading ? 'Validando autenticação...' : 'Entrar'}
              </button>

              <p
                style={{
                  margin: '4px 0 0',
                  textAlign: 'center',
                  fontSize: '11.5px',
                  color: '#64748b',
                  lineHeight: '1.45'
                }}
              >
                Cadastro público desativado. Novos acessos são habilitados exclusivamente pela Administração da CSB.
              </p>
            </form>
          )}

          {tab === 'forgot' && (
            <form onSubmit={handleForgotSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              <p style={{ fontSize: '12.5px', color: '#475569', margin: 0, lineHeight: '1.45' }}>
                Informe seu e-mail institucional cadastrado. Enviaremos um link de recuperação para redefinir sua senha.
              </p>

              <div>
                <label
                  htmlFor="forgot-email-input"
                  style={{ display: 'block', fontSize: '13px', fontWeight: 600, color: '#334155', marginBottom: '6px' }}
                >
                  E-mail institucional cadastrado *
                </label>
                <div style={{ position: 'relative' }}>
                  <span
                    style={{
                      position: 'absolute',
                      left: '14px',
                      top: '50%',
                      transform: 'translateY(-50%)',
                      color: '#94a3b8',
                      display: 'flex',
                      alignItems: 'center',
                      pointerEvents: 'none'
                    }}
                  >
                    <svg
                      width="18"
                      height="18"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
                      <polyline points="22,6 12,13 2,6" />
                    </svg>
                  </span>
                  <input
                    id="forgot-email-input"
                    type="email"
                    required
                    value={forgotEmail}
                    onChange={e => setForgotEmail(e.target.value)}
                    placeholder="servidor@sema.mt.gov.br"
                    disabled={loading || !authConfigured}
                    style={{
                      width: '100%',
                      height: '46px',
                      padding: '10px 14px 10px 42px',
                      borderRadius: '10px',
                      border: '1.5px solid #cbd5e1',
                      fontSize: '13.5px',
                      color: '#1e293b',
                      boxSizing: 'border-box',
                      outline: 'none'
                    }}
                  />
                </div>
              </div>

              <div style={{ display: 'flex', gap: '10px', marginTop: '6px' }}>
                <button
                  type="button"
                  onClick={() => setTab('login')}
                  disabled={loading}
                  style={{
                    padding: '11px 18px',
                    background: '#f1f5f9',
                    color: '#334155',
                    border: '1px solid #cbd5e1',
                    borderRadius: '8px',
                    fontSize: '13px',
                    fontWeight: 600,
                    cursor: 'pointer'
                  }}
                >
                  Voltar
                </button>
                <button
                  type="submit"
                  disabled={loading || !authConfigured}
                  style={{
                    flex: 1,
                    padding: '11px 18px',
                    background: '#00875a',
                    color: '#ffffff',
                    border: 'none',
                    borderRadius: '8px',
                    fontSize: '13px',
                    fontWeight: 700,
                    cursor: loading || !authConfigured ? 'not-allowed' : 'pointer',
                    opacity: loading || !authConfigured ? 0.65 : 1,
                    boxShadow: '0 4px 12px rgba(0, 135, 90, 0.2)'
                  }}
                >
                  {loading ? 'Enviando...' : 'Enviar link de recuperação'}
                </button>
              </div>
            </form>
          )}
        </div>

        {/* Rodapé de Segurança */}
        <div
          style={{
            background: '#f8fafc',
            padding: '12px 28px',
            borderTop: '1px solid #e2e8f0',
            textAlign: 'center',
            fontSize: '11.5px',
            color: '#64748b'
          }}
        >
          Acesso restrito a servidores autorizados
        </div>
      </div>
    </div>
  );
}
