import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Bell,
  Bot,
  CheckCircle2,
  Clock,
  CreditCard,
  Download,
  ExternalLink,
  Eye,
  Flame,
  Gamepad2,
  Globe,
  MessageCircle,
  Mic,
  Minus,
  Plus,
  Receipt,
  Search,
  ShoppingBag,
  Sparkles,
  Star,
  Trash2,
  Users,
  UtensilsCrossed,
  X,
} from 'lucide-react';
import { apiFetch, downloadInvoicePdf, useRealtimeSocket } from '../lib/api.ts';
import { calculateLineTotalCents, calculateOrderTotals, formatMoney } from '../shared/calculations.ts';
import type {
  CartItem,
  Food3dModelDTO,
  InvoiceDTO,
  MenuCategoryDTO,
  MenuItemDTO,
  NotificationLogDTO,
  OrderDTO,
  RestaurantDTO,
  ServiceRequestDTO,
  ServiceRequestType,
  SpiceLevel,
  TableDTO,
  TableSessionDTO,
} from '../shared/types.ts';
import { AiRecommendationFlow } from './AiRecommendationFlow.tsx';
import { DishVisual } from './DishVisual.tsx';
import { FoodArViewer } from './FoodArViewer.tsx';
import { VoiceOrderingModal } from './VoiceOrderingModal.tsx';

interface QrDiningAppProps {
  qrToken: string;
  onExitToWebsite: () => void;
}

type DiningTab = 'welcome' | 'ai' | 'menu' | 'tracking' | 'service' | 'bill';

const SPICE_QUIZ = [
  {
    q: 'Which Kashmiri spice gives Saffron & Hearth risotto its crimson threads and honeyed aroma?',
    options: ['Crocus sativus (Saffron)', 'Sumac Berry', 'Annatto Seed'],
    answer: 0,
  },
  {
    q: 'At what oak-oven floor temperature do our 48-hour sourdough flatbreads blister in 90 seconds?',
    options: ['220°C', '310°C', '430°C'],
    answer: 2,
  },
  {
    q: 'Which peppercorn cultivar is harvested on the Malabar Coast and prized for citrus-pine heat?',
    options: ['Tellicherry Black Pepper', 'Sichuan Green', 'Urfa Biber'],
    answer: 0,
  },
];

const MEMORY_SYMBOLS = ['🔥', '🌿', '🍋', '🍄', '🍤', '🧀'];

export const QrDiningApp: React.FC<QrDiningAppProps> = ({ qrToken, onExitToWebsite }) => {
  const [restaurant, setRestaurant] = useState<RestaurantDTO | null>(null);
  const [table, setTable] = useState<TableDTO | null>(null);
  const [session, setSession] = useState<TableSessionDTO | null>(null);
  const [categories, setCategories] = useState<MenuCategoryDTO[]>([]);
  const [menuItems, setMenuItems] = useState<MenuItemDTO[]>([]);
  const [orders, setOrders] = useState<OrderDTO[]>([]);
  const [serviceRequests, setServiceRequests] = useState<ServiceRequestDTO[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // Customer identity in collaborative session
  const [guestName, setGuestName] = useState('Guest Diner');
  const [joinInput, setJoinInput] = useState('');

  // Menu Filters & Customization Modal
  const [activeTab, setActiveTab] = useState<DiningTab>('welcome');
  const [categoryFilter, setCategoryFilter] = useState<number | 'all'>('all');
  const [vegOnly, setVegOnly] = useState(false);
  const [spiceFilter, setSpiceFilter] = useState<SpiceLevel | 'all'>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [customizingItem, setCustomizingItem] = useState<MenuItemDTO | null>(null);
  const [selectedVariant, setSelectedVariant] = useState('Regular');
  const [selectedAddons, setSelectedAddons] = useState<string[]>([]);
  const [selectedSpice, setSelectedSpice] = useState<SpiceLevel>('Medium');
  const [itemInstructions, setItemInstructions] = useState('');
  const [itemQty, setItemQty] = useState(1);

  // Add-On Modules: AI Recommendations, Voice Ordering, 3D/AR Models, Personalized Messages & Consent
  const [models3d, setModels3d] = useState<Food3dModelDTO[]>([]);
  const [arPreviewItem, setArPreviewItem] = useState<MenuItemDTO | null>(null);
  const [voiceModalOpen, setVoiceModalOpen] = useState(false);
  const [customerMessages, setCustomerMessages] = useState<NotificationLogDTO[]>([]);
  const [messagesDrawerOpen, setMessagesDrawerOpen] = useState(false);
  const [preferredLanguage, setPreferredLanguage] = useState('en');
  const [browserPushOptIn, setBrowserPushOptIn] = useState(false);
  const [smsOptIn, setSmsOptIn] = useState(false);
  const [whatsappOptIn, setWhatsappOptIn] = useState(false);
  const [emailOptIn, setEmailOptIn] = useState(false);
  const [guestPhone, setGuestPhone] = useState('');
  const [guestEmail, setGuestEmail] = useState('');
  const [savingConsent, setSavingConsent] = useState(false);

  // Cart & Order Checkout
  const [cart, setCart] = useState<CartItem[]>([]);
  const [cartOpen, setCartOpen] = useState(false);
  const [discountCode, setDiscountCode] = useState('');
  const [orderNotes, setOrderNotes] = useState('');
  const [submittingOrder, setSubmittingOrder] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  // Service Requests
  const [customServiceText, setCustomServiceText] = useState('');
  const [sendingService, setSendingService] = useState(false);

  // Waiting Lounge (Optional Quiz & Memory Match)
  const [quizIdx, setQuizIdx] = useState(0);
  const [quizScore, setQuizScore] = useState(0);
  const [quizFeedback, setQuizFeedback] = useState<string | null>(null);
  const [memoryDeck, setMemoryDeck] = useState(() =>
    [...MEMORY_SYMBOLS, ...MEMORY_SYMBOLS]
      .sort(() => Math.random() - 0.5)
      .map((sym, idx) => ({ id: idx, sym, flipped: false, matched: false }))
  );
  const [flippedIds, setFlippedIds] = useState<number[]>([]);

  // Billing & Payment
  const [activeInvoice, setActiveInvoice] = useState<InvoiceDTO | null>(null);
  const [paymentMethod, setPaymentMethod] = useState<'UPI' | 'Razorpay Card' | 'Razorpay Netbanking'>('UPI');
  const [checkoutData, setCheckoutData] = useState<{
    upiIntentUri: string;
    upiQrDataUrl: string;
    sandboxCheckoutPayload: {
      razorpay_order_id: string;
      razorpay_payment_id: string;
      razorpay_signature: string;
    };
  } | null>(null);
  const [paying, setPaying] = useState(false);
  const [paymentVerified, setPaymentVerified] = useState(false);

  // Review Form
  const [reviewForm, setReviewForm] = useState({
    overallRating: 5,
    foodRating: 5,
    serviceRating: 5,
    experienceRating: 5,
    comment: '',
  });
  const [reviewSubmitted, setReviewSubmitted] = useState(false);

  // Tick timer for live prep countdown
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 3500);
  };

  const loadSessionOrdersAndRequests = useCallback(async (sessionToken: string) => {
    try {
      const [ordList, reqList, msgList] = await Promise.all([
        apiFetch<OrderDTO[]>(`/api/sessions/${sessionToken}/orders`),
        apiFetch<ServiceRequestDTO[]>(`/api/service-requests/session/${sessionToken}`),
        apiFetch<NotificationLogDTO[]>(`/api/sessions/${sessionToken}/messages`).catch(() => []),
      ]);
      setOrders(ordList);
      setServiceRequests(reqList);
      setCustomerMessages(msgList);
    } catch {
      // Ignore transient refresh failures
    }
  }, []);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError('');
    apiFetch<{ restaurant: RestaurantDTO; table: TableDTO; session: TableSessionDTO }>(
      `/api/qr/${qrToken}`
    )
      .then(async (data) => {
        if (!active) return;
        setRestaurant(data.restaurant);
        setTable(data.table);
        setSession(data.session);
        setGuestName(data.session.hostName || 'Guest Diner');
        setPreferredLanguage(data.session.preferredLanguage || 'en');
        setBrowserPushOptIn(Boolean(data.session.notificationConsent));
        setGuestPhone(data.session.guestPhone || '');
        setGuestEmail(data.session.guestEmail || '');

        if (data.session.selectedMode === 'ai_recommendations') {
          setActiveTab('ai');
        } else if (data.session.selectedMode === 'menu') {
          setActiveTab('menu');
        } else {
          setActiveTab('welcome');
        }

        const [menuData, modelsData] = await Promise.all([
          apiFetch<{ categories: MenuCategoryDTO[]; items: MenuItemDTO[] }>(
            `/api/restaurants/${data.restaurant.slug}/menu`
          ),
          apiFetch<Food3dModelDTO[]>(`/api/restaurants/${data.restaurant.slug}/models`).catch(() => []),
        ]);
        if (!active) return;
        setCategories(menuData.categories);
        setMenuItems(menuData.items);
        setModels3d(modelsData);

        await loadSessionOrdersAndRequests(data.session.sessionToken);
      })
      .catch((err: unknown) => {
        if (active) setError(err instanceof Error ? err.message : 'Unable to load table QR.');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [qrToken, loadSessionOrdersAndRequests]);

  // Real-time WebSocket Updates for Live Kitchen Order Tracking, Service Status & Personalized Messages
  useRealtimeSocket(restaurant?.id, session?.sessionToken, (evt) => {
    if (!session) return;
    if (evt.type === 'order:created' || evt.type === 'order:updated') {
      loadSessionOrdersAndRequests(session.sessionToken);
      if (evt.type === 'order:updated') {
        const ord = evt.payload as OrderDTO;
        if (ord.tableSessionId === session.id) {
          showToast(`Order ${ord.orderNumber} is now ${ord.status}`);
        }
      }
    }
    if (evt.type === 'service_request:updated' || evt.type === 'service_request:created') {
      loadSessionOrdersAndRequests(session.sessionToken);
    }
    if (evt.type === 'session:updated') {
      setSession(evt.payload as TableSessionDTO);
    }
    if (evt.type === 'payment:verified') {
      setPaymentVerified(true);
      loadSessionOrdersAndRequests(session.sessionToken);
    }
    if (evt.type === 'customer_message') {
      const msg = evt.payload as NotificationLogDTO;
      if (msg.tableSessionId === session.id) {
        setCustomerMessages((prev) => [msg, ...prev.filter((m) => m.id !== msg.id)]);
        showToast(`${msg.title}: ${msg.renderedMessage}`);
        if (
          session.notificationConsent &&
          typeof Notification !== 'undefined' &&
          Notification.permission === 'granted'
        ) {
          try {
            new Notification(msg.title, { body: msg.renderedMessage });
          } catch {
            // Browser notifications restricted in iframe/context
          }
        }
      }
    }
  });

  // Load invoice for latest active/served order when opening Bill tab
  const latestBillableOrder = useMemo(
    () => orders.find((o) => o.status !== 'Cancelled') || null,
    [orders]
  );

  useEffect(() => {
    if (activeTab === 'bill' && latestBillableOrder) {
      apiFetch<{ invoice: InvoiceDTO | null }>(`/api/orders/track/${latestBillableOrder.orderNumber}`)
        .then((res) => {
          if (res.invoice) {
            setActiveInvoice({
              ...res.invoice,
              items: latestBillableOrder.items.map((it) => ({
                id: it.id,
                description: `${it.itemName} (${it.variantName})`,
                quantity: it.quantity,
                unitPriceCents: Math.round(it.lineTotalCents / it.quantity),
                totalCents: it.lineTotalCents,
              })),
            });
            if (res.invoice.status === 'paid') setPaymentVerified(true);
          }
        })
        .catch(() => {});
    }
  }, [activeTab, latestBillableOrder]);

  const filteredMenu = useMemo(() => {
    return menuItems.filter((item) => {
      if (categoryFilter !== 'all' && item.categoryId !== categoryFilter) return false;
      if (vegOnly && !item.isVegetarian) return false;
      if (spiceFilter !== 'all' && item.defaultSpiceLevel !== spiceFilter) return false;
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        if (!item.name.toLowerCase().includes(q) && !item.description.toLowerCase().includes(q)) {
          return false;
        }
      }
      return true;
    });
  }, [menuItems, categoryFilter, vegOnly, spiceFilter, searchQuery]);

  const cartTotals = useMemo(() => {
    if (!restaurant) return { subtotalCents: 0, discountCents: 0, taxCents: 0, serviceChargeCents: 0, totalCents: 0 };
    return calculateOrderTotals({
      items: cart.map((c) => ({
        unitPriceCents: c.basePriceCents,
        variantPriceDeltaCents: c.variantPriceDeltaCents,
        addons: c.addons,
        quantity: c.quantity,
      })),
      taxRatePercent: restaurant.taxRatePercent,
      serviceChargePercent: restaurant.serviceChargePercent,
      discountCode,
    });
  }, [cart, restaurant, discountCode]);

  const openCustomize = (item: MenuItemDTO) => {
    const defVar = item.variants.find((v) => v.isDefault) || item.variants[0];
    setCustomizingItem(item);
    setSelectedVariant(defVar?.name || 'Regular');
    setSelectedAddons([]);
    setSelectedSpice(item.defaultSpiceLevel);
    setItemInstructions('');
    setItemQty(1);
  };

  const addCustomizedToCart = () => {
    if (!customizingItem) return;
    const variant = customizingItem.variants.find((v) => v.name === selectedVariant);
    const chosenAddons = customizingItem.addons
      .filter((a) => selectedAddons.includes(a.name))
      .map((a) => ({ name: a.name, priceCents: a.priceCents }));

    setCart((prev) => [
      ...prev,
      {
        cartId: crypto.randomUUID(),
        menuItemId: customizingItem.id,
        name: customizingItem.name,
        imageKey: customizingItem.imageKey,
        quantity: itemQty,
        basePriceCents: customizingItem.basePriceCents,
        variantName: variant?.name || 'Regular',
        variantPriceDeltaCents: variant?.priceDeltaCents || 0,
        addons: chosenAddons,
        spiceLevel: selectedSpice,
        specialInstructions: itemInstructions,
        prepTimeMinutes: customizingItem.prepTimeMinutes,
        addedBy: guestName,
      },
    ]);
    showToast(`Added ${customizingItem.name} to table cart`);
    setCustomizingItem(null);
  };

  const handleSelectEntryMode = async (mode: 'ai_recommendations' | 'menu') => {
    setActiveTab(mode === 'ai_recommendations' ? 'ai' : 'menu');
    if (!session) return;
    apiFetch<TableSessionDTO>(`/api/sessions/${session.sessionToken}/mode`, {
      method: 'POST',
      body: JSON.stringify({ selectedMode: mode }),
    })
      .then((updated) => setSession(updated))
      .catch(() => {});
  };

  const handleSaveConsent = async (overridePush?: boolean) => {
    if (!session) return;
    setSavingConsent(true);
    let nextPush = overridePush ?? browserPushOptIn;
    if (nextPush && typeof Notification !== 'undefined' && Notification.permission === 'default') {
      try {
        const perm = await Notification.requestPermission();
        nextPush = perm === 'granted';
        setBrowserPushOptIn(nextPush);
      } catch {
        nextPush = false;
      }
    }
    try {
      const res = await apiFetch<{ session: TableSessionDTO }>(
        `/api/sessions/${session.sessionToken}/consent`,
        {
          method: 'POST',
          body: JSON.stringify({
            preferredLanguage,
            browserPushOptIn: nextPush,
            smsOptIn,
            whatsappOptIn,
            emailOptIn,
            phone: guestPhone,
            email: guestEmail,
            customerName: guestName,
          }),
        }
      );
      setSession(res.session);
      showToast('Communication preferences saved for this table.');
    } catch {
      showToast('Unable to save preferences right now.');
    } finally {
      setSavingConsent(false);
    }
  };

  const handleAddRecommendedItemsToCart = (
    picks: { menuItem: MenuItemDTO; quantity: number; reason?: string }[]
  ) => {
    setCart((prev) => [
      ...prev,
      ...picks.map(({ menuItem, quantity }) => {
        const defVar = menuItem.variants.find((v) => v.isDefault) || menuItem.variants[0];
        return {
          cartId: crypto.randomUUID(),
          menuItemId: menuItem.id,
          name: menuItem.name,
          imageKey: menuItem.imageKey,
          quantity,
          basePriceCents: menuItem.basePriceCents,
          variantName: defVar?.name || 'Regular',
          variantPriceDeltaCents: defVar?.priceDeltaCents || 0,
          addons: [],
          spiceLevel: menuItem.defaultSpiceLevel,
          specialInstructions: '',
          prepTimeMinutes: menuItem.prepTimeMinutes,
          addedBy: `${guestName} (AI Pick)`,
        };
      }),
    ]);
    showToast(`Added ${picks.length} recommended dish(es) to your cart`);
  };

  const handleAddVoiceItemsToCart = (
    picks: {
      menuItem: MenuItemDTO;
      quantity: number;
      variantName: string;
      spiceLevel: SpiceLevel;
      specialInstructions: string;
    }[]
  ) => {
    setCart((prev) => [
      ...prev,
      ...picks.map((p) => {
        const variant =
          p.menuItem.variants.find((v) => v.name.toLowerCase() === p.variantName.toLowerCase()) ||
          p.menuItem.variants.find((v) => v.isDefault) ||
          p.menuItem.variants[0];
        return {
          cartId: crypto.randomUUID(),
          menuItemId: p.menuItem.id,
          name: p.menuItem.name,
          imageKey: p.menuItem.imageKey,
          quantity: p.quantity,
          basePriceCents: p.menuItem.basePriceCents,
          variantName: variant?.name || 'Regular',
          variantPriceDeltaCents: variant?.priceDeltaCents || 0,
          addons: [],
          spiceLevel: p.spiceLevel,
          specialInstructions: p.specialInstructions,
          prepTimeMinutes: p.menuItem.prepTimeMinutes,
          addedBy: `${guestName} (Voice)`,
        };
      }),
    ]);
    showToast(`Added ${picks.length} spoken dish(es) to your cart`);
    setCartOpen(true);
  };

  const handleJoinTable = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!session || !joinInput.trim()) return;
    try {
      const updated = await apiFetch<TableSessionDTO>(`/api/sessions/${session.sessionToken}/join`, {
        method: 'POST',
        body: JSON.stringify({ participantName: joinInput.trim() }),
      });
      setSession(updated);
      setGuestName(joinInput.trim());
      setJoinInput('');
      showToast(`${joinInput.trim()} joined Table ${table?.tableNumber}`);
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'Unable to join session');
    }
  };

  const handlePlaceOrder = async () => {
    if (!restaurant || !session || cart.length === 0) return;
    setSubmittingOrder(true);
    try {
      const idempotencyKey = `ord-${session.sessionToken.slice(0, 8)}-${Date.now()}-${Math.random()
        .toString(36)
        .slice(2, 7)}`;

      const created = await apiFetch<OrderDTO>('/api/orders', {
        method: 'POST',
        body: JSON.stringify({
          restaurantId: restaurant.id,
          tableSessionToken: session.sessionToken,
          customerName: guestName,
          guestCount: session.guestCount,
          idempotencyKey,
          discountCode: discountCode.trim() || undefined,
          notes: orderNotes,
          items: cart.map((c) => ({
            menuItemId: c.menuItemId,
            quantity: c.quantity,
            variantName: c.variantName,
            addonNames: c.addons.map((a) => a.name),
            spiceLevel: c.spiceLevel,
            specialInstructions: c.specialInstructions,
          })),
        }),
      });

      setCart([]);
      setCartOpen(false);
      setOrders((prev) => [created, ...prev]);
      setActiveTab('tracking');
      showToast(`Order ${created.orderNumber} sent straight to the kitchen!`);
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'Order submission failed');
    } finally {
      setSubmittingOrder(false);
    }
  };

  const handleCancelOrder = async (orderId: number) => {
    try {
      const updated = await apiFetch<OrderDTO>(`/api/orders/${orderId}/cancel`, {
        method: 'POST',
        body: JSON.stringify({ reason: 'Guest cancelled within grace period' }),
      });
      setOrders((prev) => prev.map((o) => (o.id === orderId ? updated : o)));
      showToast(`Order ${updated.orderNumber} cancelled.`);
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'Cannot cancel order.');
    }
  };

  const handleSendServiceRequest = async (type: ServiceRequestType, custom = '') => {
    if (!restaurant || !session) return;
    setSendingService(true);
    try {
      const created = await apiFetch<ServiceRequestDTO>('/api/service-requests', {
        method: 'POST',
        body: JSON.stringify({
          restaurantId: restaurant.id,
          tableSessionToken: session.sessionToken,
          requestType: type,
          customMessage: custom,
        }),
      });
      setServiceRequests((prev) => [created, ...prev]);
      setCustomServiceText('');
      showToast(`${type} request sent to your table server.`);
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'Failed to send request');
    } finally {
      setSendingService(false);
    }
  };

  const handleInitPayment = async () => {
    if (!activeInvoice) return;
    setPaying(true);
    try {
      const res = await apiFetch<{
        upiIntentUri: string;
        upiQrDataUrl: string;
        sandboxCheckoutPayload: {
          razorpay_order_id: string;
          razorpay_payment_id: string;
          razorpay_signature: string;
        };
      }>('/api/payments/create-order', {
        method: 'POST',
        body: JSON.stringify({ invoiceId: activeInvoice.id, paymentMethod }),
      });
      setCheckoutData(res);
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'Payment initiation failed');
    } finally {
      setPaying(false);
    }
  };

  const handleVerifyPayment = async () => {
    if (!checkoutData) return;
    setPaying(true);
    try {
      await apiFetch('/api/payments/verify', {
        method: 'POST',
        body: JSON.stringify(checkoutData.sandboxCheckoutPayload),
      });
      setPaymentVerified(true);
      setCheckoutData(null);
      if (activeInvoice) {
        setActiveInvoice({ ...activeInvoice, status: 'paid', paidAt: new Date().toISOString() });
      }
      showToast('Payment verified via server HMAC-SHA256!');
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'Signature verification failed');
    } finally {
      setPaying(false);
    }
  };

  const handleSubmitReview = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!restaurant) return;
    try {
      await apiFetch('/api/reviews', {
        method: 'POST',
        body: JSON.stringify({
          restaurantId: restaurant.id,
          orderId: latestBillableOrder?.id ?? null,
          customerName: guestName,
          ...reviewForm,
        }),
      });
      setReviewSubmitted(true);
      showToast('Thank you! Your review has been published.');
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'Failed to submit review');
    }
  };

  const handleFlipMemory = (id: number) => {
    if (flippedIds.length >= 2) return;
    const card = memoryDeck.find((c) => c.id === id);
    if (!card || card.flipped || card.matched) return;

    const nextDeck = memoryDeck.map((c) => (c.id === id ? { ...c, flipped: true } : c));
    const nextFlipped = [...flippedIds, id];
    setMemoryDeck(nextDeck);
    setFlippedIds(nextFlipped);

    if (nextFlipped.length === 2) {
      const [firstId, secondId] = nextFlipped;
      const a = nextDeck.find((c) => c.id === firstId)!;
      const b = nextDeck.find((c) => c.id === secondId)!;
      if (a.sym === b.sym) {
        setTimeout(() => {
          setMemoryDeck((d) =>
            d.map((c) => (c.id === firstId || c.id === secondId ? { ...c, matched: true } : c))
          );
          setFlippedIds([]);
        }, 350);
      } else {
        setTimeout(() => {
          setMemoryDeck((d) =>
            d.map((c) => (c.id === firstId || c.id === secondId ? { ...c, flipped: false } : c))
          );
          setFlippedIds([]);
        }, 700);
      }
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-[#FAF8F5] flex items-center justify-center p-6">
        <div className="text-center space-y-2">
          <div className="w-8 h-8 rounded-full border-2 border-orange-600 border-t-transparent animate-spin mx-auto" />
          <p className="text-sm text-stone-600">Connecting to your table session...</p>
        </div>
      </div>
    );
  }

  if (error || !restaurant || !table || !session) {
    return (
      <div className="min-h-screen bg-[#FAF8F5] flex items-center justify-center p-6">
        <div className="max-w-md rounded-2xl bg-white border border-stone-200 p-6 text-center space-y-4">
          <p className="text-base font-semibold text-stone-900">QR Session Unavailable</p>
          <p className="text-sm text-stone-600">{error || 'This QR token is invalid or expired.'}</p>
          <button
            type="button"
            onClick={onExitToWebsite}
            className="rounded-xl bg-orange-600 px-5 py-2.5 text-sm font-semibold text-white"
          >
            Return to Restaurant Website
          </button>
        </div>
      </div>
    );
  }

  const cartItemCount = cart.reduce((s, c) => s + c.quantity, 0);

  return (
    <div className="min-h-screen bg-[#FAF8F5] text-[#1A1411] pb-24">
      {toast && (
        <div className="fixed top-16 right-4 z-50 rounded-xl bg-[#1A1411] text-white px-4 py-3 text-xs font-medium shadow-xl border border-stone-700">
          {toast}
        </div>
      )}

      {/* Compact Context Bar (within 15% sticky budget) */}
      <div className="bg-white border-b border-stone-200 px-4 sm:px-6 lg:px-8 py-3">
        <div className="max-w-7xl mx-auto flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-xs text-orange-700 font-medium">
              {restaurant.name} · Table {table.tableNumber} ({table.zone})
            </p>
            <h1 className="text-base sm:text-lg font-display font-bold text-stone-900">
              {table.label} · {session.participants.length} Guest(s) at Table
            </h1>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setMessagesDrawerOpen(true)}
              className="inline-flex items-center gap-1.5 rounded-xl border border-stone-300 bg-white px-3 py-2 text-xs font-medium text-stone-800 hover:bg-stone-100 min-h-[44px]"
              title="Table updates & personalized messages"
            >
              <MessageCircle className="w-4 h-4 text-orange-600" />
              <span className="hidden sm:inline">Updates</span>
              {customerMessages.length > 0 && (
                <span className="font-mono text-[11px] font-bold text-orange-700">
                  ({customerMessages.length})
                </span>
              )}
            </button>
            <form onSubmit={handleJoinTable} className="hidden sm:flex items-center gap-1.5">
              <input
                value={joinInput}
                onChange={(e) => setJoinInput(e.target.value)}
                placeholder="Join table as..."
                className="rounded-lg border border-stone-300 px-2.5 py-1.5 text-xs w-32 focus:outline-none focus:border-orange-600"
              />
              <button
                type="submit"
                className="rounded-lg bg-stone-900 text-white px-3 py-1.5 text-xs font-medium hover:bg-stone-800"
              >
                Join
              </button>
            </form>
            <button
              type="button"
              onClick={() => setCartOpen(true)}
              className="inline-flex items-center gap-2 rounded-xl bg-orange-600 px-4 py-2 text-xs font-semibold text-white hover:bg-orange-700 min-h-[44px]"
            >
              <ShoppingBag className="w-4 h-4" />
              <span>Cart ({cartItemCount})</span>
              {cartItemCount > 0 && (
                <span className="font-mono tabular-nums">
                  {formatMoney(cartTotals.totalCents, restaurant.currencySymbol)}
                </span>
              )}
            </button>
          </div>
        </div>

        {/* Collaborative Table Participants Strip */}
        <div className="max-w-7xl mx-auto mt-2 flex items-center gap-2 text-xs text-stone-500 overflow-x-auto">
          <Users className="w-3.5 h-3.5 text-orange-600 shrink-0" />
          <span>Ordering together:</span>
          {session.participants.map((p, idx) => (
            <span key={p.id} className="text-stone-800 font-medium whitespace-nowrap">
              {p.name}
              {idx < session.participants.length - 1 ? ' · ' : ''}
            </span>
          ))}
        </div>
      </div>

      {/* Main Content Container */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-6">
        {/* Desktop Segmented Navigation */}
        <div className="flex items-center gap-2 mb-6 overflow-x-auto pb-1">
          {[
            { id: 'welcome', label: 'Welcome', icon: Sparkles },
            { id: 'ai', label: 'AI Concierge', icon: Bot },
            { id: 'menu', label: 'Digital Menu', icon: UtensilsCrossed },
            { id: 'tracking', label: `Live Orders (${orders.length})`, icon: Flame },
            { id: 'service', label: 'Call Waiter', icon: Bell },
            { id: 'bill', label: 'Bill & UPI Pay', icon: Receipt },
          ].map((tab) => {
            const Icon = tab.icon;
            const active = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id as DiningTab)}
                className={`inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-xs font-semibold whitespace-nowrap shrink-0 min-h-[44px] transition-colors ${
                  active
                    ? 'bg-[#1A1411] text-white'
                    : 'bg-white border border-stone-200 text-stone-700 hover:bg-stone-100'
                }`}
              >
                <Icon className={`w-4 h-4 ${active ? 'text-orange-400' : 'text-stone-500'}`} />
                {tab.label}
              </button>
            );
          })}
        </div>

        {/* WELCOME & POST-QR CHOICE GATE */}
        {activeTab === 'welcome' && (() => {
          const welcomeMsg = customerMessages.find((m) => m.eventKey === 'qr_welcome');
          return (
            <div className="max-w-4xl mx-auto space-y-6">
              <div className="rounded-3xl bg-white border border-stone-200 p-6 sm:p-8 space-y-6">
                <div>
                  <p className="text-xs font-semibold text-orange-700">
                    {restaurant.name} · Table {table.tableNumber} ({table.zone})
                  </p>
                  <h2 className="mt-2 text-2xl sm:text-3xl font-display font-bold text-stone-900">
                    {welcomeMsg?.title || `Welcome to ${restaurant.name}!`}
                  </h2>
                  <p className="mt-2 text-sm text-stone-600 leading-relaxed max-w-2xl">
                    {welcomeMsg?.renderedMessage ||
                      `Hello ${guestName}, we're delighted to host you at Table ${table.tableNumber}. Choose how you'd like to begin dining today.`}
                  </p>
                </div>

                {/* Option A vs Option B */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <button
                    type="button"
                    onClick={() => handleSelectEntryMode('ai_recommendations')}
                    className="text-left rounded-2xl border-2 border-orange-500 bg-orange-50/70 p-6 space-y-3 hover:bg-orange-50 transition-colors"
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold text-orange-700 uppercase tracking-wide">
                        Option A
                      </span>
                      <Sparkles className="w-5 h-5 text-orange-600" />
                    </div>
                    <h3 className="text-lg font-display font-bold text-stone-900">
                      Get AI Food Recommendations
                    </h3>
                    <p className="text-xs text-stone-600 leading-relaxed">
                      Tell us your budget, guest count, spice preference, and allergies for a curated combo tailored from live available dishes.
                    </p>
                    <span className="inline-block text-xs font-semibold text-orange-700">
                      Launch AI Concierge →
                    </span>
                  </button>

                  <button
                    type="button"
                    onClick={() => handleSelectEntryMode('menu')}
                    className="text-left rounded-2xl border border-stone-300 bg-[#FAF8F5] p-6 space-y-3 hover:border-stone-900 transition-colors"
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold text-stone-500 uppercase tracking-wide">
                        Option B
                      </span>
                      <UtensilsCrossed className="w-5 h-5 text-stone-800" />
                    </div>
                    <h3 className="text-lg font-display font-bold text-stone-900">
                      Explore Menu Directly
                    </h3>
                    <p className="text-xs text-stone-600 leading-relaxed">
                      Browse all wood-fired courses, inspect 3D/AR dish previews, or speak your order using multilingual voice ordering.
                    </p>
                    <span className="inline-block text-xs font-semibold text-stone-900">
                      Open Digital Menu →
                    </span>
                  </button>
                </div>

                {/* Language & Live Order Alerts Opt-in */}
                <div className="rounded-2xl bg-[#FAF8F5] border border-stone-200 p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                  <div className="space-y-1">
                    <p className="text-xs font-semibold text-stone-900 flex items-center gap-1.5">
                      <Globe className="w-3.5 h-3.5 text-orange-600" />
                      Live Kitchen Updates &amp; Language
                    </p>
                    <p className="text-[11px] text-stone-500">
                      Optional: receive instant in-browser alerts when dishes enter prep or are ready to serve.
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <select
                      value={preferredLanguage}
                      onChange={(e) => setPreferredLanguage(e.target.value)}
                      className="rounded-xl border border-stone-300 bg-white px-3 py-2 text-xs font-medium"
                    >
                      <option value="en">English</option>
                      <option value="hi">Hindi (हिन्दी)</option>
                      <option value="mr">Marathi (मराठी)</option>
                    </select>
                    <button
                      type="button"
                      disabled={savingConsent}
                      onClick={() => handleSaveConsent(true)}
                      className={`rounded-xl px-3.5 py-2 text-xs font-semibold border ${
                        session.notificationConsent
                          ? 'bg-emerald-700 text-white border-emerald-700'
                          : 'bg-white text-stone-800 border-stone-300 hover:border-orange-500'
                      }`}
                    >
                      {session.notificationConsent ? 'Alerts Enabled ✓' : 'Enable Order Alerts'}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          );
        })()}

        {/* TAB: AI CONCIERGE RECOMMENDATIONS */}
        {activeTab === 'ai' && (
          <AiRecommendationFlow
            restaurant={restaurant}
            tableNumber={table.tableNumber}
            guestName={guestName}
            sessionToken={session.sessionToken}
            defaultGuestCount={session.guestCount}
            menuItems={menuItems}
            onExploreMenu={() => handleSelectEntryMode('menu')}
            onAddItemsToCart={handleAddRecommendedItemsToCart}
            onOpenAr={(dish) => setArPreviewItem(dish)}
          />
        )}

        {/* TAB 1: DIGITAL MENU */}
        {activeTab === 'menu' && (
          <div className="space-y-6">
            {/* Search, Voice Order & Dietary Filters */}
            <div className="flex flex-col md:flex-row gap-3 items-stretch md:items-center justify-between">
              <div className="flex items-center gap-2 flex-1 max-w-xl">
                <div className="relative flex-1">
                  <Search className="w-4 h-4 text-stone-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                  <input
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Search dishes, ingredients, spice..."
                    className="w-full rounded-xl bg-white border border-stone-200 pl-10 pr-4 py-2.5 text-sm focus:outline-none focus:border-orange-600 min-h-[44px]"
                  />
                </div>
                <button
                  type="button"
                  onClick={() => setVoiceModalOpen(true)}
                  className="inline-flex items-center gap-2 rounded-xl bg-[#1A1411] text-white px-4 py-2.5 text-xs font-semibold hover:bg-stone-800 shrink-0 min-h-[44px]"
                >
                  <Mic className="w-4 h-4 text-orange-400" />
                  <span>Voice Order</span>
                </button>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => setVegOnly((v) => !v)}
                  className={`px-3.5 py-2 rounded-xl text-xs font-medium min-h-[44px] border ${
                    vegOnly
                      ? 'bg-emerald-700 text-white border-emerald-700'
                      : 'bg-white text-stone-700 border-stone-200'
                  }`}
                >
                  Vegetarian Only
                </button>
                {(['all', 'Mild', 'Medium', 'Hot'] as const).map((sp) => (
                  <button
                    key={sp}
                    type="button"
                    onClick={() => setSpiceFilter(sp)}
                    className={`px-3.5 py-2 rounded-xl text-xs font-medium min-h-[44px] border ${
                      spiceFilter === sp
                        ? 'bg-orange-600 text-white border-orange-600'
                        : 'bg-white text-stone-700 border-stone-200'
                    }`}
                  >
                    {sp === 'all' ? 'All Spice' : sp}
                  </button>
                ))}
              </div>
            </div>

            {/* Category Bar */}
            <div className="flex items-center gap-2 overflow-x-auto pb-1">
              <button
                type="button"
                onClick={() => setCategoryFilter('all')}
                className={`px-3.5 py-2 rounded-lg text-xs font-medium whitespace-nowrap shrink-0 ${
                  categoryFilter === 'all' ? 'bg-stone-900 text-white' : 'bg-stone-200/70 text-stone-700'
                }`}
              >
                All Courses
              </button>
              {categories.map((cat) => (
                <button
                  key={cat.id}
                  type="button"
                  onClick={() => setCategoryFilter(cat.id)}
                  className={`px-3.5 py-2 rounded-lg text-xs font-medium whitespace-nowrap shrink-0 ${
                    categoryFilter === cat.id
                      ? 'bg-stone-900 text-white'
                      : 'bg-stone-200/70 text-stone-700'
                  }`}
                >
                  {cat.name}
                </button>
              ))}
            </div>

            {/* Menu Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
              {filteredMenu.map((item) => {
                const model = models3d.find((m) => m.menuItemId === item.id);
                const arAllowed = model ? model.arEnabled : true;
                return (
                  <article
                    key={item.id}
                    className="rounded-2xl bg-white border border-stone-200 overflow-hidden flex flex-col"
                  >
                    <DishVisual imageKey={item.imageKey} name={item.name} className="aspect-[4/3] w-full" />
                    <div className="p-4 flex-1 flex flex-col justify-between">
                      <div>
                        <p className="text-[11px] text-stone-500">
                          {item.isVegetarian ? 'Veg' : 'Non-Veg'} · {item.prepTimeMinutes}m ·{' '}
                          {item.defaultSpiceLevel}
                          {item.allergenCodes.length > 0 && ` · ${item.allergenCodes.join(', ')}`}
                        </p>
                        <h3 className="mt-1 text-base font-semibold text-stone-900">{item.name}</h3>
                        <p className="mt-1.5 text-xs text-stone-600 line-clamp-2">{item.description}</p>
                      </div>
                      <div className="mt-4 pt-3 border-t border-stone-100 flex items-center justify-between gap-2">
                        <span className="font-mono tabular-nums text-sm font-semibold text-stone-900">
                          {formatMoney(item.basePriceCents, restaurant.currencySymbol)}
                        </span>
                        <div className="flex items-center gap-1.5">
                          {arAllowed && (
                            <button
                              type="button"
                              onClick={() => setArPreviewItem(item)}
                              className="inline-flex items-center gap-1 rounded-xl border border-stone-300 px-3 py-2 text-xs font-semibold text-stone-700 hover:bg-stone-100 min-h-[44px]"
                              title="Inspect in 3D / AR"
                            >
                              <Eye className="w-3.5 h-3.5 text-orange-600" />
                              AR
                            </button>
                          )}
                          <button
                            type="button"
                            disabled={!item.isAvailable}
                            onClick={() => openCustomize(item)}
                            className="rounded-xl bg-orange-600 px-4 py-2 text-xs font-semibold text-white hover:bg-orange-700 disabled:bg-stone-300 min-h-[44px]"
                          >
                            {item.isAvailable ? 'Customize & Add' : 'Sold Out'}
                          </button>
                        </div>
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>
          </div>
        )}

        {/* TAB 2: LIVE ORDER TRACKING + WAITING EXPERIENCE */}
        {activeTab === 'tracking' && (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
            <div className="lg:col-span-7 space-y-4">
              {orders.length === 0 ? (
                <div className="rounded-2xl bg-white border border-stone-200 p-8 text-center">
                  <p className="text-base font-semibold text-stone-900">No orders placed at this table yet</p>
                  <p className="mt-1 text-sm text-stone-600">
                    Add dishes from the Digital Menu to watch live kitchen progress here.
                  </p>
                  <button
                    type="button"
                    onClick={() => setActiveTab('menu')}
                    className="mt-4 rounded-xl bg-orange-600 px-5 py-2.5 text-xs font-semibold text-white"
                  >
                    Browse Menu
                  </button>
                </div>
              ) : (
                orders.map((ord) => {
                  const steps = ['Pending', 'Accepted', 'Cooking', 'Ready', 'Served'];
                  const currentIdx = Math.max(0, steps.indexOf(ord.status));
                  const createdMs = new Date(ord.createdAt).getTime();
                  const targetMs = createdMs + ord.estimatedPrepMinutes * 60_000;
                  const remainingSec = Math.max(0, Math.floor((targetMs - nowMs) / 1000));
                  const mins = Math.floor(remainingSec / 60);
                  const secs = remainingSec % 60;

                  return (
                    <div key={ord.id} className="rounded-2xl bg-white border border-stone-200 p-5 space-y-4">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div>
                          <p className="text-xs text-stone-500 font-mono tabular-nums">
                            {ord.orderNumber} · Table {table.tableNumber} · {ord.customerName}
                          </p>
                          <h3 className="text-lg font-semibold text-stone-900 mt-0.5">
                            Status: {ord.status}
                          </h3>
                        </div>

                        {ord.status !== 'Completed' && ord.status !== 'Cancelled' && ord.status !== 'Served' && (
                          <div className="text-right">
                            <p className="text-[11px] text-stone-500">Est. Remaining</p>
                            <p className="font-mono tabular-nums text-lg font-bold text-orange-600">
                              {String(mins).padStart(2, '0')}:{String(secs).padStart(2, '0')}
                            </p>
                          </div>
                        )}
                      </div>

                      {/* Real-time Step Progress Bar */}
                      {ord.status !== 'Cancelled' && (
                        <div className="grid grid-cols-5 gap-2">
                          {steps.map((step, i) => {
                            const done = i <= currentIdx || ord.status === 'Completed';
                            return (
                              <div key={step} className="space-y-1.5">
                                <div
                                  className={`h-2 rounded-full transition-colors ${
                                    done ? 'bg-orange-600' : 'bg-stone-200'
                                  }`}
                                />
                                <p
                                  className={`text-[11px] font-medium ${
                                    done ? 'text-stone-900' : 'text-stone-400'
                                  }`}
                                >
                                  {step}
                                </p>
                              </div>
                            );
                          })}
                        </div>
                      )}

                      <div className="divide-y divide-stone-100 border-t border-stone-100 pt-2">
                        {ord.items.map((it) => (
                          <div key={it.id} className="py-2 flex justify-between text-xs">
                            <div>
                              <p className="font-medium text-stone-900">
                                {it.quantity}× {it.itemName} ({it.variantName})
                              </p>
                              <p className="text-stone-500">
                                {it.spiceLevel}
                                {it.addons.length > 0 && ` · +${it.addons.map((a) => a.name).join(', ')}`}
                                {it.specialInstructions && ` · "${it.specialInstructions}"`}
                              </p>
                            </div>
                            <span className="font-mono tabular-nums text-stone-800">
                              {formatMoney(it.lineTotalCents, restaurant.currencySymbol)}
                            </span>
                          </div>
                        ))}
                      </div>

                      <div className="flex items-center justify-between pt-2 border-t border-stone-100">
                        <span className="text-sm font-semibold font-mono tabular-nums text-stone-900">
                          Total {formatMoney(ord.totalCents, restaurant.currencySymbol)}
                        </span>
                        <div className="flex items-center gap-2">
                          {['Pending', 'Confirmed', 'Accepted'].includes(ord.status) && (
                            <button
                              type="button"
                              onClick={() => handleCancelOrder(ord.id)}
                              className="rounded-lg border border-stone-300 px-3 py-1.5 text-xs font-medium text-stone-700 hover:bg-stone-100"
                            >
                              Cancel Order
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => setActiveTab('bill')}
                            className="rounded-lg bg-stone-900 px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-stone-800"
                          >
                            View Bill
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
            </div>

            {/* Optional Waiting Experience: Culinary Quiz & Memory Game */}
            <div className="lg:col-span-5 space-y-5">
              <div className="rounded-2xl bg-white border border-stone-200 p-5 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Sparkles className="w-4 h-4 text-orange-600" />
                    <h3 className="text-sm font-semibold text-stone-900">
                      Chef&apos;s Spice &amp; Craft Quiz
                    </h3>
                  </div>
                  <span className="text-xs font-mono tabular-nums text-stone-500">
                    Score {quizScore}/{SPICE_QUIZ.length}
                  </span>
                </div>
                <p className="text-sm text-stone-800 font-medium">{SPICE_QUIZ[quizIdx].q}</p>
                <div className="space-y-2">
                  {SPICE_QUIZ[quizIdx].options.map((opt, idx) => (
                    <button
                      key={opt}
                      type="button"
                      onClick={() => {
                        if (idx === SPICE_QUIZ[quizIdx].answer) {
                          setQuizScore((s) => s + 1);
                          setQuizFeedback('Correct! Well spotted.');
                        } else {
                          setQuizFeedback(`Close — it is ${SPICE_QUIZ[quizIdx].options[SPICE_QUIZ[quizIdx].answer]}.`);
                        }
                      }}
                      className="w-full text-left rounded-xl border border-stone-200 px-3.5 py-2.5 text-xs font-medium hover:border-orange-500 hover:bg-orange-50 transition-colors"
                    >
                      {opt}
                    </button>
                  ))}
                </div>
                {quizFeedback && (
                  <div className="flex items-center justify-between pt-1 text-xs text-orange-700 font-medium">
                    <span>{quizFeedback}</span>
                    <button
                      type="button"
                      onClick={() => {
                        setQuizFeedback(null);
                        setQuizIdx((i) => (i + 1) % SPICE_QUIZ.length);
                      }}
                      className="underline"
                    >
                      Next question
                    </button>
                  </div>
                )}
              </div>

              <div className="rounded-2xl bg-white border border-stone-200 p-5 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Gamepad2 className="w-4 h-4 text-orange-600" />
                    <h3 className="text-sm font-semibold text-stone-900">Table Memory Match</h3>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setMemoryDeck(
                        [...MEMORY_SYMBOLS, ...MEMORY_SYMBOLS]
                          .sort(() => Math.random() - 0.5)
                          .map((sym, idx) => ({ id: idx, sym, flipped: false, matched: false }))
                      );
                      setFlippedIds([]);
                    }}
                    className="text-xs text-orange-700 font-medium hover:underline"
                  >
                    Reset
                  </button>
                </div>
                <div className="grid grid-cols-4 gap-2">
                  {memoryDeck.map((card) => (
                    <button
                      key={card.id}
                      type="button"
                      onClick={() => handleFlipMemory(card.id)}
                      className={`h-14 rounded-xl border text-lg font-semibold transition-transform active:scale-95 ${
                        card.flipped || card.matched
                          ? 'bg-orange-50 border-orange-300'
                          : 'bg-stone-900 border-stone-800 text-stone-400'
                      }`}
                    >
                      {card.flipped || card.matched ? card.sym : '·'}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* TAB 3: WAITER CALLING & SERVICE REQUESTS */}
        {activeTab === 'service' && (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            <div className="lg:col-span-6 rounded-2xl bg-white border border-stone-200 p-6 space-y-4">
              <h2 className="text-lg font-semibold text-stone-900">Instant Table Assistance</h2>
              <p className="text-xs text-stone-600">
                Requests route directly to {restaurant.name} floor staff for Table {table.tableNumber}.
              </p>

              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                {(
                  [
                    'Water',
                    'Napkins',
                    'Waiter Assistance',
                    'Additional Plates',
                    'Cutlery',
                    'Bill Request',
                  ] as ServiceRequestType[]
                ).map((reqType) => (
                  <button
                    key={reqType}
                    type="button"
                    disabled={sendingService}
                    onClick={() => handleSendServiceRequest(reqType)}
                    className="rounded-xl border border-stone-200 bg-[#FAF8F5] px-3 py-4 text-xs font-semibold text-stone-800 hover:border-orange-500 hover:bg-orange-50 transition-colors min-h-[52px]"
                  >
                    {reqType}
                  </button>
                ))}
              </div>

              <div className="pt-3 border-t border-stone-100 flex gap-2">
                <input
                  value={customServiceText}
                  onChange={(e) => setCustomServiceText(e.target.value)}
                  placeholder="Custom request (e.g., high chair, extra ice)..."
                  className="flex-1 rounded-xl border border-stone-300 px-3.5 py-2.5 text-sm focus:outline-none focus:border-orange-600"
                />
                <button
                  type="button"
                  disabled={sendingService || !customServiceText.trim()}
                  onClick={() => handleSendServiceRequest('Custom', customServiceText.trim())}
                  className="rounded-xl bg-orange-600 px-4 py-2.5 text-xs font-semibold text-white hover:bg-orange-700 disabled:opacity-50"
                >
                  Send
                </button>
              </div>
            </div>

            <div className="lg:col-span-6 rounded-2xl bg-white border border-stone-200 p-6 space-y-4">
              <h3 className="text-base font-semibold text-stone-900">Your Table Requests</h3>
              {serviceRequests.length === 0 ? (
                <p className="text-sm text-stone-500">No service requests sent yet.</p>
              ) : (
                <div className="space-y-3">
                  {serviceRequests.map((sr) => (
                    <div
                      key={sr.id}
                      className="flex items-center justify-between p-3.5 rounded-xl bg-[#FAF8F5] border border-stone-200"
                    >
                      <div>
                        <p className="text-sm font-semibold text-stone-900">{sr.requestType}</p>
                        {sr.customMessage && (
                          <p className="text-xs text-stone-600 mt-0.5">{sr.customMessage}</p>
                        )}
                        <p className="text-[11px] text-stone-500 mt-1 font-mono tabular-nums">
                          {new Date(sr.createdAt).toLocaleTimeString()}
                          {sr.handledByName && ` · Assigned to ${sr.handledByName}`}
                        </p>
                      </div>
                      <span className="text-xs font-semibold text-orange-700">{sr.status}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* TAB 4: DIGITAL BILLING, UPI / RAZORPAY & REVIEW */}
        {activeTab === 'bill' && (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            <div className="lg:col-span-7 rounded-2xl bg-white border border-stone-200 p-6 space-y-5">
              {!activeInvoice ? (
                <div className="text-center py-8">
                  <p className="text-base font-semibold text-stone-900">No active invoice yet</p>
                  <p className="text-sm text-stone-500 mt-1">
                    Place an order from the menu to generate an itemized digital bill.
                  </p>
                </div>
              ) : (
                <>
                  <div className="flex items-start justify-between gap-4 border-b border-stone-100 pb-4">
                    <div>
                      <p className="text-xs font-mono text-stone-500">{activeInvoice.invoiceNumber}</p>
                      <h2 className="text-xl font-display font-bold text-stone-900 mt-0.5">
                        Digital Bill · Table {table.tableNumber}
                      </h2>
                    </div>
                    <button
                      type="button"
                      onClick={() => downloadInvoicePdf(activeInvoice, restaurant)}
                      className="inline-flex items-center gap-1.5 rounded-xl border border-stone-300 px-3.5 py-2 text-xs font-medium text-stone-800 hover:bg-stone-100"
                    >
                      <Download className="w-3.5 h-3.5 text-orange-600" />
                      PDF Receipt
                    </button>
                  </div>

                  <div className="divide-y divide-stone-100">
                    {activeInvoice.items.map((it) => (
                      <div key={it.id} className="py-2.5 flex justify-between text-sm">
                        <span>
                          {it.quantity}× {it.description}
                        </span>
                        <span className="font-mono tabular-nums font-medium">
                          {formatMoney(it.totalCents, restaurant.currencySymbol)}
                        </span>
                      </div>
                    ))}
                  </div>

                  <div className="border-t border-stone-200 pt-4 space-y-1.5 text-sm">
                    <div className="flex justify-between text-stone-600">
                      <span>Subtotal</span>
                      <span className="font-mono tabular-nums">
                        {formatMoney(activeInvoice.subtotalCents, restaurant.currencySymbol)}
                      </span>
                    </div>
                    {activeInvoice.discountCents > 0 && (
                      <div className="flex justify-between text-emerald-700">
                        <span>Discount</span>
                        <span className="font-mono tabular-nums">
                          -{formatMoney(activeInvoice.discountCents, restaurant.currencySymbol)}
                        </span>
                      </div>
                    )}
                    <div className="flex justify-between text-stone-600">
                      <span>Tax ({restaurant.taxRatePercent}%)</span>
                      <span className="font-mono tabular-nums">
                        {formatMoney(activeInvoice.taxCents, restaurant.currencySymbol)}
                      </span>
                    </div>
                    {activeInvoice.serviceChargeCents > 0 && (
                      <div className="flex justify-between text-stone-600">
                        <span>Service Charge ({restaurant.serviceChargePercent}%)</span>
                        <span className="font-mono tabular-nums">
                          {formatMoney(activeInvoice.serviceChargeCents, restaurant.currencySymbol)}
                        </span>
                      </div>
                    )}
                    <div className="flex justify-between text-lg font-bold text-stone-900 pt-2 border-t border-stone-200">
                      <span>Total Payable</span>
                      <span className="font-mono tabular-nums">
                        {formatMoney(activeInvoice.totalCents, restaurant.currencySymbol)}
                      </span>
                    </div>
                  </div>

                  {paymentVerified || activeInvoice.status === 'paid' ? (
                    <div className="space-y-3">
                      <div className="rounded-xl bg-emerald-50 border border-emerald-200 p-4 flex items-center gap-3 text-emerald-900">
                        <CheckCircle2 className="w-5 h-5 text-emerald-700 shrink-0" />
                        <div className="text-xs">
                          <p className="font-semibold">Payment Verified &amp; Reconciled</p>
                          <p className="mt-0.5">
                            Paid in full via server-verified HMAC signature. Thank you for dining at{' '}
                            {restaurant.name}.
                          </p>
                        </div>
                      </div>

                      {customerMessages
                        .filter((m) => ['goodbye_message', 'feedback_request'].includes(m.eventKey))
                        .map((m) => (
                          <div
                            key={m.id}
                            className="rounded-xl bg-[#FAF8F5] border border-orange-200 p-4 text-xs"
                          >
                            <p className="font-semibold text-orange-800">{m.title}</p>
                            <p className="text-stone-700 mt-1">{m.renderedMessage}</p>
                          </div>
                        ))}
                    </div>
                  ) : (
                    <div className="space-y-4 pt-2">
                      <div className="grid grid-cols-3 gap-2">
                        {(['UPI', 'Razorpay Card', 'Razorpay Netbanking'] as const).map((m) => (
                          <button
                            key={m}
                            type="button"
                            onClick={() => setPaymentMethod(m)}
                            className={`rounded-xl py-2.5 px-3 text-xs font-semibold border ${
                              paymentMethod === m
                                ? 'bg-stone-900 text-white border-stone-900'
                                : 'bg-white text-stone-700 border-stone-200'
                            }`}
                          >
                            {m}
                          </button>
                        ))}
                      </div>

                      {!checkoutData ? (
                        <button
                          type="button"
                          disabled={paying}
                          onClick={handleInitPayment}
                          className="w-full rounded-xl bg-orange-600 py-3.5 text-sm font-semibold text-white hover:bg-orange-700 flex items-center justify-center gap-2 min-h-[48px]"
                        >
                          <CreditCard className="w-4 h-4" />
                          {paying
                            ? 'Creating Secure Payment Order...'
                            : `Pay ${formatMoney(activeInvoice.totalCents, restaurant.currencySymbol)} via ${paymentMethod}`}
                        </button>
                      ) : (
                        <div className="rounded-2xl bg-[#FAF8F5] border border-stone-200 p-5 space-y-4">
                          <div className="flex flex-col sm:flex-row items-center gap-4">
                            <img
                              src={checkoutData.upiQrDataUrl}
                              alt="UPI Payment QR Code"
                              className="w-36 h-36 rounded-xl border border-stone-200 bg-white p-2"
                            />
                            <div className="space-y-2 text-xs">
                              <p className="font-semibold text-stone-900">
                                Scan with GPay / PhonePe / Paytm or Verify Sandbox Checkout
                              </p>
                              <p className="text-stone-600 font-mono">
                                VPA: {restaurant.upiVpa}
                              </p>
                              <p className="text-stone-500">
                                Razorpay Order ID: {checkoutData.sandboxCheckoutPayload.razorpay_order_id}
                              </p>
                              <button
                                type="button"
                                disabled={paying}
                                onClick={handleVerifyPayment}
                                className="rounded-xl bg-emerald-700 px-4 py-2.5 text-xs font-semibold text-white hover:bg-emerald-800"
                              >
                                {paying ? 'Verifying Signature...' : 'Complete & Verify Payment (HMAC-SHA256)'}
                              </button>
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </>
              )}
            </div>

            {/* Post-Payment Customer Review Card */}
            <div className="lg:col-span-5 rounded-2xl bg-white border border-stone-200 p-6 space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-semibold text-stone-900">Share Your Experience</h3>
                {restaurant.googleReviewUrl && (
                  <a
                    href={restaurant.googleReviewUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 text-xs font-semibold text-orange-700 hover:underline"
                  >
                    Google Review
                    <ExternalLink className="w-3 h-3" />
                  </a>
                )}
              </div>

              {reviewSubmitted ? (
                <div className="rounded-xl bg-emerald-50 border border-emerald-200 p-4 text-xs text-emerald-900">
                  Your 5-star review has been saved and published to the {restaurant.name} website.
                </div>
              ) : (
                <form onSubmit={handleSubmitReview} className="space-y-3.5">
                  {(
                    [
                      ['overallRating', 'Overall Experience'],
                      ['foodRating', 'Food Quality'],
                      ['serviceRating', 'Table Service'],
                      ['experienceRating', 'Ambience & Speed'],
                    ] as const
                  ).map(([field, label]) => (
                    <div key={field} className="flex items-center justify-between">
                      <span className="text-xs font-medium text-stone-700">{label}</span>
                      <div className="flex items-center gap-1">
                        {[1, 2, 3, 4, 5].map((star) => (
                          <button
                            key={star}
                            type="button"
                            onClick={() => setReviewForm({ ...reviewForm, [field]: star })}
                            className="p-1"
                          >
                            <Star
                              className={`w-4 h-4 ${
                                star <= reviewForm[field]
                                  ? 'fill-orange-500 text-orange-500'
                                  : 'text-stone-300'
                              }`}
                            />
                          </button>
                        ))}
                      </div>
                    </div>
                  ))}

                  <textarea
                    required
                    rows={3}
                    value={reviewForm.comment}
                    onChange={(e) => setReviewForm({ ...reviewForm, comment: e.target.value })}
                    placeholder="What stood out about your dishes or service tonight?"
                    className="w-full rounded-xl border border-stone-300 p-3 text-sm focus:outline-none focus:border-orange-600"
                  />

                  <button
                    type="submit"
                    className="w-full rounded-xl bg-stone-900 py-3 text-xs font-semibold text-white hover:bg-stone-800"
                  >
                    Submit Dining Review
                  </button>
                </form>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Dish Customization Bottom Sheet / Modal */}
      {customizingItem && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="w-full sm:max-w-lg rounded-t-3xl sm:rounded-2xl bg-white p-6 space-y-5 max-h-[88vh] overflow-y-auto">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h3 className="text-lg font-semibold text-stone-900">{customizingItem.name}</h3>
                <p className="text-xs text-stone-500 mt-0.5">{customizingItem.description}</p>
              </div>
              <button
                type="button"
                onClick={() => setCustomizingItem(null)}
                className="p-2 rounded-lg text-stone-500 hover:bg-stone-100"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {customizingItem.variants.length > 0 && (
              <div>
                <p className="text-xs font-semibold text-stone-700 mb-2">Portion Size</p>
                <div className="grid grid-cols-2 gap-2">
                  {customizingItem.variants.map((v) => (
                    <button
                      key={v.id}
                      type="button"
                      onClick={() => setSelectedVariant(v.name)}
                      className={`rounded-xl p-3 text-left border text-xs ${
                        selectedVariant === v.name
                          ? 'border-orange-600 bg-orange-50 text-stone-900 font-semibold'
                          : 'border-stone-200 text-stone-700'
                      }`}
                    >
                      <div>{v.name}</div>
                      <div className="font-mono tabular-nums text-stone-500 mt-0.5">
                        {v.priceDeltaCents > 0
                          ? `+${formatMoney(v.priceDeltaCents, restaurant.currencySymbol)}`
                          : 'Included'}
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {customizingItem.addons.length > 0 && (
              <div>
                <p className="text-xs font-semibold text-stone-700 mb-2">Optional Add-ons</p>
                <div className="space-y-2">
                  {customizingItem.addons.map((addon) => {
                    const checked = selectedAddons.includes(addon.name);
                    return (
                      <button
                        key={addon.id}
                        type="button"
                        onClick={() =>
                          setSelectedAddons((prev) =>
                            checked ? prev.filter((x) => x !== addon.name) : [...prev, addon.name]
                          )
                        }
                        className={`w-full flex items-center justify-between rounded-xl px-3.5 py-2.5 border text-xs ${
                          checked ? 'border-orange-600 bg-orange-50 font-semibold' : 'border-stone-200'
                        }`}
                      >
                        <span>{addon.name}</span>
                        <span className="font-mono tabular-nums">
                          +{formatMoney(addon.priceCents, restaurant.currencySymbol)}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            <div>
              <p className="text-xs font-semibold text-stone-700 mb-2">Spice Level</p>
              <div className="grid grid-cols-3 gap-2">
                {(['Mild', 'Medium', 'Hot'] as SpiceLevel[]).map((sp) => (
                  <button
                    key={sp}
                    type="button"
                    onClick={() => setSelectedSpice(sp)}
                    className={`rounded-xl py-2.5 text-xs font-semibold border ${
                      selectedSpice === sp
                        ? 'bg-orange-600 text-white border-orange-600'
                        : 'border-stone-200 text-stone-700'
                    }`}
                  >
                    {sp}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-stone-700 mb-1.5">
                Special Kitchen Instructions
              </label>
              <input
                value={itemInstructions}
                onChange={(e) => setItemInstructions(e.target.value)}
                placeholder="No nuts, dressing on side, extra crispy..."
                className="w-full rounded-xl border border-stone-300 px-3.5 py-2.5 text-sm focus:outline-none focus:border-orange-600"
              />
            </div>

            <div className="flex items-center justify-between gap-4 pt-2 border-t border-stone-100">
              <div className="flex items-center gap-2 border border-stone-300 rounded-xl p-1">
                <button
                  type="button"
                  onClick={() => setItemQty((q) => Math.max(1, q - 1))}
                  className="p-2 text-stone-700"
                >
                  <Minus className="w-4 h-4" />
                </button>
                <span className="font-mono tabular-nums text-sm font-semibold w-6 text-center">
                  {itemQty}
                </span>
                <button
                  type="button"
                  onClick={() => setItemQty((q) => q + 1)}
                  className="p-2 text-stone-700"
                >
                  <Plus className="w-4 h-4" />
                </button>
              </div>

              <button
                type="button"
                onClick={addCustomizedToCart}
                className="flex-1 rounded-xl bg-orange-600 py-3.5 text-sm font-semibold text-white hover:bg-orange-700"
              >
                Add to Cart
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Table Cart Drawer */}
      {cartOpen && (
        <div className="fixed inset-0 z-50 flex justify-end bg-black/60 backdrop-blur-sm">
          <div className="w-full max-w-md bg-white h-full flex flex-col justify-between">
            <div className="px-6 py-4 border-b border-stone-200 flex items-center justify-between">
              <div>
                <h3 className="text-base font-semibold text-stone-900">
                  Table {table.tableNumber} Order Cart
                </h3>
                <p className="text-xs text-stone-500">Totals verified server-side upon submission</p>
              </div>
              <button
                type="button"
                onClick={() => setCartOpen(false)}
                className="p-2 rounded-lg text-stone-500 hover:bg-stone-100"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-6 space-y-4">
              {cart.length === 0 ? (
                <p className="text-sm text-stone-500 text-center py-12">Your table cart is empty.</p>
              ) : (
                cart.map((c) => {
                  const lineTotal = calculateLineTotalCents({
                    unitPriceCents: c.basePriceCents,
                    variantPriceDeltaCents: c.variantPriceDeltaCents,
                    addons: c.addons,
                    quantity: c.quantity,
                  });
                  return (
                    <div key={c.cartId} className="rounded-xl border border-stone-200 p-3.5 space-y-2">
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <p className="text-sm font-semibold text-stone-900">{c.name}</p>
                          <p className="text-xs text-stone-500">
                            {c.variantName} · {c.spiceLevel}
                            {c.addons.length > 0 && ` · +${c.addons.map((a) => a.name).join(', ')}`}
                          </p>
                          {c.specialInstructions && (
                            <p className="text-[11px] text-orange-700 mt-0.5">
                              Note: {c.specialInstructions}
                            </p>
                          )}
                        </div>
                        <button
                          type="button"
                          onClick={() => setCart((p) => p.filter((x) => x.cartId !== c.cartId))}
                          className="text-stone-400 hover:text-red-600 p-1"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2 border border-stone-200 rounded-lg px-1.5 py-0.5">
                          <button
                            type="button"
                            onClick={() =>
                              setCart((p) =>
                                p.map((x) =>
                                  x.cartId === c.cartId
                                    ? { ...x, quantity: Math.max(1, x.quantity - 1) }
                                    : x
                                )
                              )
                            }
                            className="p-1"
                          >
                            <Minus className="w-3 h-3" />
                          </button>
                          <span className="font-mono tabular-nums text-xs font-semibold">
                            {c.quantity}
                          </span>
                          <button
                            type="button"
                            onClick={() =>
                              setCart((p) =>
                                p.map((x) =>
                                  x.cartId === c.cartId ? { ...x, quantity: x.quantity + 1 } : x
                                )
                              )
                            }
                            className="p-1"
                          >
                            <Plus className="w-3 h-3" />
                          </button>
                        </div>
                        <span className="font-mono tabular-nums text-sm font-semibold">
                          {formatMoney(lineTotal, restaurant.currencySymbol)}
                        </span>
                      </div>
                    </div>
                  );
                })
              )}
            </div>

            {cart.length > 0 && (
              <div className="p-6 border-t border-stone-200 bg-[#FAF8F5] space-y-3">
                <div className="grid grid-cols-2 gap-2">
                  <input
                    value={discountCode}
                    onChange={(e) => setDiscountCode(e.target.value)}
                    placeholder="Promo (EMBER10)"
                    className="rounded-xl border border-stone-300 bg-white px-3 py-2 text-xs uppercase"
                  />
                  <input
                    value={orderNotes}
                    onChange={(e) => setOrderNotes(e.target.value)}
                    placeholder="Table note..."
                    className="rounded-xl border border-stone-300 bg-white px-3 py-2 text-xs"
                  />
                </div>
                <div className="space-y-1 text-xs">
                  <div className="flex justify-between text-stone-600">
                    <span>Subtotal</span>
                    <span className="font-mono tabular-nums">
                      {formatMoney(cartTotals.subtotalCents, restaurant.currencySymbol)}
                    </span>
                  </div>
                  {cartTotals.discountCents > 0 && (
                    <div className="flex justify-between text-emerald-700">
                      <span>Discount</span>
                      <span className="font-mono tabular-nums">
                        -{formatMoney(cartTotals.discountCents, restaurant.currencySymbol)}
                      </span>
                    </div>
                  )}
                  <div className="flex justify-between text-stone-600">
                    <span>
                      Taxes ({restaurant.taxRatePercent}%) + Service ({restaurant.serviceChargePercent}%)
                    </span>
                    <span className="font-mono tabular-nums">
                      {formatMoney(
                        cartTotals.taxCents + cartTotals.serviceChargeCents,
                        restaurant.currencySymbol
                      )}
                    </span>
                  </div>
                  <div className="flex justify-between text-base font-bold text-stone-900 pt-1">
                    <span>Total</span>
                    <span className="font-mono tabular-nums">
                      {formatMoney(cartTotals.totalCents, restaurant.currencySymbol)}
                    </span>
                  </div>
                </div>
                <button
                  type="button"
                  disabled={submittingOrder}
                  onClick={handlePlaceOrder}
                  className="w-full rounded-xl bg-orange-600 py-3.5 text-sm font-semibold text-white hover:bg-orange-700 disabled:opacity-60"
                >
                  {submittingOrder ? 'Submitting to Kitchen...' : 'Place Table Order'}
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Mobile Fixed Bottom Thumb Bar (<= 64px height, <15% viewport cap) */}
      <nav className="md:hidden fixed bottom-0 left-0 right-0 z-40 bg-white/95 backdrop-blur-md border-t border-stone-200 grid grid-cols-5 h-16">
        {[
          { id: 'ai', label: 'AI Picks', icon: Bot },
          { id: 'menu', label: 'Menu', icon: UtensilsCrossed },
          { id: 'tracking', label: 'Track', icon: Clock },
          { id: 'service', label: 'Waiter', icon: Bell },
          { id: 'bill', label: 'Bill', icon: Receipt },
        ].map((item) => {
          const Icon = item.icon;
          const active = activeTab === item.id;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => setActiveTab(item.id as DiningTab)}
              className={`flex flex-col items-center justify-center gap-0.5 ${
                active ? 'text-orange-600 font-semibold' : 'text-stone-500'
              }`}
            >
              <Icon className="w-5 h-5" />
              <span className="text-[10px]">{item.label}</span>
            </button>
          );
        })}
      </nav>

      {/* Personalized Customer Lifecycle Updates & Consent Drawer */}
      {messagesDrawerOpen && (
        <div className="fixed inset-0 z-50 flex justify-end bg-black/60 backdrop-blur-sm">
          <div className="w-full max-w-md bg-white h-full flex flex-col justify-between">
            <div className="px-6 py-4 border-b border-stone-200 flex items-center justify-between">
              <div>
                <h3 className="text-base font-semibold text-stone-900">
                  Table {table.tableNumber} Personalized Updates
                </h3>
                <p className="text-xs text-stone-500">Live kitchen milestones &amp; notification preferences</p>
              </div>
              <button
                type="button"
                onClick={() => setMessagesDrawerOpen(false)}
                className="p-2 rounded-lg text-stone-500 hover:bg-stone-100"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-6 space-y-4">
              {customerMessages.length === 0 ? (
                <p className="text-sm text-stone-500 text-center py-8">No lifecycle updates yet.</p>
              ) : (
                customerMessages.map((msg) => (
                  <div key={msg.id} className="rounded-xl bg-[#FAF8F5] border border-stone-200 p-3.5 space-y-1">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-xs font-semibold text-orange-800">{msg.title}</p>
                      <span className="text-[10px] font-mono text-stone-400">
                        {new Date(msg.createdAt).toLocaleTimeString()}
                      </span>
                    </div>
                    <p className="text-xs text-stone-700 leading-relaxed">{msg.renderedMessage}</p>
                  </div>
                ))
              )}

              <div className="rounded-2xl border border-stone-200 p-4 space-y-3 bg-[#FAF8F5]">
                <p className="text-xs font-semibold text-stone-900">Channel Opt-In &amp; Language</p>
                <select
                  value={preferredLanguage}
                  onChange={(e) => setPreferredLanguage(e.target.value)}
                  className="w-full rounded-xl border border-stone-300 bg-white px-3 py-2 text-xs"
                >
                  <option value="en">English</option>
                  <option value="hi">Hindi</option>
                  <option value="mr">Marathi</option>
                </select>
                <label className="flex items-center gap-2 text-xs text-stone-700">
                  <input
                    type="checkbox"
                    checked={browserPushOptIn}
                    onChange={(e) => setBrowserPushOptIn(e.target.checked)}
                  />
                  Browser Push Alerts (Order Ready &amp; Delays)
                </label>
                <label className="flex items-center gap-2 text-xs text-stone-700">
                  <input
                    type="checkbox"
                    checked={whatsappOptIn}
                    onChange={(e) => setWhatsappOptIn(e.target.checked)}
                  />
                  WhatsApp Updates (logged when provider credentials configured)
                </label>
                <label className="flex items-center gap-2 text-xs text-stone-700">
                  <input
                    type="checkbox"
                    checked={smsOptIn}
                    onChange={(e) => setSmsOptIn(e.target.checked)}
                  />
                  SMS Updates
                </label>
                <label className="flex items-center gap-2 text-xs text-stone-700">
                  <input
                    type="checkbox"
                    checked={emailOptIn}
                    onChange={(e) => setEmailOptIn(e.target.checked)}
                  />
                  Email Receipt &amp; Thank-You
                </label>
                {(whatsappOptIn || smsOptIn) && (
                  <input
                    value={guestPhone}
                    onChange={(e) => setGuestPhone(e.target.value)}
                    placeholder="Phone (+91...)"
                    className="w-full rounded-xl border border-stone-300 bg-white px-3 py-2 text-xs"
                  />
                )}
                {emailOptIn && (
                  <input
                    type="email"
                    value={guestEmail}
                    onChange={(e) => setGuestEmail(e.target.value)}
                    placeholder="Email address..."
                    className="w-full rounded-xl border border-stone-300 bg-white px-3 py-2 text-xs"
                  />
                )}
                <button
                  type="button"
                  disabled={savingConsent}
                  onClick={() => handleSaveConsent()}
                  className="w-full rounded-xl bg-stone-900 py-2.5 text-xs font-semibold text-white hover:bg-stone-800"
                >
                  {savingConsent ? 'Saving...' : 'Save Preferences'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Voice Ordering Modal */}
      <VoiceOrderingModal
        open={voiceModalOpen}
        onClose={() => setVoiceModalOpen(false)}
        restaurant={restaurant}
        sessionToken={session.sessionToken}
        menuItems={menuItems}
        onConfirmAddToCart={handleAddVoiceItemsToCart}
      />

      {/* 3D & AR Food Preview Modal */}
      <FoodArViewer
        open={Boolean(arPreviewItem)}
        onClose={() => setArPreviewItem(null)}
        item={arPreviewItem}
        model3d={models3d.find((m) => m.menuItemId === arPreviewItem?.id) || null}
        restaurant={restaurant}
        onAddToCart={(dish) => openCustomize(dish)}
      />
    </div>
  );
};
