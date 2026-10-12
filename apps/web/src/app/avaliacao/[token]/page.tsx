'use client';
import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';

interface Info { number: number; subject: string; organization: string; rated: boolean }

/** Página pública de satisfação (link enviado ao cliente após a resolução do chamado). */
export default function RatingPage() {
  const { token } = useParams<{ token: string }>();
  const [info, setInfo] = useState<Info | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [score, setScore] = useState(0);
  const [comment, setComment] = useState('');
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => { api<Info>(`/public/avaliacao/${token}`).then(setInfo).catch(() => setError('Avaliação não encontrada ou expirada.')); }, [token]);
  async function submit(): Promise<void> {
    setBusy(true);
    try { await api(`/public/avaliacao/${token}`, { method: 'POST', body: { score, comment: comment || null } }); setSent(true); } catch { setError('Não foi possível registrar a avaliação.'); } finally { setBusy(false); }
  }
  return (
    <main className="login-wrap">
      <div className="lg-card" style={{ maxWidth: 520 }}>
        <img className="lg-logo" src="/logo.png" alt="Siow System" />
        <div className="lg-sub">Avaliação do atendimento</div>
        {error ? <div className="err" role="alert">{error}</div> : !info ? <p className="small muted">Carregando…</p> : sent || info.rated ? (
          <p style={{ textAlign: 'center' }}>Obrigado! Sua avaliação do chamado <b>#{info.number}</b> foi registrada.</p>
        ) : (
          <div>
            <p className="small" style={{ color: 'var(--ink2)' }}>{info.organization} · chamado <b>#{info.number}</b>: {info.subject}</p>
            <p style={{ margin: '12px 0 6px' }}>Como foi o nosso atendimento?</p>
            <div className="row" style={{ justifyContent: 'center', gap: 6, fontSize: 34 }}>{[1, 2, 3, 4, 5].map((n) => <button key={n} type="button" aria-label={`${n} estrela(s)`} onClick={() => setScore(n)} style={{ background: 'none', border: 0, cursor: 'pointer', color: n <= score ? '#f5b301' : 'var(--line)' }}>★</button>)}</div>
            <label className="f">Comentário (opcional)<textarea rows={3} value={comment} onChange={(e) => setComment(e.target.value)} style={{ width: '100%' }} /></label>
            <button className="btn p" type="button" disabled={!score || busy} onClick={() => void submit()}>{busy ? 'Enviando…' : 'Enviar avaliação'}</button>
          </div>
        )}
      </div>
    </main>
  );
}
