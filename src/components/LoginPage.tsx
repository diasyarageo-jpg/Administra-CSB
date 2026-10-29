import React, { useState } from 'react';
import { authService } from '../services/authService';
import { PERFIS_PROFISSIONAIS, SETORES, PerfilProfissional, SetorLotacao } from '../types/auth';

interface LoginPageProps {
  onLoginSuccess: (user: any, profile: any) => void;
  pendingNotice?: string | null;
}

export function LoginPage({ onLoginSuccess, pendingNotice }: LoginPageProps) {
  const [tab, setTab] = useState<'login' | 'request' | 'forgot'>('login');

  // Estados do formulário de login
  const [loginEmail, setLoginEmail] = useState('');
  const [loginPassword, setLoginPassword] = useState('');

  // Estados do formulário "Solicitar novo acesso"
  const [reqNome, setReqNome] = useState('');
  const [reqMatricula, setReqMatricula] = useState('');
  const [reqEmail, setReqEmail] = useState('');
  const [reqLogin, setReqLogin] = useState('');
  const [reqPerfil, setReqPerfil] = useState<string>(PERFIS_PROFISSIONAIS[0]);
  const [reqSetor, setReqSetor] = useState<string>(SETORES[0]);
  const [reqSenha, setReqSenha] = useState('');

  // Estados de recuperação de senha
  const [forgotEmail, setForgotEmail] = useState('');

  // Estados de interface
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // Submissão de login
  const handleLoginSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setSuccessMsg(null);

    if (!loginEmail.trim() || !loginPassword) {
      setErrorMsg('Informe o e-mail institucional e a senha.');
      return;
    }

    setLoading(true);
    try {
      const res = await authService.loginWithPassword(loginEmail, loginPassword);
      if (!res.success) {
        setErrorMsg(res.error || 'Credenciais inválidas.');
      } else {
        onLoginSuccess(res.user, res.profile);
      }
    } catch (err: any) {
      setErrorMsg(err?.message || 'Falha ao autenticar.');
    } finally {
      setLoading(false);
    }
  };

  // Submissão de Solicitação de Novo Acesso
  const handleRequestSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setSuccessMsg(null);

    if (!reqNome.trim()) {
      setErrorMsg('Informe seu nome completo.');
      return;
    }
    if (!reqMatricula.trim()) {
      setErrorMsg('Informe sua matrícula funcional.');
      return;
    }
    if (!reqEmail.trim()) {
      setErrorMsg('Informe seu e-mail institucional.');
      return;
    }

    setLoading(true);
    try {
      const res = await authService.requestAccess({
        nome: reqNome.trim(),
        matricula: reqMatricula.trim(),
        email: reqEmail.trim(),
        login: reqLogin.trim() || reqEmail.trim().split('@')[0],
        perfilProfissional: reqPerfil,
        setor: reqSetor,
        senha: reqSenha.trim() || undefined
      });

      if (!res.success) {
        setErrorMsg(res.error || 'Não foi possível registrar a solicitação.');
      } else {
        setSuccessMsg(
          res.message ||
            'Solicitação registrada com sucesso! Seu acesso está registrado como Pendente e será avaliado pela Administração da CSB.'
        );
        // Limpa campos
        setReqNome('');
        setReqMatricula('');
        setReqEmail('');
        setReqLogin('');
        setReqSenha('');
      }
    } catch (err: any) {
      setErrorMsg(err?.message || 'Falha ao enviar a solicitação.');
    } finally {
      setLoading(false);
    }
  };

  // Submissão de Recuperação de Senha
  const handleForgotSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setSuccessMsg(null);

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
        setSuccessMsg('Link de recuperação enviado com sucesso para o seu e-mail institucional.');
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
        width: '100vw',
        background: 'linear-gradient(145deg, #064e3b 0%, #0f172a 100%)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '20px',
        boxSizing: 'border-box',
        fontFamily: 'Inter, system-ui, -apple-system, sans-serif'
      }}
    >
      <div
        style={{
          width: '100%',
          maxWidth: tab === 'request' ? '560px' : '440px',
          background: '#ffffff',
          borderRadius: '16px',
          boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.4)',
          overflow: 'hidden',
          transition: 'all 0.3s ease'
        }}
      >
        {/* Cabeçalho Institucional */}
        <div
          style={{
            background: '#047857',
            padding: '24px 28px',
            color: '#ffffff',
            borderBottom: '3px solid #10b981'
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <div
              style={{
                width: '42px',
                height: '42px',
                borderRadius: '10px',
                background: 'rgba(255, 255, 255, 0.15)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: '22px',
                fontWeight: 900
              }}
            >
              ⚖
            </div>
            <div>
              <h1 style={{ margin: 0, fontSize: '18px', fontWeight: 800, letterSpacing: '-0.02em' }}>
                ADMINISTRA-CSB
              </h1>
              <p style={{ margin: 0, fontSize: '11px', opacity: 0.9, letterSpacing: '0.04em' }}>
                SEMA-MT · SURH · COORDENADORIA DE SEGURANÇA DE BARRAGENS
              </p>
            </div>
          </div>
        </div>

        {/* Abas Superiores */}
        <div
          style={{
            display: 'flex',
            borderBottom: '1px solid #e5e7eb',
            background: '#f9fafb'
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
              background: tab === 'login' ? '#ffffff' : 'transparent',
              borderBottom: tab === 'login' ? '2px solid #047857' : 'none',
              fontWeight: tab === 'login' ? 700 : 500,
              color: tab === 'login' ? '#047857' : '#6b7280',
              cursor: 'pointer',
              fontSize: '13px'
            }}
          >
            Acessar Sistema
          </button>
          <button
            type="button"
            onClick={() => {
              setTab('request');
              setErrorMsg(null);
              setSuccessMsg(null);
            }}
            style={{
              flex: 1,
              padding: '12px 16px',
              border: 'none',
              background: tab === 'request' ? '#ffffff' : 'transparent',
              borderBottom: tab === 'request' ? '2px solid #047857' : 'none',
              fontWeight: tab === 'request' ? 700 : 500,
              color: tab === 'request' ? '#047857' : '#6b7280',
              cursor: 'pointer',
              fontSize: '13px'
            }}
          >
            Solicitar novo acesso
          </button>
        </div>

        {/* Corpo do Formulário */}
        <div style={{ padding: '24px 28px' }}>
          {/* Mensagens de Notificação */}
          {pendingNotice && (
            <div
              style={{
                marginBottom: '16px',
                padding: '12px',
                background: '#fef3c7',
                border: '1px solid #f59e0b',
                color: '#92400e',
                borderRadius: '8px',
                fontSize: '12px',
                fontWeight: 600
              }}
            >
              {pendingNotice}
            </div>
          )}

          {errorMsg && (
            <div
              style={{
                marginBottom: '16px',
                padding: '12px',
                background: '#fee2e2',
                border: '1px solid #ef4444',
                color: '#b91c1c',
                borderRadius: '8px',
                fontSize: '12px',
                fontWeight: 600
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
                fontWeight: 600
              }}
            >
              {successMsg}
            </div>
          )}

          {/* ABA 1: LOGIN */}
          {tab === 'login' && (
            <form onSubmit={handleLoginSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
              <div>
                <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: '#374151', marginBottom: '4px' }}>
                  E-mail institucional (@sema.mt.gov.br) *
                </label>
                <input
                  type="email"
                  required
                  autoComplete="username"
                  value={loginEmail}
                  onChange={e => setLoginEmail(e.target.value)}
                  placeholder="usuario@sema.mt.gov.br"
                  disabled={loading}
                  style={{
                    width: '100%',
                    padding: '10px 12px',
                    borderRadius: '8px',
                    border: '1px solid #d1d5db',
                    fontSize: '13px',
                    boxSizing: 'border-box',
                    outline: 'none'
                  }}
                />
              </div>

              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
                  <label style={{ fontSize: '12px', fontWeight: 600, color: '#374151' }}>
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
                      color: '#047857',
                      fontSize: '11px',
                      fontWeight: 600,
                      cursor: 'pointer',
                      padding: 0
                    }}
                  >
                    Esqueceu a senha?
                  </button>
                </div>
                <input
                  type="password"
                  required
                  autoComplete="current-password"
                  value={loginPassword}
                  onChange={e => setLoginPassword(e.target.value)}
                  placeholder="••••••••"
                  disabled={loading}
                  style={{
                    width: '100%',
                    padding: '10px 12px',
                    borderRadius: '8px',
                    border: '1px solid #d1d5db',
                    fontSize: '13px',
                    boxSizing: 'border-box',
                    outline: 'none'
                  }}
                />
              </div>

              <button
                type="submit"
                disabled={loading}
                style={{
                  marginTop: '8px',
                  width: '100%',
                  padding: '12px',
                  background: '#047857',
                  color: '#ffffff',
                  border: 'none',
                  borderRadius: '8px',
                  fontWeight: 700,
                  fontSize: '13px',
                  cursor: loading ? 'not-allowed' : 'pointer',
                  opacity: loading ? 0.7 : 1,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '8px'
                }}
              >
                {loading ? 'Validando autenticação...' : 'Entrar no Administra'}
              </button>

              <div style={{ marginTop: '8px', textAlign: 'center', fontSize: '12px', color: '#6b7280' }}>
                Primeiro acesso institucional?{' '}
                <button
                  type="button"
                  onClick={() => {
                    setTab('request');
                    setErrorMsg(null);
                    setSuccessMsg(null);
                  }}
                  style={{
                    background: 'none',
                    border: 'none',
                    color: '#047857',
                    fontWeight: 700,
                    cursor: 'pointer',
                    padding: 0
                  }}
                >
                  Solicitar novo acesso
                </button>
              </div>
            </form>
          )}

          {/* ABA 2: SOLICITAR NOVO ACESSO */}
          {tab === 'request' && (
            <form onSubmit={handleRequestSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <div
                style={{
                  background: '#f0fdf4',
                  border: '1px solid #bbf7d0',
                  borderRadius: '8px',
                  padding: '10px 12px',
                  fontSize: '11px',
                  color: '#166534',
                  lineHeight: '1.4'
                }}
              >
                <strong>Importante:</strong> Se não definir uma senha, será usada a senha inicial <code>@12345</code>, com troca obrigatória no primeiro acesso. O papel/função de acesso é determinado exclusivamente pela administração na aprovação.
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: '10px' }}>
                <div>
                  <label style={{ display: 'block', fontSize: '11px', fontWeight: 600, color: '#374151', marginBottom: '2px' }}>
                    Nome completo *
                  </label>
                  <input
                    type="text"
                    required
                    value={reqNome}
                    onChange={e => setReqNome(e.target.value)}
                    placeholder="Ex.: Carlos Eduardo da Silva"
                    disabled={loading}
                    style={{
                      width: '100%',
                      padding: '8px 10px',
                      borderRadius: '6px',
                      border: '1px solid #d1d5db',
                      fontSize: '12px',
                      boxSizing: 'border-box'
                    }}
                  />
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                  <div>
                    <label style={{ display: 'block', fontSize: '11px', fontWeight: 600, color: '#374151', marginBottom: '2px' }}>
                      Matrícula funcional *
                    </label>
                    <input
                      type="text"
                      required
                      value={reqMatricula}
                      onChange={e => setReqMatricula(e.target.value)}
                      placeholder="Ex.: 248910"
                      disabled={loading}
                      style={{
                        width: '100%',
                        padding: '8px 10px',
                        borderRadius: '6px',
                        border: '1px solid #d1d5db',
                        fontSize: '12px',
                        boxSizing: 'border-box'
                      }}
                    />
                  </div>
                  <div>
                    <label style={{ display: 'block', fontSize: '11px', fontWeight: 600, color: '#374151', marginBottom: '2px' }}>
                      Login desejado
                    </label>
                    <input
                      type="text"
                      value={reqLogin}
                      onChange={e => setReqLogin(e.target.value)}
                      placeholder="Ex.: carlos.silva"
                      disabled={loading}
                      style={{
                        width: '100%',
                        padding: '8px 10px',
                        borderRadius: '6px',
                        border: '1px solid #d1d5db',
                        fontSize: '12px',
                        boxSizing: 'border-box'
                      }}
                    />
                  </div>
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: '11px', fontWeight: 600, color: '#374151', marginBottom: '2px' }}>
                    E-mail institucional (@sema.mt.gov.br) *
                  </label>
                  <input
                    type="email"
                    required
                    value={reqEmail}
                    onChange={e => setReqEmail(e.target.value)}
                    placeholder="carlos.silva@sema.mt.gov.br"
                    disabled={loading}
                    style={{
                      width: '100%',
                      padding: '8px 10px',
                      borderRadius: '6px',
                      border: '1px solid #d1d5db',
                      fontSize: '12px',
                      boxSizing: 'border-box'
                    }}
                  />
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                  <div>
                    <label style={{ display: 'block', fontSize: '11px', fontWeight: 600, color: '#374151', marginBottom: '2px' }}>
                      Perfil profissional *
                    </label>
                    <select
                      value={reqPerfil}
                      onChange={e => setReqPerfil(e.target.value)}
                      disabled={loading}
                      style={{
                        width: '100%',
                        padding: '8px 10px',
                        borderRadius: '6px',
                        border: '1px solid #d1d5db',
                        fontSize: '12px',
                        background: '#ffffff',
                        boxSizing: 'border-box'
                      }}
                    >
                      {PERFIS_PROFISSIONAIS.map(p => (
                        <option key={p} value={p}>
                          {p}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label style={{ display: 'block', fontSize: '11px', fontWeight: 600, color: '#374151', marginBottom: '2px' }}>
                      Setor de lotação *
                    </label>
                    <select
                      value={reqSetor}
                      onChange={e => setReqSetor(e.target.value)}
                      disabled={loading}
                      style={{
                        width: '100%',
                        padding: '8px 10px',
                        borderRadius: '6px',
                        border: '1px solid #d1d5db',
                        fontSize: '12px',
                        background: '#ffffff',
                        boxSizing: 'border-box'
                      }}
                    >
                      {SETORES.map(s => (
                        <option key={s} value={s}>
                          {s}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: '11px', fontWeight: 600, color: '#374151', marginBottom: '2px' }}>
                    Senha de acesso (opcional · mín. 6 caracteres)
                  </label>
                  <input
                    type="password"
                    value={reqSenha}
                    onChange={e => setReqSenha(e.target.value)}
                    placeholder="Deixe em branco para usar a inicial @12345"
                    disabled={loading}
                    style={{
                      width: '100%',
                      padding: '8px 10px',
                      borderRadius: '6px',
                      border: '1px solid #d1d5db',
                      fontSize: '12px',
                      boxSizing: 'border-box'
                    }}
                  />
                </div>
              </div>

              <div style={{ display: 'flex', gap: '8px', marginTop: '10px' }}>
                <button
                  type="button"
                  onClick={() => setTab('login')}
                  disabled={loading}
                  style={{
                    padding: '10px 14px',
                    background: '#f3f4f6',
                    color: '#374151',
                    border: '1px solid #d1d5db',
                    borderRadius: '6px',
                    fontSize: '12px',
                    fontWeight: 600,
                    cursor: 'pointer'
                  }}
                >
                  Voltar
                </button>
                <button
                  type="submit"
                  disabled={loading}
                  style={{
                    flex: 1,
                    padding: '10px 14px',
                    background: '#047857',
                    color: '#ffffff',
                    border: 'none',
                    borderRadius: '6px',
                    fontSize: '12px',
                    fontWeight: 700,
                    cursor: loading ? 'not-allowed' : 'pointer',
                    opacity: loading ? 0.7 : 1
                  }}
                >
                  {loading ? 'Registrando...' : 'Enviar solicitação de acesso'}
                </button>
              </div>
            </form>
          )}

          {/* ABA 3: RECUPERAÇÃO DE SENHA */}
          {tab === 'forgot' && (
            <form onSubmit={handleForgotSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
              <p style={{ fontSize: '12px', color: '#4b5563', margin: 0, lineHeight: '1.4' }}>
                Informe seu e-mail institucional cadastrado. Enviaremos um link de recuperação para você redefinir sua senha.
              </p>

              <div>
                <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: '#374151', marginBottom: '4px' }}>
                  E-mail institucional cadastrado *
                </label>
                <input
                  type="email"
                  required
                  value={forgotEmail}
                  onChange={e => setForgotEmail(e.target.value)}
                  placeholder="usuario@sema.mt.gov.br"
                  disabled={loading}
                  style={{
                    width: '100%',
                    padding: '10px 12px',
                    borderRadius: '8px',
                    border: '1px solid #d1d5db',
                    fontSize: '13px',
                    boxSizing: 'border-box'
                  }}
                />
              </div>

              <div style={{ display: 'flex', gap: '8px', marginTop: '6px' }}>
                <button
                  type="button"
                  onClick={() => setTab('login')}
                  disabled={loading}
                  style={{
                    padding: '10px 14px',
                    background: '#f3f4f6',
                    color: '#374151',
                    border: '1px solid #d1d5db',
                    borderRadius: '8px',
                    fontSize: '12px',
                    fontWeight: 600,
                    cursor: 'pointer'
                  }}
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={loading}
                  style={{
                    flex: 1,
                    padding: '10px 14px',
                    background: '#047857',
                    color: '#ffffff',
                    border: 'none',
                    borderRadius: '8px',
                    fontSize: '12px',
                    fontWeight: 700,
                    cursor: loading ? 'not-allowed' : 'pointer'
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
            background: '#f9fafb',
            padding: '12px 28px',
            borderTop: '1px solid #f3f4f6',
            textAlign: 'center',
            fontSize: '11px',
            color: '#6b7280'
          }}
        >
          Acesso restrito a servidores autorizados
        </div>
      </div>
    </div>
  );
}
