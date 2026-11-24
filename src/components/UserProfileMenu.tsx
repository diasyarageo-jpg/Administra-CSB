import React, { useEffect, useRef, useState } from 'react';
import type { AuthUserProfile, UserRole } from '../types/auth';

interface UserProfileMenuProps {
  profile: AuthUserProfile | null;
  userRole: UserRole;
  onOpenChangePassword: () => void;
  onLogout: () => Promise<void> | void;
  defaultOpen?: boolean;
}

export function UserProfileMenu({
  profile,
  userRole,
  onOpenChangePassword,
  onLogout,
  defaultOpen = false
}: UserProfileMenuProps) {
  const [open, setOpen] = useState(defaultOpen);
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open || typeof document === 'undefined') return;
    const handleOutsideClick = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handleOutsideClick);
    return () => document.removeEventListener('mousedown', handleOutsideClick);
  }, [open]);

  const roleColor =
    userRole === 'Administrador'
      ? '#7c3aed'
      : userRole === 'Analista'
        ? '#0369a1'
        : userRole === 'Usuário'
          ? '#0284c7'
          : '#475569';

  return (
    <div
      ref={containerRef}
      style={{ position: 'relative', display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0 }}
    >
      <button
        type="button"
        className="btn soft small"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen(v => !v)}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          padding: '5px 10px',
          textAlign: 'left'
        }}
      >
        <div
          className="top-user-meta"
          style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', lineHeight: 1.2 }}
        >
          <span className="topname" style={{ fontWeight: 600 }}>
            {profile?.nome || profile?.login || 'Servidor SEMA-MT'}
          </span>
          <span style={{ fontSize: '10px', color: '#64748b', whiteSpace: 'nowrap' }}>
            {profile?.matricula ? (
              <span className="top-user-matricula">Matr. {profile.matricula} · </span>
            ) : null}
            <span style={{ fontWeight: 600, color: roleColor }}>{userRole}</span>
          </span>
        </div>
        <span style={{ fontSize: '10px', color: '#475569' }} aria-hidden="true">
          ▾
        </span>
      </button>

      {open && (
        <div
          role="menu"
          style={{
            position: 'absolute',
            top: 'calc(100% + 6px)',
            right: 0,
            minWidth: '210px',
            background: '#ffffff',
            border: '1px solid #cbd5e1',
            borderRadius: '10px',
            boxShadow: '0 12px 30px rgba(15, 23, 42, 0.14)',
            padding: '6px',
            zIndex: 80,
            display: 'flex',
            flexDirection: 'column',
            gap: '4px'
          }}
        >
          <button
            type="button"
            role="menuitem"
            className="btn soft small"
            style={{ width: '100%', justifyContent: 'flex-start', padding: '8px 10px', fontSize: '12px' }}
            onClick={() => {
              setOpen(false);
              onOpenChangePassword();
            }}
          >
            Alterar minha senha
          </button>
          <button
            type="button"
            role="menuitem"
            className="btn soft small"
            style={{
              width: '100%',
              justifyContent: 'flex-start',
              padding: '8px 10px',
              fontSize: '12px',
              color: '#b91c1c'
            }}
            onClick={async () => {
              setOpen(false);
              await onLogout();
            }}
          >
            Sair
          </button>
        </div>
      )}
    </div>
  );
}
