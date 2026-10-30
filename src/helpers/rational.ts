export interface Rational {
  numerator: number;
  denominator: number;
}

export type FractionDisplayFormat = 'mixed' | 'improper';

function gcd(a: number, b: number): number {
  while (b !== 0) {
    [a, b] = [b, a % b];
  }

  return a;
}

function makeRational(numerator: number, denominator: number): Rational | null {
  if (!Number.isSafeInteger(numerator) || !Number.isSafeInteger(denominator) || denominator <= 0) {
    return null;
  }

  const divisor = gcd(Math.abs(numerator), denominator) || 1;
  return {
    numerator: numerator / divisor,
    denominator: denominator / divisor,
  };
}

export function addRationals(left: Rational, right: Rational): Rational | null {
  const commonDivisor = gcd(left.denominator, right.denominator);
  const leftMultiplier = right.denominator / commonDivisor;
  const rightMultiplier = left.denominator / commonDivisor;
  const numerator = left.numerator * leftMultiplier + right.numerator * rightMultiplier;
  const denominator = left.denominator * leftMultiplier;

  return makeRational(numerator, denominator);
}

function unquote(value: string): string {
  return value.replace(/`/g, '');
}

function parseInteger(value: string): Rational | null {
  const integer = Number(unquote(value));
  return makeRational(integer, 1);
}

function parseDecimal(value: string): Rational | null {
  const [whole, fraction = ''] = unquote(value).split('.');
  const denominator = 10 ** fraction.length;
  const numerator = Number(whole + fraction);

  return makeRational(numerator, denominator);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Parse a quantity only when it appears at the start of a card and is followed by its unit. */
export function parseLeadingQuantity(text: string, configuredUnit: string): Rational | null {
  const unit = configuredUnit.trim();
  if (!unit) return null;

  const integer = '(?:`\\d+`|\\d+)';
  const decimal = '(?:`\\d+(?:\\.\\d+)?`|\\d+(?:\\.\\d+)?)';
  const pattern = new RegExp(
    `^\\s*(?:(${integer})\\s+(${integer})\\s*\\/\\s*(${integer})|(${integer})\\s*\\/\\s*(${integer})|(${decimal}))\\s*${escapeRegExp(unit)}(?=$|\\s|[.,;:!?)}\\]])`
  );
  const match = pattern.exec(text);

  if (!match) return null;

  if (match[1] !== undefined) {
    const whole = parseInteger(match[1]);
    const numerator = Number(unquote(match[2]));
    const denominator = Number(unquote(match[3]));
    const fraction = makeRational(numerator, denominator);

    return whole && fraction ? addRationals(whole, fraction) : null;
  }

  if (match[4] !== undefined) {
    return makeRational(Number(unquote(match[4])), Number(unquote(match[5])));
  }

  return parseDecimal(match[6]);
}

export function formatRational(value: Rational, format: FractionDisplayFormat = 'mixed'): string {
  const normalized = makeRational(value.numerator, value.denominator);
  if (!normalized) return '';

  const { numerator, denominator } = normalized;
  if (denominator === 1) return String(numerator);

  if (format === 'improper') {
    return `${numerator}/${denominator}`;
  }

  const whole = Math.floor(numerator / denominator);
  const remainder = numerator % denominator;
  return whole === 0 ? `${remainder}/${denominator}` : `${whole} ${remainder}/${denominator}`;
}
