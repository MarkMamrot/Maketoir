import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'Privacy | Solvantis',
  description: 'How Solvantis handles website enquiries, sales conversations, and account security information.',
};

export default function PrivacyPage() {
  return (
    <main className="min-h-screen bg-slate-50 px-6 py-14 text-slate-800" style={{ fontFamily: 'Inter, sans-serif' }}>
      <article className="mx-auto max-w-3xl">
        <Link href="/" className="text-sm font-semibold text-blue-700 hover:underline">Back to Solvantis</Link>
        <p className="mt-10 text-xs font-bold uppercase text-blue-700">Privacy</p>
        <h1 className="mt-2 text-4xl font-black text-slate-950">Privacy and account information</h1>
        <p className="mt-5 text-base leading-relaxed text-slate-600">This notice explains how Solvantis handles information submitted through the public website, sales forms and Sales Assistant, and limited information used to protect authenticated accounts.</p>

        <div className="mt-10 space-y-9 border-t border-slate-200 pt-9">
          <section>
            <h2 className="text-xl font-bold text-slate-950">Sales Assistant conversations</h2>
            <p className="mt-3 leading-relaxed">Questions and responses are stored so the conversation can continue across public Solvantis pages, so we can improve feature and fit guidance, and so authorised team members can review demand and unanswered needs. Do not include passwords, payment details, customer records or other sensitive information.</p>
            <p className="mt-3 leading-relaxed">You can use <strong>Delete conversation</strong> in the assistant to request removal of the conversation associated with your browser session.</p>
          </section>
          <section>
            <h2 className="text-xl font-bold text-slate-950">Contact requests</h2>
            <p className="mt-3 leading-relaxed">Contact details are collected only when you choose to submit them. We use your name, selected contact detail, preferred channel and optional business context to respond to your enquiry. Consent applies only to the channel selected in the form and is not inferred from using the assistant.</p>
          </section>
          <section>
            <h2 className="text-xl font-bold text-slate-950">Attribution and service protection</h2>
            <p className="mt-3 leading-relaxed">We may record the page, referral and campaign that brought you to Solvantis, along with privacy-preserving browser or network signals used to protect the service from abuse. We do not use an assistant conversation to access a retailer&apos;s live operational data.</p>
          </section>
          <section>
            <h2 className="text-xl font-bold text-slate-950">Account security activity</h2>
            <p className="mt-3 leading-relaxed">For authenticated business accounts, we retain successful login and password-reset activity for up to 90 days. A record may include the time, IP address, browser description, and approximate city, region and country when supplied by our hosting network. Approximate location is not precise and may be unavailable.</p>
            <p className="mt-3 leading-relaxed">Only authorised Admins or SuperAdmins for the active business can review this information in user security settings. It is used to investigate account access and password recovery, and records older than 90 days are automatically removed.</p>
          </section>
          <section>
            <h2 className="text-xl font-bold text-slate-950">Questions</h2>
            <p className="mt-3 leading-relaxed">For privacy questions or deletion requests that cannot be completed in the assistant, email <a href="mailto:sales@solvantis.com" className="font-semibold text-blue-700 hover:underline">sales@solvantis.com</a>.</p>
          </section>
        </div>
      </article>
    </main>
  );
}