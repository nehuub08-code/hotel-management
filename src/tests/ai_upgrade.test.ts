import express from 'express';
import http from 'http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { signSandboxToken } from '../middleware/auth.ts';
import {
  computeTargetBudgetCents,
  enforceRecommendationBudget,
  extractJson,
  filterEligibleMenuItems,
  formatGeminiError,
  normalizeVoiceQuantity,
  scoreCandidateForCriteria,
  type MenuCandidate,
} from '../server/ai.ts';
import { DEFAULT_CUSTOMER_TEMPLATES, renderTemplateString } from '../server/notifications.ts';
import { createApiRouter } from '../server/routes.ts';

const SAMPLE_MENU: MenuCandidate[] = [
  {
    id: 1,
    categoryId: 1,
    categoryName: 'Starters',
    name: 'Burrata & Charred Fig',
    description: 'Creamy burrata with pistachios and balsamic reduction.',
    basePriceCents: 38000,
    imageKey: 'burrata_fig',
    isVegetarian: true,
    isVegan: false,
    isAvailable: true,
    prepTimeMinutes: 10,
    defaultSpiceLevel: 'Mild',
    allergenCodes: ['dairy', 'nuts'],
  },
  {
    id: 2,
    categoryId: 2,
    categoryName: 'Mains',
    name: 'Saffron Hearth Risotto',
    description: 'Aged Carnaroli rice simmered with saffron threads.',
    basePriceCents: 42000,
    imageKey: 'saffron_risotto',
    isVegetarian: true,
    isVegan: false,
    isAvailable: true,
    prepTimeMinutes: 18,
    defaultSpiceLevel: 'Mild',
    allergenCodes: ['dairy'],
  },
  {
    id: 3,
    categoryId: 2,
    categoryName: 'Mains',
    name: 'Wood-Fired Lamb Chops',
    description: 'Herb-crusted lamb chops over aged oak embers.',
    basePriceCents: 68000,
    imageKey: 'lamb_chops',
    isVegetarian: false,
    isVegan: false,
    isAvailable: true,
    prepTimeMinutes: 22,
    defaultSpiceLevel: 'Hot',
    allergenCodes: [],
  },
  {
    id: 4,
    categoryId: 3,
    categoryName: 'Drinks',
    name: 'Blood Orange Botanical Tonic',
    description: 'Fresh blood orange, rosemary sprig, sparkling tonic.',
    basePriceCents: 18000,
    imageKey: 'orange_tonic',
    isVegetarian: true,
    isVegan: true,
    isAvailable: true,
    prepTimeMinutes: 4,
    defaultSpiceLevel: 'Mild',
    allergenCodes: [],
  },
  {
    id: 5,
    categoryId: 1,
    categoryName: 'Starters',
    name: 'Sold Out Truffle Tart',
    description: 'Unavailable seasonal truffle tart.',
    basePriceCents: 22000,
    imageKey: 'truffle_flatbread',
    isVegetarian: true,
    isVegan: false,
    isAvailable: false,
    prepTimeMinutes: 12,
    defaultSpiceLevel: 'Mild',
    allergenCodes: ['gluten'],
  },
];

describe('Feature 1: AI Recommendation Filtering & Budget Enforcement', () => {
  it('computes per-person vs entire-table target budget accurately', () => {
    expect(
      computeTargetBudgetCents({ budgetCents: 30000, budgetScope: 'per_person', guestCount: 3 })
    ).toBe(90000);
    expect(
      computeTargetBudgetCents({ budgetCents: 50000, budgetScope: 'entire_table', guestCount: 4 })
    ).toBe(50000);
  });

  it('excludes unavailable items, non-veg items when veg requested, and allergens', () => {
    const eligible = filterEligibleMenuItems(SAMPLE_MENU, {
      guestCount: 2,
      budgetCents: 60000,
      budgetScope: 'entire_table',
      dietaryType: 'veg',
      spiceLevel: 'Medium',
      allergies: ['nuts'],
      coursePreference: 'complete_meal',
      foodPreference: '',
    });

    const ids = eligible.map((e) => e.id);
    expect(ids).toContain(2);
    expect(ids).toContain(4);
    expect(ids).not.toContain(1); // contains nuts
    expect(ids).not.toContain(3); // non-veg + above 600 budget
    expect(ids).not.toContain(5); // unavailable
  });

  it('strictly enforces ceiling budget and adjusts quantities cleanly', () => {
    const map = new Map(SAMPLE_MENU.map((m) => [m.id, m]));
    const picks = enforceRecommendationBudget(
      [
        { menuItemId: 2, quantity: 2, reason: 'Signature saffron main' },
        { menuItemId: 4, quantity: 2, reason: 'Refreshing citrus pairing' },
        { menuItemId: 5, quantity: 1, reason: 'Should be skipped as unavailable' },
      ],
      map,
      65000
    );

    const total = picks.reduce((s, p) => s + p.lineTotalCents, 0);
    expect(total).toBeLessThanOrEqual(65000);
    expect(picks.some((p) => p.menuItemId === 5)).toBe(false);
    expect(picks.find((p) => p.menuItemId === 2)?.quantity).toBe(1);
    expect(picks.find((p) => p.menuItemId === 4)?.quantity).toBe(1);
  });

  it('catches allergy synonyms (pistachios/burrata) and prioritizes non_veg + course + spice scoring', () => {
    const dairyFree = filterEligibleMenuItems(SAMPLE_MENU, {
      guestCount: 2,
      budgetCents: 100000,
      budgetScope: 'entire_table',
      dietaryType: 'any',
      spiceLevel: 'any',
      allergies: ['dairy'],
      coursePreference: 'complete_meal',
      foodPreference: '',
    });
    expect(dairyFree.map((i) => i.id)).not.toContain(1);
    expect(dairyFree.map((i) => i.id)).not.toContain(2);
    expect(dairyFree.map((i) => i.id)).toContain(3);

    const criteria = {
      guestCount: 2,
      budgetCents: 100000,
      budgetScope: 'entire_table' as const,
      dietaryType: 'non_veg' as const,
      spiceLevel: 'Hot' as const,
      allergies: [],
      coursePreference: 'main_course',
      foodPreference: 'lamb',
    };
    const lambScore = scoreCandidateForCriteria(SAMPLE_MENU[2], criteria);
    const tonicScore = scoreCandidateForCriteria(SAMPLE_MENU[3], criteria);
    expect(lambScore).toBeGreaterThan(tonicScore);
  });

  it('extracts JSON cleanly from fenced model responses and formats raw Gemini quota errors', () => {
    const parsed = extractJson<{ ok: boolean }>('```json\n{"ok": true}\n```');
    expect(parsed.ok).toBe(true);

    const quotaMsg = formatGeminiError(
      new Error('{"error":{"code":429,"status":"RESOURCE_EXHAUSTED","message":"Quota exceeded"}}')
    );
    expect(quotaMsg).toContain('429');
    expect(quotaMsg).not.toContain('"status":"RESOURCE_EXHAUSTED"');
  });
});

describe('Feature 2: Multilingual Voice Ordering Quantity Parsing', () => {
  it('parses English, Hindi, Marathi, and numeric quantities safely', () => {
    expect(normalizeVoiceQuantity('ek')).toBe(1);
    expect(normalizeVoiceQuantity('do')).toBe(2);
    expect(normalizeVoiceQuantity('don')).toBe(2);
    expect(normalizeVoiceQuantity('teen')).toBe(3);
    expect(normalizeVoiceQuantity('paanch')).toBe(5);
    expect(normalizeVoiceQuantity('4')).toBe(4);
    expect(normalizeVoiceQuantity(50)).toBe(20);
    expect(normalizeVoiceQuantity(undefined)).toBe(1);
  });
});

describe('Feature 6: Personalized Customer Lifecycle Message Templates', () => {
  it('interpolates all dynamic variables cleanly', () => {
    const rendered = renderTemplateString(
      'Hi {{customer_name}} at {{table_number}} ({{restaurant_name}}): {{order_id}} ETA {{estimated_time}}, paid {{payment_amount}}.',
      {
        customer_name: 'Aarav',
        table_number: 'T-04',
        restaurant_name: 'Saffron & Hearth',
        order_id: 'ORD-2041',
        estimated_time: '14 mins',
        payment_amount: '₹1,240.00',
      }
    );
    expect(rendered).toBe(
      'Hi Aarav at T-04 (Saffron & Hearth): ORD-2041 ETA 14 mins, paid ₹1,240.00.'
    );
  });

  it('includes all 8 standard lifecycle template keys by default', () => {
    const keys = DEFAULT_CUSTOMER_TEMPLATES.map((t) => t.eventKey);
    expect(keys).toEqual([
      'qr_welcome',
      'order_confirmation',
      'order_preparation',
      'order_delay',
      'food_ready',
      'payment_success',
      'goodbye_message',
      'feedback_request',
    ]);
  });
});

describe('Features 3, 4 & 5: RBAC, Cross-Tenant Isolation & Input Validation', () => {
  let server: http.Server;
  let baseUrl = '';

  beforeAll(async () => {
    const app = express();
    app.use(express.json());
    app.use('/api', createApiRouter());
    await new Promise<void>((resolve) => {
      server = app.listen(0, '127.0.0.1', () => {
        const addr = server.address();
        if (addr && typeof addr === 'object') {
          baseUrl = `http://127.0.0.1:${addr.port}`;
        }
        resolve();
      });
    });
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it('blocks customer and kitchen staff from accessing AI Owner Assistant endpoints', async () => {
    const kitchenToken = signSandboxToken({
      userId: 2,
      uid: 'kitchen-test',
      email: 'chef@test.local',
      fullName: 'Chef Test',
      role: 'kitchen',
      isSuperAdmin: false,
      restaurantId: 1,
      isSandbox: true,
    });

    const convRes = await fetch(`${baseUrl}/api/ai/assistant/conversations?restaurantId=1`, {
      headers: { Authorization: `Bearer ${kitchenToken}` },
    });
    expect(convRes.status).toBe(403);

    const chatRes = await fetch(`${baseUrl}/api/ai/assistant/chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${kitchenToken}`,
      },
      body: JSON.stringify({ restaurantId: 1, message: "What is today's revenue?" }),
    });
    expect(chatRes.status).toBe(403);
  });

  it('enforces cross-tenant isolation for non-super-admin owners', async () => {
    const ownerRest1 = signSandboxToken({
      userId: 1,
      uid: 'owner-rest-1',
      email: 'owner@rest1.local',
      fullName: 'Owner Rest 1',
      role: 'owner',
      isSuperAdmin: false,
      restaurantId: 1,
      isSandbox: true,
    });

    const res = await fetch(`${baseUrl}/api/ai/assistant/conversations?restaurantId=2`, {
      headers: { Authorization: `Bearer ${ownerRest1}` },
    });
    expect(res.status).toBe(403);

    const modelRes = await fetch(`${baseUrl}/api/admin/models`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${ownerRest1}`,
      },
      body: JSON.stringify({
        restaurantId: 2,
        menuItemId: 1,
        modelTitle: 'Unauthorized Cross-Tenant Model',
      }),
    });
    expect(modelRes.status).toBe(403);
  });

  it('validates voice order payloads and rejects empty transcripts cleanly', async () => {
    const res = await fetch(`${baseUrl}/api/ai/voice-parse`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ restaurantId: 1, transcript: '' }),
    });
    expect(res.status).toBe(400);
  });
});
