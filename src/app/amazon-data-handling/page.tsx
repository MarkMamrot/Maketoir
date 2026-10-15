import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'Amazon Data Handling | Solvantis',
  description: 'How Solvantis collects, uses, stores, shares, and disposes of Amazon seller and order information.',
};

export default function AmazonDataHandlingPage() {
  return (
    <main className="min-h-screen bg-slate-50 px-6 py-14 text-slate-800" style={{ fontFamily: 'Inter, sans-serif' }}>
      <article className="mx-auto max-w-3xl">
        <Link href="/privacy" className="text-sm font-semibold text-blue-700 hover:underline">Privacy</Link>
        <p className="mt-10 text-xs font-bold uppercase text-blue-700">Amazon Australia integration</p>
        <h1 className="mt-2 text-4xl font-black text-slate-950">Amazon data handling</h1>
        <p className="mt-5 text-base leading-relaxed text-slate-600">This notice describes how Solvantis handles Amazon Information when a retailer connects an Amazon Australia Seller Central account.</p>

        <div className="mt-10 space-y-9 border-t border-slate-200 pt-9">
          <section>
            <h2 className="text-xl font-bold text-slate-950">Information we collect and its source</h2>
            <p className="mt-3 leading-relaxed">With the retailer&apos;s authorization, Solvantis retrieves information directly from Amazon through the Selling Partner API. This can include the seller account identifier, listing and SKU details, inventory quantities, seller-fulfilled order details, delivery information supplied with an order, shipment status, returns, and released refund or transaction information. Solvantis does not obtain Amazon Information from third-party data brokers or other non-Amazon sources.</p>
          </section>

          <section>
            <h2 className="text-xl font-bold text-slate-950">How we use and process it</h2>
            <p className="mt-3 leading-relaxed">Solvantis uses this information to show the retailer its Amazon channel, match listings to its inventory, synchronize enabled stock, create and manage seller-fulfilled orders in its sales workflow, support dispatch, and help staff review returns and refunds against orders. The delivery address is used for fulfilment. Solvantis does not use it to contact buyers for marketing.</p>
          </section>

          <section>
            <h2 className="text-xl font-bold text-slate-950">Who can access it</h2>
            <p className="mt-3 leading-relaxed">Amazon Information is associated with the retailer&apos;s business and is available to users authorized for that business in Solvantis. Solvantis is operated by a small team of two developers. Developer access is limited to work needed to operate, support, or secure the service, uses individually assigned accounts and MFA, and is not used for general browsing of customer information.</p>
          </section>

          <section>
            <h2 className="text-xl font-bold text-slate-950">Storage and security</h2>
            <p className="mt-3 leading-relaxed">Amazon Information is stored in the retailer&apos;s Solvantis business records on Railway-hosted infrastructure. The production database is configured for private access. Railway reports AES-256 encryption at rest for stored data. Connections between Solvantis, Amazon, and Australia Post use HTTPS. Amazon&apos;s authorization refresh token is additionally encrypted by Solvantis using AES-256-GCM before storage. Delivery information is stored with the relevant sales order and does not currently have separate application-level field encryption.</p>
          </section>

          <section>
            <h2 className="text-xl font-bold text-slate-950">When information is shared</h2>
            <p className="mt-3 leading-relaxed">When a retailer prepares an Australia Post shipment for an Amazon order, Solvantis sends the recipient and parcel details to Australia Post over HTTPS through the retailer&apos;s connected eParcel account so the shipment can be rated and a label created. Solvantis sends dispatch and tracking details back to Amazon over HTTPS through the Selling Partner API. Railway provides hosting and database services. Cloudflare processes public web traffic where enabled for the Solvantis service. We do not sell Amazon Information or share it for advertising.</p>
          </section>

          <section>
            <h2 className="text-xl font-bold text-slate-950">Retention and disposal</h2>
            <p className="mt-3 leading-relaxed">Our documented retention policy requires Amazon buyer personally identifiable information to be deleted or irreversibly de-identified no later than 30 days after delivery. This is a maximum retention period, not a minimum waiting period: earlier approved cleanup is permitted once delivery and operational checks are satisfied. Non-identifying order references and financial records may remain for reconciliation without preserving a lookup to removed buyer details.</p>
            <p className="mt-3 leading-relaxed">Solvantis provides explicitly approved, order-specific cleanup of targeted buyer contact and delivery fields, using Amazon Customer as a generic label where appropriate. This is currently a manual approval process, not automatic 30-day deletion. Downloaded documents, backups, and other retained copies require separate review and disposal; clearing application fields does not certify removal of every copy. Disconnecting an Amazon account stops its channel authorization but does not by itself remove historical sales-order records.</p>
          </section>

          <section>
            <h2 className="text-xl font-bold text-slate-950">Privacy requests</h2>
            <p className="mt-3 leading-relaxed">For questions about this notice or a request concerning Amazon Information, contact <a href="mailto:sales@solvantis.com" className="font-semibold text-blue-700 hover:underline">sales@solvantis.com</a>.</p>
          </section>
        </div>
      </article>
    </main>
  );
}
