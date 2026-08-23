'use client';
import { useEffect, useRef, useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { ArrowRight, FileUp, Play, Sparkles, X } from 'lucide-react';
import PricingPlanCards from '@/components/PricingPlanCards';
import SolvantisCapabilityMap from '@/components/SolvantisCapabilityMap';
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
  const [activeWorkflow, setActiveWorkflow] = useState<string | null>(null);
  const heroVideoRef = useRef<HTMLVideoElement | null>(null);

  const workflowFeatures = [
    {
      icon: FileUp,
      title: 'Invoice to Purchase Order',
      label: 'Purchasing workflow',
      outcome: 'Turn supplier paperwork into a ready-to-review purchase order.',
      description: 'Upload a PDF, JPEG, or PNG invoice. Solvantis reads the supplier, products, quantities, and costs, then prepares the purchase order for a quick human check.',
      steps: ['Upload invoice', 'Check extracted details', 'Save the purchase order'],
      accent: 'text-amber-700 bg-amber-50 border-amber-200',
      videoSrc: '/landing/Upload%20Invoice.mp4',
    },
    {
      icon: Sparkles,
      title: 'AI Creative Studio',
      label: 'Creative workflow',
      outcome: 'Create campaign-ready product imagery without a lengthy studio process.',
      description: 'Start with a product image, choose a setting and creative direction, then use brand references to generate polished visuals built around your catalogue.',
      steps: ['Choose a product', 'Set the creative direction', 'Generate branded assets'],
      accent: 'text-rose-700 bg-rose-50 border-rose-200',
      videoSrc: '/landing/Creative%20Stuido.mp4',
    },
    {
      icon: Sparkles,
      title: 'Automated Product Content Studio',
      label: 'Catalogue workflow',
      outcome: 'Move from basic product data to a polished listing in minutes.',
      description: 'Solvantis researches the item, develops useful customer-facing copy, and structures the result for review, helping your team publish consistent listings faster.',
      steps: ['Select products', 'Research and draft', 'Review the finished listing'],
      accent: 'text-blue-700 bg-blue-50 border-blue-200',
      videoSrc: '/landing/Automated%20Content%20Studio.mp4',
    },
  ];

  const selectedFeature = workflowFeatures.find((feature) => feature.title === activeWorkflow) ?? null;

  useEffect(() => {
    const delayRemaining = Math.max(0, 3000 - performance.now());
    const playbackTimer = window.setTimeout(() => {
      void heroVideoRef.current?.play().catch(() => undefined);
    }, delayRemaining);

    return () => window.clearTimeout(playbackTimer);
  }, []);

  useEffect(() => {
    if (!selectedFeature) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setActiveWorkflow(null);
    };
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', handleKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [selectedFeature]);

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
                Advanced Inventory, POS, Automation, Wholesale Tools, analytics, and CRM — unified in one platform, built for the way modern retailers and wholesalers work.
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

            {/* Right — hero video */}
            <div className="relative">
              <div className="rounded-2xl overflow-hidden shadow-2xl shadow-black/60 border border-white/10 bg-slate-950/40">
                <video
                  ref={heroVideoRef}
                  src="/landing/top%20banner.mp4?v=20260822"
                  poster="/landing/top-banner-current-poster.jpg?v=20260822"
                  muted
                  loop
                  playsInline
                  preload="auto"
                  aria-label="Solvantis retail operating system overview"
                  className="aspect-square w-full rounded-2xl object-cover"
                />
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
              <p className="text-4xl font-black text-blue-600 leading-tight">Aussie Based</p>
              <p className="text-sm text-slate-500 mt-1 font-medium">Support Team</p>
            </div>
            <div>
              <p className="text-4xl font-black text-blue-600 leading-tight">Custom Functions</p>
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
            <div className="w-full max-w-[480px] mx-auto rounded-full overflow-hidden shadow-xl border border-slate-200 aspect-square">
              <Image
                src="/landing/pos-cashier.jpg"
                alt="Retail POS cashier at checkout"
                width={600}
                height={600}
                className="w-full h-full object-cover"
              />
            </div>
          </div>
        </div>
      </section>

      {/* ══════════════════════════════════════════════════════════════════════
          IMS DEEP DIVE — light grey
      ══════════════════════════════════════════════════════════════════════ */}
      <section className="bg-slate-50 py-20">
        <div className="max-w-7xl mx-auto px-6 lg:px-8">
          <div className="grid lg:grid-cols-2 gap-16 items-center">
            <div className="w-full max-w-[480px] mx-auto rounded-full overflow-hidden shadow-xl border border-slate-200 aspect-square">
              <Image
                src="/landing/efficient%20warehouse%20operation.jpg"
                alt="Advanced inventory management"
                width={600}
                height={600}
                className="w-full h-full object-cover"
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
          WORKFLOW VIDEOS — softened light grey
      ══════════════════════════════════════════════════════════════════════ */}
      <section id="workflow-videos" className="bg-slate-100 py-20 lg:py-24">
        <div className="max-w-7xl mx-auto px-6 lg:px-8">
          <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px] lg:items-end mb-12 lg:mb-14">
            <div className="max-w-3xl">
              <Eyebrow>Advanced AI Automation Features</Eyebrow>
              <h2 className="text-4xl font-black text-slate-900 tracking-tight leading-tight">
                See Solvantis at Work
              </h2>
            </div>
            <p className="text-slate-600 text-base leading-relaxed lg:border-l lg:border-slate-300 lg:pl-7">
              A few selected ways Solvantis improves everyday workflows. These short, practical walkthroughs show how teams move from repetitive admin to finished work, faster.
            </p>
          </div>

          <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
            {workflowFeatures.map((item) => {
              const Icon = item.icon;

              return (
                <article
                  key={item.title}
                  className="group overflow-hidden rounded-lg border border-slate-200 bg-white shadow-[0_16px_45px_rgba(15,23,42,0.08)] transition duration-300 hover:-translate-y-1 hover:shadow-[0_22px_55px_rgba(15,23,42,0.13)]"
                >
                  <button
                    type="button"
                    onClick={() => setActiveWorkflow(item.title)}
                    className="relative block aspect-video w-full overflow-hidden bg-slate-950 text-left focus:outline-none focus-visible:ring-4 focus-visible:ring-inset focus-visible:ring-blue-400"
                    aria-label={`Play ${item.title} walkthrough`}
                  >
                    <video
                      src={item.videoSrc}
                      muted
                      playsInline
                      preload="metadata"
                      className="h-full w-full object-cover opacity-80 transition duration-500 group-hover:scale-[1.025] group-hover:opacity-65"
                      aria-hidden="true"
                    />
                    <span className="absolute inset-0 bg-gradient-to-t from-slate-950/70 via-slate-950/5 to-transparent" />
                    <span className="absolute inset-0 flex items-center justify-center">
                      <span className="flex h-20 w-20 items-center justify-center rounded-full border border-white/70 bg-white/95 text-blue-700 shadow-[0_12px_35px_rgba(15,23,42,0.35)] transition duration-300 group-hover:scale-110 group-hover:bg-blue-600 group-hover:text-white">
                        <Play className="ml-1 h-8 w-8 fill-current" aria-hidden="true" />
                      </span>
                    </span>
                    <span className="absolute bottom-4 left-4 text-xs font-bold uppercase tracking-widest text-white">
                      Watch walkthrough
                    </span>
                  </button>

                  <div className="p-6 lg:p-7">
                    <div className="mb-5 flex items-center gap-3">
                      <span className={`flex h-10 w-10 flex-none items-center justify-center rounded-lg border ${item.accent}`}>
                        <Icon className="h-5 w-5" aria-hidden="true" />
                      </span>
                      <p className="text-xs font-bold uppercase tracking-widest text-slate-500">{item.label}</p>
                    </div>
                    <h3 className="text-xl font-black leading-tight text-slate-900">{item.title}</h3>
                    <p className="mt-3 text-base font-semibold leading-relaxed text-slate-800">{item.outcome}</p>
                    <p className="mt-3 text-sm leading-relaxed text-slate-600">{item.description}</p>

                    <ol className="mt-6 border-t border-slate-200 pt-5">
                      {item.steps.map((step, index) => (
                        <li key={step} className="flex items-center gap-3 py-1.5 text-sm text-slate-700">
                          <span className="flex h-6 w-6 flex-none items-center justify-center rounded-full bg-slate-100 text-[11px] font-bold text-slate-600">
                            {index + 1}
                          </span>
                          {step}
                        </li>
                      ))}
                    </ol>

                    <button
                      type="button"
                      onClick={() => setActiveWorkflow(item.title)}
                      className="mt-6 inline-flex items-center gap-2 text-sm font-bold text-blue-700 transition hover:text-blue-900"
                    >
                      See how it works
                      <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" aria-hidden="true" />
                    </button>
                  </div>
                </article>
              );
            })}
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
          INTERACTIVE CAPABILITY MAP — white
      ══════════════════════════════════════════════════════════════════════ */}
      <section id="features" className="bg-white py-20 lg:py-24">
        <div className="max-w-7xl mx-auto px-6 lg:px-8">
          <div className="text-center mb-12 lg:mb-14">
            <Eyebrow>Everything You Need</Eyebrow>
            <h2 className="text-4xl font-black text-slate-900 tracking-tight">One Platform. Infinite Retail Potential.</h2>
            <p className="text-slate-500 mt-3 text-base max-w-xl mx-auto">
              All the tools a modern retailer needs — fully integrated, beautifully simple.
            </p>
          </div>
          <SolvantisCapabilityMap />
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
            Connect your accounting, ecommerce, marketing, customer communications, and payment platforms. No manual data entry, ever.
          </p>
          <div className="flex flex-wrap items-center justify-center gap-3">
            {[
              { name: 'Xero', cls: 'text-blue-700 bg-blue-50 border-blue-200' },
              { name: 'Shopify', cls: 'text-green-700 bg-green-50 border-green-200' },
              { name: 'Google Analytics', cls: 'text-yellow-700 bg-yellow-50 border-yellow-200' },
              { name: 'Google Ads', cls: 'text-blue-700 bg-blue-50 border-blue-200' },
              { name: 'Meta Ads', cls: 'text-blue-600 bg-blue-50 border-blue-200' },
              { name: 'Gmail', cls: 'text-red-700 bg-red-50 border-red-200' },
              { name: 'Payment Terminal Integration', cls: 'text-cyan-700 bg-cyan-50 border-cyan-200' },
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

          <PricingPlanCards onContactSales={() => setDemoOpen(true)} />

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
            Join some of Australia's top retailers already using Solvantis. Get a personalised demo from our retail experts.
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
                  { label: 'Automation', href: '/#features' },
                  { label: 'Wholesale Tools', href: '/#features' },
                  { label: 'Analytics', href: '/#features' },
                  { label: 'Pricing', href: '/pricing' },
                ],
              },
              {
                heading: 'Integrations',
                links: [
                  { label: 'Xero', href: '/#integrations' },
                  { label: 'Shopify', href: '/#integrations' },
                  { label: 'Google Analytics', href: '/#integrations' },
                  { label: 'Google Ads', href: '/#integrations' },
                  { label: 'Meta Ads', href: '/#integrations' },
                  { label: 'Gmail', href: '/#integrations' },
                  { label: 'Payment Terminals', href: '/#integrations' },
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

      {selectedFeature && (
        <div
          className="fixed inset-0 z-[110] flex items-center justify-center bg-slate-950/85 p-3 backdrop-blur-sm md:p-6"
          onClick={() => setActiveWorkflow(null)}
          role="dialog"
          aria-modal="true"
          aria-labelledby="workflow-video-title"
        >
          <div
            className="relative grid max-h-[94vh] w-full max-w-7xl overflow-y-auto rounded-lg border border-white/10 bg-slate-950 shadow-2xl lg:grid-cols-[minmax(0,1fr)_360px] lg:overflow-hidden"
            onClick={(event) => event.stopPropagation()}
          >
            <button
              type="button"
              onClick={() => setActiveWorkflow(null)}
              className="absolute right-3 top-3 z-10 flex h-10 w-10 items-center justify-center rounded-full border border-white/20 bg-slate-950/80 text-white backdrop-blur transition hover:bg-white hover:text-slate-950"
              aria-label="Close walkthrough"
            >
              <X className="h-5 w-5" aria-hidden="true" />
            </button>

            <div className="flex min-h-0 items-center bg-black">
              <video
                key={selectedFeature.title}
                src={selectedFeature.videoSrc}
                controls
                autoPlay
                playsInline
                className="max-h-[82vh] w-full bg-black object-contain"
                aria-label={`${selectedFeature.title} walkthrough`}
              >
                Your browser does not support embedded video.
              </video>
            </div>

            <div className="flex flex-col justify-center border-t border-white/10 p-6 text-white lg:border-l lg:border-t-0 lg:p-8">
              <p className="text-xs font-bold uppercase tracking-widest text-cyan-300">{selectedFeature.label}</p>
              <h3 id="workflow-video-title" className="mt-3 pr-10 text-2xl font-black leading-tight">
                {selectedFeature.title}
              </h3>
              <p className="mt-4 text-base font-semibold leading-relaxed text-white">{selectedFeature.outcome}</p>
              <p className="mt-4 text-sm leading-relaxed text-slate-300">{selectedFeature.description}</p>
              <ol className="mt-6 space-y-3 border-t border-white/10 pt-6">
                {selectedFeature.steps.map((step, index) => (
                  <li key={step} className="flex items-center gap-3 text-sm text-slate-200">
                    <span className="flex h-7 w-7 flex-none items-center justify-center rounded-full bg-white/10 text-xs font-bold text-cyan-300">
                      {index + 1}
                    </span>
                    {step}
                  </li>
                ))}
              </ol>
            </div>
          </div>
        </div>
      )}

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
                  placeholder="e.g. POS, multi-branch inventory, automation, wholesale tools..."
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
