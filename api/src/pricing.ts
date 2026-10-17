// Fee bands, in cents. Mirrors web/src/lib/pricing.ts; the admin console
// will move these into the database.

type Band = { min: number; max: number; fee: number };

const STK: Band[] = [
  { min: 1, max: 9, fee: 0 },
  { min: 10, max: 250_000, fee: 250 },
];

const B2C: Band[] = [
  [10, 49, 500],
  [50, 499, 1000],
  [500, 999, 1600],
  [1_000, 1_499, 2000],
  [1_500, 2_499, 2700],
  [2_500, 3_499, 3000],
  [3_500, 4_999, 3600],
  [5_000, 7_499, 4500],
  [7_500, 9_999, 5000],
  [10_000, 14_999, 5800],
  [15_000, 19_999, 7600],
  [20_000, 34_999, 9900],
  [35_000, 49_999, 13500],
  [50_000, 149_999, 15300],
  [150_000, 250_000, 18000],
].map(([min, max, fee]) => ({ min, max, fee }));

const find = (bands: Band[], amount: number) => bands.find((b) => amount >= b.min && amount <= b.max)?.fee ?? null;

export const stkFeeCents = (amount: number) => find(STK, amount);
export const b2cFeeCents = (amount: number) => find(B2C, amount);

export const STARTER_CREDIT_CENTS = 5_000;
export const TEST_FEE_CREDIT_CENTS = 1_000_000;
export const TEST_FLOAT_CENTS = 10_000_000;
