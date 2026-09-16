'use client';

import { AlertTriangle, Check, RotateCcw } from 'lucide-react';
import { useState } from 'react';
import {
  calculateMerchantRateComparison,
  splitTypicalGiftBookCardTurnover,
  type MerchantRateInputs,
  type MerchantRateOption,
} from '@/lib/merchantRates/merchantRateCalculator';

type InputKey = keyof MerchantRateInputs;
type InputValues = Record<Exclude<InputKey, 'solvantisMerchantFeeRate'>, string> & { smfPercent: string };

const INITIAL_VALUES: InputValues = {
  monthlyTurnover: '',
  averageTransactionValue: '',
  terminalCount: '1',
  currentMonthlyTerminalFees: '',
  smfPercent: '0.20',
  eftposVolume: '',
  visaMastercardVolume: '',
  amexDinersVolume: '',
  unionPayVolume: '',
};

const CURRENCY = new Intl.NumberFormat('en-AU', {
  style: 'currency',
  currency: 'AUD',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const NUMBER = new Intl.NumberFormat('en-AU', { maximumFractionDigits: 0 });

function parseAmount(value: string): number {
  const parsed = Number(value.replace(/,/g, ''));
  return Number.isFinite(parsed) ? parsed : 0;
}

function inputAmount(value: number): string {
  return value.toFixed(2).replace(/\.00$/, '');
}

function CurrencyInput({
  id,
  label,
  value,
  onChange,
  hint,
}: {
  id: InputKey;
  label: string;
  value: string;
  onChange: (id: InputKey, value: string) => void;
  hint?: string;
}) {
  return (
    <label className="block" htmlFor={id}>
      <span className="mb-1.5 block text-sm font-semibold text-gray-800">{label}</span>
      <span className="relative block">
        <span className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3 text-sm font-medium text-gray-500">$</span>
        <input
          id={id}
          type="number"
          min="0"
          step="0.01"
          inputMode="decimal"
          value={value}
          onChange={event => onChange(id, event.target.value)}
          className="h-11 w-full rounded-md border border-gray-300 bg-white pl-7 pr-3 text-sm text-gray-900 outline-none transition focus:border-cyan-600 focus:ring-2 focus:ring-cyan-100"
        />
      </span>
      {hint && <span className="mt-1 block text-xs leading-5 text-gray-500">{hint}</span>}
    </label>
  );
}

function BreakdownRow({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-gray-100 py-2 text-sm last:border-b-0">
      <span className="text-gray-600">{label}</span>
      <span className="font-medium tabular-nums text-gray-900">{CURRENCY.format(value)}</span>
    </div>
  );
}

function RateOption({
  title,
  subtitle,
  option,
  isCheaper,
}: {
  title: string;
  subtitle: string;
  option: MerchantRateOption;
  isCheaper: boolean;
}) {
  return (
    <section className={`overflow-hidden rounded-lg border bg-white ${isCheaper ? 'border-emerald-500 ring-2 ring-emerald-100' : 'border-gray-200'}`}>
      <div className={`flex min-h-24 items-start justify-between gap-4 border-b px-5 py-4 ${isCheaper ? 'border-emerald-200 bg-emerald-50' : 'border-gray-200 bg-gray-50'}`}>
        <div>
          <h3 className="text-base font-bold text-gray-950">{title}</h3>
          <p className="mt-1 text-sm leading-5 text-gray-600">{subtitle}</p>
        </div>
        {isCheaper && (
          <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-emerald-700 px-2.5 py-1 text-xs font-bold text-white">
            <Check size={13} strokeWidth={2.5} /> Cheaper
          </span>
        )}
      </div>
      <div className="px-5 py-3">
        <BreakdownRow label="Provider merchant service fees (MSF)" value={option.merchantServiceFees} />
        <BreakdownRow label="Estimated interchange and scheme fees" value={option.interchangeSchemeFees} />
        {option.eftposTransactionFees > 0 && (
          <BreakdownRow label="Fixed EFTPOS processing" value={option.eftposTransactionFees} />
        )}
        <BreakdownRow label="Solvantis Merchant Fee (SMF)" value={option.solvantisMerchantFees} />
        <BreakdownRow label="Transaction fees" value={option.transactionFees} />
        <BreakdownRow label="Monthly administration" value={option.administrationFees} />
        <BreakdownRow label="Terminal rental" value={option.terminalRentalFees} />
        <BreakdownRow label="Terminal SIM fees" value={option.terminalSimFees} />
        {option.minimumServiceFeeAdjustment > 0 && (
          <BreakdownRow label="Minimum service fee adjustment" value={option.minimumServiceFeeAdjustment} />
        )}
      </div>
      <div className={`flex items-end justify-between gap-4 border-t px-5 py-4 ${isCheaper ? 'border-emerald-200 bg-emerald-50' : 'border-gray-200 bg-gray-50'}`}>
        <span className="text-sm font-semibold text-gray-700">Estimated monthly cost</span>
        <span className="text-2xl font-bold tabular-nums text-gray-950">{CURRENCY.format(option.monthlyTotal)}</span>
      </div>
    </section>
  );
}

export function MerchantRateCalculatorView() {
  const [values, setValues] = useState<InputValues>(INITIAL_VALUES);
  const inputs: MerchantRateInputs = {
    monthlyTurnover: parseAmount(values.monthlyTurnover),
    averageTransactionValue: parseAmount(values.averageTransactionValue),
    terminalCount: parseAmount(values.terminalCount),
    currentMonthlyTerminalFees: parseAmount(values.currentMonthlyTerminalFees),
    solvantisMerchantFeeRate: parseAmount(values.smfPercent) / 100,
    eftposVolume: parseAmount(values.eftposVolume),
    visaMastercardVolume: parseAmount(values.visaMastercardVolume),
    amexDinersVolume: parseAmount(values.amexDinersVolume),
    unionPayVolume: parseAmount(values.unionPayVolume),
  };
  const comparison = calculateMerchantRateComparison(inputs);
  const hasComparison = comparison.enteredCardVolume > 0 && inputs.averageTransactionValue > 0;
  const volumesDiffer = Math.abs(comparison.unallocatedTurnover) >= 0.01;

  const updateValue = (id: InputKey, value: string) => {
    setValues(current => ({ ...current, [id]: value }));
  };

  const updateMonthlyTurnover = (_id: InputKey, value: string) => {
    const split = splitTypicalGiftBookCardTurnover(parseAmount(value));
    setValues(current => ({
      ...current,
      monthlyTurnover: value,
      eftposVolume: inputAmount(split.eftposVolume),
      visaMastercardVolume: inputAmount(split.visaMastercardVolume),
      amexDinersVolume: inputAmount(split.amexDinersVolume),
      unionPayVolume: inputAmount(split.unionPayVolume),
    }));
  };

  return (
    <div className="mx-auto max-w-7xl pb-10">
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4 border-b border-gray-200 pb-5">
        <div className="max-w-3xl">
          <p className="text-sm leading-6 text-gray-600">
            Compare Nuvei's supplied tiered GST-inclusive rate card with Tyro's 0.22% MSF option, including estimated network costs and the Solvantis Merchant Fee. Estimates update as values are entered.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setValues(INITIAL_VALUES)}
          className="inline-flex h-9 items-center gap-2 rounded-md border border-gray-300 bg-white px-3 text-sm font-semibold text-gray-700 transition hover:bg-gray-50"
        >
          <RotateCcw size={15} /> Reset
        </button>
      </div>

      <div className="grid items-start gap-6 xl:grid-cols-[360px_minmax(0,1fr)]">
        <section className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
          <h2 className="text-base font-bold text-gray-950">Monthly processing profile</h2>
          <p className="mt-1 text-sm leading-5 text-gray-500">Enter GST-inclusive Australian dollar amounts.</p>

          <div className="mt-5 space-y-4">
            <CurrencyInput
              id="monthlyTurnover"
              label="Total card turnover"
              value={values.monthlyTurnover}
              onChange={updateMonthlyTurnover}
              hint="Prefills a typical gift/book retail card mix and selects the tiered rate."
            />
            <CurrencyInput
              id="averageTransactionValue"
              label="Average transaction value"
              value={values.averageTransactionValue}
              onChange={updateValue}
              hint="Used to estimate transaction and EFTPOS counts."
            />
            <label className="block" htmlFor="terminalCount">
              <span className="mb-1.5 block text-sm font-semibold text-gray-800">Number of terminals</span>
              <input
                id="terminalCount"
                type="number"
                min="0"
                step="1"
                inputMode="numeric"
                value={values.terminalCount}
                onChange={event => updateValue('terminalCount', event.target.value)}
                className="h-11 w-full rounded-md border border-gray-300 bg-white px-3 text-sm text-gray-900 outline-none transition focus:border-cyan-600 focus:ring-2 focus:ring-cyan-100"
              />
            </label>
            <CurrencyInput
              id="currentMonthlyTerminalFees"
              label="Current monthly terminal rental"
              value={values.currentMonthlyTerminalFees}
              onChange={updateValue}
              hint="Total monthly rental across all terminals, used in both options."
            />
            <label className="block" htmlFor="smfPercent">
              <span className="mb-1.5 block text-sm font-semibold text-gray-800">Solvantis Merchant Fee (SMF)</span>
              <span className="relative block">
                <input
                  id="smfPercent"
                  type="number"
                  min="0"
                  step="0.01"
                  inputMode="decimal"
                  value={values.smfPercent}
                  onChange={event => updateValue('smfPercent', event.target.value)}
                  className="h-11 w-full rounded-md border border-gray-300 bg-white pl-3 pr-8 text-sm text-gray-900 outline-none transition focus:border-cyan-600 focus:ring-2 focus:ring-cyan-100"
                />
                <span className="pointer-events-none absolute inset-y-0 right-0 flex items-center pr-3 text-sm font-medium text-gray-500">%</span>
              </span>
              <span className="mt-1 block text-xs leading-5 text-gray-500">Added on top of provider and network fees.</span>
            </label>

            <div className="border-t border-gray-200 pt-4">
              <p className="mb-4 text-xs font-bold uppercase text-gray-500">Turnover by card type</p>
              <p className="mb-4 text-xs leading-5 text-gray-500">Typical starting mix: 65% Visa/Mastercard, 30% EFTPOS, 4% Amex/Diners and 1% UnionPay. Override any amount when the customer's actual mix is known.</p>
              <div className="space-y-4">
                <CurrencyInput id="eftposVolume" label="Standard EFTPOS" value={values.eftposVolume} onChange={updateValue} />
                <CurrencyInput id="visaMastercardVolume" label="Visa and Mastercard" value={values.visaMastercardVolume} onChange={updateValue} />
                <CurrencyInput id="amexDinersVolume" label="Amex and Diners" value={values.amexDinersVolume} onChange={updateValue} />
                <CurrencyInput id="unionPayVolume" label="UnionPay" value={values.unionPayVolume} onChange={updateValue} />
              </div>
            </div>
          </div>
        </section>

        <div className="min-w-0">
          {volumesDiffer && (
            <div className="mb-4 flex gap-3 rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-950">
              <AlertTriangle className="mt-0.5 shrink-0" size={17} />
              <p>
                Card-type amounts total <strong>{CURRENCY.format(comparison.enteredCardVolume)}</strong>, which is{' '}
                <strong>{CURRENCY.format(Math.abs(comparison.unallocatedTurnover))}</strong>{' '}
                {comparison.unallocatedTurnover > 0 ? 'below' : 'above'} total card turnover. Align these amounts for a reliable comparison.
              </p>
            </div>
          )}

          <div className="mb-5 grid gap-px overflow-hidden rounded-lg border border-gray-200 bg-gray-200 sm:grid-cols-3">
            <div className="bg-white px-4 py-3">
              <p className="text-xs font-semibold text-gray-500">Estimated transactions</p>
              <p className="mt-1 text-lg font-bold tabular-nums text-gray-950">{NUMBER.format(comparison.estimatedTransactions)}</p>
            </div>
            <div className="bg-white px-4 py-3">
              <p className="text-xs font-semibold text-gray-500">Tiered Visa/Mastercard rate</p>
              <p className="mt-1 text-lg font-bold tabular-nums text-gray-950">{(comparison.tieredRate * 100).toFixed(2)}%</p>
            </div>
            <div className="bg-white px-4 py-3">
              <p className="text-xs font-semibold text-gray-500">Estimated EFTPOS transactions</p>
              <p className="mt-1 text-lg font-bold tabular-nums text-gray-950">{NUMBER.format(comparison.estimatedEftposTransactions)}</p>
            </div>
          </div>

          <div className="grid gap-5 lg:grid-cols-2">
            <RateOption
              title="Nuvei tiered option"
              subtitle={`${(comparison.tieredRate * 100).toFixed(2)}% MSF + 0.40% network cost on Visa/Mastercard · $0.165 per EFTPOS transaction`}
              option={comparison.tiered}
              isCheaper={hasComparison && comparison.cheaperOption === 'tiered'}
            />
            <RateOption
              title="Tyro flat option"
              subtitle="0.22% MSF + 0.40% Visa/Mastercard and 0.25% EFTPOS network costs"
              option={comparison.flat}
              isCheaper={hasComparison && comparison.cheaperOption === 'flat'}
            />
          </div>

          {hasComparison && (
            <section className="mt-5 border-l-4 border-cyan-600 bg-cyan-50 px-5 py-4">
              {comparison.cheaperOption === 'equal' ? (
                <p className="text-base font-bold text-gray-950">Both options have the same estimated monthly cost.</p>
              ) : (
                <>
                  <p className="text-sm font-semibold text-cyan-900">Estimated saving with the cheaper option</p>
                  <div className="mt-1 flex flex-wrap items-baseline gap-x-6 gap-y-1">
                    <span className="text-2xl font-bold tabular-nums text-gray-950">{CURRENCY.format(comparison.monthlySaving)} <span className="text-sm font-semibold text-gray-600">per month</span></span>
                    <span className="text-lg font-bold tabular-nums text-gray-800">{CURRENCY.format(comparison.annualSaving)} <span className="text-sm font-semibold text-gray-600">per year</span></span>
                  </div>
                </>
              )}
            </section>
          )}

          <div className="mt-5 text-xs leading-5 text-gray-500">
            <p>
              Nuvei includes the supplied $0.03 transaction fee and $2.50 monthly administration fee. Tyro has no transaction or monthly administration fee, so both rows show $0. Both estimates include entered terminal rental, $5 terminal SIM fee per terminal and the $30 minimum merchant service fee. Amex and Diners use 1.60%; UnionPay uses 1.80%.
            </p>
            <p className="mt-2">
              Excludes gateway, refund, chargeback, terminal incident, same-day funding and Velocity fees. This is an indicative comparison, not a quote.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}