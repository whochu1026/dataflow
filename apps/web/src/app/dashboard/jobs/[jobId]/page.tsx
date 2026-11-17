'use client';

import Link from 'next/link';
import { FormEvent, useCallback, useEffect, useRef, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { AppHeader } from '@/components/AppHeader';
import { API_URL, api, downloadAuthed, User } from '@/lib/api';

type SchemaField = {
  key: string;
  label: string;
  type: string;
  required: boolean;
  unique?: boolean;
};

type Job = {
  id: string;
  originalName: string;
  status: string;
  fileKind?: string;
  delimiter?: string;
  headers: string[];
  mapping: Record<string, string> | null;
  totalRows: number;
  processedRows: number;
  successRows: number;
  failedRows: number;
  duplicateRows: number;
  progress: number;
  errorMessage?: string | null;
};

type ErrRow = {
  id: string;
  rowNumber: number;
  field: string | null;
  code: string;
  message: string;
};

type PreviewRow = {
  rowNumber: number;
  mapped: Record<string, string | undefined>;
  issues: Array<{ field: string | null; code: string; message: string }>;
};

function statusClass(status: string) {
  if (status === 'COMPLETED') return 'status-ok';
  if (status === 'FAILED' || status === 'CANCELLED') return 'status-err';
  if (status === 'PROCESSING' || status === 'QUEUED') return 'status-warn';
  return 'status-muted';
}

export default function JobDetailPage() {
  const { jobId } = useParams<{ jobId: string }>();
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const [job, setJob] = useState<Job | null>(null);
  const [fields, setFields] = useState<SchemaField[]>([]);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [errors, setErrors] = useState<ErrRow[]>([]);
  const [errorTotal, setErrorTotal] = useState(0);
  const [errorPage, setErrorPage] = useState(1);
  const [preview, setPreview] = useState<PreviewRow[]>([]);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const mappingInit = useRef(false);

  const loadErrors = useCallback(
    async (page: number) => {
      const err = await api<{ items: ErrRow[]; total: number }>(
        `/jobs/${jobId}/errors?page=${page}&pageSize=20`,
      );
      setErrors(err.items);
      setErrorTotal(err.total);
      setErrorPage(page);
    },
    [jobId],
  );

  const refresh = useCallback(async () => {
    const [me, j, schema] = await Promise.all([
      api<User>('/auth/me'),
      api<Job>(`/jobs/${jobId}`),
      api<SchemaField[]>('/jobs/schema-fields'),
    ]);
    setUser(me);
    setJob(j);
    setFields(schema);
    if (j.mapping) {
      setMapping(j.mapping);
      mappingInit.current = true;
    } else if (!mappingInit.current) {
      const auto: Record<string, string> = {};
      for (const f of schema) {
        const hit = (j.headers || []).find(
          (h) =>
            h.toLowerCase().replace(/\s+/g, '_') === f.key ||
            h.toLowerCase() === f.label.toLowerCase(),
        );
        if (hit) auto[f.key] = hit;
      }
      setMapping(auto);
      mappingInit.current = true;
    }
    if (['COMPLETED', 'FAILED', 'CANCELLED', 'PROCESSING'].includes(j.status)) {
      await loadErrors(errorPage);
    }
  }, [jobId, loadErrors, errorPage]);

  useEffect(() => {
    refresh().catch(() => router.replace('/'));
    // initial load only when jobId changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobId, router]);

  useEffect(() => {
    if (!job) return;
    if (!['QUEUED', 'PROCESSING'].includes(job.status)) return;
    const token = localStorage.getItem('df_token');
    if (!token) return;
    const es = new EventSource(
      `${API_URL}/jobs/${jobId}/events?access_token=${encodeURIComponent(token)}`,
    );
    es.onmessage = (ev) => {
      try {
        const j = JSON.parse(ev.data) as Job;
        setJob(j);
        if (['COMPLETED', 'FAILED', 'CANCELLED'].includes(j.status)) {
          es.close();
          loadErrors(1).catch(() => undefined);
        }
      } catch {
        /* ignore */
      }
    };
    es.onerror = () => {
      // fallback poll once on SSE failure
      api<Job>(`/jobs/${jobId}`).then(setJob).catch(() => undefined);
    };
    return () => es.close();
  }, [job?.status, jobId, loadErrors]);

  async function saveMapping(e: FormEvent) {
    e.preventDefault();
    setError('');
    try {
      await api(`/jobs/${jobId}/mapping`, {
        method: 'POST',
        body: JSON.stringify({ mapping }),
      });
      setMessage('Mapping saved');
      const j = await api<Job>(`/jobs/${jobId}`);
      setJob(j);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed');
    }
  }

  async function runPreview() {
    setError('');
    try {
      await api(`/jobs/${jobId}/mapping`, {
        method: 'POST',
        body: JSON.stringify({ mapping }),
      });
      const res = await api<{ rows: PreviewRow[] }>(`/jobs/${jobId}/preview?limit=5`, {
        method: 'POST',
      });
      setPreview(res.rows);
      setMessage('Preview ready (first 5 rows)');
      setJob(await api<Job>(`/jobs/${jobId}`));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Preview failed');
    }
  }

  async function start() {
    setError('');
    try {
      const j = await api<Job>(`/jobs/${jobId}/start`, { method: 'POST' });
      setJob(j);
      setMessage('Queued for processing');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed');
    }
  }

  async function cancel() {
    const j = await api<Job>(`/jobs/${jobId}/cancel`, { method: 'POST' });
    setJob(j);
    setMessage('Cancel requested');
  }

  async function removeJob() {
    if (!confirm('Delete this job?')) return;
    await api(`/jobs/${jobId}`, { method: 'DELETE' });
    router.push('/dashboard');
  }

  if (!job) {
    return (
      <main className="shell">
        <p className="muted">Loading…</p>
      </main>
    );
  }

  const canMap = ['UPLOADED', 'MAPPED', 'FAILED', 'CANCELLED'].includes(job.status);
  const canStart = ['MAPPED', 'FAILED', 'CANCELLED', 'COMPLETED'].includes(job.status);
  const canCancel = ['QUEUED', 'PROCESSING'].includes(job.status);
  const errorPages = Math.max(1, Math.ceil(errorTotal / 20));

  return (
    <main className="shell fade-up">
      <AppHeader email={user?.email} />
      <Link href="/dashboard" className="crumb">
        ← Jobs
      </Link>
      <h1 className="page-title mono">{job.originalName}</h1>
      <p className="page-desc">
        <span className={`status ${statusClass(job.status)}`}>{job.status}</span>
        <span className="muted">
          {' '}
          · {job.fileKind || 'csv'}
          {job.delimiter && job.fileKind !== 'xlsx' ? ` · delim "${job.delimiter}"` : ''} ·{' '}
          {job.totalRows || '—'} rows
        </span>
      </p>

      {(message || error || job.errorMessage) && (
        <p
          className={
            error || (job.errorMessage && (job.status === 'FAILED' || job.status === 'CANCELLED'))
              ? 'alert-err'
              : 'alert-ok'
          }
          style={{ marginTop: 16 }}
        >
          {error ||
            (job.status === 'FAILED' || job.status === 'CANCELLED' ? job.errorMessage : null) ||
            message}
        </p>
      )}

      <section style={{ marginTop: 28 }}>
        <h2 className="section-title">Progress</h2>
        <p className="section-sub">fail = validation only · dup = duplicates (별도 집계)</p>
        <div className="progress">
          <span style={{ width: `${job.progress || 0}%` }} />
        </div>
        <div className="stats-row">
          <div className="stat">
            <b>{job.progress}%</b>
            <span>done</span>
          </div>
          <div className="stat">
            <b>{job.successRows}</b>
            <span>ok</span>
          </div>
          <div className="stat">
            <b>{job.failedRows}</b>
            <span>validation fail</span>
          </div>
          <div className="stat">
            <b>{job.duplicateRows}</b>
            <span>dup</span>
          </div>
        </div>
        <div className="actions-row" style={{ marginTop: 16 }}>
          {canCancel && (
            <button type="button" className="btn btn-ghost" onClick={cancel}>
              Cancel
            </button>
          )}
          {job.successRows > 0 && (
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() =>
                downloadAuthed(`/jobs/${jobId}/records.csv`, `job-${jobId}-records.csv`)
              }
            >
              Download success CSV
            </button>
          )}
          {errorTotal > 0 && (
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() =>
                downloadAuthed(`/jobs/${jobId}/errors.csv`, `job-${jobId}-errors.csv`)
              }
            >
              Download errors CSV
            </button>
          )}
          <button type="button" className="btn btn-ghost" onClick={removeJob} disabled={canCancel}>
            Delete job
          </button>
        </div>
      </section>

      <div className="split-grid" style={{ marginTop: 36 }}>
        <section>
          <h2 className="section-title">Column mapping</h2>
          <p className="section-sub">시스템 필드와 파일 컬럼을 연결합니다.</p>
          <form onSubmit={saveMapping} className="form-stack">
            {fields.map((f) => (
              <div className="field" key={f.key}>
                <label>
                  {f.label}
                  {f.required ? ' *' : ''}
                  {f.unique ? ' · unique' : ''} · {f.type}
                </label>
                <select
                  value={mapping[f.key] || ''}
                  disabled={!canMap}
                  onChange={(e) =>
                    setMapping((m) => ({ ...m, [f.key]: e.target.value }))
                  }
                >
                  <option value="">— skip —</option>
                  {(job.headers || []).map((h) => (
                    <option key={h} value={h}>
                      {h}
                    </option>
                  ))}
                </select>
              </div>
            ))}
            <div className="actions-row">
              <button className="btn btn-ink" type="submit" disabled={!canMap}>
                Save mapping
              </button>
              <button
                className="btn btn-ghost"
                type="button"
                disabled={!canMap}
                onClick={runPreview}
              >
                Preview 5 rows
              </button>
              <button className="btn" type="button" disabled={!canStart} onClick={start}>
                Start processing
              </button>
            </div>
          </form>

          {preview.length > 0 && (
            <div style={{ marginTop: 20 }}>
              <h3 className="section-title">Preview</h3>
              <table className="table">
                <thead>
                  <tr>
                    <th>Row</th>
                    <th>Mapped</th>
                    <th>Issues</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.map((p) => (
                    <tr key={p.rowNumber}>
                      <td className="mono">{p.rowNumber}</td>
                      <td className="mono" style={{ fontSize: 11 }}>
                        {JSON.stringify(p.mapped)}
                      </td>
                      <td>
                        {p.issues.length === 0 ? (
                          <span className="status status-ok">OK</span>
                        ) : (
                          p.issues.map((i) => i.code).join(', ')
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section>
          <h2 className="section-title">Error report</h2>
          <p className="section-sub">
            {errorTotal} issues · page {errorPage}/{errorPages}
          </p>
          {errors.length === 0 ? (
            <p className="muted" style={{ margin: 0, fontSize: 14 }}>
              No errors yet.
            </p>
          ) : (
            <>
              <table className="table">
                <thead>
                  <tr>
                    <th>Row</th>
                    <th>Code</th>
                    <th>Message</th>
                  </tr>
                </thead>
                <tbody>
                  {errors.map((e) => (
                    <tr key={e.id}>
                      <td className="mono">{e.rowNumber}</td>
                      <td className="mono">{e.code}</td>
                      <td>
                        {e.message}
                        {e.field ? (
                          <div className="muted mono" style={{ fontSize: 11 }}>
                            {e.field}
                          </div>
                        ) : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="actions-row" style={{ marginTop: 12 }}>
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  disabled={errorPage <= 1}
                  onClick={() => loadErrors(errorPage - 1)}
                >
                  Prev
                </button>
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  disabled={errorPage >= errorPages}
                  onClick={() => loadErrors(errorPage + 1)}
                >
                  Next
                </button>
              </div>
            </>
          )}
        </section>
      </div>
    </main>
  );
}
