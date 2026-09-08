import { describe, expect, it } from 'vitest';

import { InvalidDecimalError, multiplyQuantityByUnitPrice, sumMoney } from './money.js';

describe('multiplyQuantityByUnitPrice', () => {
  it('multiplies whole quantities and prices exactly', () => {
    expect(multiplyQuantityByUnitPrice('2', '150.00')).toBe('300.00');
  });

  it('multiplies fractional quantities exactly when no rounding is needed', () => {
    expect(multiplyQuantityByUnitPrice('2.5', '10.00')).toBe('25.00');
  });

  it('rounds a repeating/excess fraction half-up to money scale', () => {
    expect(multiplyQuantityByUnitPrice('0.333', '3.00')).toBe('1.00');
  });

  it('rounds exactly-half remainders up', () => {
    expect(multiplyQuantityByUnitPrice('0.5', '0.01')).toBe('0.01');
  });

  it('rounds a below-half remainder down', () => {
    expect(multiplyQuantityByUnitPrice('0.334', '3.00')).toBe('1.00');
  });

  it('returns zero for a zero quantity', () => {
    expect(multiplyQuantityByUnitPrice('0', '999.99')).toBe('0.00');
  });

  it('rejects a quantity with more than 3 decimal places', () => {
    expect(() => multiplyQuantityByUnitPrice('1.0001', '1.00')).toThrow(InvalidDecimalError);
  });

  it('rejects a unit price with more than 2 decimal places', () => {
    expect(() => multiplyQuantityByUnitPrice('1', '1.005')).toThrow(InvalidDecimalError);
  });

  it('rejects a non-numeric value', () => {
    expect(() => multiplyQuantityByUnitPrice('abc', '1.00')).toThrow(InvalidDecimalError);
  });
});

describe('sumMoney', () => {
  it('sums money-scale values exactly', () => {
    expect(sumMoney(['10.50', '5.25', '0.01'])).toBe('15.76');
  });

  it('returns zero for an empty list', () => {
    expect(sumMoney([])).toBe('0.00');
  });

  it('rejects a value with more than money scale decimals', () => {
    expect(() => sumMoney(['1.005'])).toThrow(InvalidDecimalError);
  });
});
