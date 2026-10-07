'use client';
import * as React from 'react';
import { cn } from '@/lib/utils';

/*
 * Primitivas de interface no visual "aurora" do protótipo aprovado (classes em globals.css).
 * A API (props) é a mesma de antes, para que todas as telas herdem o tema sem reescrita.
 */

// ---------------------------------------------------------------- Button
type ButtonVariant = 'default' | 'secondary' | 'ghost' | 'danger' | 'link';
type ButtonSize = 'sm' | 'md' | 'lg' | 'icon';
const VARIANT: Record<ButtonVariant, string> = { default: 'btn p', secondary: 'btn', ghost: 'btn ghost', danger: 'btn danger', link: 'link' };
export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant | null;
  size?: ButtonSize | null;
}
export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(({ className, variant, size, type = 'button', ...props }, ref) => (
  <button ref={ref} type={type} className={cn(VARIANT[variant ?? 'default'], size === 'sm' || size === 'icon' ? 'sm' : '', className)} {...props} />
));
Button.displayName = 'Button';

// ---------------------------------------------------------------- Card
export function Card({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('card', className)} {...props} />;
}
export function CardHeader({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('hd', className)} {...props} />;
}
export function CardTitle({ className, ...props }: React.HTMLAttributes<HTMLHeadingElement>) {
  return <h2 className={className} {...props} />;
}
export function CardContent({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('bd', className)} {...props} />;
}

// ---------------------------------------------------------------- Inputs (estilo base em globals.css)
export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(({ className, type, ...props }, ref) => (
  <input ref={ref} type={type} className={cn(type === 'checkbox' || type === 'radio' ? '' : 'w-full', className)} {...props} />
));
Input.displayName = 'Input';

export const Textarea = React.forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>(({ className, ...props }, ref) => (
  <textarea ref={ref} className={cn('w-full', className)} {...props} />
));
Textarea.displayName = 'Textarea';

export const Select = React.forwardRef<HTMLSelectElement, React.SelectHTMLAttributes<HTMLSelectElement>>(({ className, children, ...props }, ref) => (
  <select ref={ref} className={cn('w-full', className)} {...props}>
    {children}
  </select>
));
Select.displayName = 'Select';

export function Label({ className, ...props }: React.LabelHTMLAttributes<HTMLLabelElement>) {
  return <label className={cn('mb-1 block text-[11px] uppercase tracking-[.06em] text-ink-2', className)} {...props} />;
}

export function Field({ label, children, className }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <label className={cn('f', className)}>
      {label}
      {children}
    </label>
  );
}

// ---------------------------------------------------------------- Badge (pill)
type Tone = 'neutral' | 'info' | 'good' | 'warn' | 'serious' | 'critical';
const TONE: Record<Tone, string> = { neutral: 'n', info: 'info', good: 'good', warn: 'warn', serious: 'warn', critical: 'crit' };
export function Badge({ className, tone, ...props }: React.HTMLAttributes<HTMLSpanElement> & { tone?: Tone | null }) {
  return <span className={cn('pill', TONE[tone ?? 'neutral'], className)} {...props} />;
}

// ---------------------------------------------------------------- Table
export function Table({ className, ...props }: React.TableHTMLAttributes<HTMLTableElement>) {
  return (
    <div className="tbl">
      <table className={className} {...props} />
    </div>
  );
}
export function Th({ className, ...props }: React.ThHTMLAttributes<HTMLTableCellElement>) {
  return <th className={className} {...props} />;
}
export function Td({ className, ...props }: React.TdHTMLAttributes<HTMLTableCellElement>) {
  return <td className={className} {...props} />;
}

// ---------------------------------------------------------------- Tabs (centralizadas, sublinhado em gradiente)
export function Tabs({ tabs, value, onChange }: { tabs: Array<{ key: string; label: string; count?: number }>; value: string; onChange: (k: string) => void }) {
  return (
    <div role="tablist" className="tabs">
      {tabs.map((t) => (
        <button key={t.key} role="tab" aria-selected={value === t.key} onClick={() => onChange(t.key)} className={value === t.key ? 'on' : ''}>
          {t.label}
          {t.count !== undefined && <span className="ml-1 text-ink-3">({t.count})</span>}
        </button>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------- Dialog (native <dialog>)
export function Dialog({ open, onClose, title, children, wide }: { open: boolean; onClose: () => void; title: string; children: React.ReactNode; wide?: boolean }) {
  const ref = React.useRef<HTMLDialogElement>(null);
  React.useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog ref={ref} onClose={onClose} style={{ ['--w' as string]: wide ? '900px' : '620px' }}>
      <div className="dh">
        <b>{title}</b>
        <button aria-label="Fechar" onClick={onClose} className="btn sm">✕</button>
      </div>
      <div className="db">{open && children}</div>
    </dialog>
  );
}

// ---------------------------------------------------------------- misc
export function Skeleton({ className }: { className?: string }) {
  return <div className={cn('card animate-pulse', className)} />;
}
export function Empty({ children }: { children: React.ReactNode }) {
  return <div className="empty">{children}</div>;
}
export function Stat({ label, value, hint, tone, onClick, small }: { label: string; value: React.ReactNode; hint?: React.ReactNode; tone?: 'good' | 'warn' | 'critical' | 'info'; onClick?: () => void; small?: boolean }) {
  const cls = tone === 'critical' ? 'crit' : tone ?? '';
  const inner = (
    <>
      <div className="l">{label}</div>
      <div className={cn('v', cls)} style={small ? { fontSize: 16 } : undefined}>{value}</div>
      {hint && <div className="h">{hint}</div>}
    </>
  );
  return onClick ? <button type="button" className="card stat" onClick={onClick}>{inner}</button> : <div className="card stat">{inner}</div>;
}
export function Pagination({ page, pageSize, total, onPage }: { page: number; pageSize: number; total: number; onPage: (p: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  return (
    <div className="row between small muted" style={{ padding: '8px 12px' }}>
      <span>{total} registro(s)</span>
      <div className="row">
        <Button size="sm" variant="secondary" disabled={page <= 1} onClick={() => onPage(page - 1)}>Anterior</Button>
        <span>página {page} de {pages}</span>
        <Button size="sm" variant="secondary" disabled={page >= pages} onClick={() => onPage(page + 1)}>Próxima</Button>
      </div>
    </div>
  );
}
/** Mensagem flutuante breve (substitui alert()). */
export function useToast(): [React.ReactNode, (msg: string) => void] {
  const [msg, setMsg] = React.useState<string | null>(null);
  const timer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const show = React.useCallback((m: string) => {
    setMsg(m);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setMsg(null), 2800);
  }, []);
  return [msg ? <div className="toast" role="status">{msg}</div> : null, show];
}
