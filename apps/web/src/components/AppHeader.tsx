'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { setToken } from '@/lib/api';

export function AppHeader({ email }: { email?: string }) {
  const router = useRouter();

  function logout() {
    setToken(null);
    router.push('/');
  }

  return (
    <header className="topbar">
      <Link href="/dashboard" className="brand">
        Data<span>Flow</span>
      </Link>
      <div className="topbar-right">
        {email && <span className="muted" style={{ fontSize: 13 }}>{email}</span>}
        {email && (
          <button type="button" className="btn btn-ghost btn-sm" onClick={logout}>
            Log out
          </button>
        )}
      </div>
    </header>
  );
}
