import type { AnchorHTMLAttributes, ReactNode } from 'react';
import { clsx } from '@/lib/clsx';

// External link helper — always opens in a new tab with safe rel attributes.
export function ExtLink({
  href,
  children,
  className,
  ...rest
}: AnchorHTMLAttributes<HTMLAnchorElement> & { href: string; children: ReactNode }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className={clsx('text-[var(--color-accent)] hover:underline', className)}
      {...rest}
    >
      {children}
    </a>
  );
}
