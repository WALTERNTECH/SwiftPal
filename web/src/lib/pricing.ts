// Single source of truth for SwiftPal fees. The pricing page, the fee
// calculator, the docs and the dashboard all read from here. When the admin
// console lands, these values move to the database and this file becomes the
// seed.

export type Band = {
  /** Inclusive lower bound in KES. */
  min: number;
  /** Inclusive upper bound in KES, or null for "and above". */
  max: number | null;
  /** Flat fee in KES, used when `percent` is not set. */
  flat?: number;
  /** Percentage of the amount, e.g. 1.8 for 1.8%. */
  percent?: number;
};

export const STK_BANDS: Band[] = [
  { min: 1, max: 9, flat: 0 },
  { min: 10, max: null, flat: 2.5 },
];

export const B2C_BANDS: Band[] = [
  { min: 10, max: 49, flat: 5 },
  { min: 50, max: 499, flat: 10 },
  { min: 500, max: 999, flat: 16 },
  { min: 1_000, max: 1_499, flat: 20 },
  { min: 1_500, max: 2_499, flat: 27 },
  { min: 2_500, max: 3_499, flat: 30 },
  { min: 3_500, max: 4_999, flat: 36 },
  { min: 5_000, max: 7_499, flat: 45 },
  { min: 7_500, max: 9_999, flat: 50 },
  { min: 10_000, max: 14_999, flat: 58 },
  { min: 15_000, max: 19_999, flat: 76 },
  { min: 20_000, max: 34_999, flat: 99 },
  { min: 35_000, max: 49_999, flat: 135 },
  { min: 50_000, max: 149_999, flat: 153 },
  // M-Pesa caps a single transaction at KES 250,000, so the top band is flat
  // too. No percentage fees anywhere.
  { min: 150_000, max: 250_000, flat: 180 },
];

/** What a typical aggregator charges, for the side-by-side on the pricing page. */
export const MARKET_STK_FEE = 3;
export const MARKET_B2C_BANDS: number[] = [6, 12, 18, 23, 30, 33, 40, 50, 55, 65, 85, 110, 150, 170, 200];
export const MARKET_B2C_TOP_PERCENT = 2;

export const STARTER_CREDIT = 50;
export const B2C_MIN = 10;
export const B2C_MAX = 250_000;
export const STK_MAX = 250_000;

export function bandFor(bands: Band[], amount: number): Band | undefined {
  return bands.find((b) => amount >= b.min && (b.max === null || amount <= b.max));
}

export function feeFor(bands: Band[], amount: number): number | null {
  const band = bandFor(bands, amount);
  if (!band) return null;
  if (band.percent !== undefined) return Math.round(amount * band.percent) / 100;
  return band.flat ?? 0;
}

export const stkFee = (amount: number) => feeFor(STK_BANDS, amount);
export const b2cFee = (amount: number) => feeFor(B2C_BANDS, amount);

export function marketB2cFee(amount: number): number | null {
  const i = B2C_BANDS.findIndex((b) => amount >= b.min && (b.max === null || amount <= b.max));
  if (i < 0) return null;
  if (i === B2C_BANDS.length - 1) return Math.round(amount * MARKET_B2C_TOP_PERCENT) / 100;
  return MARKET_B2C_BANDS[i];
}
