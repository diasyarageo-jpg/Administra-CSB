import React, { useEffect, useState } from 'react';
import {
  authService,
  MIN_PASSWORD_LENGTH,
  type ChangeOwnPasswordResult,
  type ResetOwnPasswordResult
} from '../services/authService';
import type { AuthUserProfile } from '../types/auth';

export const DEFAULT_RESET_CONFIRMATION_MESSAGE =
  'Sua senha será redefinida e você terá que criar uma nova no próximo acesso';

export function validateChangeOwnPasswordInput(
  currentPassword: string,
  newPassword: string,
  confirmPassword: string
): string | null {
  if (!currentPassword) {
    return 'Informe a senha atual.';
  }
  if (!newPassword || newPassword.length < MIN_PASSWORD_LENGTH) {
    return `A nova senha deve ter no mínimo ${MIN_PASSWORD_LENGTH} caracteres.`;
  }
  if (newPassword === currentPassword) {
    return 'A nova senha deve ser diferente da senha atual.';
  }
  if (newPassword !== confirmPassword) {
    return 'A confirmação da nova senha não confere.';
  }
  return null;
}

interface ChangeOwnPasswordModalProps {
  isOpen: boolean;
  profile: AuthUserProfile | null;
  onClose: () => void;
  onPasswordChanged?: (updatedProfile: AuthUserProfile | null) => void;
  onDefaultResetSuccess?: (message: string) => void;
  onChangePassword?: (
    currentPassword: string,
    newPassword: string,
    confirmPassword: string
  ) => Promise<ChangeOwnPasswordResult>;
  onResetToDefault?: () => Promise<ResetOwnPasswordResult>;
}

export function ChangeOwnPasswordModal({
  isOpen,
  profile,
  onClose,
  onPasswordChanged,
  onDefaultResetSuccess,
  onChangePassword,
  onResetToDefault
}: ChangeOwnPasswordModalProps) {
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showCurrentPassword, setShowCurrentPassword] = useState(false);
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [resetLoading, setResetLoading] = useState(false);
  const [confirmDefaultReset, setConfirmDefaultReset] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const clearFields = () => {
    setCurrentPassword('');
    setNewPassword('');
    setConfirmPassword('');
    setShowCurrentPassword(false);
    setShowNewPassword(false);
    setShowConfirmPassword(false);
    setConfirmDefaultReset(false);
    setErrorMsg(null);
    setSuccessMsg(null);
  };

  useEffect(() => {
    if (!isOpen) {
      clearFields();
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const handleClose = () => {
    if (loading || resetLoading) return;
    clearFields();
    onClose();
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setSuccessMsg(null);

    const validationError = validateChangeOwnPasswordInput(
      currentPassword,
      newPassword,
      confirmPassword
    );
    if (validationError) {
      setErrorMsg(validationError);
      return;
    }

    setLoading(true);
    try {
      const executor =
        onChangePassword ||
        ((cur: string, nextPwd: string, confPwd: string) =>
          authService.changeOwnPassword(cur, nextPwd, confPwd, {
            forcePasswordChange: profile?.forcePasswordChange
          }));

      const res = await executor(currentPassword, newPassword, confirmPassword);
      if (!res.success) {
        setErrorMsg(res.error || 'Não foi possível alterar a senha.');
        return;
      }

      clearFields();
      onPasswordChanged?.(res.profile ?? null);
      onClose();
    } catch {
      setErrorMsg('Não foi possível alterar a senha.');
    } finally {
      setLoading(false);
    }
  };

  const handleConfirmDefaultReset = async () => {
    setErrorMsg(null);
    setSuccessMsg(null);
    setResetLoading(true);
    try {
      const executor = onResetToDefault || (() => authService.resetOwnPasswordToDefault());
      const res = await executor();
      if (!res.success) {
        setErrorMsg(res.error || 'Não foi possível redefinir a senha para a senha padrão.');
        return;
      }

      const finalMsg =
        res.message || 'Senha redefinida. Entre com a senha padrão e crie uma nova.';
      clearFields();
      onDefaultResetSuccess?.(finalMsg);
      onClose();
    } catch {
      setErrorMsg('Não foi possível redefinir a senha para a senha padrão.');
    } finally {
      setResetLoading(false);
    }
  };

  const busy = loading || resetLoading;

  return (
    <div className="modal-back" role="dialog" aria-modal="true" aria-labelledby="change-own-password-title">
      <div className="modal" style={{ maxWidth: '460px', width: '100%' }}>
        <div className="modal-head">
          <div>
            <h3 id="change-own-password-title" style={{ margin: 0, fontSize: '16px', fontWeight: 700 }}>
              Alterar minha senha
            </h3>
            <p style={{ margin: 0, fontSize: '11px', color: '#64748b' }}>
              {profile?.nome || profile?.login || 'Usuário autenticado'} · Mínimo de {MIN_PASSWORD_LENGTH} caracteres
            </p>
          </div>
          <button
            type="button"
            className="modal-close"
            onClick={handleClose}
            disabled={busy}
            aria-label="Fechar"
          >
            ×
          </button>
        </div>

        <div className="modal-body">
          {errorMsg && (
            <div className="notice red" role="alert" style={{ marginBottom: '14px' }}>
              {errorMsg}
            </div>
          )}

          {successMsg && (
            <div className="notice green" style={{ marginBottom: '14px' }}>
              {successMsg}
            </div>
          )}

          <form onSubmit={handleSubmit}>
            <div className="form-field" style={{ marginBottom: '12px' }}>
              <label htmlFor="own-current-password-input">Senha atual *</label>
              <div style={{ position: 'relative' }}>
                <input
                  id="own-current-password-input"
                  className="input"
                  type={showCurrentPassword ? 'text' : 'password'}
                  autoComplete="current-password"
                  required
                  value={currentPassword}
                  onChange={e => setCurrentPassword(e.target.value)}
                  disabled={busy}
                  style={{ paddingRight: '56px' }}
                />
                <button
                  type="button"
                  onClick={() => setShowCurrentPassword(v => !v)}
                  disabled={busy}
                  style={{
                    position: 'absolute',
                    right: '10px',
                    top: '50%',
                    transform: 'translateY(-50%)',
                    background: 'none',
                    border: 'none',
                    cursor: 'pointer',
                    fontSize: '11px',
                    fontWeight: 600,
                    color: '#475569'
                  }}
                >
                  {showCurrentPassword ? 'Ocultar' : 'Ver'}
                </button>
              </div>
            </div>

            <div className="form-field" style={{ marginBottom: '12px' }}>
              <label htmlFor="own-new-password-input">
                Nova senha (mínimo de {MIN_PASSWORD_LENGTH} caracteres) *
              </label>
              <div style={{ position: 'relative' }}>
                <input
                  id="own-new-password-input"
                  className="input"
                  type={showNewPassword ? 'text' : 'password'}
                  autoComplete="new-password"
                  required
                  minLength={MIN_PASSWORD_LENGTH}
                  value={newPassword}
                  onChange={e => setNewPassword(e.target.value)}
                  placeholder={`Mínimo de ${MIN_PASSWORD_LENGTH} caracteres`}
                  disabled={busy}
                  style={{ paddingRight: '56px' }}
                />
                <button
                  type="button"
                  onClick={() => setShowNewPassword(v => !v)}
                  disabled={busy}
                  style={{
                    position: 'absolute',
                    right: '10px',
                    top: '50%',
                    transform: 'translateY(-50%)',
                    background: 'none',
                    border: 'none',
                    cursor: 'pointer',
                    fontSize: '11px',
                    fontWeight: 600,
                    color: '#475569'
                  }}
                >
                  {showNewPassword ? 'Ocultar' : 'Ver'}
                </button>
              </div>
            </div>

            <div className="form-field" style={{ marginBottom: '16px' }}>
              <label htmlFor="own-confirm-password-input">Confirmar nova senha *</label>
              <div style={{ position: 'relative' }}>
                <input
                  id="own-confirm-password-input"
                  className="input"
                  type={showConfirmPassword ? 'text' : 'password'}
                  autoComplete="new-password"
                  required
                  minLength={MIN_PASSWORD_LENGTH}
                  value={confirmPassword}
                  onChange={e => setConfirmPassword(e.target.value)}
                  disabled={busy}
                  style={{ paddingRight: '56px' }}
                />
                <button
                  type="button"
                  onClick={() => setShowConfirmPassword(v => !v)}
                  disabled={busy}
                  style={{
                    position: 'absolute',
                    right: '10px',
                    top: '50%',
                    transform: 'translateY(-50%)',
                    background: 'none',
                    border: 'none',
                    cursor: 'pointer',
                    fontSize: '11px',
                    fontWeight: 600,
                    color: '#475569'
                  }}
                >
                  {showConfirmPassword ? 'Ocultar' : 'Ver'}
                </button>
              </div>
            </div>

            <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
              <button type="button" className="btn light" onClick={handleClose} disabled={busy}>
                Cancelar
              </button>
              <button type="submit" className="btn green" disabled={busy}>
                {loading ? 'Salvando...' : 'Salvar nova senha'}
              </button>
            </div>
          </form>

          <div
            style={{
              marginTop: '18px',
              paddingTop: '14px',
              borderTop: '1px solid #e2e8f0'
            }}
          >
            {!confirmDefaultReset ? (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px' }}>
                <span style={{ fontSize: '11.5px', color: '#475569' }}>
                  Precisa retornar para a senha padrão institucional?
                </span>
                <button
                  type="button"
                  className="btn soft small"
                  onClick={() => {
                    setErrorMsg(null);
                    setSuccessMsg(null);
                    setConfirmDefaultReset(true);
                  }}
                  disabled={busy}
                >
                  Redefinir para a senha padrão
                </button>
              </div>
            ) : (
              <div
                style={{
                  padding: '12px',
                  borderRadius: '10px',
                  background: '#fffbeb',
                  border: '1px solid #fde68a'
                }}
              >
                <p style={{ margin: '0 0 10px 0', fontSize: '12px', color: '#92400e', fontWeight: 600 }}>
                  {DEFAULT_RESET_CONFIRMATION_MESSAGE}
                </p>
                <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
                  <button
                    type="button"
                    className="btn light small"
                    onClick={() => setConfirmDefaultReset(false)}
                    disabled={busy}
                  >
                    Voltar
                  </button>
                  <button
                    type="button"
                    className="btn amber small"
                    onClick={handleConfirmDefaultReset}
                    disabled={busy}
                  >
                    {resetLoading ? 'Redefinindo...' : 'Confirmar redefinição'}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
