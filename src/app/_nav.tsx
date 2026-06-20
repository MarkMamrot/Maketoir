'use client';
import { useState } from 'react';
import Link from 'next/link';

interface NavProps {
  onDemo?: () => void;
}

export default function Nav({ onDemo }: NavProps) {
  const [open, setOpen] = useState(false);

  const demoEl = onDemo ? (
    <button onClick={onDemo} className="text-sm font-medium text-slate-600 hover:text-blue-600 transition">
      Book a Demo
    </button>
  ) : (
    <a href="mailto:sales@solvantis.com?subject=Demo+Request" className="text-sm font-medium text-slate-600 hover:text-blue-600 transition">
      Book a Demo
    </a>
  );

  const mobileDemoEl = onDemo ? (
    <button onClick={() => { onDemo(); setOpen(false); }} className="text-sm font-medium text-slate-700 text-left">
      Book a Demo
    </button>
  ) : (
    <a href="mailto:sales@solvantis.com?subject=Demo+Request" className="text-sm font-medium text-slate-700">
      Book a Demo
    </a>
  );

  return (
    <header className="sticky top-0 z-50 bg-white/95 backdrop-blur-md border-b border-slate-200">
      <div className="max-w-7xl mx-auto px-6 lg:px-8">
        <div className="flex items-center justify-between h-16">
          <Link href="/" className="flex items-baseline gap-2">
            <span className="text-xl font-black text-blue-600 tracking-tight">Solvantis</span>
          </Link>

          <nav className="hidden md:flex items-center gap-8">
            <Link href="/#features" className="text-sm font-medium text-slate-600 hover:text-blue-600 transition">Features</Link>
            <Link href="/pricing" className="text-sm font-medium text-slate-600 hover:text-blue-600 transition">Pricing</Link>
            <Link href="/#integrations" className="text-sm font-medium text-slate-600 hover:text-blue-600 transition">Integrations</Link>
            {demoEl}
          </nav>

          <div className="hidden md:flex items-center gap-3">
            <Link href="/login" className="text-sm font-medium text-slate-700 hover:text-blue-600 px-4 py-2 transition">Sign In</Link>
            <Link href="/register" className="text-sm font-semibold bg-blue-600 hover:bg-blue-700 text-white px-5 py-2.5 rounded-lg transition shadow-sm">
              Get Started
            </Link>
          </div>

          <button
            className="md:hidden p-2 rounded-md text-slate-600 hover:bg-slate-100 transition"
            onClick={() => setOpen(!open)}
            aria-label="Toggle menu"
          >
            {open ? (
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            ) : (
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" />
              </svg>
            )}
          </button>
        </div>
      </div>

      {open && (
        <div className="md:hidden bg-white border-t border-slate-100 px-6 py-5 flex flex-col gap-4 shadow-lg">
          <Link href="/#features" className="text-sm font-medium text-slate-700" onClick={() => setOpen(false)}>Features</Link>
          <Link href="/pricing" className="text-sm font-medium text-slate-700" onClick={() => setOpen(false)}>Pricing</Link>
          <Link href="/#integrations" className="text-sm font-medium text-slate-700" onClick={() => setOpen(false)}>Integrations</Link>
          {mobileDemoEl}
          <hr className="border-slate-100" />
          <Link href="/login" className="text-sm font-medium text-slate-700">Sign In</Link>
          <Link href="/register" className="block text-sm font-semibold bg-blue-600 text-white px-4 py-2.5 rounded-lg text-center">
            Get Started
          </Link>
        </div>
      )}
    </header>
  );
}
