import './globals.css';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'PR Review Dashboard',
  description: 'tinyhumansai/openhuman PR review automation',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen">
        <header className="border-b border-[var(--color-border)] bg-[var(--color-bg-secondary)]">
          <div className="mx-auto max-w-[1600px] px-6 py-3 flex items-center justify-between">
            <h1 className="text-lg font-semibold">
              PR Review Dashboard
              <span className="ml-2 text-[var(--color-text-muted)] text-sm font-normal">tinyhumansai/openhuman</span>
            </h1>
          </div>
        </header>
        <main className="mx-auto max-w-[1600px] px-6 py-6">{children}</main>
      </body>
    </html>
  );
}
