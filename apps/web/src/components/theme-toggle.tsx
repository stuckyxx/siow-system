'use client';
import { useEffect, useState } from 'react';

export type Theme = 'dark' | 'light';
const KEY = 'siow.theme';

/** Lê o tema salvo (padrão: escuro, o visual aprovado). */
export function readTheme(): Theme {
  try { return localStorage.getItem(KEY) === 'light' ? 'light' : 'dark'; } catch { return 'dark'; }
}
export function applyTheme(t: Theme): void {
  document.documentElement.dataset['theme'] = t;
  try { localStorage.setItem(KEY, t); } catch { /* modo privado */ }
}

/** Botão de contraste: alterna entre modo escuro e claro (preferência por dispositivo). */
export function ThemeToggle({ className = 'btn sm' }: { className?: string }) {
  const [theme, setTheme] = useState<Theme>('dark');
  useEffect(() => { setTheme(readTheme()); }, []);
  const next: Theme = theme === 'dark' ? 'light' : 'dark';
  return (
    <button type="button" className={className} onClick={() => { applyTheme(next); setTheme(next); }} title={next === 'light' ? 'Mudar para modo claro' : 'Mudar para modo escuro'} aria-label="Alternar contraste">
      {theme === 'dark' ? '☀ Claro' : '☾ Escuro'}
    </button>
  );
}
