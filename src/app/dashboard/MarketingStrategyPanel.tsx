"use client";

import { useEffect, useState } from 'react';
import { Check, Loader2, Save, SlidersHorizontal } from 'lucide-react';
import type { ForesightMarketingStrategy, MarketingObjective } from '@/lib/foresight/marketingStrategy';

type StrategyResponse = {
  version: number;
  strategy: ForesightMarketingStrategy;
  changeReason: string | null;
  createdAt: string | null;
  error?: string;
  issues?: string[];
};

const OBJECTIVES: Array<{ value: MarketingObjective; label: string }> = [
  { value: 'profitable_growth', label: 'Profitable growth' },
  { value: 'revenue_growth', label: 'Revenue growth' },
  { value: 'efficiency', label: 'Efficiency' },
];

const FIELDS: Array<{
  key: keyof ForesightMarketingStrategy['paidMedia'];
  label: string;
  min: number;
  max: number;
  step: number;
  suffix: string;
}> = [
  { key: 'targetMer', label: 'Target MER (reporting)', min: 0.1, max: 100, step: 0.1, suffix: 'x' },
  { key: 'minimumContributionPoas', label: 'Minimum contribution POAS', min: 0, max: 20, step: 0.05, suffix: 'x' },
  { key: 'evaluationWindowDays', label: 'Evaluation window', min: 3, max: 30, step: 1, suffix: 'days' },
  { key: 'minimumSpend', label: 'Minimum spend', min: 0, max: 1000000, step: 10, suffix: 'AUD' },
  { key: 'zeroRevenueSpend', label: 'Zero-revenue spend threshold', min: 0, max: 1000000, step: 10, suffix: 'AUD' },
  { key: 'merDeteriorationPercent', label: 'MER deterioration tolerance', min: 1, max: 100, step: 1, suffix: '%' },
  { key: 'maximumBudgetReductionPercent', label: 'Maximum suggested reduction', min: 0, max: 50, step: 1, suffix: '%' },
  { key: 'growthMinimumContributionPoas', label: 'Growth contribution POAS floor', min: 1, max: 20, step: 0.1, suffix: 'x' },
  { key: 'maximumBudgetIncreasePercent', label: 'Maximum suggested increase', min: 0, max: 25, step: 1, suffix: '%' },
];

async function json(response: Response): Promise<any> {
  const text = await response.text();
  try { return text ? JSON.parse(text) : {}; } catch { return { error: text }; }
}

export function MarketingStrategyPanel({ userTier }: { userTier: string }) {
  const [strategy, setStrategy] = useState<ForesightMarketingStrategy | null>(null);
  const [version, setVersion] = useState(0);
  const [changeReason, setChangeReason] = useState('');
  const [lastReason, setLastReason] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ error?: string; success?: string } | null>(null);
  const isAdmin = userTier === 'Admin' || userTier === 'SuperAdmin';

  useEffect(() => {
    void (async () => {
      try {
        const response = await fetch('/api/foresight/marketing/strategy', { cache: 'no-store' });
        const body = await json(response) as StrategyResponse;
        if (!response.ok) throw new Error(body.error || 'Unable to load strategy.');
        setStrategy(body.strategy);
        setVersion(body.version);
        setLastReason(body.changeReason);
      } catch (error) {
        setMessage({ error: error instanceof Error ? error.message : 'Unable to load strategy.' });
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const setPaidMedia = (key: keyof ForesightMarketingStrategy['paidMedia'], value: number) => {
    setStrategy((current) => current ? {
      ...current,
      paidMedia: { ...current.paidMedia, [key]: value },
    } : current);
  };

  const save = async () => {
    if (!strategy) return;
    setSaving(true);
    setMessage(null);
    try {
      const response = await fetch('/api/foresight/marketing/strategy', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ strategy, changeReason }),
      });
      const body = await json(response) as StrategyResponse;
      if (!response.ok) throw new Error(body.issues?.join(' ') || body.error || 'Unable to save strategy.');
      setVersion(body.version);
      setLastReason(changeReason.trim());
      setChangeReason('');
      setMessage({ success: `Strategy version ${body.version} saved.` });
    } catch (error) {
      setMessage({ error: error instanceof Error ? error.message : 'Unable to save strategy.' });
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <div className="flex h-40 items-center justify-center text-gray-400"><Loader2 size={20} className="animate-spin" /></div>;
  if (!strategy) return <div className="border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{message?.error ?? 'Strategy unavailable.'}</div>;

  return (
    <section className="border border-gray-200 bg-white" aria-label="Marketing strategy guardrails">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-gray-200 px-4 py-4 sm:px-5">
        <div>
          <h2 className="flex items-center gap-2 text-base font-bold text-gray-950"><SlidersHorizontal size={18} /> Strategy and guardrails</h2>
          <p className="mt-1 text-xs text-gray-500">Version {version}{lastReason ? ` · ${lastReason}` : ' · Default policy'}</p>
        </div>
        {!isAdmin && <span className="border border-gray-200 px-2 py-1 text-xs font-medium text-gray-500">Read only</span>}
      </div>

      <div className="space-y-5 px-4 py-5 sm:px-5">
        <div>
          <div className="mb-2 text-xs font-bold uppercase tracking-wider text-gray-500">Objective</div>
          <div className="inline-flex max-w-full flex-wrap border border-gray-300" role="group" aria-label="Marketing objective">
            {OBJECTIVES.map((objective) => (
              <button
                key={objective.value}
                type="button"
                disabled={!isAdmin}
                onClick={() => setStrategy({ ...strategy, objective: objective.value })}
                className={`px-3 py-2 text-sm ${strategy.objective === objective.value ? 'bg-cyan-700 font-semibold text-white' : 'bg-white text-gray-600 hover:bg-gray-50'} disabled:cursor-default`}
              >
                {objective.label}
              </button>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {FIELDS.map((field) => (
            <label key={field.key} className="block min-w-0">
              <span className="mb-1.5 block text-xs font-medium text-gray-600">{field.label}</span>
              <span className="flex h-10 border border-gray-300 bg-white focus-within:border-cyan-600 focus-within:ring-1 focus-within:ring-cyan-600">
                <input
                  type="number"
                  value={strategy.paidMedia[field.key]}
                  min={field.min}
                  max={field.max}
                  step={field.step}
                  disabled={!isAdmin}
                  onChange={(event) => setPaidMedia(field.key, Number(event.target.value))}
                  className="min-w-0 flex-1 bg-transparent px-3 text-sm tabular-nums text-gray-900 outline-none disabled:text-gray-500"
                />
                <span className="flex items-center border-l border-gray-200 px-2 text-xs text-gray-400">{field.suffix}</span>
              </span>
            </label>
          ))}
        </div>

        {isAdmin && (
          <div className="flex flex-col gap-3 border-t border-gray-200 pt-4 sm:flex-row sm:items-end">
            <label className="min-w-0 flex-1">
              <span className="mb-1.5 block text-xs font-medium text-gray-600">Change reason</span>
              <input
                value={changeReason}
                maxLength={500}
                onChange={(event) => setChangeReason(event.target.value)}
                className="h-10 w-full border border-gray-300 px-3 text-sm text-gray-900 outline-none focus:border-cyan-600 focus:ring-1 focus:ring-cyan-600"
                placeholder="Required for version history"
              />
            </label>
            <button
              type="button"
              onClick={() => void save()}
              disabled={saving || changeReason.trim().length < 3}
              className="inline-flex h-10 items-center justify-center gap-2 bg-cyan-700 px-4 text-sm font-semibold text-white hover:bg-cyan-800 disabled:opacity-50"
            >
              {saving ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />} Save version
            </button>
          </div>
        )}

        {message && (
          <div className={`flex items-center gap-2 border px-3 py-2 text-sm ${message.error ? 'border-red-200 bg-red-50 text-red-800' : 'border-emerald-200 bg-emerald-50 text-emerald-800'}`}>
            {message.success && <Check size={16} />}{message.error ?? message.success}
          </div>
        )}
      </div>
    </section>
  );
}