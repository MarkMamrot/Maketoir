'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { ArrowRight, Boxes, Check, ClipboardCheck, FileUp, Menu, Network, Play, ShoppingBag, Sparkles, Store, Truck, UsersRound, X, type LucideIcon } from 'lucide-react';
import PricingPlanCards from '@/components/PricingPlanCards';
import SolvantisCapabilityMap from '@/components/SolvantisCapabilityMap';
import { SolvantisMark } from '@/components/SolvantisMark';
import { ProspectLeadDialog } from '@/components/assistant/ProspectLeadForm';
import { ProspectSalesAssistant } from '@/components/assistant/ProspectSalesAssistant';
import styles from './landing.module.css';

const sourcePath = '/landing2.html';
const workflows = [
  { title: 'Invoice to Purchase Order', icon: FileUp, label: 'Supplier paperwork', description: 'Upload a supplier invoice as a PDF or image. Review the extracted products, quantities and costs before saving the purchase order.', steps: ['Upload the document', 'Review the details', 'Save the purchase order'], src: '/landing/Upload%20Invoice.mp4' },
  { title: 'AI Creative Studio', icon: Sparkles, label: 'Product imagery', description: 'Start with your product image and brand references. Generate creative options for your team to review.', steps: ['Choose the product', 'Set the direction', 'Review generated imagery'], src: '/landing/Creative%20Stuido.mp4' },
  { title: 'Product Content Studio', icon: Sparkles, label: 'Catalogue content', description: 'Prepare researched listing drafts from product information, keeping people in control of the copy that gets published.', steps: ['Choose products', 'Prepare listing drafts', 'Review before publishing'], src: '/landing/Automated%20Content%20Studio.mp4' },
];

function Bullets({ items }: { items: string[] }) {
  return <ul className={styles.bullets}>{items.map(item => <li key={item}><Check size={18} aria-hidden="true" /><span>{item}</span></li>)}</ul>;
}

function SectionHeading({ label, title, children }: { label: string; title: string; children?: ReactNode }) {
  return <div className={styles.sectionHeading}><p className={styles.eyebrow}>{label}</p><h2>{title}</h2>{children && <p className={styles.intro}>{children}</p>}</div>;
}

function Feature({ icon: Icon, title, children }: { icon: LucideIcon; title: string; children: ReactNode }) {
  return <article className={styles.feature}><Icon size={25} aria-hidden="true" /><h3>{title}</h3><p>{children}</p></article>;
}

export default function LandingPreview() {
  const [menuOpen, setMenuOpen] = useState(false);
  const [demoOpen, setDemoOpen] = useState(false);
  const [activeVideo, setActiveVideo] = useState<(typeof workflows)[number] | null>(null);
  const videoDialogRef = useRef<HTMLDivElement>(null);
  const videoCloseRef = useRef<HTMLButtonElement>(null);
  const videoTriggerRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (!activeVideo) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    videoCloseRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setActiveVideo(null);
      if (event.key === 'Tab' && videoDialogRef.current) {
        const focusable = Array.from(videoDialogRef.current.querySelectorAll<HTMLElement>('button, video[controls]'));
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last?.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first?.focus();
        }
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', onKeyDown);
      videoTriggerRef.current?.focus();
    };
  }, [activeVideo]);

  return <div className={styles.page}>
    <a href="#main" className={styles.skipLink}>Skip to content</a>
    <header className={styles.header}>
      <div className={styles.navInner}>
        <Link href={sourcePath} className={styles.brand} aria-label="Solvantis home"><SolvantisMark size={30} /><span>Solvantis</span></Link>
        <nav className={styles.desktopNav} aria-label="Main navigation"><a href="#features">Features</a><a href="#sales-channels">Sales channels</a><a href="#pricing">Pricing</a><a href="#integrations">Integrations</a></nav>
        <div className={styles.desktopActions}><Link href="/login">Sign In</Link><button className={styles.primary} onClick={() => setDemoOpen(true)}>Book a Demo <ArrowRight size={16} /></button></div>
        <button className={styles.menuButton} aria-label={menuOpen ? 'Close menu' : 'Open menu'} aria-expanded={menuOpen} aria-controls="preview-menu" onClick={() => setMenuOpen(!menuOpen)}>{menuOpen ? <X /> : <Menu />}</button>
      </div>
      {menuOpen && <nav id="preview-menu" className={styles.mobileNav} aria-label="Mobile navigation">
        {[['Features', '#features'], ['Sales channels', '#sales-channels'], ['Daybooks', '#daybooks'], ['Wholesale', '#wholesale'], ['Pricing', '#pricing'], ['Integrations', '#integrations']].map(([label, href]) => <a key={href} href={href} onClick={() => setMenuOpen(false)}>{label}</a>)}
        <Link href="/login">Sign In</Link><button className={styles.primary} onClick={() => { setMenuOpen(false); setDemoOpen(true); }}>Book a Demo <ArrowRight size={16} /></button>
      </nav>}
    </header>

    <main id="main">
      <section className={styles.hero}>
        <Image src="/landing/pos-cashier.jpg" alt="A retailer serving a customer at the shop counter" fill priority sizes="100vw" className={styles.heroImage} />
        <div className={styles.heroShade} />
        <div className={`${styles.container} ${styles.heroContent}`}>
          <p className={styles.eyebrow}>Built with retailers and wholesalers</p>
          <h1>Solvantis for retail and wholesale</h1>
          <p className={styles.heroIntro}>Your stock, sales, storefronts and daily store work. Connected.</p>
          <p className={styles.heroDetail}>From the shop floor to the warehouse and the next online order, run the work that fills your day in one practical platform.</p>
          <div className={styles.actions}><Link href="/register" className={styles.primary}>Get Started <ArrowRight size={18} /></Link><button className={styles.secondary} onClick={() => setDemoOpen(true)}>Book a Demo</button></div>
          <p className={styles.heroOffer}>3 months of Starter for a one-time $1 payment. Normal Starter pricing applies afterwards. AUD excluding GST.</p>
        </div>
      </section>

      <section className={styles.offer} aria-label="Introductory offer"><div className={styles.container}><p><strong>3 months of Starter for $1.</strong> One payment to get started. Normal pricing applies after the offer unless cancelled beforehand.</p><Link href="/register">Get Started <ArrowRight size={17} /></Link></div></section>

      <section className="bg-white py-16 border-b border-slate-100" aria-label="Platform commitments"><div className="max-w-7xl mx-auto px-6 lg:px-8"><div className="grid grid-cols-1 sm:grid-cols-3 gap-8 text-center">
        <div><p className="text-4xl font-black text-blue-600 leading-tight">Aussie Based</p><p className="text-sm text-slate-500 mt-1 font-medium">Support Team</p></div>
        <div><p className="text-4xl font-black text-blue-600 leading-tight">Practical Workflows</p><p className="text-sm text-slate-500 mt-1 font-medium">Shaped with retailers and wholesalers</p></div>
        <div><p className="text-4xl font-black text-blue-600">99.9%</p><p className="text-sm text-slate-500 mt-1 font-medium">Platform Uptime</p></div>
      </div></div></section>

      <section id="story" className={styles.story}><div className={`${styles.container} ${styles.twoColumns}`}>
        <SectionHeading label="Our story" title="Built with operators. Shaped by everyday work.">After more than 20 years running retail operations, we know the work does not stop at checkout. Solvantis has been shaped through close collaboration with retailers and wholesalers to tackle the problems that keep coming back.</SectionHeading>
        <div className={styles.storyDetail}><p>Receiving a delivery that arrives in parts. Leaving a clear handover for the next shift. Helping a wholesale buyer reorder. Keeping several storefronts aligned without losing control of each one.</p><p>Those are not edge cases. They are the working day. We bring the workflows together so the team can work from the same operational picture.</p><a href="#daybooks" className={styles.textLink}>See daily store operations <ArrowRight size={17} /></a></div>
      </div></section>

      <section id="inventory" className={styles.section}><div className={`${styles.container} ${styles.twoColumns}`}>
        <div><SectionHeading label="Inventory & purchasing" title="Know what is available. Not just what is on the shelf.">Keep products, suppliers, stock and customer demand together, from the next delivery to the last unit of a split order.</SectionHeading>
          <Bullets items={['On-hand, committed, incoming and available stock', 'Products, variants and supplier purchasing', 'Partial receiving and incremental order fulfilment', 'Allocations, backorders and outstanding-order follow-up', 'Branch transfers and stocktakes with an audit trail', 'Multi-currency purchasing where included in your plan']} />
          <a href="#features" className={styles.textLink}>Explore Inventory <ArrowRight size={17} /></a>
        </div>
        <figure className={styles.productFigure}><Image src="/landing/sales-order.jpg" alt="Solvantis sales order workspace" width={1000} height={700} sizes="(max-width: 800px) 92vw, 540px" /><figcaption>Stock and customer orders in the same operation.</figcaption></figure>
      </div></section>

      <section id="sales-channels" className={`${styles.section} ${styles.commerce}`}><div className={styles.container}>
        <SectionHeading label="Connected sales channels" title="Several storefronts. One connected operation.">Sell in store, online and to trade customers without making every channel a separate stock-management job.</SectionHeading>
        <div className={styles.featureGrid}>
          <Feature icon={Network} title="Multiple Shopify stores">Connect stores separately, with their own product rules, inventory settings, orders and accounting configuration.</Feature>
          <Feature icon={ShoppingBag} title="Amazon Australia">Supported seller-fulfilled workflows and existing-ASIN offers, with seller-account readiness checks before activation.</Feature>
          <Feature icon={Store} title="Your own Online Shop">A native Solvantis storefront, independent of Shopify, with supported checkout, loyalty and store-credit workflows.</Feature>
        </div>
        <div className={styles.dispatch}><Truck size={27} aria-hidden="true" /><div><h3>From the order to the parcel</h3><p>Keep fulfilment, dispatch and tracking connected. Configured Australia Post eParcel services support quotes, labels and manifests.</p></div><a href="#integrations" className={styles.textLink}>Shipping & integrations <ArrowRight size={17} /></a></div>
        <p className={styles.note}>Provider capabilities and setup differ. Connections and capacity follow your plan; Amazon support here is for Australia, not a blanket promise of FBA or international marketplaces.</p>
      </div></section>

      <section id="pos" className={styles.section}><div className={`${styles.container} ${styles.twoColumns}`}>
        <figure className={styles.productFigure}><Image src="/landing/pos1.jpg" alt="Solvantis POS payment screen with cash, card and gift-card options" width={867} height={538} sizes="(max-width: 800px) 92vw, 540px" /><figcaption>Checkout that connects to the rest of the working day.</figcaption></figure>
        <div><SectionHeading label="Point of Sale" title="Built for the counter. Connected beyond it.">Find products, serve customers and close the register with the stock and customer context your staff need.</SectionHeading>
          <Bullets items={['Search by name, SKU or barcode', 'Integrated Zeller EFTPOS, cash and split payments', 'Parked sales and layby deposit tracking', 'Linked returns, store credit and eligible loyalty rewards', 'Staff permissions, register closing and end-of-day reconciliation']} />
          <p className={styles.note}>Supported ordinary checkout can continue while disconnected and sync later. Online-dependent actions, including loyalty and return workflows, require a connection.</p>
          <a href="#features" className={styles.textLink}>Explore POS <ArrowRight size={17} /></a>
        </div>
      </div></section>

      <section id="daybooks" className={`${styles.section} ${styles.daybooks}`}><div className={styles.container}>
        <div className={styles.twoColumns}><SectionHeading label="Store Daybooks" title="Keep every store's day on track.">The opening checklist, the shift handover and the warehouse request should not depend on who happens to remember them.</SectionHeading>
          <div><Bullets items={['Opening, daily, weekly and closing sign-offs', 'Staff notices with read acknowledgements', 'Customer follow-up, incidents and product references', 'Store supplies and stock requests with warehouse progress']} /><p className={styles.note}>Daybook requests coordinate the work. They do not themselves move stock or record sales; stock movements use the relevant inventory workflow.</p></div>
        </div>
        <div className={styles.daySequence}>{[
          ['Open with a plan', 'Complete checklists and read the notices that matter for your location.'],
          ['Keep work moving', 'Record requests, follow up customers and track warehouse progress.'],
          ['Hand over clearly', 'Leave the next shift a record of what is done and what still needs attention.'],
        ].map(([title, description], index) => <article key={title}><span className={styles.stepNumber}>{String(index + 1).padStart(2, '0')}</span><h3>{title}</h3><p>{description}</p></article>)}</div>
      </div></section>

      <section id="wholesale" className={styles.section}><div className={styles.container}>
        <SectionHeading label="Wholesale & distribution" title="Make repeat wholesale orders easier.">Give approved buyers a practical way to order, while your team keeps control of pricing, stock and fulfilment.</SectionHeading>
        <div className={styles.featureGrid}>
          <Feature icon={UsersRound} title="A catalogue for your buyers">Approved access, product visibility and customer pricing tiers. Buyers order from the catalogue intended for them.</Feature>
          <Feature icon={ClipboardCheck} title="Less rebuilding the same order">Saved lists, draft baskets and repeat ordering help regular buyers prepare their next order.</Feature>
          <Feature icon={Boxes} title="Back into your operation">Review and fulfil submitted orders using shared stock records. Keep buyer history and configured account terms close at hand.</Feature>
        </div>
        <p className={styles.note}>The wholesale portal is included on Core, Scale and Enterprise. Indent ordering and customer terms depend on your configuration.</p>
        <a href="#pricing" className={styles.textLink}>Compare wholesale-ready plans <ArrowRight size={17} /></a>
      </div></section>

      <section id="workflows" className={`${styles.section} ${styles.soft}`}><div className={styles.container}>
        <SectionHeading label="Practical AI workflows" title="Start with useful work. Keep the final say.">Prepare documents, product content and imagery for human review instead of starting from a blank page.</SectionHeading>
        <div className={styles.videoGrid}>{workflows.map(workflow => {
          const Icon = workflow.icon;
          return <article className={styles.videoCard} key={workflow.title}>
            <button className={styles.videoPreview} aria-label={`Play ${workflow.title} walkthrough`} onClick={event => { videoTriggerRef.current = event.currentTarget; setActiveVideo(workflow); }}>
              <video src={workflow.src} muted playsInline preload="metadata" aria-hidden="true" tabIndex={-1} />
              <span className={styles.play}><Play size={25} fill="currentColor" aria-hidden="true" /></span>
            </button>
            <div className={styles.videoCopy}><p className={styles.videoLabel}><Icon size={17} aria-hidden="true" />{workflow.label}</p><h3>{workflow.title}</h3><p>{workflow.description}</p><ol>{workflow.steps.map(step => <li key={step}>{step}</li>)}</ol></div>
          </article>;
        })}</div>
        <p className={styles.note}>Generative and agentic actions use separately purchased AI credits. Standard reports and non-generative calculations do not consume credits.</p>
      </div></section>

      <section id="analytics" className={styles.section}><div className={`${styles.container} ${styles.twoColumns}`}>
        <div><SectionHeading label="Reporting & analysis" title="See what needs your attention next.">Compare locations, understand margin and spot the products that are moving, or not moving, before your next buying decision.</SectionHeading><Bullets items={['Sales by branch, channel, product and date range', 'Stock turnover, best sellers and slow movers', 'Gross margin and branch performance comparisons', 'Connected marketing analysis where enabled', 'AI-assisted planning with reviewable evidence and scenarios']} /></div>
        <figure className={styles.productFigure}><Image src="/landing/stock-analytics.jpg" alt="Solvantis inventory analytics overview" width={1000} height={700} sizes="(max-width: 800px) 92vw, 540px" /><figcaption>Operational reporting grounded in retail activity.</figcaption></figure>
      </div></section>

      <section id="features" className={`${styles.section} ${styles.soft}`}><div className={styles.container}><SectionHeading label="The connected platform" title="The whole operation, not another isolated tool.">From checkout to replenishment, customer service and wholesale orders, the parts work together.</SectionHeading><SolvantisCapabilityMap refreshed /></div></section>

      <section id="integrations" className={styles.section}><div className={styles.container}>
        <SectionHeading label="Integrations" title="Reduce duplicate entry. Keep control.">Connect the systems you already use, with setup and supported workflows confirmed for your operation.</SectionHeading>
        <dl className={styles.integrationGrid}>{[
          ['Xero', 'Retail accounting, payment clearing and reconciliation.'],
          ['Shopify', 'Multiple stores with separate product, stock and order settings.'],
          ['Amazon Australia', 'Configured seller-fulfilled channels and existing-ASIN offers.'],
          ['Australia Post eParcel', 'Configured shipping quotes, labels, tracking and manifests.'],
          ['Zeller', 'Supported integrated EFTPOS at the counter.'],
          ['Cin7', 'Product, stock and purchasing alignment with agreed ownership.'],
          ['Google & Meta', 'Supported business tools and marketing analysis where enabled.'],
          ['Supported 3PLs', 'Standard workflows on Scale and Enterprise; provider fit confirmed.'],
        ].map(([name, description]) => <div key={name}><dt>{name}</dt><dd>{description}</dd></div>)}</dl>
        <p className={styles.note}>Integration allowances vary by plan. Specialist connectors, complex workflows and third-party charges may require separate scope and quotation.</p>
      </div></section>

      <section id="customers" className={`${styles.section} ${styles.customerBand}`}><div className={`${styles.container} ${styles.twoColumns}`}>
        <SectionHeading label="Customers & loyalty" title="Know the customer behind the next order.">Bring purchase history, pricing, linked returns and customer value into the same view your staff use to serve people.</SectionHeading>
        <div><Bullets items={['Customer profiles and retail or wholesale pricing', 'Configurable loyalty earning on eligible purchases', 'Eligible reward redemption and supported online loyalty', 'Store credit with linked return and transaction history']} /><p className={styles.note}>Shopify and native-shop workflows depend on setup and provider support. Customer matching and reward rules are confirmed during onboarding.</p></div>
      </div></section>

      <section id="pricing" className={styles.section}><div className={styles.container}><SectionHeading label="Plans & pricing" title="A foundation for today. Room for what comes next.">Choose the capacity and support that fit your operation. All prices are AUD excluding GST.</SectionHeading><PricingPlanCards /></div></section>

      <section id="daily-work" className={`${styles.section} ${styles.soft}`}><div className={styles.container}>
        <SectionHeading label="Everyday workflows" title="For the problems that keep coming back." />
        <div className={styles.featureGrid}><Feature icon={ClipboardCheck} title="A shift without the guesswork">Check notices and follow-ups in the Daybook, then leave the next team a clear handover.</Feature><Feature icon={Network} title="Another storefront, not another stock silo">Keep the connection and product rules separate while bringing supported orders into the same operation.</Feature><Feature icon={Store} title="A buyer's regular reorder">Let an approved wholesale buyer prepare the order, then review it against the stock and terms you manage.</Feature></div>
      </div></section>

      <section id="demo" className={styles.demo}><div className={styles.container}><p className={styles.eyebrow}>Let's talk about your operation</p><h2>Bring us the work that gets in your way.</h2><p>Tell us about your stores, warehouse, storefronts and wholesale buyers. We will walk through where Solvantis fits and what needs a closer look.</p><div className={styles.actions}><button className={styles.primary} onClick={() => setDemoOpen(true)}>Book a Demo <ArrowRight size={18} /></button><Link href="/register" className={styles.textLink}>Get Started <ArrowRight size={18} /></Link></div></div></section>
    </main>

    <footer className={styles.footer}><div className={styles.container}><div className={styles.footerTop}><div><Link href={sourcePath} className={styles.brand}><SolvantisMark size={30} /><span>Solvantis</span></Link><p>Connected retail and wholesale operations.<br />Shaped with the people doing the work.</p></div><nav aria-label="Product links">{[['Inventory', '#inventory'], ['POS', '#pos'], ['Daybooks', '#daybooks'], ['Sales channels', '#sales-channels'], ['Wholesale', '#wholesale'], ['Integrations', '#integrations'], ['Pricing', '#pricing']].map(([label, href]) => <a key={href} href={href}>{label}</a>)}</nav><div><a href="mailto:sales@solvantis.com">sales@solvantis.com</a><button onClick={() => setDemoOpen(true)}>Book a Demo <ArrowRight size={16} /></button><Link href="/login">Sign In</Link></div></div><p className={styles.copyright}>Copyright {new Date().getFullYear()} Solvantis. All rights reserved.</p></div></footer>

    {activeVideo && <div className={styles.videoBackdrop} role="dialog" aria-modal="true" aria-labelledby="workflow-title" onClick={event => { if (event.target === event.currentTarget) setActiveVideo(null); }}><div ref={videoDialogRef} className={styles.videoDialog}><div><h2 id="workflow-title">{activeVideo.title}</h2><button ref={videoCloseRef} onClick={() => setActiveVideo(null)} aria-label="Close walkthrough" title="Close walkthrough"><X size={22} /></button></div><video key={activeVideo.src} src={activeVideo.src} controls autoPlay playsInline preload="metadata" tabIndex={0} /></div></div>}
    <ProspectSalesAssistant sourcePath={sourcePath} />
    <ProspectLeadDialog open={demoOpen} sourcePath={sourcePath} onClose={() => setDemoOpen(false)} />
  </div>;
}