import React, { useMemo, useState } from 'react';
import {
  ArrowRight,
  Check,
  ChefHat,
  Eye,
  Minus,
  Plus,
  RefreshCw,
  ShoppingBag,
  Sparkles,
  Trash2,
  UtensilsCrossed,
} from 'lucide-react';
import { apiFetch } from '../lib/api.ts';
import { formatMoney } from '../shared/calculations.ts';
import type {
  AiRecommendationItemDTO,
  AiRecommendationResponseDTO,
  MenuItemDTO,
  RestaurantDTO,
} from '../shared/types.ts';
import { DishVisual } from './DishVisual.tsx';

interface AiRecommendationFlowProps {
  restaurant: RestaurantDTO;
  tableNumber: string;
  guestName: string;
  sessionToken: string;
  defaultGuestCount: number;
  menuItems: MenuItemDTO[];
  onExploreMenu: () => void;
  onAddItemsToCart: (items: { menuItem: MenuItemDTO; quantity: number; reason?: string }[]) => void;
  onOpenAr: (item: MenuItemDTO) => void;
}

const ALLERGY_OPTIONS = ['dairy', 'nuts', 'gluten', 'soy', 'eggs', 'shellfish'];

export const AiRecommendationFlow: React.FC<AiRecommendationFlowProps> = ({
  restaurant,
  tableNumber,
  guestName,
  sessionToken,
  defaultGuestCount,
  menuItems,
  onExploreMenu,
  onAddItemsToCart,
  onOpenAr,
}) => {
  const availableMenu = useMemo(() => menuItems.filter((m) => m.isAvailable), [menuItems]);
  const minDishRupees = useMemo(() => {
    if (availableMenu.length === 0) return 200;
    return Math.round(Math.min(...availableMenu.map((m) => m.basePriceCents)) / 100);
  }, [availableMenu]);

  const budgetPresets = useMemo(() => {
    if (minDishRupees >= 350) {
      return [
        { label: '₹400–₹600', value: 600 },
        { label: '₹600–₹900', value: 900 },
        { label: '₹900–₹1,200', value: 1200 },
        { label: '₹1,200–₹1,800', value: 1800 },
        { label: '₹2,500 Feast', value: 2500 },
      ];
    }
    return [
      { label: `Under ₹${Math.max(300, minDishRupees + 100)}`, value: Math.max(300, minDishRupees + 100) },
      { label: '₹400–₹600', value: 600 },
      { label: '₹600–₹1,000', value: 1000 },
      { label: '₹1,000–₹1,500', value: 1500 },
      { label: '₹2,200 Feast', value: 2200 },
    ];
  }, [minDishRupees]);

  const [guestCount, setGuestCount] = useState(Math.max(1, defaultGuestCount));
  const [budgetRupees, setBudgetRupees] = useState(1200);
  const [customBudget, setCustomBudget] = useState('');
  const [budgetScope, setBudgetScope] = useState<'per_person' | 'entire_table'>('entire_table');
  const [dietaryType, setDietaryType] = useState<'any' | 'veg' | 'non_veg' | 'vegan'>('any');
  const [foodPreference, setFoodPreference] = useState('');
  const [spiceLevel, setSpiceLevel] = useState<'any' | 'Mild' | 'Medium' | 'Hot'>('Medium');
  const [allergies, setAllergies] = useState<string[]>([]);
  const [coursePreference, setCoursePreference] = useState('complete_meal');

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<AiRecommendationResponseDTO | null>(null);
  const [itemsState, setItemsState] = useState<AiRecommendationItemDTO[]>([]);

  const effectiveBudget =
    customBudget.trim() && Number(customBudget) >= 50 ? Number(customBudget) : budgetRupees;

  const toggleAllergy = (code: string) => {
    setAllergies((prev) =>
      prev.includes(code) ? prev.filter((x) => x !== code) : [...prev, code]
    );
  };

  const handleGenerate = async (e?: React.FormEvent) => {
    e?.preventDefault();
    setLoading(true);
    setError('');
    try {
      const res = await apiFetch<AiRecommendationResponseDTO>('/api/ai/recommendations', {
        method: 'POST',
        body: JSON.stringify({
          restaurantId: restaurant.id,
          tableSessionToken: sessionToken,
          guestCount,
          budgetRupees: effectiveBudget,
          budgetScope,
          dietaryType,
          foodPreference,
          spiceLevel,
          allergies,
          coursePreference,
        }),
      });
      setResult(res);
      setItemsState(res.items);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Unable to generate recommendations.');
    } finally {
      setLoading(false);
    }
  };

  const handleAdjustQty = (menuItemId: number, delta: number) => {
    setItemsState((prev) =>
      prev.map((it) => {
        if (it.menuItemId !== menuItemId) return it;
        const nextQty = Math.max(1, Math.min(10, it.quantity + delta));
        return {
          ...it,
          quantity: nextQty,
          lineTotalCents: it.unitPriceCents * nextQty,
        };
      })
    );
  };

  const handleRemoveItem = (menuItemId: number) => {
    setItemsState((prev) => prev.filter((it) => it.menuItemId !== menuItemId));
  };

  const handleAddSingle = async (rec: AiRecommendationItemDTO) => {
    const matched = menuItems.find((m) => m.id === rec.menuItemId);
    if (!matched) return;
    onAddItemsToCart([{ menuItem: matched, quantity: rec.quantity, reason: rec.reason }]);
    setItemsState((prev) =>
      prev.map((x) => (x.menuItemId === rec.menuItemId ? { ...x, wasAddedToCart: true } : x))
    );
    if (rec.id) {
      apiFetch(`/api/ai/recommendations/items/${rec.id}/added`, { method: 'PATCH' }).catch(() => {});
    }
  };

  const handleAddAllCombo = async () => {
    const payload = itemsState
      .map((rec) => {
        const matched = menuItems.find((m) => m.id === rec.menuItemId);
        return matched ? { menuItem: matched, quantity: rec.quantity, reason: rec.reason } : null;
      })
      .filter((x): x is NonNullable<typeof x> => Boolean(x));

    if (payload.length === 0) return;
    onAddItemsToCart(payload);
    setItemsState((prev) => prev.map((x) => ({ ...x, wasAddedToCart: true })));
    itemsState.forEach((rec) => {
      if (rec.id) {
        apiFetch(`/api/ai/recommendations/items/${rec.id}/added`, { method: 'PATCH' }).catch(() => {});
      }
    });
  };

  const currentTotalCents = itemsState.reduce((s, r) => s + r.lineTotalCents, 0);

  return (
    <div className="space-y-6">
      <div className="rounded-2xl bg-white border border-stone-200 p-5 sm:p-6">
        <div className="flex flex-wrap items-center justify-between gap-3 pb-4 border-b border-stone-100">
          <div>
            <p className="text-xs font-semibold text-orange-700 flex items-center gap-1.5">
              <Sparkles className="w-3.5 h-3.5" />
              AI Food Concierge · Table {tableNumber}
            </p>
            <h2 className="text-xl font-display font-bold text-stone-900 mt-0.5">
              Curated Dish Combo for {guestName}
            </h2>
            <p className="text-xs text-stone-500 mt-0.5">
              Tell us your budget &amp; tastes, or skip any optional field to get tailored picks from
              live available dishes.
            </p>
          </div>
          <button
            type="button"
            onClick={onExploreMenu}
            className="inline-flex items-center gap-1.5 rounded-xl border border-stone-300 px-3.5 py-2 text-xs font-semibold text-stone-700 hover:bg-stone-100"
          >
            <UtensilsCrossed className="w-3.5 h-3.5" />
            Explore Full Menu Instead
          </button>
        </div>

        <form onSubmit={handleGenerate} className="mt-5 space-y-5">
          {/* 1. Guests & Budget Scope */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            <div>
              <label className="block text-xs font-semibold text-stone-700 mb-2">
                How many people are dining?
              </label>
              <div className="inline-flex items-center gap-3 rounded-xl border border-stone-300 px-3 py-1.5 bg-[#FAF8F5]">
                <button
                  type="button"
                  onClick={() => setGuestCount((g) => Math.max(1, g - 1))}
                  className="p-1.5 text-stone-700 hover:text-orange-700"
                >
                  <Minus className="w-4 h-4" />
                </button>
                <span className="font-mono tabular-nums text-sm font-bold w-16 text-center">
                  {guestCount} {guestCount === 1 ? 'Guest' : 'Guests'}
                </span>
                <button
                  type="button"
                  onClick={() => setGuestCount((g) => Math.min(20, g + 1))}
                  className="p-1.5 text-stone-700 hover:text-orange-700"
                >
                  <Plus className="w-4 h-4" />
                </button>
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-stone-700 mb-2">
                Budget applies to:
              </label>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setBudgetScope('entire_table')}
                  className={`rounded-xl py-2.5 px-3 text-xs font-semibold border ${
                    budgetScope === 'entire_table'
                      ? 'bg-stone-900 text-white border-stone-900'
                      : 'bg-white text-stone-700 border-stone-200'
                  }`}
                >
                  For Entire Table
                </button>
                <button
                  type="button"
                  onClick={() => setBudgetScope('per_person')}
                  className={`rounded-xl py-2.5 px-3 text-xs font-semibold border ${
                    budgetScope === 'per_person'
                      ? 'bg-stone-900 text-white border-stone-900'
                      : 'bg-white text-stone-700 border-stone-200'
                  }`}
                >
                  Per Person
                </button>
              </div>
            </div>
          </div>

          {/* 2. Budget Presets & Custom Budget */}
          <div>
            <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
              <label className="text-xs font-semibold text-stone-700">
                Approximate Budget ({budgetScope === 'per_person' ? 'per guest' : 'entire table'})
              </label>
              <span className="text-[11px] text-stone-500">
                Available dishes start from {restaurant.currencySymbol}
                {minDishRupees}
              </span>
            </div>
            <div className="flex flex-wrap gap-2">
              {budgetPresets.map((preset) => (
                <button
                  key={preset.value}
                  type="button"
                  onClick={() => {
                    setBudgetRupees(preset.value);
                    setCustomBudget('');
                  }}
                  className={`rounded-xl px-3.5 py-2 text-xs font-semibold border ${
                    !customBudget && budgetRupees === preset.value
                      ? 'bg-orange-600 text-white border-orange-600'
                      : 'bg-[#FAF8F5] text-stone-800 border-stone-200 hover:border-orange-400'
                  }`}
                >
                  {preset.label}
                </button>
              ))}
              <input
                type="number"
                min={50}
                max={50000}
                value={customBudget}
                onChange={(e) => setCustomBudget(e.target.value)}
                placeholder="Custom ₹"
                className="w-28 rounded-xl border border-stone-300 px-3 py-2 text-xs font-mono focus:outline-none focus:border-orange-600"
              />
            </div>
          </div>

          {/* 3. Veg / Non-Veg + Spice + Course */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="block text-xs font-semibold text-stone-700 mb-2">
                Dietary Preference
              </label>
              <select
                value={dietaryType}
                onChange={(e) =>
                  setDietaryType(e.target.value as 'any' | 'veg' | 'non_veg' | 'vegan')
                }
                className="w-full rounded-xl border border-stone-300 bg-white px-3 py-2.5 text-xs font-medium focus:outline-none focus:border-orange-600"
              >
                <option value="any">Veg &amp; Non-Veg (Any)</option>
                <option value="veg">Vegetarian Only</option>
                <option value="vegan">Vegan Only</option>
                <option value="non_veg">Non-Vegetarian Welcome</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-semibold text-stone-700 mb-2">
                Spice Level (Optional)
              </label>
              <select
                value={spiceLevel}
                onChange={(e) =>
                  setSpiceLevel(e.target.value as 'any' | 'Mild' | 'Medium' | 'Hot')
                }
                className="w-full rounded-xl border border-stone-300 bg-white px-3 py-2.5 text-xs font-medium focus:outline-none focus:border-orange-600"
              >
                <option value="any">No Preference (Skip)</option>
                <option value="Mild">Mild</option>
                <option value="Medium">Medium</option>
                <option value="Hot">Spicy / Hot</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-semibold text-stone-700 mb-2">
                Meal Type (Optional)
              </label>
              <select
                value={coursePreference}
                onChange={(e) => setCoursePreference(e.target.value)}
                className="w-full rounded-xl border border-stone-300 bg-white px-3 py-2.5 text-xs font-medium focus:outline-none focus:border-orange-600"
              >
                <option value="complete_meal">Complete Balanced Meal</option>
                <option value="starter">Starters &amp; Small Plates</option>
                <option value="main_course">Hearty Main Course</option>
                <option value="dessert">Desserts &amp; Craft Drinks</option>
              </select>
            </div>
          </div>

          {/* 4. Allergies & Mood */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-stone-700 mb-2">
                Allergies to Exclude (Optional)
              </label>
              <div className="flex flex-wrap gap-1.5">
                {ALLERGY_OPTIONS.map((code) => {
                  const selected = allergies.includes(code);
                  return (
                    <button
                      key={code}
                      type="button"
                      onClick={() => toggleAllergy(code)}
                      className={`rounded-lg px-2.5 py-1.5 text-xs font-medium border capitalize ${
                        selected
                          ? 'bg-red-50 border-red-400 text-red-800'
                          : 'bg-white border-stone-200 text-stone-600'
                      }`}
                    >
                      No {code}
                    </button>
                  );
                })}
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-stone-700 mb-2">
                What style of food are you craving? (Optional)
              </label>
              <input
                value={foodPreference}
                onChange={(e) => setFoodPreference(e.target.value)}
                placeholder="e.g., smoky flatbread, light seafood, comforting & creamy..."
                className="w-full rounded-xl border border-stone-300 px-3.5 py-2.5 text-xs focus:outline-none focus:border-orange-600"
              />
            </div>
          </div>

          {error && (
            <div className="rounded-xl bg-red-50 border border-red-200 px-4 py-3 text-xs text-red-800">
              {error}
            </div>
          )}

          <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
            <p className="text-xs text-stone-500">
              Target ceiling:{' '}
              <span className="font-mono font-semibold text-stone-800">
                {formatMoney(
                  (budgetScope === 'per_person' ? effectiveBudget * guestCount : effectiveBudget) *
                    100,
                  restaurant.currencySymbol
                )}
              </span>{' '}
              ({guestCount} {guestCount === 1 ? 'guest' : 'guests'})
            </p>
            <button
              type="submit"
              disabled={loading}
              className="inline-flex items-center gap-2 rounded-xl bg-orange-600 px-6 py-3 text-sm font-semibold text-white hover:bg-orange-700 disabled:opacity-60 min-h-[44px]"
            >
              {loading ? (
                <>
                  <RefreshCw className="w-4 h-4 animate-spin" />
                  Composing Menu Picks...
                </>
              ) : (
                <>
                  <ChefHat className="w-4 h-4" />
                  Get Personalized Recommendations
                  <ArrowRight className="w-4 h-4" />
                </>
              )}
            </button>
          </div>
        </form>
      </div>

      {/* Recommendation Output */}
      {result && (
        <div className="rounded-2xl bg-white border border-stone-200 p-5 sm:p-6 space-y-5">
          <div className="flex flex-wrap items-start justify-between gap-4 border-b border-stone-100 pb-4">
            <div className="max-w-2xl">
              <p className="text-xs font-semibold text-orange-700">AI Recommendation Summary</p>
              <p className="text-sm text-stone-800 mt-1">{result.summaryText}</p>
            </div>
            <div className="text-right">
              <p className="text-xs text-stone-500">Combo Total</p>
              <p className="text-xl font-display font-bold font-mono tabular-nums text-stone-900">
                {formatMoney(currentTotalCents, restaurant.currencySymbol)}
              </p>
              <p className="text-[11px] text-emerald-700">
                Within {formatMoney(result.budgetTargetCents, restaurant.currencySymbol)} budget
              </p>
            </div>
          </div>

          {itemsState.length === 0 ? (
            <p className="text-sm text-stone-500 py-4 text-center">
              No dishes selected. Try adjusting your budget or filters above.
            </p>
          ) : (
            <>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {itemsState.map((rec) => {
                  const fullDish = menuItems.find((m) => m.id === rec.menuItemId);
                  return (
                    <div
                      key={rec.menuItemId}
                      className="rounded-2xl border border-stone-200 overflow-hidden flex flex-col sm:flex-row bg-[#FAF8F5]"
                    >
                      <div className="sm:w-36 shrink-0">
                        <DishVisual
                          imageKey={rec.imageKey}
                          name={rec.name}
                          className="w-full h-36 sm:h-full"
                        />
                      </div>
                      <div className="p-4 flex-1 flex flex-col justify-between gap-3">
                        <div>
                          <div className="flex items-start justify-between gap-2">
                            <h3 className="text-sm font-semibold text-stone-900">{rec.name}</h3>
                            <span className="font-mono tabular-nums text-xs font-bold text-stone-900 shrink-0">
                              {formatMoney(rec.unitPriceCents, restaurant.currencySymbol)}
                            </span>
                          </div>
                          <p className="text-[11px] text-stone-500 mt-0.5 line-clamp-2">
                            {rec.description}
                          </p>
                          <p className="mt-2 text-xs text-orange-800 bg-orange-50 border border-orange-200 rounded-lg px-2.5 py-1.5">
                            {rec.reason}
                          </p>
                        </div>

                        <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-stone-200/70">
                          <div className="flex items-center gap-1.5">
                            <div className="inline-flex items-center gap-1.5 border border-stone-300 bg-white rounded-lg px-1.5 py-0.5">
                              <button
                                type="button"
                                onClick={() => handleAdjustQty(rec.menuItemId, -1)}
                                disabled={rec.quantity <= 1}
                                className="p-1 text-stone-700 disabled:opacity-35"
                              >
                                <Minus className="w-3 h-3" />
                              </button>
                              <span className="font-mono tabular-nums text-xs font-semibold w-5 text-center">
                                {rec.quantity}
                              </span>
                              <button
                                type="button"
                                onClick={() => handleAdjustQty(rec.menuItemId, 1)}
                                className="p-1 text-stone-700"
                              >
                                <Plus className="w-3 h-3" />
                              </button>
                            </div>
                            <button
                              type="button"
                              onClick={() => handleRemoveItem(rec.menuItemId)}
                              title="Remove recommendation"
                              className="p-1.5 rounded-lg text-stone-400 hover:text-red-600 hover:bg-red-50"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>

                          <div className="flex items-center gap-1.5">
                            {fullDish && (
                              <button
                                type="button"
                                onClick={() => onOpenAr(fullDish)}
                                className="inline-flex items-center gap-1 rounded-lg border border-stone-300 bg-white px-2.5 py-1.5 text-[11px] font-semibold text-stone-700 hover:bg-stone-100"
                              >
                                <Eye className="w-3 h-3 text-orange-600" />
                                AR
                              </button>
                            )}
                            <button
                              type="button"
                              onClick={() => handleAddSingle(rec)}
                              className={`inline-flex items-center gap-1 rounded-lg px-3 py-1.5 text-[11px] font-semibold ${
                                rec.wasAddedToCart
                                  ? 'bg-emerald-700 text-white'
                                  : 'bg-stone-900 text-white hover:bg-stone-800'
                              }`}
                            >
                              {rec.wasAddedToCart ? (
                                <>
                                  <Check className="w-3 h-3" />
                                  Added
                                </>
                              ) : (
                                <>
                                  <ShoppingBag className="w-3 h-3" />
                                  Add
                                </>
                              )}
                            </button>
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>

              <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-stone-100">
                <p className="text-xs text-stone-500">
                  Review your selections above. Nothing is ordered until you confirm in your table cart.
                </p>
                <button
                  type="button"
                  onClick={handleAddAllCombo}
                  className="inline-flex items-center gap-2 rounded-xl bg-orange-600 px-5 py-3 text-xs font-semibold text-white hover:bg-orange-700"
                >
                  <ShoppingBag className="w-4 h-4" />
                  Add All Recommended Dishes ({formatMoney(currentTotalCents, restaurant.currencySymbol)})
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
};
