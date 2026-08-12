export type CashPreparationVariance = {
  businessDate: string;
  amount: number;
};

const money = (value: unknown) => Math.round(Number(value) * 100) / 100;

export function buildCashDepositConfirmationPlan(input: {
  preparedTotal: number | string;
  depositedTotal: number | string;
  days: Array<{ business_date: string | Date; banking_variance: number | string }>;
}) {
  const preparationVariances: CashPreparationVariance[] = input.days
    .map(day => ({
      businessDate: day.business_date instanceof Date
        ? day.business_date.toISOString().slice(0, 10)
        : String(day.business_date).slice(0, 10),
      amount: money(day.banking_variance),
    }))
    .filter(day => day.amount !== 0);
  return {
    preparationVariances,
    bankAcceptanceVariance: money(Number(input.depositedTotal) - Number(input.preparedTotal)),
  };
}