'use client';
import { useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import Nav from './_nav';

// ─── Tiny reusable components ──────────────────────────────────────────────────

function Check({ light = false }: { light?: boolean }) {
  return (
    <svg
      className={`w-5 h-5 flex-shrink-0 mt-0.5 ${light ? 'text-cyan-400' : 'text-blue-600'}`}
      viewBox="0 0 20 20"
      fill="currentColor"
    >
      <path
        fillRule="evenodd"
        d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
        clipRule="evenodd"
      />
    </svg>
  );
}

function Bullet({ text, light = false }: { text: string; light?: boolean }) {
  return (
    <li className="flex items-start gap-3">
      <Check light={light} />
      <span className={`text-sm leading-relaxed ${light ? 'text-slate-300' : 'text-slate-700'}`}>{text}</span>
    </li>
  );
}

function Eyebrow({ children, light = false }: { children: React.ReactNode; light?: boolean }) {
  return (
    <p className={`text-xs uppercase tracking-widest font-semibold mb-3 ${light ? 'text-cyan-400' : 'text-blue-600'}`}>
      {children}
    </p>
  );
}

// ─── Demo form type ────────────────────────────────────────────────────────────
interface DemoForm { name: string; email: string; company: string; message: string; }

// ─── Main component ────────────────────────────────────────────────────────────
export default function Landing() {
  const [demoOpen, setDemoOpen] = useState(false);
  const [form, setForm] = useState<DemoForm>({ name: '', email: '', company: '', message: '' });

  function handleDemoSubmit(e: React.FormEvent) {
    e.preventDefault();
    const subject = encodeURIComponent(`Demo Request – ${form.company || form.name}`);
    const body = encodeURIComponent(
      `Hi Solvantis Sales,\n\nI'd like to book a product demo.\n\nName: ${form.name}\nEmail: ${form.email}\nCompany: ${form.company}\n\nMessage:\n${form.message}\n\nThanks`
    );
    window.location.href = `mailto:sales@solvantis.com?subject=${subject}&body=${body}`;
    setDemoOpen(false);
  }

  return (
    <div className="bg-white text-slate-900 overflow-x-hidden min-h-screen" style={{ fontFamily: 'Inter, sans-serif' }}>
      <Nav onDemo={() => setDemoOpen(true)} />

      {/* ══════════════════════════════════════════════════════════════════════
          HERO — dark navy
      ══════════════════════════════════════════════════════════════════════ */}
      <section className="bg-slate-900 relative overflow-hidden">
        {/* Subtle grid */}
        <div
          className="absolute inset-0 opacity-[0.035]"
          style={{
            backgroundImage:
              'linear-gradient(rgba(255,255,255,1) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,1) 1px, transparent 1px)',
            backgroundSize: '64px 64px',
          }}
        />
        {/* Glow blobs */}
        <div className="absolute top-0 left-1/4 w-[500px] h-[500px] bg-blue-600/15 rounded-full blur-3xl pointer-events-none" />
        <div className="absolute bottom-0 right-1/4 w-[300px] h-[300px] bg-cyan-500/10 rounded-full blur-3xl pointer-events-none" />

        <div className="relative max-w-7xl mx-auto px-6 lg:px-8 py-24 lg:py-32">
          <div className="grid lg:grid-cols-2 gap-12 lg:gap-16 items-center">
            {/* Left — copy */}
            <div>
              <div className="inline-flex items-center gap-2 bg-blue-600/20 border border-blue-500/30 text-blue-300 text-xs font-semibold px-3 py-1.5 rounded-full mb-6">
                <span className="w-1.5 h-1.5 bg-blue-400 rounded-full" />
                Built BY retailers, FOR retailers
              </div>
              <h1 className="text-5xl lg:text-[3.5rem] font-black text-white tracking-tight leading-[1.1] mb-6">
                The Operating System{' '}
                <span className="bg-gradient-to-r from-blue-400 to-cyan-400 bg-clip-text text-transparent">
                  for Modern Retail
                </span>
              </h1>
              <p className="text-lg text-slate-300 mb-8 leading-relaxed max-w-lg">
                Inventory, POS, AI tools, analytics, and CRM — unified in one platform.
                Stop juggling spreadsheets and fragmented systems. Start scaling.
              </p>
              <div className="flex flex-wrap gap-3">
                <Link
                  href="/register"
                  className="bg-blue-600 hover:bg-blue-700 text-white font-semibold px-7 py-3.5 rounded-lg transition shadow-lg shadow-blue-900/40 text-sm"
                >
                  Start Free Trial →
                </Link>
                <button
                  onClick={() => setDemoOpen(true)}
                  className="border border-white/25 hover:border-white/50 text-white hover:bg-white/5 font-semibold px-7 py-3.5 rounded-lg transition text-sm"
                >
                  Book a Demo
                </button>
              </div>
              <p className="text-slate-500 text-xs mt-4">3 months for $1 · No credit card required · Cancel anytime</p>
            </div>

            {/* Right — hero image */}
            <div className="relative">
              <div className="rounded-2xl overflow-hidden shadow-2xl shadow-black/60 border border-white/10">
                <Image
                  src="/landing/pos-cashier.jpg"
                  alt="Solvantis POS in a retail store"
                  width={640}
                  height={430}
                  className="w-full object-cover"
                  priority
                />
              </div>
              {/* Badge: AI — oval pill */}
              <div className="absolute -bottom-5 -left-4 bg-white rounded-full shadow-xl px-5 py-3 flex items-center gap-2.5">
                <div className="w-8 h-8 bg-violet-100 rounded-full flex items-center justify-center flex-shrink-0">
                  <svg className="w-4 h-4 text-violet-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z" />
                  </svg>
                </div>
                <div>
                  <p className="text-xs font-bold text-slate-900">Automate your Most Tedious Tasks</p>
                  <p className="text-xs text-slate-500">with Smart AI</p>
                </div>
              </div>
              {/* Badge: support — oval pill */}
              <div className="absolute -top-4 -right-4 bg-blue-600 text-white rounded-full shadow-xl px-5 py-3 text-center">
                <p className="text-sm font-black leading-none">100% Aussie</p>
                <p className="text-xs opacity-80 mt-0.5">Phone Support</p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ══════════════════════════════════════════════════════════════════════
          PROMO BANNER — brand blue
      ══════════════════════════════════════════════════════════════════════ */}
      <div className="bg-blue-600 py-4 px-6">
        <div className="max-w-7xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-3">
          <p className="text-white text-sm font-medium text-center sm:text-left">
            🎉 <strong>Limited Offer:</strong> Try Solvantis free for 3 months — just $1. No lock-in, no credit card required.
          </p>
          <Link
            href="/register"
            className="flex-shrink-0 bg-white text-blue-600 hover:bg-blue-50 font-semibold text-sm px-5 py-2 rounded-lg transition shadow-sm"
          >
            Claim Offer →
          </Link>
        </div>
      </div>

      {/* ══════════════════════════════════════════════════════════════════════
          STATS — white
      ══════════════════════════════════════════════════════════════════════ */}
      <section className="bg-white py-16 border-b border-slate-100">
        <div className="max-w-7xl mx-auto px-6 lg:px-8">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-8 text-center">
            <div>
              <p className="text-4xl font-black text-blue-600 leading-tight">Australia Based</p>
              <p className="text-sm text-slate-500 mt-1 font-medium">Support Team</p>
            </div>
            <div>
              <p className="text-3xl font-black text-blue-600 leading-tight">Customised Functions</p>
              <p className="text-sm text-slate-500 mt-1 font-medium">Because every Retailer is Different</p>
            </div>
            <div>
              <p className="text-4xl font-black text-blue-600">99.9%</p>
              <p className="text-sm text-slate-500 mt-1 font-medium">Platform Uptime</p>
            </div>
          </div>
        </div>
      </section>

      {/* ══════════════════════════════════════════════════════════════════════
          BY RETAILERS — light grey
      ══════════════════════════════════════════════════════════════════════ */}
      <section className="bg-slate-50 py-20">
        <div className="max-w-7xl mx-auto px-6 lg:px-8">
          <div className="grid lg:grid-cols-2 gap-16 items-center">
            <div>
              <Eyebrow>Our Story</Eyebrow>
              <h2 className="text-4xl font-black text-slate-900 tracking-tight leading-tight mb-5">
                We've been on the shop floor.{' '}
                <span className="text-blue-600">We built what we always needed.</span>
              </h2>
              <p className="text-slate-600 text-base leading-relaxed mb-5">
                After 20+ years running retail operations, we knew exactly what was missing. Every system was either too simple, too complex, or simply not built for how real retailers work day-to-day.
              </p>
              <p className="text-slate-600 text-base leading-relaxed">
                Solvantis brings together everything — inventory, sales, staff, customers, and AI — into one platform that actually makes sense to use. No consultants required.
              </p>
            </div>
            <div className="rounded-2xl overflow-hidden shadow-xl border border-slate-200">
              <Image
                src="/landing/warehouse.jpg"
                alt="Efficient retail warehouse operations"
                width={600}
                height={400}
                className="w-full object-cover"
              />
            </div>
          </div>
        </div>
      </section>

      {/* ══════════════════════════════════════════════════════════════════════
          FEATURE CARDS — white
      ══════════════════════════════════════════════════════════════════════ */}
      <section id="features" className="bg-white py-20">
        <div className="max-w-7xl mx-auto px-6 lg:px-8">
          <div className="text-center mb-14">
            <Eyebrow>Everything You Need</Eyebrow>
            <h2 className="text-4xl font-black text-slate-900 tracking-tight">One Platform. Infinite Retail Potential.</h2>
            <p className="text-slate-500 mt-3 text-base max-w-xl mx-auto">
              All the tools a modern retailer needs — fully integrated, beautifully simple.
            </p>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {[
              {
                icon: (
                  <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 10V7" />
                  </svg>
                ),
                title: 'Advanced Inventory',
                desc: 'Multi-variant products, purchase orders, sales orders, branch transfers, stocktakes, and multi-currency — all in one place.',
              },
              {
                icon: (
                  <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z" />
                  </svg>
                ),
                title: 'Point of Sale',
                desc: 'Fast POS with card machine integration, lay-buys, order parking, advanced search, multiple users, and full offline mode.',
              },
              {
                icon: (
                  <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z" />
                  </svg>
                ),
                title: 'AI-Powered Tools',
                desc: 'Auto product builder, customer service automation, intelligent reordering, and AI-powered demand forecasting.',
              },
              {
                icon: (
                  <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 013 19.875v-6.75zM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V8.625zM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V4.125z" />
                  </svg>
                ),
                title: 'Analytics & Forecasting',
                desc: 'Real-time dashboards, custom built reports, stock turnover analysis, demand forecasting, and margin optimisation across all locations.',
              },
              {
                icon: (
                  <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 21h16.5M4.5 3h15M5.25 3v18m13.5-18v18M9 6.75h1.5m-1.5 3h1.5m-1.5 3h1.5m3-6H15m-1.5 3H15m-1.5 3H15M9 21v-3.375c0-.621.504-1.125 1.125-1.125h3.75c.621 0 1.125.504 1.125 1.125V21" />
                  </svg>
                ),
                title: 'Multi-Branch Support',
                desc: 'Manage unlimited locations from one dashboard. Centralised reporting, stock visibility, and inter-branch transfers.',
              },
              {
                icon: (
                  <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M13.19 8.688a4.5 4.5 0 011.242 7.244l-4.5 4.5a4.5 4.5 0 01-6.364-6.364l1.757-1.757m13.35-.622l1.757-1.757a4.5 4.5 0 00-6.364-6.364l-4.5 4.5a4.5 4.5 0 001.242 7.244" />
                  </svg>
                ),
                title: 'Integrations',
                desc: 'Connect with Xero, Shopify, Magento, Google Analytics, Meta Ads, and more. Your whole ecosystem speaking one language.',
              },
            ].map((f) => (
              <div
                key={f.title}
                className="bg-white rounded-2xl border border-slate-200 p-6 shadow-sm hover:shadow-md hover:border-blue-200 transition-all group"
              >
                <div className="w-11 h-11 bg-blue-50 text-blue-600 rounded-xl flex items-center justify-center mb-4 group-hover:bg-blue-100 transition">
                  {f.icon}
                </div>
                <h3 className="font-bold text-slate-900 mb-2">{f.title}</h3>
                <p className="text-sm text-slate-500 leading-relaxed">{f.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ══════════════════════════════════════════════════════════════════════
          IMS DEEP DIVE — light grey
      ══════════════════════════════════════════════════════════════════════ */}
      <section className="bg-slate-50 py-20">
        <div className="max-w-7xl mx-auto px-6 lg:px-8">
          <div className="grid lg:grid-cols-2 gap-16 items-center">
            <div className="rounded-2xl overflow-hidden shadow-xl border border-slate-200">
              <Image
                src="/landing/warehouse.jpg"
                alt="Advanced inventory management"
                width={600}
                height={400}
                className="w-full object-cover"
              />
            </div>
            <div>
              <Eyebrow>Inventory Management</Eyebrow>
              <h2 className="text-4xl font-black text-slate-900 tracking-tight leading-tight mb-4">
                Inventory control that keeps up with your business
              </h2>
              <p className="text-slate-600 mb-6 leading-relaxed">
                Built for retailers who deal with real complexity — hundreds of variants, multiple suppliers, and branches across multiple cities.
              </p>
              <ul className="space-y-3">
                {[
                  'Products with unlimited variants (size, colour, style)',
                  'Purchase Orders with full supplier management',
                  'Sales Orders and fulfilment tracking',
                  'Inter-branch stock transfers with audit trail',
                  'Guided stocktakes with discrepancy reports',
                  'Multi-currency pricing and costing',
                ].map((t) => <Bullet key={t} text={t} />)}
              </ul>
              <Link
                href="/register"
                className="inline-block mt-8 bg-blue-600 hover:bg-blue-700 text-white font-semibold px-6 py-3 rounded-lg transition text-sm shadow-sm"
              >
                Explore Inventory →
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* ══════════════════════════════════════════════════════════════════════
          POS DEEP DIVE — dark navy
      ══════════════════════════════════════════════════════════════════════ */}
      <section className="bg-slate-900 py-20">
        <div className="max-w-7xl mx-auto px-6 lg:px-8">
          <div className="grid lg:grid-cols-2 gap-16 items-center">
            <div>
              <Eyebrow light>Point of Sale</Eyebrow>
              <h2 className="text-4xl font-black text-white tracking-tight leading-tight mb-4">
                A POS built for the retail floor — not the boardroom
              </h2>
              <p className="text-slate-400 mb-6 leading-relaxed">
                Designed for speed, built for reliability. Your team will love using it. Your customers won't even notice it's there.
              </p>
              <ul className="space-y-3">
                {[
                  'Integrated card machine support',
                  'Order parking — serve multiple customers at once',
                  'Lay-buy management with deposit tracking',
                  'Advanced product search by name, SKU, or barcode',
                  'Multiple users with role-based permissions',
                  'Full offline mode — works without internet',
                  'Integrated loyalty point earning and redemption',
                ].map((t) => <Bullet key={t} text={t} light />)}
              </ul>
              <Link
                href="/register"
                className="inline-block mt-8 border border-white/30 hover:border-white/60 text-white hover:bg-white/5 font-semibold px-6 py-3 rounded-lg transition text-sm"
              >
                Explore POS →
              </Link>
            </div>
            <div className="rounded-2xl overflow-hidden shadow-2xl shadow-black/60 border border-white/10">
              <Image
                src="/landing/pos1.jpg"
                alt="Solvantis POS system"
                width={600}
                height={400}
                className="w-full object-cover"
              />
            </div>
          </div>
        </div>
      </section>

      {/* ══════════════════════════════════════════════════════════════════════
          AI TOOLS — white
      ══════════════════════════════════════════════════════════════════════ */}
      <section className="bg-white py-20">
        <div className="max-w-7xl mx-auto px-6 lg:px-8">
          <div className="grid lg:grid-cols-2 gap-16 items-center">
            <div className="rounded-2xl overflow-hidden shadow-xl border border-slate-200">
              <Image
                src="/landing/ai-products.jpg"
                alt="AI auto product builder"
                width={600}
                height={400}
                className="w-full object-cover"
              />
            </div>
            <div>
              <Eyebrow>AI-Powered Tools</Eyebrow>
              <h2 className="text-4xl font-black text-slate-900 tracking-tight leading-tight mb-4">
                Let AI handle the heavy lifting
              </h2>
              <p className="text-slate-600 mb-6 leading-relaxed">
                Solvantis AI is trained on retail. It doesn't just automate tasks — it makes decisions that would have taken your team hours.
              </p>
              <ul className="space-y-3">
                {[
                  'Auto Product Builder — publish to Shopify, Magento, and more in seconds',
                  'Customer service automation with context-aware responses',
                  'Intelligent reorder suggestions based on sales velocity',
                  'AI-generated product descriptions and SEO content',
                  'Demand forecasting to prevent stockouts and overstock',
                ].map((t) => <Bullet key={t} text={t} />)}
              </ul>
            </div>
          </div>
        </div>
      </section>

      {/* ══════════════════════════════════════════════════════════════════════
          ANALYTICS — light grey
      ══════════════════════════════════════════════════════════════════════ */}
      <section className="bg-slate-50 py-20">
        <div className="max-w-7xl mx-auto px-6 lg:px-8">
          <div className="grid lg:grid-cols-2 gap-16 items-center">
            <div>
              <Eyebrow>Analytics & Forecasting</Eyebrow>
              <h2 className="text-4xl font-black text-slate-900 tracking-tight leading-tight mb-4">
                Data-driven decisions, made easy
              </h2>
              <p className="text-slate-600 mb-6 leading-relaxed">
                Understand your business at a glance. Real-time dashboards, trend analysis, and forecasts that help you plan with confidence.
              </p>
              <ul className="space-y-3">
                {[
                  'Stock turnover efficiency analysis',
                  'Sales velocity and product trend reports',
                  'Seasonal demand forecasting',
                  'Gross margin and profitability dashboards',
                  'Branch-by-branch performance comparison',
                  'Best seller and slow-mover identification',
                ].map((t) => <Bullet key={t} text={t} />)}
              </ul>
            </div>
            <div className="rounded-2xl overflow-hidden shadow-xl border border-slate-200">
              <Image
                src="/landing/stock-analytics.jpg"
                alt="Stock analytics and forecasting dashboard"
                width={600}
                height={400}
                className="w-full object-cover"
              />
            </div>
          </div>
        </div>
      </section>

      {/* ══════════════════════════════════════════════════════════════════════
          INTEGRATIONS — white
      ══════════════════════════════════════════════════════════════════════ */}
      <section id="integrations" className="bg-white py-16 border-t border-slate-100">
        <div className="max-w-7xl mx-auto px-6 lg:px-8 text-center">
          <Eyebrow>Integrations</Eyebrow>
          <h2 className="text-3xl font-black text-slate-900 mb-3">Works with the tools you already use</h2>
          <p className="text-slate-500 text-sm mb-10 max-w-md mx-auto">
            Connect your accounting, ecommerce, and marketing platforms. No manual data entry, ever.
          </p>
          <div className="flex flex-wrap items-center justify-center gap-3">
            {[
              { name: 'Xero', cls: 'text-blue-700 bg-blue-50 border-blue-200' },
              { name: 'Shopify', cls: 'text-green-700 bg-green-50 border-green-200' },
              { name: 'Magento', cls: 'text-orange-600 bg-orange-50 border-orange-200' },
              { name: 'Google Analytics', cls: 'text-yellow-700 bg-yellow-50 border-yellow-200' },
              { name: 'Meta Ads', cls: 'text-blue-600 bg-blue-50 border-blue-200' },
              { name: 'WooCommerce', cls: 'text-purple-700 bg-purple-50 border-purple-200' },
              { name: '+ More Coming', cls: 'text-slate-500 bg-slate-50 border-slate-200' },
            ].map((item) => (
              <span
                key={item.name}
                className={`inline-flex items-center px-5 py-2.5 rounded-xl border text-sm font-semibold ${item.cls}`}
              >
                {item.name}
              </span>
            ))}
          </div>
        </div>
      </section>

      {/* ══════════════════════════════════════════════════════════════════════
          CRM & LOYALTY — dark navy
      ══════════════════════════════════════════════════════════════════════ */}
      <section className="bg-slate-900 py-20">
        <div className="max-w-7xl mx-auto px-6 lg:px-8">
          <div className="grid lg:grid-cols-2 gap-16 items-center">
            <div>
              <Eyebrow light>CRM & Loyalty</Eyebrow>
              <h2 className="text-4xl font-black text-white tracking-tight leading-tight mb-4">
                Turn first-time buyers into loyal customers
              </h2>
              <p className="text-slate-400 mb-8 leading-relaxed">
                Your customer data is one of your most valuable assets. Solvantis CRM gives you the tools to nurture relationships at scale — from one store or fifty.
              </p>
              <div className="grid sm:grid-cols-2 gap-4">
                {[
                  { title: 'Customer Profiles', desc: 'Full purchase history and preferences in one view' },
                  { title: 'Loyalty Points', desc: 'Earn points on every purchase, redeem in-store or online' },
                  { title: 'Automated Rewards', desc: 'Set milestone rules — the system does the rest' },
                  { title: 'Customer Segmentation', desc: 'Group customers for targeted promotions' },
                ].map((item) => (
                  <div key={item.title} className="bg-white/5 border border-white/10 rounded-xl p-4 hover:bg-white/[0.07] transition">
                    <p className="text-white font-semibold text-sm mb-1">{item.title}</p>
                    <p className="text-slate-400 text-xs leading-relaxed">{item.desc}</p>
                  </div>
                ))}
              </div>
            </div>

            {/* Loyalty dashboard illustration */}
            <div className="bg-slate-800/60 border border-white/10 rounded-2xl p-8">
              <div className="flex items-center justify-between mb-5">
                <p className="text-white font-semibold text-sm">Loyalty Dashboard</p>
                <span className="text-xs text-cyan-400 font-medium bg-cyan-400/10 border border-cyan-400/20 px-2.5 py-1 rounded-full">Live</span>
              </div>
              <div className="space-y-3">
                {[
                  { name: 'Sarah Mitchell', pts: 2480, spend: '$1,240', tag: 'VIP' },
                  { name: 'James Park', pts: 1820, spend: '$910', tag: 'Gold' },
                  { name: 'Priya Nair', pts: 3100, spend: '$1,550', tag: 'VIP' },
                ].map((c) => (
                  <div key={c.name} className="flex items-center justify-between bg-white/5 rounded-lg px-4 py-3">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 bg-blue-600 rounded-full flex items-center justify-center text-white text-xs font-bold">
                        {c.name.split(' ').map(w => w[0]).join('')}
                      </div>
                      <div>
                        <span className="text-white text-sm font-medium">{c.name}</span>
                        <span className="ml-2 text-xs text-cyan-400 bg-cyan-400/10 px-1.5 py-0.5 rounded">{c.tag}</span>
                      </div>
                    </div>
                    <div className="text-right">
                      <p className="text-cyan-400 text-sm font-bold">{c.pts.toLocaleString()} pts</p>
                      <p className="text-slate-500 text-xs">{c.spend} spent</p>
                    </div>
                  </div>
                ))}
              </div>
              <p className="text-slate-600 text-xs mt-4 text-center">Sample data for illustration</p>
            </div>
          </div>
        </div>
      </section>

      {/* ══════════════════════════════════════════════════════════════════════
          PRICING — white
      ══════════════════════════════════════════════════════════════════════ */}
      <section id="pricing" className="bg-white py-20">
        <div className="max-w-7xl mx-auto px-6 lg:px-8">
          <div className="text-center mb-12">
            <Eyebrow>Pricing</Eyebrow>
            <h2 className="text-4xl font-black text-slate-900 tracking-tight">Simple, transparent pricing</h2>
            <p className="text-slate-500 mt-3 text-base">No hidden fees. Scale as you grow.</p>
          </div>

          {/* Promo callout */}
          <div className="bg-blue-600 text-white rounded-2xl p-5 flex flex-col sm:flex-row items-center justify-between gap-4 mb-10 shadow-lg shadow-blue-100">
            <div>
              <p className="font-black text-lg">🎉 Limited Time: 3 months for $1</p>
              <p className="text-blue-100 text-sm mt-0.5">Try Solvantis risk-free. No lock-in contract. Cancel anytime.</p>
            </div>
            <Link href="/register" className="flex-shrink-0 bg-white text-blue-600 hover:bg-blue-50 font-bold px-6 py-2.5 rounded-xl transition text-sm shadow">
              Claim Offer
            </Link>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 items-start">
            {/* Starter */}
            <div className="rounded-2xl border border-slate-200 p-7 hover:border-blue-300 transition-colors">
              <h3 className="text-lg font-black text-slate-900 mb-1">Starter</h3>
              <p className="text-slate-500 text-sm mb-5">For single-location retailers just getting started</p>
              <div className="flex items-end gap-1 mb-6">
                <span className="text-4xl font-black text-slate-900">$65</span>
                <span className="text-slate-400 text-sm mb-1.5">/month</span>
              </div>
              <ul className="space-y-2.5 mb-7">
                {['1 location', 'Up to 3 users', 'Full IMS & POS', 'Sales & purchase orders', 'Email support'].map((f) => (
                  <li key={f} className="flex items-center gap-2 text-sm text-slate-700">
                    <Check /> {f}
                  </li>
                ))}
              </ul>
              <Link href="/register" className="block w-full text-center border-2 border-blue-600 text-blue-600 hover:bg-blue-50 font-semibold py-2.5 rounded-xl transition text-sm">
                Get Started
              </Link>
            </div>

            {/* Growth — most popular */}
            <div className="rounded-2xl border-2 border-blue-600 p-7 shadow-xl shadow-blue-100 relative">
              <div className="absolute -top-3.5 left-1/2 -translate-x-1/2 bg-blue-600 text-white text-xs font-bold px-3 py-1 rounded-full whitespace-nowrap">
                MOST POPULAR
              </div>
              <h3 className="text-lg font-black text-slate-900 mb-1">Growth</h3>
              <p className="text-slate-500 text-sm mb-5">For growing multi-location retailers</p>
              <div className="flex items-end gap-1 mb-6">
                <span className="text-4xl font-black text-slate-900">$50</span>
                <span className="text-slate-400 text-sm mb-1.5">/location/mo</span>
              </div>
              <ul className="space-y-2.5 mb-7">
                {[
                  '2–10 locations',
                  'Up to 20 users',
                  'Full IMS & POS',
                  'AI tools included',
                  'Phone support',
                  'Free data migration',
                  'Analytics & forecasting',
                ].map((f) => (
                  <li key={f} className="flex items-center gap-2 text-sm text-slate-700">
                    <Check /> {f}
                  </li>
                ))}
              </ul>
              <Link href="/register" className="block w-full text-center bg-blue-600 hover:bg-blue-700 text-white font-semibold py-2.5 rounded-xl transition text-sm shadow-sm">
                Get Started
              </Link>
            </div>

            {/* Enterprise */}
            <div className="rounded-2xl border border-slate-200 p-7 hover:border-blue-300 transition-colors">
              <h3 className="text-lg font-black text-slate-900 mb-1">Enterprise</h3>
              <p className="text-slate-500 text-sm mb-5">For large chains and retail groups</p>
              <div className="flex items-end gap-1 mb-6">
                <span className="text-4xl font-black text-slate-900">Custom</span>
              </div>
              <ul className="space-y-2.5 mb-7">
                {[
                  '10+ locations',
                  'Unlimited users',
                  'All Growth features',
                  'Priority 24/7 support',
                  'Free migration & training',
                  'Custom integrations',
                  'Dedicated account manager',
                ].map((f) => (
                  <li key={f} className="flex items-center gap-2 text-sm text-slate-700">
                    <Check /> {f}
                  </li>
                ))}
              </ul>
              <button
                onClick={() => setDemoOpen(true)}
                className="block w-full text-center border-2 border-slate-300 hover:border-blue-600 text-slate-700 hover:text-blue-600 font-semibold py-2.5 rounded-xl transition text-sm"
              >
                Contact Sales
              </button>
            </div>
          </div>

          <p className="text-center mt-8 text-slate-400 text-sm">
            <Link href="/pricing" className="text-blue-600 hover:underline font-medium">
              View full pricing details &amp; feature comparison →
            </Link>
          </p>
        </div>
      </section>

      {/* ══════════════════════════════════════════════════════════════════════
          TESTIMONIALS — light grey
      ══════════════════════════════════════════════════════════════════════ */}
      <section className="bg-slate-50 py-20">
        <div className="max-w-7xl mx-auto px-6 lg:px-8">
          <div className="text-center mb-12">
            <Eyebrow>Customer Stories</Eyebrow>
            <h2 className="text-4xl font-black text-slate-900 tracking-tight">Retailers love Solvantis</h2>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {[
              {
                quote: 'We replaced 4 different systems with Solvantis and our team was fully up to speed in a day. The POS is incredibly fast — our customers actually notice the difference.',
                name: 'Sarah Mitchell',
                role: 'Owner, Threads & Co.',
                initials: 'SM',
              },
              {
                quote: 'The multi-branch stock visibility alone saved us thousands in overstock. The analytics dashboard is something our previous system couldn\'t come close to delivering.',
                name: 'James Park',
                role: 'Operations Manager, Pacific Electronics',
                initials: 'JP',
              },
              {
                quote: 'The AI product builder cut our new product launch time from hours to minutes. We now publish directly to Shopify with descriptions and images — completely ready to go.',
                name: 'Priya Nair',
                role: 'Director, Bloom Cosmetics',
                initials: 'PN',
              },
            ].map((t) => (
              <div key={t.name} className="bg-white rounded-2xl border border-slate-200 p-7 shadow-sm">
                <div className="flex gap-0.5 mb-5">
                  {[...Array(5)].map((_, i) => (
                    <svg key={i} className="w-4 h-4 text-yellow-400 fill-yellow-400" viewBox="0 0 20 20">
                      <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
                    </svg>
                  ))}
                </div>
                <p className="text-slate-700 text-sm leading-relaxed mb-5 italic">"{t.quote}"</p>
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 bg-blue-600 rounded-full flex items-center justify-center text-white text-xs font-bold flex-shrink-0">
                    {t.initials}
                  </div>
                  <div>
                    <p className="text-slate-900 text-sm font-semibold">{t.name}</p>
                    <p className="text-slate-400 text-xs">{t.role}</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ══════════════════════════════════════════════════════════════════════
          BOOK DEMO CTA — blue gradient
      ══════════════════════════════════════════════════════════════════════ */}
      <section id="demo" className="bg-gradient-to-br from-blue-600 to-cyan-600 py-20">
        <div className="max-w-3xl mx-auto px-6 lg:px-8 text-center">
          <h2 className="text-4xl font-black text-white tracking-tight mb-4">
            Ready to transform your retail operations?
          </h2>
          <p className="text-blue-100 text-lg mb-10 leading-relaxed">
            Join 500+ retailers already using Solvantis. Get a personalised demo from our retail experts.
          </p>
          <div className="flex flex-wrap items-center justify-center gap-4">
            <button
              onClick={() => setDemoOpen(true)}
              className="bg-white text-blue-600 hover:bg-blue-50 font-bold px-8 py-3.5 rounded-xl transition shadow-lg text-sm"
            >
              Book a Free Demo
            </button>
            <Link
              href="/register"
              className="border-2 border-white/60 hover:border-white text-white font-semibold px-8 py-3.5 rounded-xl transition text-sm hover:bg-white/10"
            >
              Start Free Trial
            </Link>
          </div>
          <p className="text-blue-200 text-xs mt-6">No obligation · 30-minute session · Tailored to your business</p>
        </div>
      </section>

      {/* ══════════════════════════════════════════════════════════════════════
          FOOTER — dark navy
      ══════════════════════════════════════════════════════════════════════ */}
      <footer className="bg-slate-900 pt-14 pb-8">
        <div className="max-w-7xl mx-auto px-6 lg:px-8">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-8 mb-10">
            <div className="col-span-2 md:col-span-1">
              <p className="text-xl font-black text-blue-400 mb-2">Solvantis</p>
              <p className="text-slate-400 text-sm leading-relaxed">
                The operating system for modern retail. Built BY retailers, FOR retailers.
              </p>
            </div>
            {[
              {
                heading: 'Product',
                links: [
                  { label: 'Inventory (IMS)', href: '/#features' },
                  { label: 'Point of Sale', href: '/#features' },
                  { label: 'AI Tools', href: '/#features' },
                  { label: 'Analytics', href: '/#features' },
                  { label: 'Pricing', href: '/pricing' },
                ],
              },
              {
                heading: 'Integrations',
                links: [
                  { label: 'Xero', href: '/#integrations' },
                  { label: 'Shopify', href: '/#integrations' },
                  { label: 'Magento', href: '/#integrations' },
                  { label: 'Google Analytics', href: '/#integrations' },
                  { label: 'Meta Ads', href: '/#integrations' },
                ],
              },
              {
                heading: 'Company',
                links: [
                  { label: 'Book a Demo', href: '#demo' },
                  { label: 'Sign In', href: '/login' },
                  { label: 'Get Started', href: '/register' },
                  { label: 'Contact Sales', href: 'mailto:sales@solvantis.com' },
                ],
              },
            ].map((col) => (
              <div key={col.heading}>
                <p className="text-white text-xs font-bold uppercase tracking-widest mb-4">{col.heading}</p>
                <ul className="space-y-2.5">
                  {col.links.map((l) => (
                    <li key={l.label}>
                      <Link href={l.href} className="text-slate-400 hover:text-white text-sm transition">
                        {l.label}
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
          <div className="border-t border-white/10 pt-6 flex flex-col sm:flex-row items-center justify-between gap-3">
            <p className="text-slate-500 text-xs">© {new Date().getFullYear()} Solvantis. All rights reserved.</p>
            <p className="text-slate-500 text-xs">Built BY retailers, FOR retailers.</p>
          </div>
        </div>
      </footer>

      {/* ══════════════════════════════════════════════════════════════════════
          DEMO MODAL
      ══════════════════════════════════════════════════════════════════════ */}
      {demoOpen && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
          onClick={() => setDemoOpen(false)}
        >
          <div
            className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-8"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between mb-6">
              <div>
                <h3 className="text-xl font-black text-slate-900">Book a Free Demo</h3>
                <p className="text-slate-500 text-sm mt-0.5">30 minutes · No obligation · Tailored to you</p>
              </div>
              <button
                onClick={() => setDemoOpen(false)}
                className="p-2 rounded-lg hover:bg-slate-100 text-slate-400 hover:text-slate-600 transition -mt-1"
              >
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <form onSubmit={handleDemoSubmit} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1.5">Full Name *</label>
                <input
                  required
                  type="text"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  placeholder="Jane Smith"
                  className="w-full border border-slate-300 rounded-lg px-3.5 py-2.5 text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1.5">Work Email *</label>
                <input
                  required
                  type="email"
                  value={form.email}
                  onChange={(e) => setForm({ ...form, email: e.target.value })}
                  placeholder="jane@yourstore.com"
                  className="w-full border border-slate-300 rounded-lg px-3.5 py-2.5 text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1.5">Company / Store Name</label>
                <input
                  type="text"
                  value={form.company}
                  onChange={(e) => setForm({ ...form, company: e.target.value })}
                  placeholder="Threads & Co."
                  className="w-full border border-slate-300 rounded-lg px-3.5 py-2.5 text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1.5">What would you like to see?</label>
                <textarea
                  rows={3}
                  value={form.message}
                  onChange={(e) => setForm({ ...form, message: e.target.value })}
                  placeholder="e.g. POS, multi-branch inventory, AI tools..."
                  className="w-full border border-slate-300 rounded-lg px-3.5 py-2.5 text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-none"
                />
              </div>
              <button
                type="submit"
                className="w-full bg-blue-600 hover:bg-blue-700 text-white font-semibold py-3 rounded-xl transition text-sm shadow-sm"
              >
                Send Request →
              </button>
              <p className="text-center text-xs text-slate-400">We&apos;ll reply within 1 business day.</p>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
