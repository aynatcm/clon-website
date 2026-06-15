import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: "Design DNA Platform",
  description:
    "Analyze any website, extract its Design DNA, build a reusable Design System, and generate new pages that belong to the same product.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full flex flex-col">
        <header className="border-b border-[var(--color-border)]">
          <div className="mx-auto flex h-14 w-full max-w-6xl items-center justify-between px-5">
            <Link href="/" className="flex items-center gap-2 font-semibold">
              <span className="inline-block h-5 w-5 rounded-md bg-[var(--color-primary)]" />
              Design DNA
            </Link>
            <nav className="flex items-center gap-4 text-sm">
              <Link href="/" className="text-[var(--color-muted)] hover:text-[var(--color-foreground)]">
                Projects
              </Link>
              <Link
                href="/projects/new"
                className="rounded-[10px] bg-[var(--color-primary)] px-3 py-1.5 text-[var(--color-primary-fg)]"
              >
                New analysis
              </Link>
            </nav>
          </div>
        </header>
        <main className="mx-auto w-full max-w-6xl flex-1 px-5 py-8">{children}</main>
        <footer className="border-t border-[var(--color-border)] py-6 text-center text-xs text-[var(--color-muted)]">
          Design DNA Extraction &amp; Design System Extension Platform
        </footer>
      </body>
    </html>
  );
}
