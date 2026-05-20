'use client';
import { clsx } from '@/lib/clsx';
import type { ButtonHTMLAttributes, ReactNode } from 'react';

type Variant = 'default' | 'primary' | 'green' | 'red' | 'purple';

const variants: Record<Variant, string> = {
  default: 'bg-[var(--color-bg-tertiary)] hover:bg-[var(--color-border)] text-[var(--color-text)]',
  primary: 'bg-[var(--color-accent)] hover:bg-blue-500 text-white',
  green: 'bg-[var(--color-green)] hover:bg-green-500 text-black',
  red: 'bg-[var(--color-red)] hover:bg-red-500 text-white',
  purple: 'bg-[var(--color-purple)] hover:bg-purple-400 text-black',
};

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: 'sm' | 'md';
  children: ReactNode;
}

export function Button({ variant = 'default', size = 'md', className, children, ...rest }: Props) {
  return (
    <button
      {...rest}
      className={clsx(
        'rounded border border-[var(--color-border)] font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed',
        size === 'sm' ? 'px-2 py-1 text-[12px]' : 'px-3 py-1.5 text-sm',
        variants[variant],
        className,
      )}
    >
      {children}
    </button>
  );
}
