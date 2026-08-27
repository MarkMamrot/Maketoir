import type { Metadata } from 'next';
import Link from 'next/link';

import styles from '../policy.module.css';

export const metadata: Metadata = {
  title: 'Monsterclub Rewards Privacy Policy | Monsterthreads',
  description: 'How Monsterthreads handles personal information for Monsterclub Rewards.',
};

export default function MonsterthreadsLoyaltyPrivacyPage() {
  return (
    <main className={styles.shell}>
      <nav className={styles.nav} aria-label="Policy navigation">
        <a className={styles.brand} href="https://monsterthreads.com.au">Monsterthreads</a>
        <div className={styles.navLinks}>
          <Link href="/rewards/monsterthreads-rewards/terms">Rewards terms</Link>
          <a href="https://monsterthreads.com.au/pages/contact-us">Contact</a>
        </div>
      </nav>

      <article className={styles.article}>
        <p className={styles.eyebrow}>Effective 28 August 2026 · Version 1</p>
        <h1>Monsterclub Rewards Privacy Policy</h1>
        <p className={styles.intro}>This policy explains how Monsterthreads collects, uses, discloses and protects personal information for Monsterclub Rewards. It supplements the Monsterthreads website Privacy Policy.</p>

        <section>
          <h2>1. Who we are</h2>
          <p>Monsterthreads is operated by Monsterthreads TGV Pty Ltd (ABN 31 151 413 124). In this policy, “Monsterthreads”, “we”, “us” and “our” refer to that company.</p>
        </section>

        <section>
          <h2>2. Information we collect</h2>
          <p>When you use Monsterclub Rewards, we may collect and maintain:</p>
          <ul>
            <li>your name, email address, phone number and Shopify customer identifier;</li>
            <li>your membership status, enrolment and opt-out dates, and the version of the terms you accepted;</li>
            <li>eligible purchase and return references used to calculate points;</li>
            <li>points balances, earning, adjustments, redemptions and related activity dates;</li>
            <li>Shopify discount codes issued to you, their status and expiry; and</li>
            <li>authentication, session and security information used to send one-time codes, keep you signed in, prevent misuse and diagnose service failures.</li>
          </ul>
          <p>We do not collect payment card details through the rewards portal.</p>
        </section>

        <section>
          <h2>3. How we collect information</h2>
          <p>We collect information directly from you, from purchases and returns made through participating Monsterthreads stores, from the Monsterthreads Shopify store, and from systems used to operate the rewards program. When you request a sign-in code, we use the email address you provide to find the matching Shopify customer account without confirming to other people whether that account exists.</p>
        </section>

        <section>
          <h2>4. Why we use it</h2>
          <p>We use rewards information to:</p>
          <ul>
            <li>verify your identity and provide access to your rewards account;</li>
            <li>enrol you, record your consent and manage opt-out requests;</li>
            <li>calculate, display, adjust and redeem points;</li>
            <li>create customer-only Shopify discounts at your request;</li>
            <li>resolve returns, enquiries, disputes, errors and suspected misuse;</li>
            <li>maintain records, secure the service and comply with legal obligations; and</li>
            <li>improve the reliability and operation of Monsterclub Rewards.</li>
          </ul>
          <p>Joining Monsterclub Rewards does not by itself consent to marketing. We use contact details for marketing only in line with the preferences and permissions you provide separately.</p>
        </section>

        <section>
          <h2>5. When we disclose information</h2>
          <p>We may disclose the information needed to operate Monsterclub Rewards to service providers acting for us, including:</p>
          <ul>
            <li>Shopify, which operates the online store, customer identity and customer-specific discount functions;</li>
            <li>Solvantis, which operates the rewards ledger, customer portal and retail management services;</li>
            <li>email delivery providers used to send one-time sign-in codes; and</li>
            <li>hosting, security and technical support providers.</li>
          </ul>
          <p>We may also disclose information where required or authorised by law, to protect customers or our rights, or as part of a business transaction subject to appropriate safeguards. We do not sell Monsterclub Rewards personal information.</p>
        </section>

        <section>
          <h2>6. Overseas processing</h2>
          <p>Some service providers may store or process information outside Australia. Their locations can change. We take reasonable steps to use providers with appropriate privacy and security protections, while overseas recipients may be subject to the laws of their country.</p>
        </section>

        <section>
          <h2>7. Storage, security and retention</h2>
          <p>We use reasonable technical and organisational measures intended to protect rewards information from loss, misuse and unauthorised access. No internet service can guarantee absolute security.</p>
          <p>We retain rewards account and transaction records for as long as reasonably needed to operate the program, resolve disputes, prevent fraud and satisfy accounting, legal and regulatory obligations. Opting out stops active membership but does not automatically delete transaction history.</p>
        </section>

        <section>
          <h2>8. Access and correction</h2>
          <p>You may ask to access or correct personal information we hold about you. You may also ask us to delete information where applicable, although we may need to retain some records where required by law or for legitimate recordkeeping, security and dispute-resolution purposes.</p>
          <p>You can view key membership, balance, redemption and activity information in the rewards portal. Contact us if anything appears incorrect.</p>
        </section>

        <section>
          <h2>9. Cookies and sign-in</h2>
          <p>The rewards portal uses a strictly necessary session cookie after successful email-code verification. It keeps you signed in securely and expires automatically. You can remove it by signing out or clearing browser data. Blocking necessary cookies may prevent the portal from working.</p>
        </section>

        <section>
          <h2>10. Complaints</h2>
          <p>If you have a privacy concern, contact us using the details below and explain the issue. We will review and respond within a reasonable period. If you are not satisfied, you may be entitled to contact the Office of the Australian Information Commissioner at <a href="https://www.oaic.gov.au">oaic.gov.au</a>.</p>
        </section>

        <section>
          <h2>11. Changes to this policy</h2>
          <p>We may update this policy when the program, our service providers or legal requirements change. The current version and effective date will be published on this page. Material changes affecting membership consent may require acceptance of updated terms.</p>
        </section>

        <section>
          <h2>12. Contact</h2>
          <div className={styles.notice}>
            <p>Email <a href="mailto:mark@monsterthreads.com.au">mark@monsterthreads.com.au</a> or write to Privacy Compliance Officer, Monsterthreads, Unit 9, 25 Ossary Street, Mascot NSW 2020, Australia.</p>
          </div>
        </section>

        <section>
          <h2>Related policies</h2>
          <p>Read the <Link href="/rewards/monsterthreads-rewards/terms">Monsterclub Rewards Terms</Link> and the <a href="https://monsterthreads.com.au/policies/privacy-policy">Monsterthreads website Privacy Policy</a>.</p>
        </section>

        <footer className={styles.footer}>Monsterthreads · Monsterthreads TGV Pty Ltd · ABN 31 151 413 124 · Monsterclub Rewards</footer>
      </article>
    </main>
  );
}