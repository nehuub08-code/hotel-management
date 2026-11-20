export interface PriceableLineItem {
  unitPriceCents: number;
  variantPriceDeltaCents: number;
  addons: { name: string; priceCents: number }[];
  quantity: number;
}

export interface OrderPricingBreakdown {
  subtotalCents: number;
  discountCents: number;
  taxCents: number;
  serviceChargeCents: number;
  totalCents: number;
}

export const DISCOUNT_CODES: Record<string, { type: 'percent' | 'flat'; value: number; minSubtotalCents: number }> = {
  EMBER10: { type: 'percent', value: 10, minSubtotalCents: 30000 },
  WELCOME50: { type: 'flat', value: 5000, minSubtotalCents: 25000 },
  CHEF15: { type: 'percent', value: 15, minSubtotalCents: 100000 },
};

export function calculateLineTotalCents(item: PriceableLineItem): number {
  const addonsSum = item.addons.reduce((acc, a) => acc + Math.max(0, a.priceCents), 0);
  const perUnit = Math.max(0, item.unitPriceCents + item.variantPriceDeltaCents + addonsSum);
  return perUnit * Math.max(1, item.quantity);
}

export function calculateDiscountCents(subtotalCents: number, discountCode?: string): number {
  if (!discountCode) return 0;
  const code = discountCode.trim().toUpperCase();
  const rule = DISCOUNT_CODES[code];
  if (!rule || subtotalCents < rule.minSubtotalCents) return 0;
  if (rule.type === 'percent') {
    return Math.round((subtotalCents * rule.value) / 100);
  }
  return Math.min(subtotalCents, rule.value);
}

export function calculateOrderTotals(params: {
  items: PriceableLineItem[];
  taxRatePercent: number;
  serviceChargePercent: number;
  discountCode?: string;
}): OrderPricingBreakdown {
  const subtotalCents = params.items.reduce((sum, item) => sum + calculateLineTotalCents(item), 0);
  const discountCents = calculateDiscountCents(subtotalCents, params.discountCode);
  const taxableAmount = Math.max(0, subtotalCents - discountCents);
  const taxCents = Math.round((taxableAmount * Math.max(0, params.taxRatePercent)) / 100);
  const serviceChargeCents = Math.round(
    (taxableAmount * Math.max(0, params.serviceChargePercent)) / 100
  );
  const totalCents = taxableAmount + taxCents + serviceChargeCents;

  return {
    subtotalCents,
    discountCents,
    taxCents,
    serviceChargeCents,
    totalCents,
  };
}

export function canCancelOrder(params: {
  status: string;
  createdAt: Date;
  cancellationRuleMinutes: number;
  now?: Date;
}): { allowed: boolean; reason?: string } {
  const nonCancellable = ['Cooking', 'Ready', 'Served', 'Completed', 'Cancelled'];
  if (nonCancellable.includes(params.status)) {
    return {
      allowed: false,
      reason: `Cannot cancel order while status is ${params.status}.`,
    };
  }
  const now = params.now ?? new Date();
  const elapsedMinutes = (now.getTime() - params.createdAt.getTime()) / 60000;
  if (elapsedMinutes > params.cancellationRuleMinutes) {
    return {
      allowed: false,
      reason: `Cancellation window of ${params.cancellationRuleMinutes} minutes has expired.`,
    };
  }
  return { allowed: true };
}

export function formatMoney(cents: number, symbol = '₹'): string {
  const value = (cents / 100).toLocaleString('en-IN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return `${symbol}${value}`;
}
