import React, { useState } from 'react';
import {
  authService,
  MIN_PASSWORD_LENGTH,
  type CompletePasswordChangeResult
} from '../services/authService';
import type { AuthUserProfile } from '../types/auth';

export function validateForcePasswordChangeInput(
  newPassword: string,
  confirmPassword: string,
  currentPassword?: string,
  mode: 'forced' | 'recovery' = 'forced'
): string | null {
  if (mode === 'forced' && !currentPassword) {
    return 'Informe a senha atual.';
  }
  if (!newPassword || !confirmPassword) {
    return 'Preencha e confirme a nova senha.';
  }
  if (mode === 'forced' && currentPassword && newPassword === currentPassword) {
    return 'A nova senha deve ser diferente da senha atual.';
  }
  if (newPassword !== confirmPassword) {
    return 'A confirmação da nova senha não confere.';
  }
  if (newPassword.length < MIN_PASSWORD_LENGTH) {
    return `A nova senha deve atender à política mínima de segurança (ao menos ${MIN_PASSWORD_LENGTH} caracteres).`;
  }
  return null;
}

interface ForcePasswordChangePageProps {
  profile: AuthUserProfile;
  mode?: 'forced' | 'recovery';
  onPasswordChanged: (updatedProfile: AuthUserProfile) => void;
  onLogout: () => Promise<void> | void;
  submitPasswordChange?: (
    newPassword: string,
    confirmPassword: string,
    currentPassword?: string
  ) => Promise<CompletePasswordChangeResult>;
}

export function ForcePasswordChangePage({
  profile,
  mode = 'forced',
  onPasswordChanged,
  onLogout,
  submitPasswordChange
}: ForcePasswordChangePageProps) {
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showCurrentPassword, setShowCurrentPassword] = useState(false);
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);

    const validationError = validateForcePasswordChangeInput(
      newPassword,
      confirmPassword,
      currentPassword,
      mode
    );
    if (validationError) {
      setErrorMsg(validationError);
      return;
    }

    setLoading(true);
    try {
      const executor =
        submitPasswordChange ||
        ((pwd: string, confirmPwd: string, curPwd?: string) =>
          mode === 'recovery'
            ? authService.completeRecoveryPasswordChange(pwd, confirmPwd)
            : authService.completeFirstAccessPasswordChange(String(curPwd || ''), pwd, confirmPwd));
      const res = await executor(newPassword, confirmPassword, currentPassword);
      if (!res.success || !res.profile || res.profile.forcePasswordChange) {
        setErrorMsg(
          res.error || 'Não foi possível concluir a alteração obrigatória de senha.'
        );
        return;
      }

      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      onPasswordChanged(res.profile);
    } catch (err: any) {
      setErrorMsg(err?.message || 'Falha ao atualizar a senha.');
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
          maxWidth: '450px',
          background: '#ffffff',
          borderRadius: '20px',
          boxShadow: '0 25px 60px -15px rgba(0, 0, 0, 0.65)',
          overflow: 'hidden'
        }}
      >
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
            {mode === 'recovery'
              ? 'SEMA-MT · SURH · REDEFINIÇÃO DE SENHA'
              : 'SEMA-MT · SURH · TROCA OBRIGATÓRIA DE SENHA'}
          </span>
        </div>

        <div style={{ padding: '30px 30px 26px' }}>
          <div style={{ textAlign: 'center', marginBottom: '20px' }}>
            <div
              style={{
                width: '56px',
                height: '56px',
                borderRadius: '16px',
                background: '#f0f4f8',
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                padding: '6px',
                marginBottom: '14px',
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
                fontSize: '18px',
                fontWeight: 800,
                letterSpacing: '0.04em',
                color: '#0a192f',
                textTransform: 'uppercase'
              }}
            >
              Definição de Nova Senha
            </h1>

            <p
              style={{
                margin: 0,
                fontSize: '12px',
                color: '#475569',
                lineHeight: '1.5'
              }}
            >
              {mode === 'recovery' ? (
                <>
                  Olá, <strong>{profile.nome || 'servidor'}</strong>. Defina uma nova senha pessoal para concluir a recuperação da sua conta.
                </>
              ) : (
                <>
                  Olá, <strong>{profile.nome || 'servidor'}</strong>. Por segurança, defina uma nova senha pessoal antes de acessar o sistema.
                </>
              )}
            </p>
          </div>

          <div
            style={{
              marginBottom: '18px',
              padding: '10px 14px',
              background: '#fef9c3',
              border: '1px solid #fef08a',
              borderRadius: '8px',
              fontSize: '11.5px',
              color: '#854d0e',
              lineHeight: '1.45'
            }}
          >
            {mode === 'recovery'
              ? `Informe uma nova senha com no mínimo ${MIN_PASSWORD_LENGTH} caracteres e demais requisitos de segurança configurados para acessar o sistema.`
              : `O acesso aos módulos do sistema permanece bloqueado até a confirmação da nova senha com no mínimo ${MIN_PASSWORD_LENGTH} caracteres e demais requisitos de segurança configurados.`}
          </div>

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

          <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            {mode === 'forced' && (
              <div>
                <label
                  htmlFor="force-current-password-input"
                  style={{
                    display: 'block',
                    fontSize: '13px',
                    fontWeight: 600,
                    color: '#334155',
                    marginBottom: '6px'
                  }}
                >
                  Senha atual / temporária *
                </label>
                <div style={{ position: 'relative' }}>
                  <input
                    id="force-current-password-input"
                    type={showCurrentPassword ? 'text' : 'password'}
                    required
                    autoComplete="current-password"
                    value={currentPassword}
                    onChange={e => setCurrentPassword(e.target.value)}
                    placeholder="Informe a senha recebida ou atual"
                    disabled={loading}
                    style={{
                      width: '100%',
                      height: '46px',
                      padding: '10px 44px 10px 14px',
                      borderRadius: '10px',
                      border: '1.5px solid #cbd5e1',
                      fontSize: '13.5px',
                      color: '#1e293b',
                      boxSizing: 'border-box',
                      outline: 'none'
                    }}
                  />
                  <button
                    type="button"
                    onClick={() => setShowCurrentPassword(v => !v)}
                    style={{
                      position: 'absolute',
                      right: '12px',
                      top: '50%',
                      transform: 'translateY(-50%)',
                      background: 'none',
                      border: 'none',
                      cursor: 'pointer',
                      color: showCurrentPassword ? '#00875a' : '#64748b',
                      fontSize: '11px',
                      fontWeight: 600
                    }}
                  >
                    {showCurrentPassword ? 'Ocultar' : 'Ver'}
                  </button>
                </div>
              </div>
            )}
            <div>
              <label
                htmlFor="force-new-password-input"
                style={{
                  display: 'block',
                  fontSize: '13px',
                  fontWeight: 600,
                  color: '#334155',
                  marginBottom: '6px'
                }}
              >
                Nova senha (mínimo de {MIN_PASSWORD_LENGTH} caracteres) *
              </label>
              <div style={{ position: 'relative' }}>
                <input
                  id="force-new-password-input"
                  type={showNewPassword ? 'text' : 'password'}
                  required
                  minLength={MIN_PASSWORD_LENGTH}
                  autoComplete="new-password"
                  value={newPassword}
                  onChange={e => setNewPassword(e.target.value)}
                  placeholder={`Mínimo de ${MIN_PASSWORD_LENGTH} caracteres`}
                  disabled={loading}
                  style={{
                    width: '100%',
                    height: '46px',
                    padding: '10px 44px 10px 14px',
                    borderRadius: '10px',
                    border: '1.5px solid #cbd5e1',
                    fontSize: '13.5px',
                    color: '#1e293b',
                    boxSizing: 'border-box',
                    outline: 'none'
                  }}
                />
                <button
                  type="button"
                  onClick={() => setShowNewPassword(v => !v)}
                  style={{
                    position: 'absolute',
                    right: '12px',
                    top: '50%',
                    transform: 'translateY(-50%)',
                    background: 'none',
                    border: 'none',
                    cursor: 'pointer',
                    color: showNewPassword ? '#00875a' : '#64748b',
                    fontSize: '11px',
                    fontWeight: 600
                  }}
                >
                  {showNewPassword ? 'Ocultar' : 'Ver'}
                </button>
              </div>
            </div>

            <div>
              <label
                htmlFor="force-confirm-password-input"
                style={{
                  display: 'block',
                  fontSize: '13px',
                  fontWeight: 600,
                  color: '#334155',
                  marginBottom: '6px'
                }}
              >
                Confirmar nova senha *
              </label>
              <div style={{ position: 'relative' }}>
                <input
                  id="force-confirm-password-input"
                  type={showConfirmPassword ? 'text' : 'password'}
                  required
                  minLength={MIN_PASSWORD_LENGTH}
                  autoComplete="new-password"
                  value={confirmPassword}
                  onChange={e => setConfirmPassword(e.target.value)}
                  placeholder="Repita a nova senha"
                  disabled={loading}
                  style={{
                    width: '100%',
                    height: '46px',
                    padding: '10px 44px 10px 14px',
                    borderRadius: '10px',
                    border: '1.5px solid #cbd5e1',
                    fontSize: '13.5px',
                    color: '#1e293b',
                    boxSizing: 'border-box',
                    outline: 'none'
                  }}
                />
                <button
                  type="button"
                  onClick={() => setShowConfirmPassword(v => !v)}
                  style={{
                    position: 'absolute',
                    right: '12px',
                    top: '50%',
                    transform: 'translateY(-50%)',
                    background: 'none',
                    border: 'none',
                    cursor: 'pointer',
                    color: showConfirmPassword ? '#00875a' : '#64748b',
                    fontSize: '11px',
                    fontWeight: 600
                  }}
                >
                  {showConfirmPassword ? 'Ocultar' : 'Ver'}
                </button>
              </div>
            </div>

            <div style={{ display: 'flex', gap: '10px', marginTop: '6px' }}>
              <button
                type="button"
                onClick={onLogout}
                disabled={loading}
                style={{
                  padding: '12px 16px',
                  background: '#f1f5f9',
                  color: '#334155',
                  border: '1px solid #cbd5e1',
                  borderRadius: '10px',
                  fontSize: '13px',
                  fontWeight: 600,
                  cursor: loading ? 'not-allowed' : 'pointer'
                }}
              >
                Sair
              </button>

              <button
                type="submit"
                disabled={loading}
                style={{
                  flex: 1,
                  height: '46px',
                  padding: '12px',
                  background: '#00875a',
                  color: '#ffffff',
                  border: 'none',
                  borderRadius: '10px',
                  fontWeight: 700,
                  fontSize: '14px',
                  cursor: loading ? 'not-allowed' : 'pointer',
                  opacity: loading ? 0.65 : 1,
                  boxShadow: '0 4px 12px rgba(0, 135, 90, 0.25)'
                }}
              >
                {loading ? 'Atualizando senha...' : 'Salvar nova senha e acessar'}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
