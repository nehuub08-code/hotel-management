import {
  GoogleGenAI,
  ThinkingLevel,
  Type,
  type Content,
  type FunctionDeclaration,
} from '@google/genai';
import { and, desc, eq, inArray } from 'drizzle-orm';
import { db } from '../db/index.ts';
import {
  aiRecommendationSessions,
  assistantConversations,
  assistantMessages,
  inventoryItems,
  menuCategories,
  menuItems,
  menuVariants,
  orderItems,
  orders,
  recommendationItems,
  restaurants,
  reviews,
  voiceOrderSessions,
  type AssistantChartPayload,
  type VoiceParsedItemPayload,
} from '../db/schema.ts';
import type {
  AiRecommendationItemDTO,
  AiRecommendationResponseDTO,
  SpiceLevel,
  VoiceOrderParseResponseDTO,
} from '../shared/types.ts';

const GEMINI_MODEL = 'gemini-4-hydrogen';
const GEMINI_LITE_MODEL = 'gemini-3.1-flash-lite';
const GEMINI_TIMEOUT_MS = 14_000;

function getGeminiClient(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY is not configured on the server.');
  }
  return new GoogleGenAI({
    apiKey,
    httpOptions: { headers: { 'User-Agent': 'aistudio-build' } },
  });
}

export function formatGeminiError(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  let extractedMsg = raw;
  let code = 0;
  let status = '';

  try {
    const startIdx = raw.indexOf('{');
    if (startIdx !== -1) {
      const parsed = JSON.parse(raw.slice(startIdx)) as {
        error?: { code?: number; message?: string; status?: string };
      };
      if (parsed?.error) {
        code = Number(parsed.error.code || 0);
        status = parsed.error.status || '';
        if (parsed.error.message) {
          extractedMsg = parsed.error.message.split('\n')[0].trim();
        }
      }
    }
  } catch {
    // Keep raw message if not JSON
  }

  const lower = `${raw} ${extractedMsg}`.toLowerCase();
  if (code === 403 || lower.includes('permission_denied') || lower.includes('api key')) {
    return 'Gemini API key is missing or invalid. Please check GEMINI_API_KEY in Settings > Secrets.';
  }
  if (code === 429 || status === 'RESOURCE_EXHAUSTED' || lower.includes('quota')) {
    return 'AI request quota temporarily exhausted (429). Please retry shortly or configure a billing-enabled key in Settings > Secrets.';
  }
  if (
    lower.includes('abort') ||
    lower.includes('timeout') ||
    lower.includes('timed out')
  ) {
    return 'AI service timed out while processing your request. Please try again.';
  }
  if (code === 404 || status === 'NOT_FOUND') {
    return 'Configured Gemini model is currently unavailable.';
  }
  return extractedMsg.length > 220 ? `${extractedMsg.slice(0, 217)}...` : extractedMsg;
}

export function extractJson<T>(rawText: string | undefined): T {
  const trimmed = (rawText || '').trim();
  if (!trimmed) {
    throw new Error('AI returned an empty structured response.');
  }
  const unfenced = trimmed
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();
  try {
    return JSON.parse(unfenced) as T;
  } catch {
    const objStart = unfenced.indexOf('{');
    const objEnd = unfenced.lastIndexOf('}');
    if (objStart !== -1 && objEnd > objStart) {
      return JSON.parse(unfenced.slice(objStart, objEnd + 1)) as T;
    }
    throw new Error('AI returned malformed JSON output.');
  }
}

async function generateWithRetry(
  ai: GoogleGenAI,
  req: Parameters<GoogleGenAI['models']['generateContent']>[0]
) {
  const primaryReq: Parameters<GoogleGenAI['models']['generateContent']>[0] = {
    ...req,
    model: GEMINI_MODEL,
    config: {
      ...(req.config || {}),
      thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
      abortSignal: AbortSignal.timeout(GEMINI_TIMEOUT_MS),
    },
  };

  try {
    return await ai.models.generateContent(primaryReq);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    const isTransient = msg.includes('503') || msg.includes('UNAVAILABLE');
    const isQuotaOrTimeout =
      msg.includes('429') ||
      msg.includes('RESOURCE_EXHAUSTED') ||
      msg.toLowerCase().includes('abort') ||
      msg.toLowerCase().includes('timeout');

    if (isTransient) {
      await new Promise((r) => setTimeout(r, 600));
      try {
        return await ai.models.generateContent({
          ...primaryReq,
          config: {
            ...(primaryReq.config || {}),
            abortSignal: AbortSignal.timeout(GEMINI_TIMEOUT_MS),
          },
        });
      } catch (retryErr: unknown) {
        const retryMsg = retryErr instanceof Error ? retryErr.message : String(retryErr);
        if (
          !retryMsg.includes('429') &&
          !retryMsg.includes('RESOURCE_EXHAUSTED') &&
          !retryMsg.includes('503') &&
          !retryMsg.toLowerCase().includes('abort') &&
          !retryMsg.toLowerCase().includes('timeout')
        ) {
          throw new Error(formatGeminiError(retryErr));
        }
      }
    }

    if (isQuotaOrTimeout || isTransient) {
      try {
        const liteConfig = { ...(req.config || {}) };
        delete (liteConfig as Record<string, unknown>).thinkingConfig;
        return await ai.models.generateContent({
          ...req,
          model: GEMINI_LITE_MODEL,
          config: {
            ...liteConfig,
            abortSignal: AbortSignal.timeout(GEMINI_TIMEOUT_MS),
          },
        });
      } catch (liteErr: unknown) {
        throw new Error(formatGeminiError(liteErr));
      }
    }

    throw new Error(formatGeminiError(err));
  }
}

// ---------------------------------------------------------------------------
// PURE DETERMINISTIC HELPERS (Menu Filtering, Budget Math, Voice Resolution)
// ---------------------------------------------------------------------------

export interface MenuCandidate {
  id: number;
  categoryId: number;
  categoryName: string;
  name: string;
  description: string;
  basePriceCents: number;
  imageKey: string;
  isVegetarian: boolean;
  isVegan: boolean;
  isAvailable: boolean;
  prepTimeMinutes: number;
  defaultSpiceLevel: string;
  allergenCodes: string[];
}

export interface RecommendationCriteria {
  guestCount: number;
  budgetCents: number;
  budgetScope: 'per_person' | 'entire_table';
  dietaryType: 'any' | 'veg' | 'non_veg' | 'vegan';
  spiceLevel: 'any' | 'Mild' | 'Medium' | 'Hot';
  allergies: string[];
  coursePreference: string;
  foodPreference: string;
}

export function computeTargetBudgetCents(criteria: {
  budgetCents: number;
  budgetScope: 'per_person' | 'entire_table';
  guestCount: number;
}): number {
  const safeGuests = Math.max(1, criteria.guestCount || 1);
  return criteria.budgetScope === 'per_person'
    ? criteria.budgetCents * safeGuests
    : criteria.budgetCents;
}

const ALLERGY_SYNONYMS: Record<string, string[]> = {
  dairy: ['dairy', 'milk', 'cream', 'butter', 'cheese', 'burrata', 'paneer', 'ghee', 'yogurt', 'curd', 'lassi'],
  nuts: ['nut', 'nuts', 'pistachio', 'almond', 'cashew', 'walnut', 'hazelnut', 'peanut', 'pecan'],
  gluten: ['gluten', 'wheat', 'flour', 'bread', 'naan', 'roti', 'flatbread', 'sourdough', 'ramen', 'noodle', 'pasta', 'crust'],
  eggs: ['egg', 'eggs', 'ajitama', 'mayo', 'mayonnaise', 'custard', 'meringue'],
  soy: ['soy', 'soya', 'tofu', 'miso', 'tamari', 'edamame', 'teriyaki'],
  shellfish: ['shellfish', 'prawn', 'shrimp', 'crab', 'lobster', 'clam', 'mussel', 'oyster', 'scallop'],
};

function textContainsWord(text: string, term: string): boolean {
  const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`\\b${escaped}\\b`, 'i').test(text);
}

export function filterEligibleMenuItems(
  candidates: MenuCandidate[],
  criteria: RecommendationCriteria
): MenuCandidate[] {
  const normalizedAllergies = criteria.allergies.map((a) => a.trim().toLowerCase()).filter(Boolean);
  const targetBudgetCents = computeTargetBudgetCents(criteria);

  return candidates.filter((item) => {
    if (!item.isAvailable) return false;
    if (criteria.dietaryType === 'veg' && !item.isVegetarian) return false;
    if (criteria.dietaryType === 'vegan' && !item.isVegan) return false;

    if (normalizedAllergies.length > 0) {
      const itemAllergens = item.allergenCodes.map((c) => c.toLowerCase());
      const combinedText = `${item.name} ${item.description}`.toLowerCase();
      for (const allergy of normalizedAllergies) {
        const synonyms = ALLERGY_SYNONYMS[allergy] || [allergy];
        if (itemAllergens.includes(allergy)) return false;
        if (synonyms.some((term) => itemAllergens.includes(term) || textContainsWord(combinedText, term))) {
          return false;
        }
      }
    }

    if (targetBudgetCents > 0 && item.basePriceCents > targetBudgetCents) {
      return false;
    }
    return true;
  });
}

export function scoreCandidateForCriteria(
  item: MenuCandidate,
  criteria: RecommendationCriteria
): number {
  let score = 0;

  if (criteria.dietaryType === 'non_veg' && !item.isVegetarian) {
    score += 45;
  }

  const catLower = item.categoryName.toLowerCase();
  const course = (criteria.coursePreference || 'complete_meal').toLowerCase();
  if (course === 'starter' && /starter|small|appetizer|shareable|soup|salad/.test(catLower)) {
    score += 35;
  } else if (
    course === 'main_course' &&
    /main|hearth|ramen|rice|curry|grill|entree|bowl|katsu/.test(catLower)
  ) {
    score += 35;
  } else if (
    course === 'dessert' &&
    /dessert|sweet|drink|beverage|craft|tea|coffee|cocktail|mocktail/.test(catLower)
  ) {
    score += 35;
  }

  if (
    criteria.spiceLevel &&
    criteria.spiceLevel !== 'any' &&
    item.defaultSpiceLevel.toLowerCase() === criteria.spiceLevel.toLowerCase()
  ) {
    score += 20;
  }

  if (criteria.foodPreference.trim()) {
    const haystack = `${item.name} ${item.description} ${item.categoryName}`.toLowerCase();
    const tokens = criteria.foodPreference
      .toLowerCase()
      .split(/[\s,]+/)
      .filter((t) => t.length >= 3);
    for (const tok of tokens) {
      if (haystack.includes(tok)) score += 15;
    }
  }

  return score;
}

export function enforceRecommendationBudget(
  proposed: { menuItemId: number; quantity: number; reason: string }[],
  eligibleMap: Map<number, MenuCandidate>,
  targetBudgetCents: number
): AiRecommendationItemDTO[] {
  const result: AiRecommendationItemDTO[] = [];
  let runningTotal = 0;

  for (const pick of proposed) {
    const item = eligibleMap.get(pick.menuItemId);
    if (!item || !item.isAvailable) continue;
    let qty = Math.max(1, Math.min(6, Math.round(pick.quantity || 1)));
    while (qty > 1 && runningTotal + item.basePriceCents * qty > targetBudgetCents) {
      qty -= 1;
    }
    const lineTotal = item.basePriceCents * qty;
    if (targetBudgetCents > 0 && runningTotal + lineTotal > targetBudgetCents) {
      continue;
    }
    runningTotal += lineTotal;
    result.push({
      menuItemId: item.id,
      name: item.name,
      description: item.description,
      imageKey: item.imageKey,
      quantity: qty,
      unitPriceCents: item.basePriceCents,
      lineTotalCents: lineTotal,
      isVegetarian: item.isVegetarian,
      defaultSpiceLevel: (item.defaultSpiceLevel as SpiceLevel) || 'Medium',
      prepTimeMinutes: item.prepTimeMinutes,
      reason: pick.reason,
      wasAddedToCart: false,
    });
  }

  return result;
}

const HINDI_MARATHI_NUMBERS: Record<string, number> = {
  ek: 1,
  one: 1,
  a: 1,
  an: 1,
  do: 2,
  two: 2,
  don: 2,
  teen: 3,
  three: 3,
  char: 4,
  four: 4,
  paanch: 5,
  pach: 5,
  five: 5,
};

export function normalizeVoiceQuantity(rawQty: number | string | undefined): number {
  if (typeof rawQty === 'number' && Number.isFinite(rawQty)) {
    return Math.max(1, Math.min(20, Math.round(rawQty)));
  }
  if (typeof rawQty === 'string') {
    const trimmed = rawQty.trim().toLowerCase();
    if (HINDI_MARATHI_NUMBERS[trimmed]) return HINDI_MARATHI_NUMBERS[trimmed];
    const parsed = Number(trimmed);
    if (Number.isFinite(parsed) && parsed > 0) return Math.max(1, Math.min(20, Math.round(parsed)));
  }
  return 1;
}

// ---------------------------------------------------------------------------
// FEATURE 1: AI FOOD RECOMMENDATIONS
// ---------------------------------------------------------------------------

export async function generateAiFoodRecommendations(input: {
  restaurantId: number;
  tableId?: number | null;
  tableSessionId?: number | null;
  guestCount: number;
  budgetCents: number;
  budgetScope: 'per_person' | 'entire_table';
  dietaryType: 'any' | 'veg' | 'non_veg' | 'vegan';
  foodPreference: string;
  spiceLevel: 'any' | 'Mild' | 'Medium' | 'Hot';
  allergies: string[];
  coursePreference: string;
}): Promise<AiRecommendationResponseDTO> {
  const [rest] = await db
    .select()
    .from(restaurants)
    .where(eq(restaurants.id, input.restaurantId))
    .limit(1);
  if (!rest) throw new Error('Restaurant not found.');

  const cats = await db
    .select()
    .from(menuCategories)
    .where(eq(menuCategories.restaurantId, rest.id));
  const catMap = new Map(cats.map((c) => [c.id, c.name]));

  const items = await db
    .select()
    .from(menuItems)
    .where(eq(menuItems.restaurantId, rest.id));

  const candidates: MenuCandidate[] = items.map((it) => ({
    id: it.id,
    categoryId: it.categoryId,
    categoryName: catMap.get(it.categoryId) || 'Menu',
    name: it.name,
    description: it.description,
    basePriceCents: it.basePriceCents,
    imageKey: it.imageKey,
    isVegetarian: it.isVegetarian,
    isVegan: it.isVegan,
    isAvailable: it.isAvailable,
    prepTimeMinutes: it.prepTimeMinutes,
    defaultSpiceLevel: it.defaultSpiceLevel,
    allergenCodes: it.allergenCodes || [],
  }));

  const targetBudgetCents = computeTargetBudgetCents(input);
  const eligible = filterEligibleMenuItems(candidates, input);

  if (eligible.length === 0) {
    const [sessionRow] = await db
      .insert(aiRecommendationSessions)
      .values({
        restaurantId: rest.id,
        tableId: input.tableId ?? null,
        tableSessionId: input.tableSessionId ?? null,
        guestCount: input.guestCount,
        budgetCents: input.budgetCents,
        budgetScope: input.budgetScope,
        dietaryType: input.dietaryType,
        foodPreference: input.foodPreference,
        spiceLevel: input.spiceLevel,
        allergies: input.allergies,
        coursePreference: input.coursePreference,
        summaryText:
          'No available dishes matched all dietary, allergy, and budget filters simultaneously. Try increasing your budget slightly or relaxing an allergy/course filter.',
        totalRecommendedCents: 0,
        status: 'empty',
      })
      .returning();

    return {
      sessionId: sessionRow.id,
      summaryText: sessionRow.summaryText,
      budgetTargetCents: targetBudgetCents,
      budgetScope: input.budgetScope,
      guestCount: input.guestCount,
      totalRecommendedCents: 0,
      items: [],
    };
  }

  const rankedEligible = [...eligible].sort((a, b) => {
    const diff = scoreCandidateForCriteria(b, input) - scoreCandidateForCriteria(a, input);
    return diff !== 0 ? diff : a.basePriceCents - b.basePriceCents;
  });

  const eligibleMap = new Map(rankedEligible.map((i) => [i.id, i]));
  const ai = getGeminiClient();

  const menuCatalogForPrompt = rankedEligible.map((item) => ({
    menuItemId: item.id,
    name: item.name,
    category: item.categoryName,
    priceRupees: Math.round(item.basePriceCents / 100),
    isVegetarian: item.isVegetarian,
    isVegan: item.isVegan,
    spiceLevel: item.defaultSpiceLevel,
    allergens: item.allergenCodes,
    description: item.description,
  }));

  const prompt = [
    `You are the culinary sommelier and AI dining advisor for "${rest.name}" (${rest.cuisineType}).`,
    `Compose a balanced, delicious meal combination using ONLY the verified available menu items below.`,
    ``,
    `Guest Profile:`,
    `- Guests: ${input.guestCount}`,
    `- Maximum Total Budget: ₹${Math.round(targetBudgetCents / 100)} (${input.budgetScope === 'per_person' ? `₹${Math.round(input.budgetCents / 100)} per person` : 'for entire table'})`,
    `- Dietary Preference: ${input.dietaryType}`,
    `- Spice Tolerance: ${input.spiceLevel}`,
    `- Food Preference / Mood: ${input.foodPreference || 'Chef selection'}`,
    `- Course Focus: ${input.coursePreference || 'complete_meal'}`,
    `- Allergies Excluded (already filtered, double-check strictly): ${input.allergies.length ? input.allergies.join(', ') : 'None'}`,
    ``,
    `STRICT RULES:`,
    `1. Only select menuItemId values present in the Eligible Menu Catalog.`,
    `2. The sum of (priceRupees * quantity) MUST be <= ₹${Math.round(targetBudgetCents / 100)}.`,
    `3. Recommend 1 to 5 complementary items matching course focus (${input.coursePreference}).`,
    input.dietaryType === 'non_veg'
      ? `4. Guest prefers non-vegetarian dishes: prioritize including at least one non-vegetarian dish if present in the catalog, paired with complementary sides/drinks.`
      : `4. Strictly honor dietary preference (${input.dietaryType}) and spice preference (${input.spiceLevel}).`,
    `5. For each dish, write a concise 1-sentence personalized reason explaining why it fits their taste, spice, and budget.`,
    ``,
    `Eligible Menu Catalog:`,
    JSON.stringify(menuCatalogForPrompt),
  ].join('\n');

  const response = await generateWithRetry(ai, {
    model: GEMINI_MODEL,
    contents: prompt,
    config: {
      responseMimeType: 'application/json',
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          summaryText: {
            type: Type.STRING,
            description: 'Warm 1-2 sentence overview of the curated combo and why it fits the table.',
          },
          picks: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                menuItemId: { type: Type.INTEGER },
                quantity: { type: Type.INTEGER },
                reason: { type: Type.STRING },
              },
              required: ['menuItemId', 'quantity', 'reason'],
            },
          },
        },
        required: ['summaryText', 'picks'],
      },
    },
  });

  const parsed = extractJson<{
    summaryText?: string;
    picks?: { menuItemId: number; quantity: number; reason: string }[];
  }>(response.text);

  let recommended = enforceRecommendationBudget(
    parsed.picks || [],
    eligibleMap,
    targetBudgetCents
  );

  // If Gemini chose items exceeding budget or invalid IDs, fill deterministically respecting score & budget
  if (recommended.length === 0) {
    let remaining = targetBudgetCents;
    for (const candidate of rankedEligible) {
      if (candidate.basePriceCents <= remaining) {
        recommended.push({
          menuItemId: candidate.id,
          name: candidate.name,
          description: candidate.description,
          imageKey: candidate.imageKey,
          quantity: 1,
          unitPriceCents: candidate.basePriceCents,
          lineTotalCents: candidate.basePriceCents,
          isVegetarian: candidate.isVegetarian,
          defaultSpiceLevel: (candidate.defaultSpiceLevel as SpiceLevel) || 'Medium',
          prepTimeMinutes: candidate.prepTimeMinutes,
          reason: `Tailored ${candidate.categoryName.toLowerCase()} pick within your ₹${Math.round(targetBudgetCents / 100)} budget.`,
          wasAddedToCart: false,
        });
        remaining -= candidate.basePriceCents;
        if (recommended.length >= 3) break;
      }
    }
  }

  const totalRecommendedCents = recommended.reduce((s, r) => s + r.lineTotalCents, 0);

  const [sessionRow] = await db
    .insert(aiRecommendationSessions)
    .values({
      restaurantId: rest.id,
      tableId: input.tableId ?? null,
      tableSessionId: input.tableSessionId ?? null,
      guestCount: input.guestCount,
      budgetCents: input.budgetCents,
      budgetScope: input.budgetScope,
      dietaryType: input.dietaryType,
      foodPreference: input.foodPreference,
      spiceLevel: input.spiceLevel,
      allergies: input.allergies,
      coursePreference: input.coursePreference,
      summaryText:
        parsed.summaryText ||
        `Curated ${recommended.length} available dishes totaling ${rest.currencySymbol}${Math.round(totalRecommendedCents / 100)}.`,
      totalRecommendedCents,
      status: 'completed',
    })
    .returning();

  if (recommended.length > 0) {
    const insertedRecs = await db
      .insert(recommendationItems)
      .values(
        recommended.map((r) => ({
          sessionId: sessionRow.id,
          menuItemId: r.menuItemId,
          quantity: r.quantity,
          unitPriceCents: r.unitPriceCents,
          reason: r.reason,
          wasAddedToCart: false,
        }))
      )
      .returning();

    recommended = recommended.map((r, idx) => ({
      ...r,
      id: insertedRecs[idx]?.id,
    }));
  }

  return {
    sessionId: sessionRow.id,
    summaryText: sessionRow.summaryText,
    budgetTargetCents: targetBudgetCents,
    budgetScope: input.budgetScope,
    guestCount: input.guestCount,
    totalRecommendedCents,
    items: recommended,
  };
}

// ---------------------------------------------------------------------------
// FEATURE 2: VOICE-BASED FOOD ORDERING PARSER (MULTILINGUAL)
// ---------------------------------------------------------------------------

export async function parseVoiceFoodOrder(input: {
  restaurantId: number;
  tableSessionId?: number | null;
  language: string;
  transcript: string;
}): Promise<VoiceOrderParseResponseDTO> {
  const cleanTranscript = input.transcript.trim();
  if (!cleanTranscript) {
    throw new Error('Please speak or type your order first.');
  }

  const [rest] = await db
    .select()
    .from(restaurants)
    .where(eq(restaurants.id, input.restaurantId))
    .limit(1);
  if (!rest) throw new Error('Restaurant not found.');

  const dbItems = await db
    .select()
    .from(menuItems)
    .where(eq(menuItems.restaurantId, rest.id));
  const itemIds = dbItems.map((i) => i.id);
  const variants = itemIds.length
    ? await db.select().from(menuVariants).where(inArray(menuVariants.menuItemId, itemIds))
    : [];

  const catalog = dbItems.map((i) => ({
    menuItemId: i.id,
    name: i.name,
    isAvailable: i.isAvailable,
    priceRupees: Math.round(i.basePriceCents / 100),
    defaultSpiceLevel: i.defaultSpiceLevel,
    variants: variants.filter((v) => v.menuItemId === i.id).map((v) => v.name),
  }));

  const ai = getGeminiClient();
  const prompt = [
    `You are a multilingual restaurant voice-order parser for "${rest.name}".`,
    `Understand natural speech in English, Hindi, Marathi, or mixed Hinglish/code-switched phrases.`,
    `Examples: "Ek burrata fig aur do saffron cold brew add karo", "Two wild mushroom flatbread less spicy, ek hazelnut torte".`,
    `Language hint: ${input.language}`,
    `Customer spoken transcript: "${cleanTranscript}"`,
    ``,
    `Restaurant Menu Catalog:`,
    JSON.stringify(catalog),
    ``,
    `Instructions:`,
    `- Extract every requested dish, quantity (convert Hindi/Marathi words like ek/don/do/teen/char to integers), variant if mentioned (default "Regular"), spiceLevel ("Mild"|"Medium"|"Hot"), and specialInstructions.`,
    `- Map to the closest menuItemId from the catalog ONLY if it genuinely matches. If no menu item matches or multiple ambiguous items match equally, set menuItemId to 0 and add an explanation to ambiguities.`,
    `- Never invent prices.`,
  ].join('\n');

  const response = await generateWithRetry(ai, {
    model: GEMINI_MODEL,
    contents: prompt,
    config: {
      responseMimeType: 'application/json',
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          items: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                menuItemId: { type: Type.INTEGER },
                spokenPhrase: { type: Type.STRING },
                quantity: { type: Type.INTEGER },
                variantName: { type: Type.STRING },
                spiceLevel: { type: Type.STRING },
                specialInstructions: { type: Type.STRING },
                confidence: { type: Type.STRING },
              },
              required: ['menuItemId', 'spokenPhrase', 'quantity'],
            },
          },
          ambiguities: {
            type: Type.ARRAY,
            items: { type: Type.STRING },
          },
        },
        required: ['items', 'ambiguities'],
      },
    },
  });

  const parsed = extractJson<{
    items?: {
      menuItemId: number;
      spokenPhrase: string;
      quantity: number;
      variantName?: string;
      spiceLevel?: string;
      specialInstructions?: string;
      confidence?: string;
    }[];
    ambiguities?: string[];
  }>(response.text);

  const itemMap = new Map(dbItems.map((i) => [i.id, i]));
  const ambiguities: string[] = [...(parsed.ambiguities || [])];

  const rescueItemByPhrase = (phrase: string) => {
    const tokens = phrase
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((t) => t.length >= 3 && !HINDI_MARATHI_NUMBERS[t]);
    if (tokens.length === 0) return undefined;
    const scored = dbItems
      .map((item) => {
        const nameLower = item.name.toLowerCase();
        const hits = tokens.filter((t) => nameLower.includes(t)).length;
        return { item, hits, ratio: hits / tokens.length };
      })
      .filter((s) => s.hits >= 2 || (tokens.length === 1 && s.hits === 1))
      .sort((a, b) => b.hits - a.hits || b.ratio - a.ratio);

    if (scored.length === 1) return scored[0].item;
    if (scored.length > 1 && scored[0].hits > scored[1].hits) return scored[0].item;
    return undefined;
  };

  const resolvedItems: (VoiceParsedItemPayload & { imageKey?: string })[] = (parsed.items || []).map(
    (entry) => {
      const qty = normalizeVoiceQuantity(entry.quantity);
      let dbItem = entry.menuItemId ? itemMap.get(entry.menuItemId) : undefined;
      let rescued = false;
      if (!dbItem && entry.spokenPhrase) {
        dbItem = rescueItemByPhrase(entry.spokenPhrase);
        rescued = Boolean(dbItem);
      }
      if (!dbItem) {
        ambiguities.push(`Could not confidently match "${entry.spokenPhrase}" to a menu dish.`);
        return {
          menuItemId: null,
          spokenPhrase: entry.spokenPhrase,
          matchedItemName: entry.spokenPhrase,
          quantity: qty,
          variantName: 'Regular',
          spiceLevel: 'Medium',
          specialInstructions: entry.specialInstructions || '',
          unitPriceCents: 0,
          lineTotalCents: 0,
          isAvailable: false,
          confidence: 'ambiguous',
        };
      }

      const variant = variants.find(
        (v) =>
          v.menuItemId === dbItem.id &&
          v.name.toLowerCase() === (entry.variantName || 'Regular').toLowerCase()
      );
      const unitPriceCents = dbItem.basePriceCents + (variant?.priceDeltaCents || 0);
      const spice =
        entry.spiceLevel === 'Mild' || entry.spiceLevel === 'Hot' ? entry.spiceLevel : 'Medium';

      if (!dbItem.isAvailable) {
        ambiguities.push(`${dbItem.name} is currently marked sold out.`);
      }

      return {
        menuItemId: dbItem.id,
        spokenPhrase: entry.spokenPhrase,
        matchedItemName: dbItem.name,
        quantity: qty,
        variantName: variant?.name || 'Regular',
        spiceLevel: spice,
        specialInstructions: entry.specialInstructions || '',
        unitPriceCents,
        lineTotalCents: dbItem.isAvailable ? unitPriceCents * qty : 0,
        imageKey: dbItem.imageKey,
        isAvailable: dbItem.isAvailable,
        confidence: !dbItem.isAvailable
          ? 'unavailable'
          : rescued || entry.confidence === 'fuzzy'
            ? 'fuzzy'
            : 'exact',
      };
    }
  );

  const estimatedTotalCents = resolvedItems
    .filter((i) => i.isAvailable && i.menuItemId !== null)
    .reduce((sum, i) => sum + i.lineTotalCents, 0);

  const [voiceRow] = await db
    .insert(voiceOrderSessions)
    .values({
      restaurantId: rest.id,
      tableSessionId: input.tableSessionId ?? null,
      language: input.language,
      rawTranscript: cleanTranscript,
      editedTranscript: cleanTranscript,
      parsedItems: resolvedItems,
      ambiguities,
      estimatedTotalCents,
      status: 'parsed',
      errorMessage: '',
    })
    .returning();

  return {
    voiceSessionId: voiceRow.id,
    language: input.language,
    rawTranscript: cleanTranscript,
    items: resolvedItems,
    ambiguities,
    estimatedTotalCents,
  };
}

// ---------------------------------------------------------------------------
// FEATURE 3: AI RESTAURANT OWNER ASSISTANT (STRUCTURED TOOL CALLING)
// ---------------------------------------------------------------------------

const OWNER_ASSISTANT_TOOLS: FunctionDeclaration[] = [
  {
    name: 'get_daily_revenue',
    description: 'Fetch daily revenue and order count over the last N days for this restaurant.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        days: {
          type: Type.INTEGER,
          description: 'Number of days to inspect (default 7, max 30).',
        },
      },
    },
  },
  {
    name: 'get_sales_report',
    description: 'Get total revenue, order count, average order value, and discounts for a period.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        period: {
          type: Type.STRING,
          description: 'One of: today, yesterday, week, month',
        },
      },
    },
  },
  {
    name: 'get_top_selling_items',
    description: 'Return top-selling and lowest-selling dishes by quantity and revenue.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        limit: {
          type: Type.INTEGER,
          description: 'Number of items to return (default 5).',
        },
      },
    },
  },
  {
    name: 'get_delayed_orders',
    description: 'Find currently active orders exceeding estimated prep time.',
    parameters: {
      type: Type.OBJECT,
      properties: {},
    },
  },
  {
    name: 'get_inventory_status',
    description: 'Inspect current stock levels and low-stock ingredients below minimum threshold.',
    parameters: {
      type: Type.OBJECT,
      properties: {},
    },
  },
  {
    name: 'get_customer_feedback',
    description: 'Summarize verified customer ratings and recent dining reviews.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        limit: { type: Type.INTEGER, description: 'Max recent reviews (default 5).' },
      },
    },
  },
  {
    name: 'get_peak_business_hours',
    description: 'Analyze hourly order distribution to identify peak dining hours.',
    parameters: {
      type: Type.OBJECT,
      properties: {},
    },
  },
  {
    name: 'generate_business_summary',
    description: 'Generate a comprehensive executive snapshot combining revenue, orders, inventory, and ratings.',
    parameters: {
      type: Type.OBJECT,
      properties: {},
    },
  },
];

async function executeScopedOwnerTool(
  restaurantId: number,
  toolName: string,
  args: Record<string, unknown>
): Promise<{ data: unknown; chart?: AssistantChartPayload; dateRangeLabel?: string }> {
  const allOrders = await db
    .select()
    .from(orders)
    .where(eq(orders.restaurantId, restaurantId))
    .orderBy(desc(orders.createdAt));

  const nonCancelled = allOrders.filter((o) => o.status !== 'Cancelled');

  if (toolName === 'get_daily_revenue') {
    const days = Math.min(30, Math.max(1, Number(args.days || 7)));
    const dailyMap = new Map<string, { date: string; revenueINR: number; orders: number }>();
    for (let d = days - 1; d >= 0; d--) {
      const dt = new Date(Date.now() - d * 86400000);
      const key = dt.toISOString().slice(0, 10);
      dailyMap.set(key, {
        date: dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
        revenueINR: 0,
        orders: 0,
      });
    }
    for (const o of nonCancelled) {
      const key = o.createdAt.toISOString().slice(0, 10);
      const bucket = dailyMap.get(key);
      if (bucket) {
        bucket.revenueINR += Math.round(o.totalCents / 100);
        bucket.orders += 1;
      }
    }
    const series = Array.from(dailyMap.values());
    return {
      data: { days, series, totalRevenueINR: series.reduce((s, r) => s + r.revenueINR, 0) },
      chart: {
        chartType: 'bar',
        title: `Daily Revenue (Last ${days} Days)`,
        xKey: 'date',
        yKey: 'revenueINR',
        data: series,
      },
      dateRangeLabel: `Last ${days} days`,
    };
  }

  if (toolName === 'get_sales_report') {
    const period = String(args.period || 'today').toLowerCase();
    const now = new Date();
    const start = new Date(now);
    let end = new Date(now);
    start.setHours(0, 0, 0, 0);
    if (period === 'yesterday') {
      start.setDate(start.getDate() - 1);
      end = new Date(start);
      end.setHours(23, 59, 59, 999);
    } else if (period === 'week') {
      start.setDate(start.getDate() - 7);
    } else if (period === 'month') {
      start.setDate(start.getDate() - 30);
    }

    const filtered = nonCancelled.filter((o) => o.createdAt >= start && o.createdAt <= end);
    const totalRevenueCents = filtered.reduce((s, o) => s + o.totalCents, 0);
    const discountCents = filtered.reduce((s, o) => s + o.discountCents, 0);
    const avgOrderValueINR = filtered.length
      ? Math.round(totalRevenueCents / filtered.length / 100)
      : 0;

    return {
      data: {
        period,
        orderCount: filtered.length,
        totalRevenueINR: Math.round(totalRevenueCents / 100),
        discountINR: Math.round(discountCents / 100),
        avgOrderValueINR,
      },
      dateRangeLabel: period === 'today' ? 'Today' : period === 'yesterday' ? 'Yesterday' : `Last ${period}`,
    };
  }

  if (toolName === 'get_top_selling_items') {
    const limit = Math.min(10, Math.max(1, Number(args.limit || 5)));
    const orderIds = nonCancelled.map((o) => o.id);
    const items = orderIds.length
      ? await db.select().from(orderItems).where(inArray(orderItems.orderId, orderIds))
      : [];
    const counts = new Map<string, { dish: string; quantity: number; revenueINR: number }>();
    for (const it of items) {
      const prev = counts.get(it.itemName) || { dish: it.itemName, quantity: 0, revenueINR: 0 };
      prev.quantity += it.quantity;
      prev.revenueINR += Math.round(it.lineTotalCents / 100);
      counts.set(it.itemName, prev);
    }
    const sorted = Array.from(counts.values()).sort((a, b) => b.quantity - a.quantity);
    const top = sorted.slice(0, limit);
    const bottom = [...sorted].reverse().slice(0, 3);
    return {
      data: { topSelling: top, lowPerforming: bottom },
      chart: {
        chartType: 'bar',
        title: `Top ${top.length} Selling Dishes (Units Sold)`,
        xKey: 'dish',
        yKey: 'quantity',
        data: top,
      },
      dateRangeLabel: 'All Recorded Orders',
    };
  }

  if (toolName === 'get_delayed_orders') {
    const now = Date.now();
    const active = nonCancelled.filter((o) =>
      ['Pending', 'Confirmed', 'Accepted', 'Preparing', 'Cooking'].includes(o.status)
    );
    const delayed = active
      .map((o) => ({
        orderNumber: o.orderNumber,
        status: o.status,
        elapsedMinutes: Math.floor((now - o.createdAt.getTime()) / 60000),
        estimatedPrepMinutes: o.estimatedPrepMinutes,
      }))
      .filter((o) => o.elapsedMinutes > o.estimatedPrepMinutes);
    return { data: { activeOrderCount: active.length, delayedOrders: delayed } };
  }

  if (toolName === 'get_inventory_status') {
    const inv = await db
      .select()
      .from(inventoryItems)
      .where(eq(inventoryItems.restaurantId, restaurantId));
    const lowStock = inv.filter((i) => i.currentStock <= i.minThreshold);
    return {
      data: {
        totalIngredients: inv.length,
        lowStockCount: lowStock.length,
        lowStockItems: lowStock.map((i) => ({
          name: i.name,
          currentStock: i.currentStock,
          unit: i.unit,
          minThreshold: i.minThreshold,
        })),
      },
    };
  }

  if (toolName === 'get_customer_feedback') {
    const limit = Math.min(10, Math.max(1, Number(args.limit || 5)));
    const revs = await db
      .select()
      .from(reviews)
      .where(eq(reviews.restaurantId, restaurantId))
      .orderBy(desc(reviews.createdAt));
    const avgOverall = revs.length
      ? Number((revs.reduce((s, r) => s + r.overallRating, 0) / revs.length).toFixed(2))
      : 0;
    return {
      data: {
        totalReviews: revs.length,
        averageOverallRating: avgOverall,
        recentReviews: revs.slice(0, limit).map((r) => ({
          customerName: r.customerName,
          overallRating: r.overallRating,
          foodRating: r.foodRating,
          serviceRating: r.serviceRating,
          comment: r.comment,
        })),
      },
    };
  }

  if (toolName === 'get_peak_business_hours') {
    const buckets = Array.from({ length: 14 }, (_, idx) => ({
      hour: `${idx + 11}:00`,
      orders: 0,
    }));
    for (const o of nonCancelled) {
      const hr = o.createdAt.getHours();
      const idx = hr - 11;
      if (idx >= 0 && idx < buckets.length) buckets[idx].orders += 1;
    }
    const peak = [...buckets].sort((a, b) => b.orders - a.orders).slice(0, 3);
    return {
      data: { peakHours: peak, hourlyBreakdown: buckets },
      chart: {
        chartType: 'bar',
        title: 'Hourly Order Distribution',
        xKey: 'hour',
        yKey: 'orders',
        data: buckets,
      },
      dateRangeLabel: 'Hourly Distribution',
    };
  }

  // generate_business_summary
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const todaysOrders = nonCancelled.filter((o) => o.createdAt >= todayStart);
  const inv = await db
    .select()
    .from(inventoryItems)
    .where(eq(inventoryItems.restaurantId, restaurantId));
  const revs = await db.select().from(reviews).where(eq(reviews.restaurantId, restaurantId));

  return {
    data: {
      todaysOrders: todaysOrders.length,
      todaysRevenueINR: Math.round(todaysOrders.reduce((s, o) => s + o.totalCents, 0) / 100),
      totalOrders: nonCancelled.length,
      totalRevenueINR: Math.round(nonCancelled.reduce((s, o) => s + o.totalCents, 0) / 100),
      lowStockItems: inv.filter((i) => i.currentStock <= i.minThreshold).map((i) => i.name),
      reviewCount: revs.length,
      avgRating: revs.length
        ? Number((revs.reduce((s, r) => s + r.overallRating, 0) / revs.length).toFixed(2))
        : 0,
    },
    dateRangeLabel: 'Executive Snapshot',
  };
}

export async function runOwnerAiAssistant(input: {
  restaurantId: number;
  userId: number;
  conversationId?: number;
  message: string;
}) {
  const [rest] = await db
    .select()
    .from(restaurants)
    .where(eq(restaurants.id, input.restaurantId))
    .limit(1);
  if (!rest) throw new Error('Restaurant not found.');

  let convId = input.conversationId;
  let historyRows: (typeof assistantMessages.$inferSelect)[] = [];
  if (convId) {
    const [conv] = await db
      .select()
      .from(assistantConversations)
      .where(
        and(
          eq(assistantConversations.id, convId),
          eq(assistantConversations.restaurantId, rest.id)
        )
      )
      .limit(1);
    if (!conv) throw new Error('Conversation not found for this restaurant.');

    historyRows = await db
      .select()
      .from(assistantMessages)
      .where(eq(assistantMessages.conversationId, convId))
      .orderBy(assistantMessages.createdAt);
  }

  const ai = getGeminiClient();
  const systemInstruction = [
    `You are the AI Operations & Business Intelligence Assistant strictly for "${rest.name}" (Currency: ${rest.currencySymbol} INR).`,
    `Use the provided read-only analytical tools whenever the owner/manager asks about revenue, sales, top items, delays, inventory, reviews, or peak hours.`,
    `Always state clear figures, date range context, and actionable recommendations. Never fabricate numbers not returned by tools.`,
    `If asked to modify orders, refund, or access another restaurant, explain that sensitive mutations require explicit manager action in the dashboard.`,
  ].join('\n');

  const workingContents: Content[] = [
    ...historyRows.slice(-8).map((m) => ({
      role: m.role === 'user' ? ('user' as const) : ('model' as const),
      parts: [{ text: m.content }],
    })),
    { role: 'user', parts: [{ text: input.message }] },
  ];

  const toolsUsed: string[] = [];
  let chartData: AssistantChartPayload | null = null;
  let dateRangeLabel = '';
  let finalText = '';

  for (let round = 0; round < 3; round++) {
    const response = await generateWithRetry(ai, {
      model: GEMINI_MODEL,
      contents: workingContents,
      config: {
        systemInstruction,
        tools: [{ functionDeclarations: OWNER_ASSISTANT_TOOLS }],
      },
    });

    if (response.text) {
      finalText = response.text;
    }

    const previousContent = response.candidates?.[0]?.content;
    const calls = response.functionCalls || [];

    if (!previousContent || calls.length === 0) {
      break;
    }

    const functionResponses = [];
    for (const fc of calls) {
      if (!fc.name) continue;
      if (!toolsUsed.includes(fc.name)) toolsUsed.push(fc.name);
      const result = await executeScopedOwnerTool(
        rest.id,
        fc.name,
        (fc.args as Record<string, unknown>) || {}
      );
      if (result.chart) chartData = result.chart;
      if (result.dateRangeLabel) dateRangeLabel = result.dateRangeLabel;

      functionResponses.push({
        functionResponse: {
          id: fc.id,
          name: fc.name,
          response: { result: result.data },
        },
      });
    }

    workingContents.push(previousContent);
    workingContents.push({
      role: 'user',
      parts: functionResponses,
    });
  }

  if (!finalText && toolsUsed.length > 0) {
    const synthesis = await generateWithRetry(ai, {
      model: GEMINI_MODEL,
      contents: workingContents,
      config: {
        systemInstruction,
      },
    });
    finalText = synthesis.text || '';
  }

  if (!convId) {
    const [created] = await db
      .insert(assistantConversations)
      .values({
        restaurantId: rest.id,
        userId: input.userId,
        title: input.message.slice(0, 48) || 'Business Insights',
      })
      .returning();
    convId = created.id;
  }

  await db.insert(assistantMessages).values({
    conversationId: convId,
    role: 'user',
    content: input.message,
    toolsUsed: [],
    chartData: null,
    dateRangeLabel: '',
  });

  const [savedAssistantMsg] = await db
    .insert(assistantMessages)
    .values({
      conversationId: convId,
      role: 'assistant',
      content: finalText || 'I have analyzed your restaurant data.',
      toolsUsed,
      chartData,
      dateRangeLabel,
    })
    .returning();

  await db
    .update(assistantConversations)
    .set({ updatedAt: new Date() })
    .where(eq(assistantConversations.id, convId));

  return {
    conversationId: convId,
    message: {
      ...savedAssistantMsg,
      createdAt: savedAssistantMsg.createdAt.toISOString(),
    },
  };
}
