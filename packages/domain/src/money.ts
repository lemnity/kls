const QUANTITY_SCALE = 3;
const MONEY_SCALE = 2;
const DECIMAL_PATTERN = /^-?\d+(\.\d+)?$/;

export class InvalidDecimalError extends Error {
  public constructor(public readonly value: string) {
    super(`Invalid decimal value: ${value}`);
    this.name = 'InvalidDecimalError';
  }
}

/**
 * Computes `quantity * unitPrice` as an exact decimal string rounded to money
 * scale (2 places), using BigInt fixed-point arithmetic throughout so no
 * JS `number`/float ever touches a financial value (AGENTS.md: money is
 * decimal/numeric, never float).
 */
export function multiplyQuantityByUnitPrice(quantity: string, unitPrice: string): string {
  const scaledQuantity = parseToScaledBigInt(quantity, QUANTITY_SCALE);
  const scaledUnitPrice = parseToScaledBigInt(unitPrice, MONEY_SCALE);
  const product = scaledQuantity * scaledUnitPrice; // scale = QUANTITY_SCALE + MONEY_SCALE
  const rounded = roundToScale(product, QUANTITY_SCALE + MONEY_SCALE, MONEY_SCALE);
  return formatScaledBigInt(rounded, MONEY_SCALE);
}

/** Exact sum of money-scale decimal strings — no rounding needed, addition is exact in fixed point. */
export function sumMoney(values: readonly string[]): string {
  const total = values.reduce(
    (sum, value) => sum + parseToScaledBigInt(value, MONEY_SCALE),
    0n,
  );
  return formatScaledBigInt(total, MONEY_SCALE);
}

function parseToScaledBigInt(value: string, scale: number): bigint {
  if (!DECIMAL_PATTERN.test(value)) throw new InvalidDecimalError(value);

  const negative = value.startsWith('-');
  const unsigned = negative ? value.slice(1) : value;
  const [integerPart, fractionPart = ''] = unsigned.split('.');
  if (fractionPart.length > scale) throw new InvalidDecimalError(value);

  const paddedFraction = fractionPart.padEnd(scale, '0');
  const magnitude = BigInt(integerPart + paddedFraction);
  return negative ? -magnitude : magnitude;
}

function roundToScale(value: bigint, fromScale: number, toScale: number): bigint {
  const dropDigits = fromScale - toScale;
  if (dropDigits <= 0) return value;

  const divisor = 10n ** BigInt(dropDigits);
  const half = divisor / 2n;
  const negative = value < 0n;
  const magnitude = negative ? -value : value;
  const rounded = (magnitude + half) / divisor;
  return negative ? -rounded : rounded;
}

function formatScaledBigInt(value: bigint, scale: number): string {
  const negative = value < 0n;
  const magnitude = (negative ? -value : value).toString().padStart(scale + 1, '0');
  const integerPart = magnitude.slice(0, magnitude.length - scale);
  const fractionPart = magnitude.slice(magnitude.length - scale);
  return `${negative ? '-' : ''}${integerPart}.${fractionPart}`;
}
