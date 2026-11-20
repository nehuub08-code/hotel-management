import React, { useEffect, useState } from 'react';
import {
  Calendar,
  Clock,
  ExternalLink,
  Eye,
  MapPin,
  Phone,
  QrCode,
  Star,
  Utensils,
  CheckCircle2,
  X,
} from 'lucide-react';
import { apiFetch } from '../lib/api.ts';
import { formatMoney } from '../shared/calculations.ts';
import type {
  Food3dModelDTO,
  MenuCategoryDTO,
  MenuItemDTO,
  RestaurantDTO,
  ReviewDTO,
} from '../shared/types.ts';
import { DiningHeroVisual, DishVisual } from './DishVisual.tsx';
import { FoodArViewer } from './FoodArViewer.tsx';

interface QrTableEntry {
  id: number;
  tableNumber: string;
  label: string;
  zone: string;
  capacity: number;
  status: string;
  qrToken: string;
}

interface CustomerWebsiteProps {
  restaurant: RestaurantDTO;
  categories: MenuCategoryDTO[];
  menuItems: MenuItemDTO[];
  reviews: ReviewDTO[];
  onLaunchQrSession: (qrToken: string) => void;
  onRefreshReviews: () => void;
}

export const CustomerWebsite: React.FC<CustomerWebsiteProps> = ({
  restaurant,
  categories,
  menuItems,
  reviews,
  onLaunchQrSession,
}) => {
  const [activeCategoryId, setActiveCategoryId] = useState<number | 'all'>('all');
  const [qrDrawerOpen, setQrDrawerOpen] = useState(false);
  const [qrDirectory, setQrDirectory] = useState<QrTableEntry[]>([]);
  const [selectedQrPreview, setSelectedQrPreview] = useState<{
    dataUrl: string;
    scanUrl: string;
    tableNumber: string;
  } | null>(null);
  const [models3d, setModels3d] = useState<Food3dModelDTO[]>([]);
  const [arPreviewDish, setArPreviewDish] = useState<MenuItemDTO | null>(null);

  // Reservation form state
  const [resForm, setResForm] = useState({
    customerName: '',
    customerEmail: '',
    customerPhone: '',
    partySize: 2,
    reservationDate: new Date().toISOString().slice(0, 10),
    reservationTime: '19:30',
    preferredZone: 'Main Dining',
    specialRequests: '',
  });
  const [resSubmitting, setResSubmitting] = useState(false);
  const [resMessage, setResMessage] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  useEffect(() => {
    if (qrDrawerOpen && qrDirectory.length === 0) {
      apiFetch<QrTableEntry[]>(`/api/restaurants/${restaurant.slug}/qr-directory`)
        .then(setQrDirectory)
        .catch(() => setQrDirectory([]));
    }
  }, [qrDrawerOpen, qrDirectory.length, restaurant.slug]);

  useEffect(() => {
    setQrDirectory([]);
    setSelectedQrPreview(null);
    apiFetch<Food3dModelDTO[]>(`/api/restaurants/${restaurant.slug}/models`)
      .then(setModels3d)
      .catch(() => setModels3d([]));
  }, [restaurant.slug]);

  const featuredDishes = menuItems.filter((i) => i.isFeatured).slice(0, 4);
  const filteredMenu =
    activeCategoryId === 'all'
      ? menuItems
      : menuItems.filter((i) => i.categoryId === activeCategoryId);

  const approvedReviews = reviews.filter((r) => r.isApproved);
  const avgRating = approvedReviews.length
    ? (approvedReviews.reduce((s, r) => s + r.overallRating, 0) / approvedReviews.length).toFixed(1)
    : '4.9';

  const handleLoadQrImage = async (tableId: number) => {
    try {
      const data = await apiFetch<{ dataUrl: string; scanUrl: string; tableNumber: string }>(
        `/api/tables/${tableId}/qr-image?origin=${encodeURIComponent(window.location.origin)}`
      );
      setSelectedQrPreview(data);
    } catch {
      // Ignore
    }
  };

  const handleReservationSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setResMessage(null);
    setResSubmitting(true);
    try {
      await apiFetch('/api/reservations', {
        method: 'POST',
        body: JSON.stringify({
          restaurantId: restaurant.id,
          ...resForm,
          partySize: Number(resForm.partySize),
        }),
      });
      setResMessage({
        type: 'ok',
        text: `Table confirmed for ${resForm.customerName} (${resForm.partySize} guests on ${resForm.reservationDate} at ${resForm.reservationTime}).`,
      });
      setResForm({
        customerName: '',
        customerEmail: '',
        customerPhone: '',
        partySize: 2,
        reservationDate: new Date().toISOString().slice(0, 10),
        reservationTime: '19:30',
        preferredZone: 'Main Dining',
        specialRequests: '',
      });
    } catch (err: unknown) {
      setResMessage({
        type: 'err',
        text: err instanceof Error ? err.message : 'Unable to submit reservation.',
      });
    } finally {
      setResSubmitting(false);
    }
  };

  return (
    <div className="bg-[#FAF8F5] text-[#1A1411] min-h-screen">
      {/* Hero Section */}
      <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-8 pb-16">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 lg:gap-12 items-stretch">
          <div className="lg:col-span-6 flex flex-col justify-between py-4">
            <div>
              <p className="text-xs font-medium text-orange-700 tracking-wide">
                {restaurant.cuisineType} · {restaurant.city}
              </p>
              <h1
                className="mt-4 font-display font-bold tracking-tight text-[#1A1411] leading-[1.05]"
                style={{ fontSize: 'clamp(2.25rem, 4vw, 3.75rem)' }}
              >
                {restaurant.name}
              </h1>
              <p className="mt-4 text-lg font-medium text-stone-700 max-w-xl">
                {restaurant.tagline}
              </p>
              <p className="mt-4 text-sm sm:text-base text-stone-600 leading-relaxed max-w-xl">
                {restaurant.description}
              </p>
            </div>

            <div className="mt-8 flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={() => setQrDrawerOpen(true)}
                className="inline-flex items-center gap-2 rounded-xl bg-orange-600 px-6 py-3.5 text-sm font-semibold text-white hover:bg-orange-700 transition-colors min-h-[44px]"
              >
                <QrCode className="w-4 h-4" />
                Scan Table QR &amp; Order
              </button>
              <a
                href="#reserve-table"
                className="inline-flex items-center gap-2 rounded-xl border border-stone-300 bg-white px-5 py-3.5 text-sm font-medium text-stone-800 hover:bg-stone-100 transition-colors min-h-[44px]"
              >
                <Calendar className="w-4 h-4 text-orange-600" />
                Reserve a Table
              </a>
            </div>
          </div>

          <div className="lg:col-span-6">
            <div className="h-full min-h-[320px] lg:min-h-[460px] rounded-2xl overflow-hidden border border-stone-200">
              <DiningHeroVisual className="w-full h-full" />
            </div>
          </div>
        </div>

        {/* Full-Width Key Hospitality Strip Below Split */}
        <div className="mt-10 grid grid-cols-2 lg:grid-cols-4 gap-4 border-t border-b border-stone-200 py-6">
          <div>
            <p className="text-xs text-stone-500">Guest Rating</p>
            <p className="mt-1 text-xl font-semibold font-mono tabular-nums text-stone-900">
              {avgRating} / 5.0
            </p>
          </div>
          <div>
            <p className="text-xs text-stone-500">Curated Dishes</p>
            <p className="mt-1 text-xl font-semibold font-mono tabular-nums text-stone-900">
              {menuItems.length} Plates
            </p>
          </div>
          <div>
            <p className="text-xs text-stone-500">Hearth Service</p>
            <p className="mt-1 text-xl font-semibold text-stone-900">12:00 PM Daily</p>
          </div>
          <div>
            <p className="text-xs text-stone-500">Table Ordering</p>
            <p className="mt-1 text-xl font-semibold text-stone-900">Live QR &amp; UPI</p>
          </div>
        </div>
      </section>

      {/* Featured Dishes */}
      <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 mb-8">
          <div>
            <h2 className="text-2xl sm:text-3xl font-display font-bold tracking-tight">
              01. Signature Wood-Fired Plates
            </h2>
            <p className="mt-1.5 text-sm text-stone-600">
              Prepared to order over aged fruitwood embers and seasonal botanicals.
            </p>
          </div>
          <a
            href="#full-menu"
            className="text-sm font-medium text-orange-700 hover:text-orange-800 whitespace-nowrap"
          >
            Explore full menu →
          </a>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          {featuredDishes.map((dish) => (
            <article
              key={dish.id}
              className="rounded-2xl bg-white border border-stone-200 overflow-hidden flex flex-col"
            >
              <DishVisual imageKey={dish.imageKey} name={dish.name} className="aspect-[4/3] w-full" />
              <div className="p-5 flex-1 flex flex-col justify-between">
                <div>
                  <p className="text-xs text-stone-500">
                    {dish.isVegetarian ? 'Vegetarian' : 'Chef Cut'} · {dish.prepTimeMinutes} min ·{' '}
                    {dish.defaultSpiceLevel}
                  </p>
                  <h3 className="mt-1.5 text-base font-semibold text-stone-900">{dish.name}</h3>
                  <p className="mt-2 text-xs text-stone-600 leading-relaxed line-clamp-3">
                    {dish.description}
                  </p>
                </div>
                <div className="mt-4 pt-3 border-t border-stone-100 flex items-center justify-between gap-2">
                  <span className="font-mono tabular-nums text-sm font-semibold text-stone-900">
                    {formatMoney(dish.basePriceCents, restaurant.currencySymbol)}
                  </span>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setArPreviewDish(dish)}
                      className="inline-flex items-center gap-1 rounded-lg border border-stone-200 px-2.5 py-1 text-[11px] font-semibold text-stone-700 hover:bg-stone-100"
                    >
                      <Eye className="w-3 h-3 text-orange-600" />
                      3D/AR
                    </button>
                    <button
                      type="button"
                      onClick={() => setQrDrawerOpen(true)}
                      className="text-xs font-semibold text-orange-700 hover:text-orange-800"
                    >
                      Order at table
                    </button>
                  </div>
                </div>
              </div>
            </article>
          ))}
        </div>
      </section>

      {/* Full Interactive Menu Showcase */}
      <section id="full-menu" className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12 border-t border-stone-200">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-8">
          <div>
            <h2 className="text-2xl sm:text-3xl font-display font-bold tracking-tight">
              02. Seasonal Dining Menu
            </h2>
            <p className="mt-1.5 text-sm text-stone-600">
              Browse categories, allergens, and customization options. Scan a table QR to order.
            </p>
          </div>

          <div className="flex items-center gap-1.5 overflow-x-auto pb-1">
            <button
              type="button"
              onClick={() => setActiveCategoryId('all')}
              className={`px-3.5 py-2 rounded-lg text-xs font-medium whitespace-nowrap shrink-0 transition-colors ${
                activeCategoryId === 'all'
                  ? 'bg-[#1A1411] text-white'
                  : 'bg-stone-200/70 text-stone-700 hover:bg-stone-200'
              }`}
            >
              All Courses
            </button>
            {categories.map((cat) => (
              <button
                key={cat.id}
                type="button"
                onClick={() => setActiveCategoryId(cat.id)}
                className={`px-3.5 py-2 rounded-lg text-xs font-medium whitespace-nowrap shrink-0 transition-colors ${
                  activeCategoryId === cat.id
                    ? 'bg-[#1A1411] text-white'
                    : 'bg-stone-200/70 text-stone-700 hover:bg-stone-200'
                }`}
              >
                {cat.name}
              </button>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {filteredMenu.map((dish) => (
            <div
              key={dish.id}
              className="flex gap-4 p-4 rounded-2xl bg-white border border-stone-200 items-center"
            >
              <DishVisual
                imageKey={dish.imageKey}
                name={dish.name}
                className="w-28 h-24 rounded-xl shrink-0"
              />
              <div className="flex-1 min-w-0">
                <div className="flex items-start justify-between gap-3">
                  <h3 className="text-base font-semibold text-stone-900 truncate">{dish.name}</h3>
                  <span className="font-mono tabular-nums text-sm font-semibold text-stone-900 shrink-0">
                    {formatMoney(dish.basePriceCents, restaurant.currencySymbol)}
                  </span>
                </div>
                <p className="mt-1 text-xs text-stone-600 line-clamp-2">{dish.description}</p>
                <p className="mt-2 text-[11px] text-stone-500">
                  {dish.isVegetarian ? 'Veg' : 'Non-Veg'} · {dish.defaultSpiceLevel} Spice
                  {dish.allergenCodes.length > 0 && ` · Allergens: ${dish.allergenCodes.join(', ')}`}
                  {!dish.isAvailable && ' · Sold Out'}
                </p>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Gallery, Hours & Location */}
      <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12 border-t border-stone-200">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
          <div className="lg:col-span-7 space-y-4">
            <h2 className="text-2xl font-display font-bold tracking-tight">
              03. Inside the Dining Room
            </h2>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
              <DishVisual imageKey="truffle_flatbread" name="Hearth Flatbread Craft" className="aspect-[4/3] rounded-xl" />
              <DishVisual imageKey="lamb_chops" name="Charcoal Robata Sear" className="aspect-[4/3] rounded-xl" />
              <DishVisual imageKey="orange_tonic" name="Botanical Zero-Proof Bar" className="aspect-[4/3] rounded-xl col-span-2 sm:col-span-1" />
            </div>
          </div>

          <div className="lg:col-span-5 rounded-2xl bg-white border border-stone-200 p-6 space-y-5">
            <h3 className="text-lg font-semibold text-stone-900">Hours &amp; Location</h3>
            <div className="space-y-3 text-sm text-stone-700">
              <div className="flex items-start gap-3">
                <MapPin className="w-4 h-4 text-orange-600 mt-1 shrink-0" />
                <div>
                  <p className="font-medium text-stone-900">{restaurant.address}</p>
                  <p className="text-stone-500">{restaurant.city}</p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <Phone className="w-4 h-4 text-orange-600 shrink-0" />
                <span className="font-mono tabular-nums">{restaurant.phone}</span>
              </div>
              <div className="pt-2 border-t border-stone-100 space-y-1.5">
                <div className="flex items-center gap-2 text-xs font-semibold text-stone-500 mb-2">
                  <Clock className="w-3.5 h-3.5 text-orange-600" />
                  Opening Hours
                </div>
                {Object.entries(restaurant.openingHours).map(([dayLabel, hrs]) => (
                  <div key={dayLabel} className="flex justify-between text-xs">
                    <span className="text-stone-600">{dayLabel}</span>
                    <span className="font-medium text-stone-900 font-mono tabular-nums">{hrs}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Reservations & Guest Reviews */}
      <section id="reserve-table" className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12 border-t border-stone-200">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-10">
          {/* Reservation Form */}
          <div className="lg:col-span-6 rounded-2xl bg-white border border-stone-200 p-6 sm:p-8">
            <h2 className="text-2xl font-display font-bold tracking-tight">Reserve Your Table</h2>
            <p className="mt-1 text-sm text-stone-600">
              Instant confirmation directly into our live floor management system.
            </p>

            {resMessage && (
              <div
                className={`mt-4 rounded-xl p-4 text-xs font-medium flex items-start gap-2.5 ${
                  resMessage.type === 'ok'
                    ? 'bg-emerald-50 text-emerald-900 border border-emerald-200'
                    : 'bg-red-50 text-red-900 border border-red-200'
                }`}
              >
                <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />
                <span>{resMessage.text}</span>
              </div>
            )}

            <form onSubmit={handleReservationSubmit} className="mt-6 space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-stone-700 mb-1">Full Name</label>
                  <input
                    required
                    value={resForm.customerName}
                    onChange={(e) => setResForm({ ...resForm, customerName: e.target.value })}
                    placeholder="Ananya Sharma"
                    className="w-full rounded-xl border border-stone-300 px-3.5 py-2.5 text-sm focus:outline-none focus:border-orange-600"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-stone-700 mb-1">Phone Number</label>
                  <input
                    required
                    value={resForm.customerPhone}
                    onChange={(e) => setResForm({ ...resForm, customerPhone: e.target.value })}
                    placeholder="+91 98450 12345"
                    className="w-full rounded-xl border border-stone-300 px-3.5 py-2.5 text-sm focus:outline-none focus:border-orange-600"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-stone-700 mb-1">Email Address</label>
                  <input
                    required
                    type="email"
                    value={resForm.customerEmail}
                    onChange={(e) => setResForm({ ...resForm, customerEmail: e.target.value })}
                    placeholder="ananya@example.com"
                    className="w-full rounded-xl border border-stone-300 px-3.5 py-2.5 text-sm focus:outline-none focus:border-orange-600"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-stone-700 mb-1">Party Size</label>
                  <select
                    value={resForm.partySize}
                    onChange={(e) => setResForm({ ...resForm, partySize: Number(e.target.value) })}
                    className="w-full rounded-xl border border-stone-300 px-3.5 py-2.5 text-sm focus:outline-none focus:border-orange-600 bg-white"
                  >
                    {[1, 2, 3, 4, 5, 6, 8, 10].map((n) => (
                      <option key={n} value={n}>
                        {n} {n === 1 ? 'Guest' : 'Guests'}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div>
                  <label className="block text-xs font-medium text-stone-700 mb-1">Date</label>
                  <input
                    required
                    type="date"
                    value={resForm.reservationDate}
                    onChange={(e) => setResForm({ ...resForm, reservationDate: e.target.value })}
                    className="w-full rounded-xl border border-stone-300 px-3.5 py-2.5 text-sm focus:outline-none focus:border-orange-600"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-stone-700 mb-1">Time</label>
                  <input
                    required
                    type="time"
                    value={resForm.reservationTime}
                    onChange={(e) => setResForm({ ...resForm, reservationTime: e.target.value })}
                    className="w-full rounded-xl border border-stone-300 px-3.5 py-2.5 text-sm focus:outline-none focus:border-orange-600"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-stone-700 mb-1">Dining Zone</label>
                  <select
                    value={resForm.preferredZone}
                    onChange={(e) => setResForm({ ...resForm, preferredZone: e.target.value })}
                    className="w-full rounded-xl border border-stone-300 px-3.5 py-2.5 text-sm focus:outline-none focus:border-orange-600 bg-white"
                  >
                    <option value="Main Dining">Main Dining</option>
                    <option value="Patio">Patio</option>
                    <option value="Chef's Counter">Chef&apos;s Counter</option>
                    <option value="Private Booth">Private Booth</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-stone-700 mb-1">
                  Dietary Notes or Occasion
                </label>
                <input
                  value={resForm.specialRequests}
                  onChange={(e) => setResForm({ ...resForm, specialRequests: e.target.value })}
                  placeholder="Anniversary table, allergy notes..."
                  className="w-full rounded-xl border border-stone-300 px-3.5 py-2.5 text-sm focus:outline-none focus:border-orange-600"
                />
              </div>

              <button
                type="submit"
                disabled={resSubmitting}
                className="w-full rounded-xl bg-orange-600 py-3.5 text-sm font-semibold text-white hover:bg-orange-700 transition-colors disabled:opacity-60"
              >
                {resSubmitting ? 'Confirming Reservation...' : 'Confirm Reservation'}
              </button>
            </form>
          </div>

          {/* Guest Reviews */}
          <div className="lg:col-span-6 space-y-5">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-2xl font-display font-bold tracking-tight">Guest Reviews</h2>
                <p className="mt-1 text-sm text-stone-600">
                  Verified feedback submitted after completed dine-in payments.
                </p>
              </div>
              {restaurant.googleReviewUrl && (
                <a
                  href={restaurant.googleReviewUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1.5 text-xs font-semibold text-orange-700 hover:underline whitespace-nowrap"
                >
                  Google Reviews
                  <ExternalLink className="w-3.5 h-3.5" />
                </a>
              )}
            </div>

            <div className="space-y-4">
              {approvedReviews.slice(0, 4).map((rev) => (
                <div key={rev.id} className="rounded-2xl bg-white border border-stone-200 p-5">
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-semibold text-stone-900">{rev.customerName}</p>
                    <div className="flex items-center gap-1 text-orange-600">
                      {Array.from({ length: rev.overallRating }).map((_, idx) => (
                        <Star key={idx} className="w-3.5 h-3.5 fill-orange-500 text-orange-500" />
                      ))}
                    </div>
                  </div>
                  <p className="mt-2 text-sm text-stone-600 leading-relaxed">{rev.comment}</p>
                  <p className="mt-3 text-[11px] text-stone-500 font-mono tabular-nums">
                    Food {rev.foodRating}/5 · Service {rev.serviceRating}/5 · Experience{' '}
                    {rev.experienceRating}/5
                  </p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* Quiet Footer */}
      <footer className="border-t border-stone-200 py-8 px-4 sm:px-6 lg:px-8 max-w-7xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-4 text-xs text-stone-500">
        <div className="flex items-center gap-2">
          <Utensils className="w-3.5 h-3.5 text-orange-600" />
          <span>{restaurant.name} · Powered by EmberTable</span>
        </div>
        <div className="flex items-center gap-5">
          <span>{restaurant.email}</span>
          <span>{restaurant.phone}</span>
        </div>
      </footer>

      {/* Table QR Code Scanner & Demo Launcher Drawer */}
      {qrDrawerOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/65 backdrop-blur-sm p-4">
          <div className="w-full max-w-2xl rounded-2xl bg-[#FAF8F5] border border-stone-200 shadow-2xl overflow-hidden max-h-[88vh] flex flex-col">
            <div className="flex items-center justify-between px-6 py-4 bg-white border-b border-stone-200">
              <div className="flex items-center gap-2.5">
                <QrCode className="w-5 h-5 text-orange-600" />
                <div>
                  <h3 className="text-base font-semibold text-stone-900">
                    Scan or Launch Table QR Session
                  </h3>
                  <p className="text-xs text-stone-500">
                    Each table uses a cryptographic token (no editable table numbers in URLs).
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setQrDrawerOpen(false)}
                className="p-2 rounded-lg text-stone-500 hover:bg-stone-100"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-6 overflow-y-auto grid grid-cols-1 md:grid-cols-12 gap-6">
              <div className="md:col-span-7 space-y-2.5">
                {qrDirectory.map((tbl) => (
                  <div
                    key={tbl.id}
                    className="flex items-center justify-between p-3.5 rounded-xl bg-white border border-stone-200"
                  >
                    <div>
                      <p className="text-sm font-semibold text-stone-900">
                        {tbl.tableNumber} · {tbl.label}
                      </p>
                      <p className="text-xs text-stone-500">
                        {tbl.zone} · {tbl.capacity} Seats · {tbl.status}
                      </p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <button
                        type="button"
                        onClick={() => handleLoadQrImage(tbl.id)}
                        className="px-2.5 py-1.5 rounded-lg border border-stone-300 text-xs font-medium text-stone-700 hover:bg-stone-100"
                      >
                        View QR
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setQrDrawerOpen(false);
                          onLaunchQrSession(tbl.qrToken);
                        }}
                        className="px-3 py-1.5 rounded-lg bg-orange-600 text-xs font-semibold text-white hover:bg-orange-700"
                      >
                        Open Menu
                      </button>
                    </div>
                  </div>
                ))}
              </div>

              <div className="md:col-span-5 flex flex-col items-center justify-center rounded-2xl bg-white border border-stone-200 p-5 text-center">
                {selectedQrPreview ? (
                  <>
                    <p className="text-xs font-semibold text-stone-900 mb-2">
                      Table {selectedQrPreview.tableNumber} QR
                    </p>
                    <img
                      src={selectedQrPreview.dataUrl}
                      alt={`QR Code for Table ${selectedQrPreview.tableNumber}`}
                      className="w-44 h-44 rounded-lg border border-stone-200"
                    />
                    <p className="mt-2 text-[11px] font-mono text-stone-500 break-all">
                      {selectedQrPreview.scanUrl}
                    </p>
                    <a
                      href={selectedQrPreview.dataUrl}
                      download={`table-${selectedQrPreview.tableNumber}-qr.png`}
                      className="mt-3 inline-flex items-center gap-1.5 text-xs font-semibold text-orange-700 hover:underline"
                    >
                      Download PNG
                    </a>
                  </>
                ) : (
                  <p className="text-xs text-stone-500">
                    Select &ldquo;View QR&rdquo; on any table to inspect or download its scannable QR code, or click &ldquo;Open Menu&rdquo; to enter that table&apos;s live session.
                  </p>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      <FoodArViewer
        open={Boolean(arPreviewDish)}
        onClose={() => setArPreviewDish(null)}
        item={arPreviewDish}
        model3d={models3d.find((m) => m.menuItemId === arPreviewDish?.id) || null}
        restaurant={restaurant}
      />
    </div>
  );
};
