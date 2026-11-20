import { useEffect, useRef, useState } from 'react';
import { jsPDF } from 'jspdf';
import type { AuthSession, InvoiceDTO, RealtimeEvent, RestaurantDTO } from '../shared/types.ts';
import { formatMoney } from '../shared/calculations.ts';

const AUTH_STORAGE_KEY = 'embertable_auth_session_v1';

export function loadStoredAuth(): AuthSession | null {
  try {
    const raw = localStorage.getItem(AUTH_STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as AuthSession;
  } catch {
    return null;
  }
}

export function saveStoredAuth(session: AuthSession | null): void {
  try {
    if (!session) {
      localStorage.removeItem(AUTH_STORAGE_KEY);
    } else {
      localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(session));
    }
  } catch {
    // Ignore storage failures in private iframes
  }
}

export async function apiFetch<T>(
  path: string,
  options: RequestInit & { token?: string; restaurantId?: number } = {}
): Promise<T> {
  const stored = loadStoredAuth();
  const token = options.token ?? stored?.token;
  const restaurantId = options.restaurantId ?? stored?.restaurantId;

  const headers = new Headers(options.headers || {});
  if (!headers.has('Content-Type') && options.body) {
    headers.set('Content-Type', 'application/json');
  }
  if (token) {
    headers.set('Authorization', `Bearer ${token}`);
  }
  if (restaurantId) {
    headers.set('x-restaurant-id', String(restaurantId));
  }

  const res = await fetch(path, { ...options, headers });
  const text = await res.text();
  let data: unknown = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { error: text };
  }

  if (!res.ok) {
    const message =
      typeof data === 'object' && data !== null && 'error' in data
        ? String((data as { error: unknown }).error)
        : `Request failed (${res.status})`;
    throw new Error(message);
  }

  return data as T;
}

export function useRealtimeSocket(
  restaurantId: number | undefined,
  sessionToken?: string,
  onEvent?: (event: RealtimeEvent) => void
) {
  const [connected, setConnected] = useState(false);
  const handlerRef = useRef(onEvent);
  handlerRef.current = onEvent;

  useEffect(() => {
    if (!restaurantId) return;

    let ws: WebSocket | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let closedByUser = false;

    const connect = () => {
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const params = new URLSearchParams({ restaurantId: String(restaurantId) });
      if (sessionToken) params.set('sessionToken', sessionToken);
      const url = `${protocol}//${window.location.host}/ws?${params.toString()}`;

      ws = new WebSocket(url);
      ws.onopen = () => setConnected(true);
      ws.onmessage = (msg) => {
        try {
          const parsed = JSON.parse(msg.data) as RealtimeEvent;
          handlerRef.current?.(parsed);
        } catch {
          // Ignore malformed WS packets
        }
      };
      ws.onclose = () => {
        setConnected(false);
        if (!closedByUser) {
          reconnectTimer = setTimeout(connect, 2500);
        }
      };
      ws.onerror = () => {
        ws?.close();
      };
    };

    connect();

    return () => {
      closedByUser = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      ws?.close();
    };
  }, [restaurantId, sessionToken]);

  return { connected };
}

export function downloadInvoicePdf(invoice: InvoiceDTO, restaurant: RestaurantDTO) {
  const doc = new jsPDF({ unit: 'pt', format: 'a4' });
  const sym = restaurant.currencyCode === 'INR' ? 'Rs. ' : restaurant.currencySymbol;

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(18);
  doc.text(restaurant.name, 48, 56);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  doc.setTextColor(90, 90, 90);
  doc.text(`${restaurant.address}, ${restaurant.city}`, 48, 74);
  doc.text(`Phone: ${restaurant.phone}  |  Email: ${restaurant.email}`, 48, 88);

  doc.setDrawColor(220, 220, 220);
  doc.line(48, 104, 547, 104);

  doc.setTextColor(20, 20, 20);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(12);
  doc.text(`Tax Invoice: ${invoice.invoiceNumber}`, 48, 128);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  doc.text(`Issued: ${new Date(invoice.issuedAt).toLocaleString()}`, 48, 144);
  doc.text(`Status: ${invoice.status.toUpperCase()}`, 420, 128);

  let y = 176;
  doc.setFont('helvetica', 'bold');
  doc.text('Item', 48, y);
  doc.text('Qty', 340, y);
  doc.text('Rate', 410, y);
  doc.text('Amount', 490, y);
  y += 8;
  doc.line(48, y, 547, y);
  y += 18;

  doc.setFont('helvetica', 'normal');
  for (const item of invoice.items) {
    doc.text(item.description.slice(0, 48), 48, y);
    doc.text(String(item.quantity), 344, y);
    doc.text(formatMoney(item.unitPriceCents, sym), 410, y);
    doc.text(formatMoney(item.totalCents, sym), 490, y);
    y += 20;
  }

  y += 10;
  doc.line(320, y, 547, y);
  y += 20;

  const addSummary = (label: string, amount: number, bold = false) => {
    doc.setFont('helvetica', bold ? 'bold' : 'normal');
    doc.text(label, 340, y);
    doc.text(formatMoney(amount, sym), 490, y);
    y += 18;
  };

  addSummary('Subtotal', invoice.subtotalCents);
  if (invoice.discountCents > 0) addSummary('Discount', -invoice.discountCents);
  addSummary(`Tax (${restaurant.taxRatePercent}%)`, invoice.taxCents);
  if (invoice.serviceChargeCents > 0) {
    addSummary(`Service Charge (${restaurant.serviceChargePercent}%)`, invoice.serviceChargeCents);
  }
  doc.line(320, y - 6, 547, y - 6);
  y += 8;
  addSummary('Total Payable', invoice.totalCents, true);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(110, 110, 110);
  doc.text('Thank you for dining with us. Powered by EmberTable.', 48, y + 36);

  doc.save(`${invoice.invoiceNumber}.pdf`);
}

export function downloadAnalyticsReportPdf(params: {
  restaurant: RestaurantDTO;
  kpis: {
    todaysRevenueCents: number;
    totalRevenueCents: number;
    totalOrders: number;
    averageOrderValueCents: number;
    avgPrepMinutes: number;
    avgRating: number;
  };
  popularDishes: { name: string; count: number; revenueCents: number }[];
}) {
  const doc = new jsPDF({ unit: 'pt', format: 'a4' });
  const sym = params.restaurant.currencyCode === 'INR' ? 'Rs. ' : params.restaurant.currencySymbol;

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(18);
  doc.text(`${params.restaurant.name} — Performance Report`, 48, 56);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  doc.setTextColor(100, 100, 100);
  doc.text(`Generated ${new Date().toLocaleString()}`, 48, 74);

  let y = 112;
  doc.setTextColor(20, 20, 20);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(12);
  doc.text('Key Operational Metrics', 48, y);
  y += 22;

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  const rows = [
    ["Today's Revenue", formatMoney(params.kpis.todaysRevenueCents, sym)],
    ['Cumulative Revenue', formatMoney(params.kpis.totalRevenueCents, sym)],
    ['Total Completed & Active Orders', String(params.kpis.totalOrders)],
    ['Average Order Value', formatMoney(params.kpis.averageOrderValueCents, sym)],
    ['Average Kitchen Prep Time', `${params.kpis.avgPrepMinutes} minutes`],
    ['Average Guest Rating', `${params.kpis.avgRating} / 5.0`],
  ];
  for (const [k, v] of rows) {
    doc.text(k, 48, y);
    doc.text(v, 320, y);
    y += 18;
  }

  y += 20;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(12);
  doc.text('Top Performing Dishes', 48, y);
  y += 22;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);

  for (const dish of params.popularDishes) {
    doc.text(dish.name, 48, y);
    doc.text(`${dish.count} sold`, 320, y);
    doc.text(formatMoney(dish.revenueCents, sym), 430, y);
    y += 18;
  }

  doc.save(`${params.restaurant.slug}-analytics-report.pdf`);
}
