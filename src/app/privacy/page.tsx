import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'Privacy Policy | Solvantis',
  description: 'How Solvantis collects, uses, shares, protects and retains personal information across its website, retail platform and connected services, and how to make a privacy request.',
};

export default function PrivacyPage() {
  return (
    <main className="min-h-screen bg-slate-50 px-6 py-14 text-slate-800" style={{ fontFamily: 'Inter, sans-serif' }}>
      <article className="mx-auto max-w-3xl">
        <Link href="/" className="text-sm font-semibold text-blue-700 hover:underline">Back to Solvantis</Link>
        <p className="mt-10 text-xs font-bold uppercase text-blue-700">Privacy</p>
        <h1 className="mt-2 text-4xl font-black text-slate-950">Privacy policy</h1>
        <p className="mt-4 text-sm text-slate-500">Last updated: <time dateTime="2026-10-16">16 October 2026</time></p>
        <p className="mt-5 text-base leading-relaxed text-slate-600">Solvantis helps Australian retailers manage stock, sales, purchasing and dispatch. This policy explains how we handle personal information through our public website, enquiries, assistants, business accounts, retail workflows and connected services. It also explains how to ask about, correct or request deletion of information.</p>
        <p className="mt-3 leading-relaxed text-slate-600">Additional requirements apply to Amazon seller and buyer information. Read this policy together with our <Link href="/amazon-data-handling" className="font-semibold text-blue-700 hover:underline">Amazon data handling notice</Link>, which describes the integration&apos;s specific uses and disposal limitations.</p>

        <nav aria-label="Privacy policy sections" className="mt-8 rounded-xl border border-slate-200 bg-white p-5">
          <p className="font-semibold text-slate-950">In this policy</p>
          <ul className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
            <li><a href="#scope" className="text-blue-700 hover:underline">Our role and retailer responsibilities</a></li>
            <li><a href="#information" className="text-blue-700 hover:underline">Information and its sources</a></li>
            <li><a href="#uses" className="text-blue-700 hover:underline">How information is used</a></li>
            <li><a href="#assistants" className="text-blue-700 hover:underline">Assistants and enquiries</a></li>
            <li><a href="#sharing" className="text-blue-700 hover:underline">Sharing and overseas processing</a></li>
            <li><a href="#security" className="text-blue-700 hover:underline">Security and account activity</a></li>
            <li><a href="#retention" className="text-blue-700 hover:underline">Retention and deletion</a></li>
            <li><a href="#requests" className="text-blue-700 hover:underline">Privacy requests and complaints</a></li>
          </ul>
        </nav>

        <div className="mt-10 space-y-9 border-t border-slate-200 pt-9">
          <section id="scope">
            <h2 className="text-xl font-bold text-slate-950">1. Our role and retailer responsibilities</h2>
            <p className="mt-3 leading-relaxed">We handle website enquiries, Solvantis account details and service-security information to operate our own service. We also process information that retailers and their authorised users enter, import or connect to Solvantis to run their businesses.</p>
            <p className="mt-3 leading-relaxed">When a retailer uses Solvantis to manage its customers, staff, suppliers or orders, the retailer determines the business purpose and the workflows it enables. Its own privacy notice, customer communications and legal obligations also apply. Retailers should collect and share only information they are authorised to use, keep records accurate and give their staff appropriate access.</p>
            <p className="mt-3 leading-relaxed">If you bought from a retailer using Solvantis, contact that retailer first about your purchase or customer record. We can help route a privacy request, but must verify authority before disclosing or changing the retailer&apos;s records.</p>
          </section>
          <section id="information">
            <h2 className="text-xl font-bold text-slate-950">2. Information we collect and its sources</h2>
            <p className="mt-3 leading-relaxed">The information processed depends on how you use the service and which features a retailer enables. It can include:</p>
            <ul className="mt-3 list-disc space-y-2 pl-6 leading-relaxed">
              <li><strong>Enquiry information:</strong> your name, email or phone number, preferred contact channel, business details and messages you choose to submit.</li>
              <li><strong>Account and team information:</strong> names, sign-in email addresses, business memberships, roles, invitations and authentication settings.</li>
              <li><strong>Retail records:</strong> customer and supplier contact details, billing and delivery addresses, orders, receipts, purchase history, returns, refunds, loyalty and store-credit records, and relevant notes or documents.</li>
              <li><strong>Connected-service information:</strong> authorised seller or store identifiers, listings, stock, orders, shipments, accounting records, marketing information and credentials needed for enabled integrations.</li>
              <li><strong>Support and assistant information:</strong> questions, responses, feedback, attachments and the context needed to handle a request.</li>
              <li><strong>Technical and security information:</strong> request times, IP addresses where recorded, browser descriptions, approximate network-derived location, session identifiers, errors and activity relevant to service protection.</li>
            </ul>
            <p className="mt-3 leading-relaxed">We receive information directly from you, from the retailer and its authorised users, from connected providers under the retailer&apos;s authorisation, and from your browser or the networks delivering the service. You can choose not to submit optional information, but some account, checkout, delivery or integration functions cannot operate without the necessary details.</p>
            <p className="mt-3 leading-relaxed">Do not enter sensitive personal information, identity documents, passwords or complete payment-card details into general notes, support messages or assistants. Use only the dedicated protected fields required for a supported workflow.</p>
          </section>
          <section id="uses">
            <h2 className="text-xl font-bold text-slate-950">3. How we use information</h2>
            <ul className="mt-3 list-disc space-y-2 pl-6 leading-relaxed">
              <li>Provide accounts, business access and the retail functions selected by the retailer.</li>
              <li>Process sales, purchasing, stock, fulfilment, returns, payments and reconciliation workflows.</li>
              <li>Synchronise information with authorised integrations and show relevant reports.</li>
              <li>Respond to enquiries, provide support and send necessary account or service messages.</li>
              <li>Protect accounts, investigate errors or suspected misuse, and maintain reliable service.</li>
              <li>Understand product demand, improve guidance and meet applicable recordkeeping or legal requirements.</li>
            </ul>
            <p className="mt-3 leading-relaxed">We do not sell Amazon Information or use Amazon buyer information for advertising or unrelated marketing. A retailer&apos;s connection to a service does not by itself give consent for promotional messages to its customers.</p>
          </section>
          <section id="assistants">
            <h2 className="text-xl font-bold text-slate-950">4. Sales Assistant and AI-assisted features</h2>
            <p className="mt-3 leading-relaxed">The public Sales Assistant stores questions and responses so a conversation can continue across public Solvantis pages and authorised team members can review product demand and unanswered needs. It uses public product guidance, not access to a retailer&apos;s live operational records.</p>
            <p className="mt-3 leading-relaxed">AI-assisted features use Google&apos;s Gemini services. Your prompt, relevant conversation context and information needed for the selected feature may be sent to the AI provider to generate a response. In signed-in workspaces, supported live checks are scoped to the verified account, business and permitted functions; they are separate from the public Sales Assistant.</p>
            <p className="mt-3 leading-relaxed">AI responses can be incomplete or inaccurate. Review them before making business decisions or taking action, and avoid including personal information that is not needed for the task. This policy does not promise that all AI processing occurs in Australia or that every provider has the same retention terms.</p>
            <p className="mt-3 leading-relaxed">Use <strong>Delete conversation</strong> in the public assistant to remove the messages associated with that conversation in your current browser session. This does not automatically remove a separately submitted contact request, related email correspondence, security records or backup copies. Contact us if your request needs to cover those records as well.</p>
          </section>
          <section>
            <h2 className="text-xl font-bold text-slate-950">5. Enquiries and communications</h2>
            <p className="mt-3 leading-relaxed">When you submit a contact request, we use your name, chosen contact detail, preferred channel and optional business context to respond. Contact consent applies to the channel selected in the form; it is not inferred simply from browsing the website or using the assistant.</p>
            <p className="mt-3 leading-relaxed">Tell us if you no longer want enquiry follow-up or promotional contact. Necessary security, account, transaction or service communications may still be required. A retailer is responsible for the customer communications it initiates through its own workflows and connected marketing services.</p>
          </section>
          <section>
            <h2 className="text-xl font-bold text-slate-950">6. Cookies, browser storage and attribution</h2>
            <p className="mt-3 leading-relaxed">We use cookies and browser storage for sign-in, session continuity, preferences and supported retail functions. The public Sales Assistant uses a browser-session cookie with a 30-day lifetime to recognise its conversation session. POS features also use local browser storage for device settings, cached catalogue information and supported offline work.</p>
            <p className="mt-3 leading-relaxed">We may record the page, referral and campaign that brought you to Solvantis. The public assistant uses a keyed network/browser fingerprint for abuse prevention rather than storing the raw IP address in its conversation records. Authentication and infrastructure logs may separately contain IP addresses.</p>
            <p className="mt-3 leading-relaxed">You can manage cookies and stored site data through your browser. Blocking or clearing them may sign you out, break conversation continuity or affect POS data and unsynchronised work. On shared devices, follow the retailer&apos;s sign-out and device-security procedures rather than relying only on closing a tab.</p>
          </section>
          <section id="sharing">
            <h2 className="text-xl font-bold text-slate-950">7. When information is shared</h2>
            <p className="mt-3 leading-relaxed">Information is available to authorised retailer users and to service providers where needed to deliver the relevant function. Depending on the services in use, recipients include:</p>
            <ul className="mt-3 list-disc space-y-2 pl-6 leading-relaxed">
              <li><strong>Railway:</strong> application hosting and database services.</li>
              <li><strong>Cloudflare:</strong> delivery and protection of public web traffic where enabled.</li>
              <li><strong>Google:</strong> AI processing and the Google services a retailer chooses to connect.</li>
              <li><strong>Email providers, including Resend:</strong> delivery of supported account, enquiry and service notifications.</li>
              <li><strong>Connected commerce and accounting providers:</strong> Amazon, Shopify, Cin7, Xero and other supported services, according to the connection and workflow authorised by the retailer.</li>
              <li><strong>Australia Post and payment providers:</strong> recipient and parcel details for supported shipping, or payment information for the selected checkout or POS payment method.</li>
              <li><strong>Connected marketing providers:</strong> information needed for the retailer&apos;s enabled marketing workflows, subject to the relevant permissions and consent requirements.</li>
            </ul>
            <p className="mt-3 leading-relaxed">Not every provider receives every type of information. We may also disclose information where legally required or reasonably necessary to investigate fraud, protect people or secure the service. Providers&apos; own privacy terms apply to their handling of information. Additional processors receiving Amazon Information require separate review and authorisation.</p>
          </section>
          <section>
            <h2 className="text-xl font-bold text-slate-950">8. Overseas storage and processing</h2>
            <p className="mt-3 leading-relaxed">Solvantis uses cloud infrastructure and connected providers that may store, process or support information outside Australia. Relevant locations can differ between hosting, backups, email, AI and retailer-selected integrations; an application hosting location does not determine where every provider processes information.</p>
            <p className="mt-3 leading-relaxed">Do not assume that all information remains in Australia or that all copies are held in one country. Contact us before providing information if a particular residency restriction is important to your business, so we can confirm the applicable services and locations rather than make a general residency guarantee.</p>
          </section>
          <section>
            <h2 className="text-xl font-bold text-slate-950">9. Payments</h2>
            <p className="mt-3 leading-relaxed">Supported payment providers process payment details for the checkout or POS method selected by the retailer. Solvantis records transaction references, amounts, payment status and reconciliation information needed for the sale. The native online shop uses Stripe checkout components; do not send complete card numbers, card security codes or banking passwords through notes, email, support or chat.</p>
          </section>
          <section id="security">
            <h2 className="text-xl font-bold text-slate-950">10. Security and authorised access</h2>
            <p className="mt-3 leading-relaxed">Solvantis applies business-scoped access checks, protected sign-in, password hashing and encryption of stored integration credentials. Named back-office accounts use password and multi-factor authentication controls. Cashier PIN access and separate customer sign-ins follow their own workflows; they should not be treated as identical to back-office MFA.</p>
            <p className="mt-3 leading-relaxed">Railway reports AES-256 encryption at rest for its volume storage. This is provider-managed storage protection, not a claim that every personal-information field has separate application-level encryption. Exported files, downloaded labels, screenshots and copies on retailer devices require their own protection.</p>
            <p className="mt-3 leading-relaxed">Access by Solvantis personnel is limited to work needed to operate, support or secure the service. No system can guarantee absolute security. Report suspected unauthorised access promptly using the contact below, without sending passwords, tokens or unnecessary customer information. We assess suspected incidents, take appropriate containment and recovery steps and make notifications required by applicable law and provider obligations.</p>
          </section>
          <section>
            <h2 className="text-xl font-bold text-slate-950">11. Account security activity</h2>
            <p className="mt-3 leading-relaxed">Platform authentication history covers the last 12 calendar months. It includes successful and failed sign-ins, lockouts, password-renewal requirements, MFA activity, recovery-code or trusted-browser use, and password-reset activity. Entries can include the time, client IP address, browser description and approximate city, region or country supplied by the hosting network. Approximate location is not precise and can be unavailable or inaccurate.</p>
            <p className="mt-3 leading-relaxed">Only authorised Admins or SuperAdmins for the active business can review a user&apos;s history in user security settings. Authorised platform security reviewers can also review authentication history across the service for security investigations. Expired authentication records are removed automatically; this does not mean every operational or provider log follows the same retention schedule.</p>
          </section>
          <section id="retention">
            <h2 className="text-xl font-bold text-slate-950">12. Retention, deletion and backups</h2>
            <p className="mt-3 leading-relaxed">Retention depends on the information&apos;s purpose, the retailer&apos;s instructions, applicable legal recordkeeping requirements and any relevant provider rules. Closing an account, disabling an integration and deleting historical records are separate actions.</p>
            <ul className="mt-3 list-disc space-y-2 pl-6 leading-relaxed">
              <li><strong>Authentication history:</strong> the last 12 calendar months, with automatic expiry cleanup.</li>
              <li><strong>Public assistant conversations and enquiry contacts:</strong> the normal maintenance schedule removes or de-identifies message content and contact details after 12 months. Limited consent records and product-demand summaries may remain. You can request earlier removal.</li>
              <li><strong>Retail and financial records:</strong> retained as needed for the retailer&apos;s service, reconciliation and applicable legal obligations. There is no single deletion period for all orders, invoices, returns and account records.</li>
              <li><strong>Amazon buyer PII:</strong> our documented policy requires deletion or irreversible de-identification no later than 30 days after delivery, unless a justified legal retention obligation applies. This is a maximum period, not a requirement to wait 30 days.</li>
            </ul>
            <p className="mt-3 leading-relaxed">Amazon identifying-field cleanup currently requires explicit, order-specific approval; it is not automatic 30-day deletion. Shipment documents, downloads, exports, backups and other retained copies need separate review. Disconnecting Amazon authorisation does not itself erase previous orders. See the Amazon notice for the current process and its limitations.</p>
            <p className="mt-3 leading-relaxed">Removing a live record does not instantly erase every backup, email or exported copy. A deletion request must consider these copies, applicable retention duties and measures to prevent removed information from being returned to active use during recovery. We do not promise immediate erasure of every copy, and will explain relevant limitations when responding to a request.</p>
          </section>
          <section id="requests">
            <h2 className="text-xl font-bold text-slate-950">13. Access, correction and deletion requests</h2>
            <p className="mt-3 leading-relaxed">You can ask what personal information we hold about you, request access or correction, ask us to remove information no longer needed, or raise a concern about its use. Email <a href="mailto:sales@solvantis.com" className="font-semibold text-blue-700 hover:underline">sales@solvantis.com</a> with the subject <strong>Privacy request</strong>, enough context to identify the relevant account, retailer or conversation, and the outcome you are seeking. Do not include passwords or full identity documents in your initial message.</p>
            <p className="mt-3 leading-relaxed">We may need to verify your identity and authority and clarify the scope before disclosing or changing records. For retailer-controlled information, we may refer the request to that retailer or work with its authorised representative. Requests must not expose another person&apos;s information or another business&apos;s records.</p>
            <p className="mt-3 leading-relaxed">We will respond within a reasonable period, explain any information needed to progress the request, and explain relevant reasons if access or deletion cannot be provided in full. Legal recordkeeping, security evidence, third-party rights and provider obligations can affect the response. Withdrawing optional contact consent does not automatically delete a retailer&apos;s transaction history.</p>
          </section>
          <section>
            <h2 className="text-xl font-bold text-slate-950">14. Privacy complaints</h2>
            <p className="mt-3 leading-relaxed">Send privacy concerns to <a href="mailto:sales@solvantis.com" className="font-semibold text-blue-700 hover:underline">sales@solvantis.com</a> with the subject <strong>Privacy complaint</strong>. Describe what happened, when, the relevant service and your preferred response. We will assess the concern, seek clarification where needed and communicate the outcome or next steps.</p>
            <p className="mt-3 leading-relaxed">If you are not satisfied with our response, you may contact the <a href="https://www.oaic.gov.au/privacy/privacy-complaints" className="font-semibold text-blue-700 hover:underline">Office of the Australian Information Commissioner</a> to check the complaint options available to you. The applicable process depends on the circumstances and relevant law.</p>
          </section>
          <section>
            <h2 className="text-xl font-bold text-slate-950">15. Other services and policy changes</h2>
            <p className="mt-3 leading-relaxed">Retailer storefronts, connected providers and external websites can have their own privacy notices. Review those notices when using their services; this policy does not replace them.</p>
            <p className="mt-3 leading-relaxed">We may update this policy as the service or its information handling changes. The date above identifies the current published version. Questions about this policy can be sent to <a href="mailto:sales@solvantis.com" className="font-semibold text-blue-700 hover:underline">sales@solvantis.com</a>.</p>
          </section>
        </div>
      </article>
    </main>
  );
}