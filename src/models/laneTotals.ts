import { Item } from 'src/components/types';
import { Rational, addRationals, parseLeadingQuantity } from 'src/helpers/rational';

/** Sum quantities from active lane cards, regardless of their checked state. */
export function sumLaneQuantities(items: readonly Item[], unit: string): Rational | null {
  if (!unit.trim()) return null;

  let total: Rational | null = null;

  for (const item of items) {
    const quantity = parseLeadingQuantity(item.data.titleRaw, unit);
    if (!quantity) continue;

    if (!total) {
      total = quantity;
      continue;
    }

    total = addRationals(total, quantity);
    if (!total) return null;
  }

  return total;
}
