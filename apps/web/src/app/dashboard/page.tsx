'use client';

import Link from 'next/link';
import { FormEvent, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { AppHeader } from '@/components/AppHeader';
import { api, User } from '@/lib/api';

type Job = {
  id: string;
  originalName: string;
  status: string;
  fileKind?: string;
  totalRows: number;
  successRows: number;
  failedRows: number;
  duplicateRows?: number;
  createdAt: string;
};

function statusClass(status: string) {
  if (status === 'COMPLETED') return 'status-ok';
  if (status === 'FAILED' || status === 'CANCELLED') return 'status-err';
  if (status === 'PROCESSING' || status === 'QUEUED') return 'status-warn';
  return 'status-muted';
}

export default function DashboardPage() {
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);

  async function refreshJobs() {
    setJobs(await api<Job[]>('/jobs'));
  }

  useEffect(() => {
    (async () => {
      try {
        setUser(await api<User>('/auth/me'));
        await refreshJobs();
      } catch {
        router.replace('/');
      } finally {
        setLoading(false);
      }
    })();
  }, [router]);

  async function upload(e: FormEvent) {
    e.preventDefault();
    if (!file) return;
    setUploading(true);
    setError('');
    try {
      const body = new FormData();
      body.append('file', file);
      const job = await api<Job>('/jobs/upload', { method: 'POST', body });
      router.push(`/dashboard/jobs/${job.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setUploading(false);
    }
  }

  async function removeJob(id: string) {
    if (!confirm('Delete this job and its stored file?')) return;
    await api(`/jobs/${id}`, { method: 'DELETE' });
    await refreshJobs();
  }

  if (loading) {
    return (
      <main className="shell">
        <p className="muted">Loading…</p>
      </main>
    );
  }

  return (
    <main className="shell fade-up">
      <AppHeader email={user?.email} />
      <h1 className="page-title">Imports</h1>
      <p className="page-desc">
        CSV/Excel 업로드 → 매핑 → 검증 → 배치 처리까지 한 흐름으로 진행합니다.
      </p>

      <div className="dash-grid" style={{ marginTop: 28 }}>
        <section>
          <h2 className="section-title">Recent jobs</h2>
          <p className="section-sub">클릭하면 매핑과 오류 리포트로 이동합니다.</p>
          {jobs.length === 0 ? (
            <p className="muted" style={{ margin: 0, fontSize: 14 }}>
              아직 업로드한 파일이 없습니다.
            </p>
          ) : (
            <div className="list-stack">
              {jobs.map((j) => (
                <div key={j.id} className="list-row" style={{ display: 'block' }}>
                  <Link href={`/dashboard/jobs/${j.id}`}>
                    <div className="list-row-top">
                      <strong className="mono">{j.originalName}</strong>
                      <span className={`status ${statusClass(j.status)}`}>{j.status}</span>
                    </div>
                    <p className="list-row-desc">
                      {j.fileKind || 'csv'} · {j.totalRows || '—'} rows · {j.successRows} ok ·{' '}
                      {j.failedRows} fail · {j.duplicateRows ?? 0} dup ·{' '}
                      {new Date(j.createdAt).toLocaleString()}
                    </p>
                  </Link>
                  <div className="actions-row" style={{ marginTop: 8 }}>
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      onClick={() => removeJob(j.id)}
                      disabled={j.status === 'QUEUED' || j.status === 'PROCESSING'}
                    >
                      Delete
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="surface surface-pad fade-up-delay">
          <h2 className="section-title">Upload file</h2>
          <p className="section-sub">CSV / Excel · 최대 50MB · disk streaming</p>
          <form onSubmit={upload} className="form-stack">
            <label className={`dropzone ${file ? 'has-file' : ''}`}>
              <input
                type="file"
                accept=".csv,.xlsx,.xls,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                onChange={(e) => setFile(e.target.files?.[0] || null)}
                required
                style={{ display: 'none' }}
              />
              <p>{file ? 'Selected file' : 'Click to choose CSV or Excel'}</p>
              {file && <span className="mono">{file.name}</span>}
            </label>
            {error && <p className="alert-err">{error}</p>}
            <button className="btn" type="submit" disabled={!file || uploading}>
              {uploading ? 'Uploading…' : 'Upload & map'}
            </button>
          </form>
        </section>
      </div>
    </main>
  );
}
