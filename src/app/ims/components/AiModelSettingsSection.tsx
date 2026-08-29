'use client';

import { useEffect, useState } from 'react';
import {
  BUSINESS_AI_MODEL_KEYS,
  DEFAULT_BUSINESS_AI_MODELS,
  type BusinessAiModelKey,
  type BusinessAiModelPreferences,
} from '@/lib/ai/businessModelPreferences';

type ModelOption = { id: string; displayName?: string; name?: string };

const FUNCTION_DETAILS: Record<BusinessAiModelKey, { label: string; description: string }> = {
  documentExtraction: {
    label: 'Document extraction',
    description: 'Reads supplier invoices and customer order documents. Pro is recommended for dense tables, scans, tax, freight, and discounts.',
  },
  catalogueMatching: {
    label: 'Catalogue matching',
    description: 'Matches extracted invoice and order lines to existing SKUs, barcodes, and product names. Flash is usually sufficient.',
  },
  businessIntelligence: {
    label: 'Business intelligence and content',
    description: 'Used for brand analysis, campaign audits, marketing missions, estimates, schemas, and general business AI requests.',
  },
  customerService: {
    label: 'Customer service',
    description: 'Used for customer enquiry classification and AI-assisted replies when a more specific Customer Service model is not configured.',
  },
};

export default function AiModelSettingsSection() {
  const [models, setModels] = useState<ModelOption[]>([]);
  const [preferences, setPreferences] = useState<BusinessAiModelPreferences>(DEFAULT_BUSINESS_AI_MODELS);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    Promise.all([
      fetch('/api/ai/text-models').then(async response => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || 'Available AI models could not be loaded.');
        return Array.isArray(data.models) ? data.models : [];
      }),
      fetch('/api/ims/ai/model-settings').then(async response => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || 'AI model settings could not be loaded.');
        return data.models as BusinessAiModelPreferences;
      }),
    ]).then(([availableModels, savedPreferences]) => {
      if (!active) return;
      setModels(availableModels);
      setPreferences(savedPreferences);
    }).catch(cause => {
      if (active) setError(cause instanceof Error ? cause.message : 'AI model settings could not be loaded.');
    }).finally(() => {
      if (active) setLoading(false);
    });
    return () => { active = false; };
  }, []);

  const save = async () => {
    setSaving(true);
    setMessage('');
    setError('');
    try {
      const response = await fetch('/api/ims/ai/model-settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ models: preferences }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'AI model settings could not be saved.');
      setPreferences(data.models);
      setMessage('AI model settings saved.');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'AI model settings could not be saved.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={{ padding: 32, maxWidth: 880 }} data-assistant-context="ims-settings-ai-models">
      <h2 style={{ margin: '0 0 6px', fontSize: 18, fontWeight: 700, color: 'var(--sv-text-strong)' }}>AI Models</h2>
      <p style={{ margin: '0 0 20px', fontSize: 13, color: 'var(--sv-text-dim)', lineHeight: 1.6 }}>
        Choose the Gemini text model used for each type of work. More capable models can improve difficult document and reasoning tasks, while Flash models are generally faster and lower cost.
      </p>

      <div style={{ borderTop: '1px solid var(--sv-etch)' }}>
        {BUSINESS_AI_MODEL_KEYS.map(key => {
          const selected = preferences[key];
          const options = models.some(model => model.id === selected) ? models : [{ id: selected }, ...models];
          return (
            <div key={key} style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 280px), 1fr))', gap: 16, alignItems: 'center', padding: '18px 0', borderBottom: '1px solid var(--sv-etch)' }}>
              <div>
                <label htmlFor={`ai-model-${key}`} style={{ display: 'block', fontSize: 13, fontWeight: 700, color: 'var(--sv-text-strong)' }}>{FUNCTION_DETAILS[key].label}</label>
                <p style={{ margin: '4px 0 0', fontSize: 12, color: 'var(--sv-text-dim)', lineHeight: 1.5 }}>{FUNCTION_DETAILS[key].description}</p>
              </div>
              <select
                id={`ai-model-${key}`}
                value={selected}
                disabled={loading || saving}
                onChange={event => setPreferences(current => ({ ...current, [key]: event.target.value }))}
                style={{ width: '100%', padding: '8px 10px', borderRadius: 6, border: '1px solid var(--sv-etch)', background: 'var(--sv-bg-0)', color: 'var(--sv-text-main)', fontSize: 13 }}
              >
                {options.map(model => <option key={model.id} value={model.id}>{model.displayName || model.name || model.id}</option>)}
              </select>
            </div>
          );
        })}
      </div>

      <p style={{ margin: '16px 0', fontSize: 12, color: 'var(--sv-text-dim)', lineHeight: 1.6 }}>
        Website content, product creative media, and Customer Service light/capable models retain their dedicated controls in those workspaces. Changes apply to new AI requests only and do not alter saved documents or drafts.
      </p>
      {error && <p role="alert" style={{ margin: '0 0 12px', fontSize: 12, color: 'var(--sv-red)' }}>{error}</p>}
      {message && <p role="status" style={{ margin: '0 0 12px', fontSize: 12, color: 'var(--sv-mint)' }}>{message}</p>}
      <button type="button" onClick={save} disabled={loading || saving || Boolean(error && models.length === 0)} style={{ padding: '8px 18px', border: 0, borderRadius: 6, background: 'var(--sv-action)', color: '#fff', fontSize: 13, fontWeight: 650, cursor: loading || saving ? 'not-allowed' : 'pointer', opacity: loading || saving ? .6 : 1 }}>
        {loading ? 'Loading...' : saving ? 'Saving...' : 'Save AI Models'}
      </button>
    </div>
  );
}