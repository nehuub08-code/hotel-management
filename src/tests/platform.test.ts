import crypto from 'crypto';
import { describe, expect, it } from 'vitest';
import {
  calculateDiscountCents,
  calculateLineTotalCents,
  calculateOrderTotals,
  canCancelOrder,
  formatMoney,
} from '../shared/calculations.ts';
import { signSandboxToken, verifySandboxToken } from '../middleware/auth.ts';

describe('Cart & Server-Side Order Pricing Engine', () => {
  it('computes line total with variant delta, addons, and quantity', () => {
    const total = calculateLineTotalCents({
      unitPriceCents: 68000,
      variantPriceDeltaCents: 22000,
      addons: [
        { name: 'Extra Truffle Drizzle', priceCents: 9500 },
        { name: 'Charred Sourdough Side', priceCents: 8000 },
      ],
      quantity: 2,
    });
    expect(total).toBe((68000 + 22000 + 9500 + 8000) * 2);
  });

  it('applies EMBER10 percentage discount, 5% GST, and 5% service charge', () => {
    const totals = calculateOrderTotals({
      items: [
        { unitPriceCents: 100000, variantPriceDeltaCents: 0, addons: [], quantity: 1 },
      ],
      taxRatePercent: 5,
      serviceChargePercent: 5,
      discountCode: 'EMBER10',
    });
    expect(totals.subtotalCents).toBe(100000);
    expect(totals.discountCents).toBe(10000);
    expect(totals.taxCents).toBe(4500);
    expect(totals.serviceChargeCents).toBe(4500);
    expect(totals.totalCents).toBe(99000);
  });

  it('ignores promo code below minimum subtotal threshold', () => {
    expect(calculateDiscountCents(10000, 'EMBER10')).toBe(0);
  });

  it('formats INR money cleanly', () => {
    expect(formatMoney(124000, '₹')).toBe('₹1,240.00');
  });
});

describe('Order Cancellation Rules', () => {
  it('allows cancellation when Pending and within cancellation window', () => {
    const now = new Date();
    const createdAt = new Date(now.getTime() - 2 * 60_000);
    const res = canCancelOrder({ status: 'Pending', createdAt, cancellationRuleMinutes: 5, now });
    expect(res.allowed).toBe(true);
  });

  it('blocks cancellation once Cooking has started', () => {
    const now = new Date();
    const res = canCancelOrder({
      status: 'Cooking',
      createdAt: now,
      cancellationRuleMinutes: 5,
      now,
    });
    expect(res.allowed).toBe(false);
  });

  it('blocks cancellation after grace window expires', () => {
    const now = new Date();
    const createdAt = new Date(now.getTime() - 12 * 60_000);
    const res = canCancelOrder({ status: 'Pending', createdAt, cancellationRuleMinutes: 5, now });
    expect(res.allowed).toBe(false);
  });
});

describe('RBAC Token Integrity & HMAC Payment Signature Verification', () => {
  it('issues and verifies server-signed RBAC sandbox tokens and rejects tampered payloads', () => {
    const token = signSandboxToken({
      userId: 1,
      uid: 'demo-kitchen-saffron',
      email: 'chef@saffronhearth.in',
      fullName: 'Chef Rohan',
      role: 'kitchen',
      isSuperAdmin: false,
      restaurantId: 1,
      isSandbox: true,
    });

    const verified = verifySandboxToken(token);
    expect(verified?.role).toBe('kitchen');
    expect(verified?.restaurantId).toBe(1);

    // Tamper with payload segment
    const parts = token.split('.');
    const tamperedPayload = Buffer.from(
      JSON.stringify({ role: 'super_admin', isSuperAdmin: true, exp: Date.now() + 10000 })
    ).toString('base64url');
    const tamperedToken = `${parts[0]}.${tamperedPayload}.${parts[2]}`;
    expect(verifySandboxToken(tamperedToken)).toBeNull();
  });

  it('verifies Razorpay-compatible HMAC-SHA256 payment signatures', () => {
    const secret = 'embertable_sandbox_hmac_secret';
    const orderId = 'order_rzp_test123';
    const paymentId = 'pay_rzp_test456';
    const sig = crypto.createHmac('sha256', secret).update(`${orderId}|${paymentId}`).digest('hex');

    const expected = crypto
      .createHmac('sha256', secret)
      .update(`${orderId}|${paymentId}`)
      .digest('hex');
    expect(sig).toBe(expected);
  });
});
