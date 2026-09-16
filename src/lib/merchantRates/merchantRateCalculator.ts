export interface MerchantRateInputs {
  monthlyTurnover: number;
  averageTransactionValue: number;
  terminalCount: number;
  currentMonthlyTerminalFees: number;
  solvantisMerchantFeeRate: number;
  eftposVolume: number;
  visaMastercardVolume: number;
  amexDinersVolume: number;
  unionPayVolume: number;
}

export interface MerchantRateOption {
  id: 'tiered' | 'flat';
  merchantServiceFees: number;
  interchangeSchemeFees: number;
  eftposTransactionFees: number;
  solvantisMerchantFees: number;
  transactionFees: number;
  administrationFees: number;
  terminalRentalFees: number;
  terminalSimFees: number;
  minimumServiceFeeAdjustment: number;
  monthlyTotal: number;
}

export interface MerchantRateComparison {
  tieredRate: number;
  estimatedTransactions: number;
  estimatedEftposTransactions: number;
  enteredCardVolume: number;
  unallocatedTurnover: number;
  tiered: MerchantRateOption;
  flat: MerchantRateOption;
  cheaperOption: MerchantRateOption['id'] | 'equal';
  monthlySaving: number;
  annualSaving: number;
}

const FLAT_RATE = 0.0022;
const VISA_MASTERCARD_INTERCHANGE_SCHEME_RATE = 0.004;
const EFTPOS_INTERCHANGE_SCHEME_RATE = 0.0025;
const AMEX_DINERS_RATE = 0.016;
const UNIONPAY_RATE = 0.018;
const EFTPOS_TRANSACTION_RATE = 0.165;
const TRANSACTION_FEE = 0.03;
const ADMINISTRATION_FEE = 2.5;
const TERMINAL_SIM_FEE = 5;
const MINIMUM_SERVICE_FEE = 30;

function nonNegative(value: number): number {
  return Number.isFinite(value) ? Math.max(0, value) : 0;
}

export function getTieredMerchantServiceRate(monthlyTurnover: number): number {
  const turnover = nonNegative(monthlyTurnover);
  if (turnover < 5_000_000) return 0.0025;
  if (turnover < 15_000_000) return 0.002;
  if (turnover < 50_000_000) return 0.0018;
  if (turnover < 250_000_000) return 0.0014;
  return 0.0012;
}

export function calculateMerchantRateComparison(rawInputs: MerchantRateInputs): MerchantRateComparison {
  const inputs = {
    monthlyTurnover: nonNegative(rawInputs.monthlyTurnover),
    averageTransactionValue: nonNegative(rawInputs.averageTransactionValue),
    terminalCount: Math.floor(nonNegative(rawInputs.terminalCount)),
    currentMonthlyTerminalFees: nonNegative(rawInputs.currentMonthlyTerminalFees),
    solvantisMerchantFeeRate: nonNegative(rawInputs.solvantisMerchantFeeRate),
    eftposVolume: nonNegative(rawInputs.eftposVolume),
    visaMastercardVolume: nonNegative(rawInputs.visaMastercardVolume),
    amexDinersVolume: nonNegative(rawInputs.amexDinersVolume),
    unionPayVolume: nonNegative(rawInputs.unionPayVolume),
  };

  const estimatedTransactions = inputs.averageTransactionValue > 0
    ? Math.round(inputs.monthlyTurnover / inputs.averageTransactionValue)
    : 0;
  const estimatedEftposTransactions = inputs.averageTransactionValue > 0
    ? Math.round(inputs.eftposVolume / inputs.averageTransactionValue)
    : 0;
  const enteredCardVolume = inputs.eftposVolume
    + inputs.visaMastercardVolume
    + inputs.amexDinersVolume
    + inputs.unionPayVolume;
  const tieredRate = getTieredMerchantServiceRate(inputs.monthlyTurnover);
  const premiumCardFees = (inputs.amexDinersVolume * AMEX_DINERS_RATE)
    + (inputs.unionPayVolume * UNIONPAY_RATE);
  const sharedFees = {
    transactionFees: estimatedTransactions * TRANSACTION_FEE,
    administrationFees: ADMINISTRATION_FEE,
    terminalRentalFees: inputs.currentMonthlyTerminalFees,
    terminalSimFees: inputs.terminalCount * TERMINAL_SIM_FEE,
  };

  const makeOption = (
    id: MerchantRateOption['id'],
    merchantServiceFees: number,
    interchangeSchemeFees: number,
    eftposTransactionFees: number,
    solvantisMerchantFees: number,
  ): MerchantRateOption => {
    const providerServiceFees = merchantServiceFees + eftposTransactionFees;
    const minimumServiceFeeAdjustment = Math.max(0, MINIMUM_SERVICE_FEE - providerServiceFees);
    const monthlyTotal = merchantServiceFees
      + interchangeSchemeFees
      + eftposTransactionFees
      + solvantisMerchantFees
      + minimumServiceFeeAdjustment
      + sharedFees.transactionFees
      + sharedFees.administrationFees
      + sharedFees.terminalRentalFees
      + sharedFees.terminalSimFees;

    return {
      id,
      merchantServiceFees,
      interchangeSchemeFees,
      eftposTransactionFees,
      solvantisMerchantFees,
      ...sharedFees,
      minimumServiceFeeAdjustment,
      monthlyTotal,
    };
  };

  const tiered = makeOption(
    'tiered',
    (inputs.visaMastercardVolume * tieredRate)
      + premiumCardFees,
    inputs.visaMastercardVolume * VISA_MASTERCARD_INTERCHANGE_SCHEME_RATE,
    estimatedEftposTransactions * EFTPOS_TRANSACTION_RATE,
    inputs.visaMastercardVolume * inputs.solvantisMerchantFeeRate,
  );
  const flat = makeOption(
    'flat',
    ((inputs.visaMastercardVolume + inputs.eftposVolume) * FLAT_RATE)
      + premiumCardFees,
    (inputs.visaMastercardVolume * VISA_MASTERCARD_INTERCHANGE_SCHEME_RATE)
      + (inputs.eftposVolume * EFTPOS_INTERCHANGE_SCHEME_RATE),
    0,
    (inputs.visaMastercardVolume + inputs.eftposVolume) * inputs.solvantisMerchantFeeRate,
  );
  const monthlySaving = Math.abs(tiered.monthlyTotal - flat.monthlyTotal);

  return {
    tieredRate,
    estimatedTransactions,
    estimatedEftposTransactions,
    enteredCardVolume,
    unallocatedTurnover: inputs.monthlyTurnover - enteredCardVolume,
    tiered,
    flat,
    cheaperOption: tiered.monthlyTotal === flat.monthlyTotal
      ? 'equal'
      : tiered.monthlyTotal < flat.monthlyTotal ? 'tiered' : 'flat',
    monthlySaving,
    annualSaving: monthlySaving * 12,
  };
}