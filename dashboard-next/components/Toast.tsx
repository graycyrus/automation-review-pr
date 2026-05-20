'use client';
import { useEffect } from 'react';
import { clsx } from '@/lib/clsx';

type Tone = 'info' | 'success' | 'error';

const toneClass: Record<Tone, string> = {
  info: 'border-[var(--color-border)] bg-[var(--color-bg-tertiary)] text-[var(--color-text)]',
  success: 'border-green-500/40 bg-green-500/15 text-[var(--color-green)]',
  error: 'border-red-500/40 bg-red-500/15 text-[var(--color-red)]',
};

export function Toast({
  tone = 'info',
  message,
  onClose,
  ttlMs = 6000,
}: {
  tone?: Tone;
  message: string;
  onClose: () => void;
  ttlMs?: number;
}) {
  useEffect(() => {
    const t = setTimeout(onClose, ttlMs);
    return () => clearTimeout(t);
  }, [onClose, ttlMs]);

  return (
    <div className={clsx('fixed bottom-4 right-4 z-50 max-w-md rounded border px-3 py-2 text-sm shadow-lg', toneClass[tone])}>
      <div className="flex items-start gap-2">
        <span className="flex-1 whitespace-pre-wrap">{message}</span>
        <button
          onClick={onClose}
          className="text-xs text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
          aria-label="Close"
        >
          ×
        </button>
      </div>
    </div>
  );
}
