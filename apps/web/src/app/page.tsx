'use client';

import Link from 'next/link';
import { FormEvent, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, setToken } from '@/lib/api';

export default function HomePage() {
  const router = useRouter();
  const [email, setEmail] = useState('demo@dataflow.test');
  const [password, setPassword] = useState('password123');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function login(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const res = await api<{ accessToken: string }>('/auth/login', {
        method: 'POST',
        auth: false,
        body: JSON.stringify({ email, password }),
      });
      setToken(res.accessToken);
      router.push('/dashboard');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed');
    } finally {
      setBusy(false);
    }
  }

  async function demo() {
    setBusy(true);
    setError('');
    try {
      const res = await api<{ accessToken: string }>('/auth/demo', {
        method: 'POST',
        auth: false,
      });
      setToken(res.accessToken);
      router.push('/dashboard');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Demo failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="shell shell-home">
      <header className="topbar topbar-home fade-up">
        <div className="brand">
          Data<span>Flow</span>
        </div>
        <div className="topbar-right">
          <button type="button" className="btn btn-sm" onClick={demo} disabled={busy}>
            Demo
          </button>
          <Link href="/register" className="btn btn-ghost btn-sm">
            회원가입
          </Link>
        </div>
      </header>

      <div className="landing">
        <section className="landing-copy fade-up">
          <h1 className="hero-brand">
            Data<span>Flow</span>
          </h1>
          <p className="hero-line">
            복잡한 데이터 업로드와 검증 작업을 자동화하세요.
          </p>

          <form onSubmit={login} className="form-stack auth-form">
            <div className="field">
              <label>Email</label>
              <input value={email} onChange={(e) => setEmail(e.target.value)} />
            </div>
            <div className="field">
              <label>Password</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>
            {error && <p className="alert-err">{error}</p>}
            <button className="btn btn-ink" type="submit" disabled={busy}>
              Log in
            </button>
          </form>
        </section>

        <aside className="hero-visual" aria-hidden>
          <div className="hero-sheet">
            <strong>orders.csv · validation</strong>
            <div className="ok">row 1  email OK</div>
            <div className="ok">row 2  amount OK</div>
            <div className="bad">row 3  INVALID_EMAIL</div>
            <div className="bad">row 4  DUPLICATE_IN_FILE</div>
            <div>batch 500 · streaming</div>
          </div>
        </aside>
      </div>
    </main>
  );
}
