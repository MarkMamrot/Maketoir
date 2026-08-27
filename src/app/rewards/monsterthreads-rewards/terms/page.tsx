import type { Metadata } from 'next';
import Link from 'next/link';

import styles from '../policy.module.css';

export const metadata: Metadata = {
  title: 'Monsterclub Rewards Terms | Monsterthreads',
  description: 'Terms for earning and using Monsterclub Rewards points with Monsterthreads.',
};

export default function MonsterthreadsLoyaltyTermsPage() {
  return (
    <main className={styles.shell}>
      <nav className={styles.nav} aria-label="Policy navigation">
        <a className={styles.brand} href="https://monsterthreads.com.au">Monsterthreads</a>
        <div className={styles.navLinks}>
          <Link href="/rewards/monsterthreads-rewards/privacy">Privacy</Link>
          <a href="https://monsterthreads.com.au/pages/contact-us">Contact</a>
        </div>
      </nav>

      <article className={styles.article}>
        <p className={styles.eyebrow}>Effective 28 August 2026 · Version 1</p>
        <h1>Monsterclub Rewards terms</h1>
        <p className={styles.intro}>These terms explain how customers join, earn and use points in Monsterclub Rewards. Monsterthreads is operated by Monsterthreads TGV Pty Ltd (ABN 31 151 413 124).</p>

        <section>
          <h2>1. Joining and eligibility</h2>
          <p>Monsterclub Rewards is available to individual Monsterthreads retail customers with an active customer account and a valid email address. Membership is free, personal to you and may not be sold, transferred or combined with another person&apos;s account.</p>
          <p>You join when you accept the current terms in the customer rewards portal or when membership is enabled with your authority in store. You are responsible for keeping your account details accurate and protecting access to your email account.</p>
          <p>Joining Monsterclub Rewards does not by itself subscribe you to marketing. Marketing preferences are managed separately and you may unsubscribe from promotional messages without leaving the rewards program.</p>
        </section>

        <section>
          <h2>2. Earning points</h2>
          <p>The current earning rate is shown in the rewards portal and may change for future purchases. Points are calculated in whole points from eligible merchandise value after discounts. Fractional points are rounded down.</p>
          <ul>
            <li>Points begin on eligible purchases completed after your effective enrolment date and are not backdated.</li>
            <li>Gift card purchases, delivery charges and the portion of a purchase paid for by a loyalty reward do not earn points.</li>
            <li>Using a gift card as payment does not prevent eligible merchandise from earning points.</li>
            <li>Points are normally added after an eligible transaction is completed and associated with your customer account.</li>
          </ul>
          <p>You should identify your membership before an in-store sale is completed and use the email linked to your membership for online purchases.</p>
        </section>

        <section>
          <h2>3. Returns, cancellations and corrections</h2>
          <p>When an eligible purchase is returned, refunded, cancelled or corrected, the related points may be reversed in proportion to the returned eligible value. A voided sale may also reverse any reward used on that sale.</p>
          <p>If the affected points have already been used, contact Monsterthreads so the return and rewards account can be resolved correctly. Nothing in these terms excludes, restricts or modifies rights or remedies that cannot lawfully be excluded, including rights under the Australian Consumer Law.</p>
        </section>

        <section>
          <h2>4. Using rewards in store</h2>
          <p>Available fixed-value rewards and their points cost are shown in the rewards portal or at the register. To use a reward in store, ask staff to link the correct customer account before payment. The required points are deducted when the reward is applied.</p>
          <p>Points and rewards have no cash value, do not earn interest, cannot be exchanged for cash and cannot be used to purchase gift cards unless Monsterthreads expressly states otherwise.</p>
        </section>

        <section>
          <h2>5. Converting points for Shopify</h2>
          <p>You may choose to convert an available reward into a Shopify discount through the rewards portal. When you confirm the conversion:</p>
          <ul>
            <li>the stated points are deducted immediately and the conversion is final;</li>
            <li>the code is restricted to your linked Shopify customer account and may be used once;</li>
            <li>the code cannot be combined with another discount; and</li>
            <li>the code expires 90 days after issue.</li>
          </ul>
          <p>Expired or unused Shopify codes do not automatically restore points. An issued Shopify reward cannot also be used at a Monsterthreads register.</p>
        </section>

        <section>
          <h2>6. Leaving the program</h2>
          <p>You may opt out through the rewards portal or by contacting Monsterthreads. Opting out stops future earning and redemption but does not delete transaction records that Monsterthreads must retain. If you later rejoin, future earning resumes from the new enrolment date; earlier purchases are not backdated.</p>
        </section>

        <section>
          <h2>7. Errors, misuse and account security</h2>
          <p>Monsterthreads may correct points or rewards credited or deducted in error. We may suspend access while reasonably investigating fraud, misuse, duplicate accounts, unauthorised access or technical error. We may cancel points or rewards obtained through fraud or deliberate misuse.</p>
          <p>Tell us promptly if you believe your account or a reward code has been used without permission. We will assess account corrections reasonably and in accordance with applicable law.</p>
        </section>

        <section>
          <h2>8. Program changes</h2>
          <p>Monsterthreads may change earning rates, reward options or these terms, or may suspend or close the program. Where practical, we will provide reasonable notice of a material adverse change and a reasonable opportunity to use existing points. Changes do not affect statutory rights, and issued Shopify codes remain subject to the conditions and expiry displayed when issued unless cancellation is required by law or because of fraud or error.</p>
        </section>

        <section>
          <h2>9. Privacy</h2>
          <p>Monsterthreads handles personal information used for Monsterclub Rewards as described in the <Link href="/rewards/monsterthreads-rewards/privacy">Monsterclub Rewards Privacy Policy</Link> and the <a href="https://monsterthreads.com.au/policies/privacy-policy">Monsterthreads website Privacy Policy</a>.</p>
        </section>

        <section>
          <h2>10. Liability and governing law</h2>
          <p>To the extent permitted by law, Monsterthreads is not responsible for indirect or consequential loss caused by unavailable points or rewards. Any liability that cannot lawfully be excluded remains unaffected. These terms are governed by the laws of New South Wales, Australia.</p>
        </section>

        <section>
          <h2>11. Contact</h2>
          <div className={styles.notice}>
            <p>Email <a href="mailto:mark@monsterthreads.com.au">mark@monsterthreads.com.au</a> or write to Monsterthreads, Unit 9, 25 Ossary Street, Mascot NSW 2020, Australia.</p>
          </div>
        </section>

        <footer className={styles.footer}>Monsterthreads · Monsterthreads TGV Pty Ltd · ABN 31 151 413 124 · Monsterclub Rewards</footer>
      </article>
    </main>
  );
}