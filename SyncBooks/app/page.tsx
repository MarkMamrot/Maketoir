import {
  ArrowRight, BadgeCheck, BarChart3, Building2, CalendarCheck, Check,
  ChevronDown, CircleDollarSign, Clock3, Globe2, Headphones, Landmark,
  LockKeyhole, Menu, RefreshCw, ShieldCheck, Sparkles, Users, X,
} from "lucide-react";
import { ConsultationForm } from "@/components/consultation-form";
import { faqs, pricingTiers, services, softwarePlatforms } from "@/lib/site-content";

const deliveryModels = [
  { icon: Building2, label: "Local", title: "Close to your business", description: "Australian-based support for teams that value shared working hours, local context and direct collaboration.", detail: "Best for advisory proximity and onshore preference" },
  { icon: Globe2, label: "Overseas", title: "More capacity, thoughtfully matched", description: "Experienced offshore bookkeepers for dependable processing, extended coverage and greater cost flexibility.", detail: "Best for routine workflows and scalable support" },
  { icon: RefreshCw, label: "Blended", title: "The practical middle ground", description: "Combine an Australian point of contact with an overseas delivery team for continuity, oversight and value.", detail: "Best for growing or operationally complex teams" },
];

const serviceIcons = [Landmark, Users, BarChart3, RefreshCw, Clock3, ShieldCheck];

function Brand({ light = false }: { light?: boolean }) {
  return (
    <a className={`brand${light ? " brand-light" : ""}`} href="#top" aria-label="SyncBooks home">
      <span className="brand-mark" aria-hidden="true"><span /><span /><span /></span>
      <span>SyncBooks</span>
    </a>
  );
}

export default function Home() {
  return (
    <div className="site-shell">
      <header className="site-header">
        <Brand />
        <nav className="desktop-nav" aria-label="Primary navigation">
          <a href="#how-it-works">How it works</a><a href="#services">Services</a>
          <a href="#pricing">Pricing</a><a href="#faq">FAQ</a>
        </nav>
        <a className="button button-small desktop-cta" href="#consultation">Free consultation <ArrowRight size={16} /></a>
        <details className="mobile-menu">
          <summary aria-label="Open navigation"><Menu className="menu-open" size={22} /><X className="menu-close" size={22} /></summary>
          <nav aria-label="Mobile navigation">
            <a href="#how-it-works">How it works</a><a href="#services">Services</a>
            <a href="#pricing">Pricing</a><a href="#faq">FAQ</a>
            <a className="button button-small" href="#consultation">Free consultation</a>
          </nav>
        </details>
      </header>

      <main>
        <section className="hero" id="top">
          <div className="hero-content reveal">
            <div className="eyebrow"><BadgeCheck size={16} /> Bookkeeping matched to your business</div>
            <h1>Better books.<br /><em>Better business.</em></h1>
            <p className="hero-lead">SyncBooks connects Australian businesses with experienced local and overseas bookkeepers who understand your software, your workflow and what needs to happen next.</p>
            <div className="hero-actions">
              <a className="button" href="#consultation">Request a free consultation <ArrowRight size={18} /></a>
              <a className="text-link" href="#pricing">View indicative pricing</a>
            </div>
            <div className="trust-line"><span><Check size={15} /> Flexible delivery</span><span><Check size={15} /> Software-matched</span><span><Check size={15} /> No lock-in contracts</span></div>
          </div>

          <div className="hero-visual reveal reveal-delay" aria-label="Bookkeeping overview example">
            <div className="visual-topbar"><div><span className="status-dot" /> Books overview</div><span>August 2026</span></div>
            <div className="visual-heading"><span>Ready for review</span><strong>92%</strong></div>
            <div className="progress-track"><span /></div>
            <div className="metric-grid">
              <div className="metric metric-green"><CircleDollarSign size={20} /><span>Reconciled</span><strong>184</strong><small>transactions</small></div>
              <div className="metric"><CalendarCheck size={20} /><span>Month-end</span><strong>3</strong><small>tasks remaining</small></div>
            </div>
            <div className="activity-card">
              <div className="activity-heading"><span>Processing rhythm</span><small>On track</small></div>
              <div className="bars">{[38,62,49,78,66,88,72,94,82,100,91,96].map((height, index) => <span key={index} style={{ height: `${height}%` }} />)}</div>
              <div className="bar-labels"><span>Week 1</span><span>Week 2</span><span>Week 3</span><span>Week 4</span></div>
            </div>
            <div className="bookkeeper-chip"><span className="avatar">AM</span><span><strong>Your matched bookkeeper</strong><small>Next check-in: Thursday, 10am</small></span><Headphones size={19} /></div>
          </div>
        </section>

        <section className="software-strip" aria-label="Software expertise">
          <p>Experienced across the tools your business already uses</p>
          <div>{softwarePlatforms.map((platform) => <span key={platform}>{platform}</span>)}<span>and more</span></div>
        </section>

        <section className="section process-section" id="how-it-works">
          <div className="section-heading centered"><span className="section-kicker">A more considered match</span><h2>Bookkeeping that fits how you operate</h2><p>Start with the business, not a generic package. We learn what matters, find the right capability and set a clear working rhythm.</p></div>
          <div className="process-grid">
            <article><span className="step-number">01</span><Sparkles size={23} /><h3>Tell us what is happening</h3><p>We discuss your team, systems, volume, pain points and what good support should look like.</p></article>
            <article><span className="step-number">02</span><Users size={23} /><h3>Meet your best-fit bookkeeper</h3><p>We match the experience, availability and delivery model to the real work your business needs done.</p></article>
            <article><span className="step-number">03</span><CalendarCheck size={23} /><h3>Settle into a clear rhythm</h3><p>Agree priorities, access and check-ins, then keep the books moving with consistent oversight.</p></article>
          </div>
        </section>

        <section className="delivery-section"><div className="section delivery-inner">
          <div className="section-heading light"><span className="section-kicker">Built around your priorities</span><h2>Local knowledge. Global talent. One clear standard.</h2><p>Choose the model that suits your working hours, budget and need for onshore contact. We will help you weigh the options honestly.</p></div>
          <div className="delivery-grid">{deliveryModels.map((model) => { const Icon = model.icon; return <article key={model.label}><div className="delivery-label"><Icon size={19} />{model.label}</div><h3>{model.title}</h3><p>{model.description}</p><small>{model.detail}</small></article>; })}</div>
        </div></section>

        <section className="section services-section" id="services">
          <div className="section-heading split-heading"><div><span className="section-kicker">The work, handled</span><h2>A dependable finance function, without the full-time hire</h2></div><p>From recurring processing to untangling a backlog, your support is shaped around the work and reviewed as the business changes.</p></div>
          <div className="services-grid">{services.map((service, index) => { const Icon = serviceIcons[index]; return <article key={service.title}><Icon size={22} /><h3>{service.title}</h3><p>{service.description}</p></article>; })}</div>
          <div className="services-note"><LockKeyhole size={18} /><p>Your bookkeeper works within agreed access, review and handover processes. SyncBooks can collaborate with your existing accountant or registered BAS agent.</p></div>
        </section>

        <section className="pricing-section" id="pricing"><div className="section pricing-inner">
          <div className="section-heading centered"><span className="section-kicker">Indicative monthly pricing</span><h2>Start with a clear benchmark</h2><p>Packages give you a useful starting point. We confirm the right scope after learning about your volume and workflow.</p></div>
          <div className="pricing-grid">{pricingTiers.map((tier) => (
            <article className={`pricing-card${tier.recommended ? " recommended" : ""}`} key={tier.name}>
              {tier.recommended && <span className="popular">Most popular</span>}
              <div className="pricing-card-head"><h3>{tier.name}</h3><p>{tier.summary}</p></div>
              <div className="price">{tier.price.startsWith("$") && <small>from</small>}<strong>{tier.price}</strong>{tier.price.startsWith("$") && <span>/ month</span>}</div>
              <ul><li><Clock3 size={16} />{tier.hours}</li><li><Users size={16} />{tier.employees}</li><li><RefreshCw size={16} />{tier.frequency}</li><li><BarChart3 size={16} />{tier.reporting}</li><li><Check size={16} />{tier.payroll}</li><li><Globe2 size={16} />{tier.delivery}</li></ul>
              <a className={`button${tier.recommended ? "" : " button-outline"}`} href="#consultation">Discuss this package <ArrowRight size={17} /></a>
            </article>
          ))}</div>
          <p className="pricing-disclaimer">Prices are indicative, exclude GST and are subject to scope. Final pricing depends on transaction volume, complexity, payroll cycles, software and delivery model.</p>
        </div></section>

        <section className="section reassurance-section">
          <div className="reassurance-copy"><span className="section-kicker">Confidence in the process</span><h2>Good bookkeeping should make the business feel lighter</h2><p>Clear ownership, regular check-ins and work you can review. No mystery about who is doing what or where things stand.</p></div>
          <div className="reassurance-points">
            <div><ShieldCheck size={22} /><span><strong>Defined access</strong><small>Appropriate permissions and documented handovers</small></span></div>
            <div><CalendarCheck size={22} /><span><strong>Visible rhythm</strong><small>Agreed processing days, priorities and check-ins</small></span></div>
            <div><Headphones size={22} /><span><strong>Human support</strong><small>A clear contact when the work or scope changes</small></span></div>
          </div>
        </section>

        <section className="faq-section" id="faq"><div className="section faq-inner">
          <div className="section-heading faq-heading"><span className="section-kicker">Frequently asked</span><h2>A few useful answers before we talk</h2></div>
          <div className="faq-list">{faqs.map((faq) => <details key={faq.question}><summary>{faq.question}<ChevronDown size={20} /></summary><p>{faq.answer}</p></details>)}</div>
        </div></section>

        <section className="consultation-section" id="consultation"><div className="section consultation-inner">
          <div className="consultation-copy"><span className="section-kicker">Free initial consultation</span><h2>Tell us what needs to work better</h2><p>Share a little about your business and we will start with the right questions. No hard sell and no obligation.</p><div className="consultation-points"><span><Check size={16} />A practical scope discussion</span><span><Check size={16} />Local, overseas and blended options</span><span><Check size={16} />Indicative next steps and pricing</span></div></div>
          <ConsultationForm />
        </div></section>
      </main>

      <footer><div className="footer-main"><Brand light /><p>Better bookkeeping connections for Australian businesses.</p><nav aria-label="Footer navigation"><a href="#how-it-works">How it works</a><a href="#services">Services</a><a href="#pricing">Pricing</a><a href="#consultation">Contact</a></nav></div><div className="footer-legal"><span>© 2026 SyncBooks. Prototype website.</span><span>Bookkeeping support is not tax or financial advice.</span></div></footer>
    </div>
  );
}
