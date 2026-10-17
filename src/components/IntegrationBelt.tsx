'use client';

import { useState } from 'react';
import Image from 'next/image';
import { Pause, Play } from 'lucide-react';
import amazon from '../../images/landing page/integrations/Amazon.png';
import australiaPost from '../../images/landing page/integrations/AUSTRALIA_POST_VECTOR_large.png';
import eparcel from '../../images/landing page/integrations/eparcel.png';
import gmail from '../../images/landing page/integrations/gmail.jpg';
import klaviyo from '../../images/landing page/integrations/klaviyo.png';
import advertising from '../../images/landing page/integrations/meta-ads-&-google-ads.png';
import shopify from '../../images/landing page/integrations/Shopify.png';
import xero from '../../images/landing page/integrations/Xero.png';
import styles from './IntegrationBelt.module.css';

const integrations = [
  { name: 'Xero', logo: xero, description: 'Retail accounting, payment clearing and reconciliation.' },
  { name: 'Shopify', logo: shopify, description: 'Multiple stores with separate product, stock and order settings.' },
  { name: 'Klaviyo', logo: klaviyo, description: 'Customer profiles and selected sales events, with consent kept separate.' },
  { name: 'Amazon Australia', logo: amazon, description: 'Configured seller-fulfilled channels and existing-ASIN offers.' },
  { name: 'Australia Post', logo: australiaPost, description: 'Supported delivery services through configured eParcel accounts.' },
  { name: 'eParcel', logo: eparcel, description: 'Shipping quotes, parcels, labels, tracking and manifests.' },
  { name: 'Google Ads & Meta Ads', logo: advertising, description: 'Connected advertising context and analysis where enabled.' },
  { name: 'Gmail', logo: gmail, description: 'Connected customer communications where enabled.' },
  { name: 'Zeller', description: 'Supported integrated EFTPOS at the counter.' },
  { name: 'Google Analytics', description: 'Connected website performance and marketing analysis.' },
];

export default function IntegrationBelt() {
  const [paused, setPaused] = useState(false);

  return (
    <div className={styles.belt} role="region" aria-label="Connected integrations">
      <div className={styles.controls}>
        <p>Accounting, commerce, shipping and customer connections</p>
        <button
          type="button"
          aria-label={paused ? 'Resume integration animation' : 'Pause integration animation'}
          aria-pressed={paused}
          onClick={() => setPaused(!paused)}
        >
          {paused ? <Play size={14} aria-hidden="true" /> : <Pause size={14} aria-hidden="true" />}
          {paused ? 'Resume' : 'Pause'}
        </button>
      </div>
      <div className={styles.viewport}>
        <div className={styles.track} data-paused={paused}>
          {[false, true].map(duplicate => (
            <ul key={String(duplicate)} className={styles.group} aria-hidden={duplicate || undefined} aria-label={duplicate ? undefined : 'Integration providers'}>
              {integrations.map(integration => (
                <li key={integration.name} className={styles.card}>
                  <div className={styles.logo} aria-hidden="true">
                    {integration.logo
                      ? <Image src={integration.logo} alt="" width={168} height={76} sizes="168px" loading="eager" />
                      : <span>{integration.name}</span>}
                  </div>
                  <p className={styles.name}>{integration.name}</p>
                  <p className={styles.description}>{integration.description}</p>
                </li>
              ))}
            </ul>
          ))}
        </div>
      </div>
    </div>
  );
}
