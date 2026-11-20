import React, { useCallback, useEffect, useState } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import {
  Activity,
  AlertTriangle,
  BarChart3,
  Bell,
  Bot,
  Box,
  Calendar,
  ChefHat,
  CreditCard,
  Download,
  Eye,
  FileSpreadsheet,
  LayoutDashboard,
  LayoutGrid,
  MessageSquare,
  Package,
  Plus,
  QrCode,
  Receipt,
  Settings,
  Shield,
  Star,
  Trash2,
  UserCheck,
  Users,
  Utensils,
} from 'lucide-react';
import {
  apiFetch,
  downloadAnalyticsReportPdf,
  downloadInvoicePdf,
  useRealtimeSocket,
} from '../lib/api.ts';
import { formatMoney } from '../shared/calculations.ts';
import type {
  AuthSession,
  Food3dModelDTO,
  InventoryItemDTO,
  InvoiceDTO,
  MenuCategoryDTO,
  MenuItemDTO,
  NotificationDTO,
  NotificationLogDTO,
  NotificationPreferenceDTO,
  NotificationTemplateDTO,
  OrderDTO,
  PaymentDTO,
  ReservationDTO,
  RestaurantDTO,
  ReviewDTO,
  ServiceRequestDTO,
  TableDTO,
} from '../shared/types.ts';
import { FoodArViewer } from './FoodArViewer.tsx';
import { OwnerAiAssistant } from './OwnerAiAssistant.tsx';

type AdminSection =
  | 'overview'
  | 'ai_assistant'
  | 'orders'
  | 'menu'
  | 'models_3d'
  | 'kitchen'
  | 'floor'
  | 'tables'
  | 'customers'
  | 'staff'
  | 'service'
  | 'messaging'
  | 'billing'
  | 'payments'
  | 'inventory'
  | 'reviews'
  | 'reservations'
  | 'analytics'
  | 'reports'
  | 'settings';

interface AnalyticsPayload {
  kpis: {
    todaysRevenueCents: number;
    totalRevenueCents: number;
    totalOrders: number;
    activeOrders: number;
    occupiedTables: number;
    availableTables: number;
    totalTables: number;
    averageOrderValueCents: number;
    avgPrepMinutes: number;
    avgRating: number;
    reviewCount: number;
  };
  dailyRevenue: { date: string; revenue: number; orders: number }[];
  peakHours: { hour: string; orders: number }[];
  popularDishes: { name: string; count: number; revenueCents: number }[];
  lowPerformingDishes: { name: string; count: number; revenueCents: number }[];
  paymentDistribution: { method: string; amount: number }[];
  recentTransactions: PaymentDTO[];
}

interface StaffMemberRow {
  id: number;
  fullName: string;
  email: string;
  roleCode: string;
  staffTitle: string;
  isActive: boolean;
}

interface ShiftRow {
  id: number;
  memberId: number;
  shiftDate: string;
  startTime: string;
  endTime: string;
  station: string;
  status: string;
}

interface AuditLogRow {
  id: number;
  actorEmail: string;
  actorRole: string;
  action: string;
  entityType: string;
  entityId: string;
  createdAt: string;
}

interface AdminDashboardProps {
  restaurant: RestaurantDTO;
  authSession: AuthSession | null;
  onRequestAuth: () => void;
  onNavigateWorkspace: (view: 'kds' | 'floor') => void;
  onRestaurantUpdated: (updated: RestaurantDTO) => void;
}

const NAV_ITEMS: { id: AdminSection; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { id: 'overview', label: 'Overview', icon: LayoutDashboard },
  { id: 'ai_assistant', label: 'AI Owner Assistant', icon: Bot },
  { id: 'orders', label: 'Orders', icon: Activity },
  { id: 'menu', label: 'Menu Management', icon: Utensils },
  { id: 'models_3d', label: '3D & AR Models', icon: Box },
  { id: 'kitchen', label: 'Kitchen Management', icon: ChefHat },
  { id: 'floor', label: 'Floor Management', icon: LayoutGrid },
  { id: 'tables', label: 'Table Management', icon: QrCode },
  { id: 'customers', label: 'Customers', icon: Users },
  { id: 'staff', label: 'Staff', icon: UserCheck },
  { id: 'service', label: 'Service Requests', icon: Bell },
  { id: 'messaging', label: 'Messages & Alerts', icon: MessageSquare },
  { id: 'billing', label: 'Billing', icon: Receipt },
  { id: 'payments', label: 'Payments', icon: CreditCard },
  { id: 'inventory', label: 'Inventory', icon: Package },
  { id: 'reviews', label: 'Reviews', icon: Star },
  { id: 'reservations', label: 'Reservations', icon: Calendar },
  { id: 'analytics', label: 'Analytics', icon: BarChart3 },
  { id: 'reports', label: 'Reports', icon: FileSpreadsheet },
  { id: 'settings', label: 'Restaurant Settings', icon: Settings },
];

const PIE_COLORS = ['#EA580C', '#F59E0B', '#10B981', '#0284C7', '#8B5CF6'];

export const AdminDashboard: React.FC<AdminDashboardProps> = ({
  restaurant,
  authSession,
  onRequestAuth,
  onNavigateWorkspace,
  onRestaurantUpdated,
}) => {
  const [section, setSection] = useState<AdminSection>('overview');
  const [analytics, setAnalytics] = useState<AnalyticsPayload | null>(null);
  const [orders, setOrders] = useState<OrderDTO[]>([]);
  const [categories, setCategories] = useState<MenuCategoryDTO[]>([]);
  const [menuItems, setMenuItems] = useState<MenuItemDTO[]>([]);
  const [tables, setTables] = useState<TableDTO[]>([]);
  const [invoices, setInvoices] = useState<InvoiceDTO[]>([]);
  const [payments, setPayments] = useState<PaymentDTO[]>([]);
  const [inventory, setInventory] = useState<InventoryItemDTO[]>([]);
  const [reviews, setReviews] = useState<ReviewDTO[]>([]);
  const [reservations, setReservations] = useState<ReservationDTO[]>([]);
  const [serviceRequests, setServiceRequests] = useState<ServiceRequestDTO[]>([]);
  const [staff, setStaff] = useState<StaffMemberRow[]>([]);
  const [shifts, setShifts] = useState<ShiftRow[]>([]);
  const [notifications, setNotifications] = useState<NotificationDTO[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditLogRow[]>([]);
  const [templates, setTemplates] = useState<NotificationTemplateDTO[]>([]);
  const [notifPreferences, setNotifPreferences] = useState<NotificationPreferenceDTO[]>([]);
  const [notifLogs, setNotifLogs] = useState<NotificationLogDTO[]>([]);
  const [models3d, setModels3d] = useState<Food3dModelDTO[]>([]);
  const [editingModel, setEditingModel] = useState<{
    menuItemId: number;
    modelTitle: string;
    proceduralPreset: string;
    glbUrl: string;
    usdzUrl: string;
    scaleFactor: number;
    arEnabled: boolean;
    previewNotes: string;
  } | null>(null);
  const [previewArDish, setPreviewArDish] = useState<MenuItemDTO | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [banner, setBanner] = useState('');

  // Menu Item Form
  const [newDish, setNewDish] = useState({
    categoryId: 0,
    name: '',
    description: '',
    basePriceRupees: '450',
    isVegetarian: true,
    prepTimeMinutes: 15,
  });

  // Inventory Form
  const [newIngredient, setNewIngredient] = useState({
    name: '',
    sku: '',
    category: 'Produce',
    currentStock: 10,
    unit: 'kg',
    minThreshold: 3,
    supplierName: '',
  });

  // Staff Form
  const [newStaff, setNewStaff] = useState({
    fullName: '',
    email: '',
    roleCode: 'waiter' as 'owner' | 'manager' | 'kitchen' | 'waiter' | 'cashier',
    staffTitle: '',
  });

  // Restaurant Settings Form
  const [settingsForm, setSettingsForm] = useState({
    name: restaurant.name,
    tagline: restaurant.tagline,
    description: restaurant.description,
    phone: restaurant.phone,
    address: restaurant.address,
    taxRatePercent: restaurant.taxRatePercent,
    serviceChargePercent: restaurant.serviceChargePercent,
    allowNegativeStock: restaurant.allowNegativeStock,
    cancellationRuleMinutes: restaurant.cancellationRuleMinutes,
    upiVpa: restaurant.upiVpa,
    googleReviewUrl: restaurant.googleReviewUrl,
  });

  useEffect(() => {
    setSettingsForm({
      name: restaurant.name,
      tagline: restaurant.tagline,
      description: restaurant.description,
      phone: restaurant.phone,
      address: restaurant.address,
      taxRatePercent: restaurant.taxRatePercent,
      serviceChargePercent: restaurant.serviceChargePercent,
      allowNegativeStock: restaurant.allowNegativeStock,
      cancellationRuleMinutes: restaurant.cancellationRuleMinutes,
      upiVpa: restaurant.upiVpa,
      googleReviewUrl: restaurant.googleReviewUrl,
    });
  }, [restaurant]);

  const loadDashboardData = useCallback(async () => {
    if (!authSession) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError('');
    try {
      const [menuRes, revRes] = await Promise.all([
        apiFetch<{ categories: MenuCategoryDTO[]; items: MenuItemDTO[] }>(
          `/api/restaurants/${restaurant.slug}/menu`
        ),
        apiFetch<ReviewDTO[]>(`/api/restaurants/${restaurant.slug}/reviews`),
      ]);
      setCategories(menuRes.categories);
      setMenuItems(menuRes.items);
      setReviews(revRes);
      if (menuRes.categories[0]) {
        const firstCatId = menuRes.categories[0].id;
        setNewDish((d) => (d.categoryId === 0 ? { ...d, categoryId: firstCatId } : d));
      }

      const [
        analyticsRes,
        ordersRes,
        tablesRes,
        invRes,
        payRes,
        stockRes,
        resvRes,
        srvRes,
        staffRes,
        notifRes,
        auditRes,
        tplRes,
        prefRes,
        logRes,
        modelsRes,
      ] = await Promise.all([
        apiFetch<AnalyticsPayload>(`/api/analytics/overview?restaurantId=${restaurant.id}`).catch(() => null),
        apiFetch<OrderDTO[]>(`/api/orders?restaurantId=${restaurant.id}`).catch(() => []),
        apiFetch<TableDTO[]>(`/api/tables?restaurantId=${restaurant.id}`).catch(() => []),
        apiFetch<InvoiceDTO[]>(`/api/invoices?restaurantId=${restaurant.id}`).catch(() => []),
        apiFetch<PaymentDTO[]>(`/api/payments?restaurantId=${restaurant.id}`).catch(() => []),
        apiFetch<{ items: InventoryItemDTO[] }>(`/api/inventory?restaurantId=${restaurant.id}`).catch(() => ({
          items: [],
        })),
        apiFetch<ReservationDTO[]>(`/api/reservations?restaurantId=${restaurant.id}`).catch(() => []),
        apiFetch<ServiceRequestDTO[]>(`/api/service-requests?restaurantId=${restaurant.id}`).catch(() => []),
        apiFetch<{ members: StaffMemberRow[]; shifts: ShiftRow[] }>(
          `/api/staff?restaurantId=${restaurant.id}`
        ).catch(() => ({ members: [], shifts: [] })),
        apiFetch<NotificationDTO[]>(`/api/notifications?restaurantId=${restaurant.id}`).catch(() => []),
        apiFetch<AuditLogRow[]>(`/api/audit-logs?restaurantId=${restaurant.id}`).catch(() => []),
        apiFetch<NotificationTemplateDTO[]>(`/api/communication/templates?restaurantId=${restaurant.id}`).catch(
          () => []
        ),
        apiFetch<NotificationPreferenceDTO[]>(
          `/api/notifications/preferences?restaurantId=${restaurant.id}`
        ).catch(() => []),
        apiFetch<NotificationLogDTO[]>(`/api/notifications/logs?restaurantId=${restaurant.id}`).catch(() => []),
        apiFetch<Food3dModelDTO[]>(`/api/restaurants/${restaurant.slug}/models`).catch(() => []),
      ]);

      setAnalytics(analyticsRes);
      setOrders(ordersRes);
      setTables(tablesRes);
      setInvoices(invRes);
      setPayments(payRes);
      setInventory(stockRes.items);
      setReservations(resvRes);
      setServiceRequests(srvRes);
      setStaff(staffRes.members);
      setShifts(staffRes.shifts);
      setNotifications(notifRes);
      setAuditLogs(auditRes);
      setTemplates(tplRes);
      setNotifPreferences(prefRes);
      setNotifLogs(logRes);
      setModels3d(modelsRes);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Unable to load dashboard data.');
    } finally {
      setLoading(false);
    }
  }, [authSession, restaurant.id, restaurant.slug]);

  useEffect(() => {
    loadDashboardData();
  }, [loadDashboardData]);

  useRealtimeSocket(restaurant.id, undefined, () => {
    loadDashboardData();
  });

  if (!authSession || authSession.role === 'customer') {
    return (
      <div className="min-h-[82vh] bg-[#120F0D] text-[#F5F0EB] flex items-center justify-center p-6">
        <div className="max-w-md rounded-2xl bg-[#1B1613] border border-stone-800 p-7 text-center space-y-4">
          <Shield className="w-8 h-8 text-orange-500 mx-auto" />
          <h2 className="text-xl font-display font-bold">Management Console Protected</h2>
          <p className="text-sm text-stone-400">
            Role-based access control is enforced on the server. Sign in as Owner, Manager, Cashier, or Super Admin to open the administration console.
          </p>
          <button
            type="button"
            onClick={onRequestAuth}
            className="rounded-xl bg-orange-600 px-5 py-3 text-sm font-semibold text-white hover:bg-orange-700"
          >
            Sign In / Select Role
          </button>
        </div>
      </div>
    );
  }

  const handleToggleDishAvailability = async (dish: MenuItemDTO) => {
    await apiFetch(`/api/admin/menu/items/${dish.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ isAvailable: !dish.isAvailable }),
    });
    loadDashboardData();
  };

  const handleCreateDish = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await apiFetch('/api/admin/menu/items', {
        method: 'POST',
        body: JSON.stringify({
          restaurantId: restaurant.id,
          categoryId: newDish.categoryId || categories[0]?.id,
          name: newDish.name,
          description: newDish.description,
          basePriceCents: Math.round(Number(newDish.basePriceRupees) * 100),
          isVegetarian: newDish.isVegetarian,
          prepTimeMinutes: Number(newDish.prepTimeMinutes),
        }),
      });
      setNewDish({ ...newDish, name: '', description: '' });
      setBanner('Menu dish added to catalog.');
      loadDashboardData();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to create menu item');
    }
  };

  const handleAdjustStock = async (itemId: number, delta: number, type: 'purchase' | 'adjustment') => {
    try {
      await apiFetch(`/api/inventory/${itemId}/adjust`, {
        method: 'POST',
        body: JSON.stringify({
          transactionType: type,
          quantityDelta: delta,
          note: delta > 0 ? 'Manual restock entry' : 'Kitchen adjustment',
        }),
      });
      loadDashboardData();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Stock adjustment failed');
    }
  };

  const handleAddIngredient = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await apiFetch('/api/inventory', {
        method: 'POST',
        body: JSON.stringify({
          restaurantId: restaurant.id,
          ...newIngredient,
          currentStock: Number(newIngredient.currentStock),
          minThreshold: Number(newIngredient.minThreshold),
        }),
      });
      setNewIngredient({ ...newIngredient, name: '', sku: '' });
      loadDashboardData();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to add ingredient');
    }
  };

  const handleAddStaff = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await apiFetch('/api/staff', {
        method: 'POST',
        body: JSON.stringify({ restaurantId: restaurant.id, ...newStaff }),
      });
      setNewStaff({ fullName: '', email: '', roleCode: 'waiter', staffTitle: '' });
      setBanner('Staff member added and role assigned.');
      loadDashboardData();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to add staff');
    }
  };

  const handleSaveSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const updated = await apiFetch<RestaurantDTO>(`/api/restaurants/${restaurant.id}/settings`, {
        method: 'PATCH',
        body: JSON.stringify({
          ...settingsForm,
          taxRatePercent: Number(settingsForm.taxRatePercent),
          serviceChargePercent: Number(settingsForm.serviceChargePercent),
          cancellationRuleMinutes: Number(settingsForm.cancellationRuleMinutes),
        }),
      });
      onRestaurantUpdated(updated);
      setBanner('Restaurant settings saved and synced to live website.');
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to update settings');
    }
  };

  const handleDownloadCsv = async () => {
    const res = await fetch(`/api/analytics/export.csv?restaurantId=${restaurant.id}`, {
      headers: { Authorization: `Bearer ${authSession.token}` },
    });
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${restaurant.slug}-orders-report.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const lowStockItems = inventory.filter((i) => i.currentStock <= i.minThreshold);
  const uniqueCustomers = Array.from(
    new Map(
      orders.map((o) => [
        o.customerName,
        {
          name: o.customerName,
          ordersCount: orders.filter((x) => x.customerName === o.customerName).length,
          totalSpentCents: orders
            .filter((x) => x.customerName === o.customerName && x.status !== 'Cancelled')
            .reduce((s, x) => s + x.totalCents, 0),
          lastOrder: o.createdAt,
        },
      ])
    ).values()
  );

  return (
    <div className="min-h-screen bg-[#120F0D] text-[#F5F0EB] flex flex-col lg:flex-row">
      {/* Left Sidebar (260px on Desktop) */}
      <aside className="lg:w-64 bg-[#191411] border-b lg:border-b-0 lg:border-r border-stone-800 shrink-0 p-4">
        <div className="mb-4 px-2">
          <p className="text-xs font-medium text-orange-400 truncate">{restaurant.name}</p>
          <p className="text-[11px] text-stone-400 truncate">
            {authSession.fullName} · {authSession.role}
          </p>
        </div>

        <nav className="flex lg:flex-col gap-1 overflow-x-auto lg:overflow-visible pb-2 lg:pb-0">
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            const active = section === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setSection(item.id)}
                className={`flex items-center gap-2.5 rounded-xl px-3 py-2 text-xs font-medium whitespace-nowrap shrink-0 transition-colors ${
                  active
                    ? 'bg-orange-600 text-white'
                    : 'text-stone-300 hover:bg-stone-800/80 hover:text-white'
                }`}
              >
                <Icon className="w-4 h-4 shrink-0" />
                <span>{item.label}</span>
              </button>
            );
          })}
        </nav>
      </aside>

      {/* Main Content Area */}
      <main className="flex-1 p-4 sm:p-6 lg:p-8 max-w-7xl space-y-6 overflow-x-hidden">
        {banner && (
          <div className="rounded-xl bg-emerald-950/60 border border-emerald-800 px-4 py-3 text-xs text-emerald-200 flex items-center justify-between">
            <span>{banner}</span>
            <button type="button" onClick={() => setBanner('')} className="underline">
              Dismiss
            </button>
          </div>
        )}

        {error && (
          <div className="rounded-xl bg-red-950/60 border border-red-800 px-4 py-3 text-xs text-red-200">
            {error}
          </div>
        )}

        {/* 1. OVERVIEW */}
        {section === 'overview' && (
          <div className="space-y-6">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div>
                <h1 className="text-2xl font-display font-bold tracking-tight">
                  Operations Overview
                </h1>
                <p className="text-xs text-stone-400 mt-0.5">
                  Live PostgreSQL metrics across orders, tables, revenue, and inventory.
                </p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => onNavigateWorkspace('kds')}
                  className="rounded-xl border border-stone-700 px-3.5 py-2 text-xs font-medium text-stone-200 hover:bg-stone-800"
                >
                  Open Full KDS
                </button>
                <button
                  type="button"
                  onClick={() => onNavigateWorkspace('floor')}
                  className="rounded-xl bg-orange-600 px-3.5 py-2 text-xs font-semibold text-white hover:bg-orange-700"
                >
                  Open Live Floor
                </button>
              </div>
            </div>

            {loading || !analytics ? (
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                {[1, 2, 3, 4].map((n) => (
                  <div key={n} className="h-24 rounded-2xl bg-[#1B1613] border border-stone-800 animate-pulse" />
                ))}
              </div>
            ) : (
              <>
                <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4">
                  {[
                    {
                      label: "Today's Revenue",
                      val: formatMoney(analytics.kpis.todaysRevenueCents, restaurant.currencySymbol),
                    },
                    { label: 'Total Orders', val: String(analytics.kpis.totalOrders) },
                    { label: 'Active Orders', val: String(analytics.kpis.activeOrders) },
                    {
                      label: 'Occupied / Avail',
                      val: `${analytics.kpis.occupiedTables} / ${analytics.kpis.availableTables}`,
                    },
                    {
                      label: 'Avg Order Value',
                      val: formatMoney(analytics.kpis.averageOrderValueCents, restaurant.currencySymbol),
                    },
                    { label: 'Avg Prep Time', val: `${analytics.kpis.avgPrepMinutes} min` },
                  ].map((kpi) => (
                    <div
                      key={kpi.label}
                      className="rounded-2xl bg-[#1B1613] border border-stone-800 p-4"
                    >
                      <p className="text-[11px] text-stone-400">{kpi.label}</p>
                      <p className="mt-1.5 text-xl font-bold font-mono tabular-nums text-white">
                        {kpi.val}
                      </p>
                    </div>
                  ))}
                </div>

                {/* Revenue & Popular Dishes */}
                <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
                  <div className="lg:col-span-7 rounded-2xl bg-[#1B1613] border border-stone-800 p-5">
                    <h2 className="text-sm font-semibold mb-4">7-Day Revenue ({restaurant.currencyCode})</h2>
                    <div className="h-64">
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={analytics.dailyRevenue}>
                          <CartesianGrid strokeDasharray="3 3" stroke="#292524" />
                          <XAxis dataKey="date" stroke="#A8A29E" fontSize={11} />
                          <YAxis stroke="#A8A29E" fontSize={11} />
                          <Tooltip
                            contentStyle={{
                              backgroundColor: '#191411',
                              borderColor: '#44403C',
                              color: '#F5F0EB',
                              fontSize: 12,
                            }}
                          />
                          <Bar dataKey="revenue" fill="#EA580C" radius={[6, 6, 0, 0]} />
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                  </div>

                  <div className="lg:col-span-5 rounded-2xl bg-[#1B1613] border border-stone-800 p-5 space-y-4">
                    <h2 className="text-sm font-semibold">Popular Dishes &amp; Low Stock Alerts</h2>
                    <div className="space-y-2.5">
                      {analytics.popularDishes.slice(0, 5).map((d) => (
                        <div key={d.name} className="flex items-center justify-between text-xs border-b border-stone-800/80 pb-2">
                          <span className="text-stone-200 truncate pr-2">{d.name}</span>
                          <span className="font-mono tabular-nums text-orange-400 shrink-0">
                            {d.count} sold
                          </span>
                        </div>
                      ))}
                    </div>

                    {lowStockItems.length > 0 && (
                      <div className="rounded-xl bg-amber-950/50 border border-amber-800/70 p-3 text-xs text-amber-200 flex items-start gap-2">
                        <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                        <span>
                          Low stock: {lowStockItems.map((i) => `${i.name} (${i.currentStock} ${i.unit})`).join(', ')}
                        </span>
                      </div>
                    )}
                  </div>
                </div>

                {/* Live Activity & Recent Transactions */}
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                  <div className="rounded-2xl bg-[#1B1613] border border-stone-800 p-5 space-y-3">
                    <h2 className="text-sm font-semibold">Live Restaurant Notifications</h2>
                    <div className="space-y-2.5 max-h-60 overflow-y-auto">
                      {notifications.slice(0, 8).map((n) => (
                        <div key={n.id} className="text-xs border-b border-stone-800/70 pb-2">
                          <p className="font-semibold text-stone-100">{n.title}</p>
                          <p className="text-stone-400 mt-0.5">{n.message}</p>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="rounded-2xl bg-[#1B1613] border border-stone-800 p-5 space-y-3">
                    <h2 className="text-sm font-semibold">Recent Verified Transactions</h2>
                    <div className="space-y-2.5 max-h-60 overflow-y-auto">
                      {analytics.recentTransactions.map((p) => (
                        <div key={p.id} className="flex items-center justify-between text-xs border-b border-stone-800/70 pb-2">
                          <div>
                            <p className="font-medium text-stone-100">{p.paymentMethod}</p>
                            <p className="text-stone-500 font-mono">{p.providerPaymentId || p.providerOrderId}</p>
                          </div>
                          <div className="text-right">
                            <p className="font-mono tabular-nums font-semibold text-emerald-400">
                              {formatMoney(p.amountCents, restaurant.currencySymbol)}
                            </p>
                            <p className="text-[11px] text-stone-400">{p.status}</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </>
            )}
          </div>
        )}

        {/* 1B. AI RESTAURANT OWNER ASSISTANT */}
        {section === 'ai_assistant' && <OwnerAiAssistant restaurant={restaurant} />}

        {/* 2. ORDERS */}
        {section === 'orders' && (
          <div className="space-y-4">
            <h1 className="text-2xl font-display font-bold">Order History &amp; Live Dispatch</h1>
            <div className="rounded-2xl bg-[#1B1613] border border-stone-800 overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="border-b border-stone-800 text-stone-400">
                  <tr>
                    <th className="py-3 px-4">Order</th>
                    <th className="py-3 px-4">Table</th>
                    <th className="py-3 px-4">Guest</th>
                    <th className="py-3 px-4">Items</th>
                    <th className="py-3 px-4">Status</th>
                    <th className="py-3 px-4 text-right">Total</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-stone-800/80">
                  {orders.map((o) => (
                    <tr key={o.id} className="hover:bg-stone-900/50">
                      <td className="py-3 px-4 font-mono font-semibold text-white">{o.orderNumber}</td>
                      <td className="py-3 px-4">{o.tableNumber}</td>
                      <td className="py-3 px-4">{o.customerName}</td>
                      <td className="py-3 px-4 text-stone-400">
                        {o.items.map((i) => `${i.quantity}× ${i.itemName}`).join(', ')}
                      </td>
                      <td className="py-3 px-4 text-orange-400 font-medium">{o.status}</td>
                      <td className="py-3 px-4 text-right font-mono tabular-nums font-semibold">
                        {formatMoney(o.totalCents, restaurant.currencySymbol)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* 3. MENU MANAGEMENT */}
        {section === 'menu' && (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
            <div className="lg:col-span-8 space-y-4">
              <h1 className="text-2xl font-display font-bold">Menu Catalog ({menuItems.length})</h1>
              <div className="space-y-3">
                {menuItems.map((dish) => (
                  <div
                    key={dish.id}
                    className="flex items-center justify-between gap-4 rounded-2xl bg-[#1B1613] border border-stone-800 p-4"
                  >
                    <div>
                      <p className="text-sm font-semibold text-white">{dish.name}</p>
                      <p className="text-xs text-stone-400 mt-0.5">
                        {formatMoney(dish.basePriceCents, restaurant.currencySymbol)} ·{' '}
                        {dish.isVegetarian ? 'Veg' : 'Non-Veg'} · {dish.prepTimeMinutes}m ·{' '}
                        {dish.isAvailable ? 'Available' : 'Sold Out'}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleToggleDishAvailability(dish)}
                      className={`rounded-xl px-3.5 py-2 text-xs font-semibold shrink-0 ${
                        dish.isAvailable
                          ? 'bg-emerald-900/50 text-emerald-300 border border-emerald-700'
                          : 'bg-red-900/50 text-red-300 border border-red-700'
                      }`}
                    >
                      {dish.isAvailable ? 'Mark Sold Out' : 'Mark Available'}
                    </button>
                  </div>
                ))}
              </div>
            </div>

            <form
              onSubmit={handleCreateDish}
              className="lg:col-span-4 rounded-2xl bg-[#1B1613] border border-stone-800 p-5 space-y-3.5"
            >
              <h2 className="text-base font-semibold">Add Menu Item</h2>
              <select
                value={newDish.categoryId}
                onChange={(e) => setNewDish({ ...newDish, categoryId: Number(e.target.value) })}
                className="w-full rounded-xl bg-[#120F0D] border border-stone-800 px-3 py-2.5 text-xs"
              >
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
              <input
                required
                placeholder="Dish Name"
                value={newDish.name}
                onChange={(e) => setNewDish({ ...newDish, name: e.target.value })}
                className="w-full rounded-xl bg-[#120F0D] border border-stone-800 px-3 py-2.5 text-xs"
              />
              <textarea
                required
                rows={3}
                placeholder="Description & key ingredients"
                value={newDish.description}
                onChange={(e) => setNewDish({ ...newDish, description: e.target.value })}
                className="w-full rounded-xl bg-[#120F0D] border border-stone-800 px-3 py-2.5 text-xs"
              />
              <div className="grid grid-cols-2 gap-2">
                <input
                  required
                  type="number"
                  placeholder="Price (INR)"
                  value={newDish.basePriceRupees}
                  onChange={(e) => setNewDish({ ...newDish, basePriceRupees: e.target.value })}
                  className="rounded-xl bg-[#120F0D] border border-stone-800 px-3 py-2.5 text-xs"
                />
                <input
                  required
                  type="number"
                  placeholder="Prep mins"
                  value={newDish.prepTimeMinutes}
                  onChange={(e) => setNewDish({ ...newDish, prepTimeMinutes: Number(e.target.value) })}
                  className="rounded-xl bg-[#120F0D] border border-stone-800 px-3 py-2.5 text-xs"
                />
              </div>
              <label className="flex items-center gap-2 text-xs text-stone-300">
                <input
                  type="checkbox"
                  checked={newDish.isVegetarian}
                  onChange={(e) => setNewDish({ ...newDish, isVegetarian: e.target.checked })}
                />
                Vegetarian Dish
              </label>
              <button
                type="submit"
                className="w-full rounded-xl bg-orange-600 py-2.5 text-xs font-semibold text-white hover:bg-orange-700"
              >
                Save Dish to Menu
              </button>
            </form>
          </div>
        )}

        {/* 3B. 3D & AR DISH MODEL MANAGER */}
        {section === 'models_3d' && (
          <div className="space-y-6">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div>
                <h1 className="text-2xl font-display font-bold">3D &amp; AR Food Preview Studio</h1>
                <p className="text-xs text-stone-400 mt-0.5">
                  Configure procedural 3D dish geometries or attach custom GLB / USDZ models per menu item.
                </p>
              </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
              <div className="lg:col-span-7 space-y-3">
                {menuItems.map((dish) => {
                  const model = models3d.find((m) => m.menuItemId === dish.id);
                  return (
                    <div
                      key={dish.id}
                      className="rounded-2xl bg-[#1B1613] border border-stone-800 p-4 flex flex-wrap items-center justify-between gap-4"
                    >
                      <div>
                        <p className="text-sm font-semibold text-white">{dish.name}</p>
                        <p className="text-xs text-stone-400 mt-0.5">
                          Preset:{' '}
                          <span className="font-mono text-orange-400">
                            {model?.proceduralPreset || dish.imageKey}
                          </span>{' '}
                          · Scale: {model?.scaleFactor ?? 1}x ·{' '}
                          {model?.arEnabled === false ? 'AR Disabled' : 'AR Enabled'}
                          {model?.glbUrl && ' · Custom GLB Attached'}
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => setPreviewArDish(dish)}
                          className="inline-flex items-center gap-1 rounded-xl border border-stone-700 px-3 py-1.5 text-xs font-medium text-stone-200 hover:bg-stone-800"
                        >
                          <Eye className="w-3.5 h-3.5 text-orange-400" />
                          Preview
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            setEditingModel({
                              menuItemId: dish.id,
                              modelTitle: model?.modelTitle || dish.name,
                              proceduralPreset: model?.proceduralPreset || dish.imageKey || 'generic_plate',
                              glbUrl: model?.glbUrl || '',
                              usdzUrl: model?.usdzUrl || '',
                              scaleFactor: model?.scaleFactor ?? 1,
                              arEnabled: model?.arEnabled ?? true,
                              previewNotes: model?.previewNotes || '',
                            })
                          }
                          className="rounded-xl bg-orange-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-orange-700"
                        >
                          Configure
                        </button>
                        {model && (
                          <button
                            type="button"
                            onClick={async () => {
                              await apiFetch(`/api/admin/models/${dish.id}`, { method: 'DELETE' });
                              setBanner(`Removed custom 3D configuration for ${dish.name}.`);
                              loadDashboardData();
                            }}
                            className="p-1.5 rounded-lg border border-stone-700 text-stone-400 hover:text-red-400"
                            title="Reset / Remove 3D model config"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>

              <div className="lg:col-span-5 rounded-2xl bg-[#1B1613] border border-stone-800 p-5 space-y-4">
                {editingModel ? (
                  <form
                    onSubmit={async (e) => {
                      e.preventDefault();
                      try {
                        await apiFetch('/api/admin/models', {
                          method: 'POST',
                          body: JSON.stringify({
                            restaurantId: restaurant.id,
                            ...editingModel,
                            scaleFactor: Number(editingModel.scaleFactor),
                          }),
                        });
                        setBanner(`Saved 3D/AR model configuration for ${editingModel.modelTitle}.`);
                        setEditingModel(null);
                        loadDashboardData();
                      } catch (err: unknown) {
                        setError(err instanceof Error ? err.message : 'Failed to save 3D model');
                      }
                    }}
                    className="space-y-3"
                  >
                    <h2 className="text-base font-semibold">Edit Dish 3D / AR Asset</h2>
                    <input
                      required
                      value={editingModel.modelTitle}
                      onChange={(e) => setEditingModel({ ...editingModel, modelTitle: e.target.value })}
                      placeholder="Display Title"
                      className="w-full rounded-xl bg-[#120F0D] border border-stone-800 px-3 py-2 text-xs"
                    />
                    <div>
                      <label className="block text-[11px] text-stone-400 mb-1">
                        Procedural Studio Preset (Fallback / Default)
                      </label>
                      <select
                        value={editingModel.proceduralPreset}
                        onChange={(e) =>
                          setEditingModel({ ...editingModel, proceduralPreset: e.target.value })
                        }
                        className="w-full rounded-xl bg-[#120F0D] border border-stone-800 px-3 py-2 text-xs"
                      >
                        <option value="truffle_flatbread">Truffle Flatbread</option>
                        <option value="pepperoni_flatbread">Charred Pepperoni Flatbread</option>
                        <option value="burrata_fig">Burrata &amp; Fig Plate</option>
                        <option value="lamb_chops">Wood-Fired Lamb Chops</option>
                        <option value="salmon_bowl">Cedar Salmon Rice Bowl</option>
                        <option value="saffron_risotto">Saffron Hearth Risotto</option>
                        <option value="hazelnut_torte">Chocolate Hazelnut Torte</option>
                        <option value="orange_tonic">Blood Orange Botanical Tonic</option>
                        <option value="saffron_brew">Saffron Cold Brew</option>
                        <option value="generic_plate">Artisanal Ceramic Plate</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-[11px] text-stone-400 mb-1">
                        Optional Custom .GLB / .GLTF URL or Local Upload (max 2MB)
                      </label>
                      <input
                        value={editingModel.glbUrl}
                        onChange={(e) => setEditingModel({ ...editingModel, glbUrl: e.target.value })}
                        placeholder="https://.../dish.glb (leave empty to use procedural 3D)"
                        className="w-full rounded-xl bg-[#120F0D] border border-stone-800 px-3 py-2 text-xs font-mono"
                      />
                      <input
                        type="file"
                        accept=".glb,.gltf"
                        onChange={(e) => {
                          const file = e.target.files?.[0];
                          if (!file) return;
                          if (file.size > 2_000_000) {
                            setError('GLB file must be under 2MB.');
                            return;
                          }
                          const reader = new FileReader();
                          reader.onload = () => {
                            if (typeof reader.result === 'string') {
                              setEditingModel({ ...editingModel, glbUrl: reader.result });
                            }
                          };
                          reader.readAsDataURL(file);
                        }}
                        className="mt-2 block w-full text-[11px] text-stone-400"
                      />
                    </div>
                    <input
                      value={editingModel.usdzUrl}
                      onChange={(e) => setEditingModel({ ...editingModel, usdzUrl: e.target.value })}
                      placeholder="Optional iOS Quick Look .usdz URL"
                      className="w-full rounded-xl bg-[#120F0D] border border-stone-800 px-3 py-2 text-xs font-mono"
                    />
                    <div className="grid grid-cols-2 gap-3 items-center">
                      <div>
                        <label className="block text-[11px] text-stone-400 mb-1">Scale Factor</label>
                        <input
                          type="number"
                          step="0.1"
                          min="0.3"
                          max="2.5"
                          value={editingModel.scaleFactor}
                          onChange={(e) =>
                            setEditingModel({ ...editingModel, scaleFactor: Number(e.target.value) })
                          }
                          className="w-full rounded-xl bg-[#120F0D] border border-stone-800 px-3 py-2 text-xs font-mono"
                        />
                      </div>
                      <label className="flex items-center gap-2 text-xs text-stone-300 pt-4">
                        <input
                          type="checkbox"
                          checked={editingModel.arEnabled}
                          onChange={(e) =>
                            setEditingModel({ ...editingModel, arEnabled: e.target.checked })
                          }
                        />
                        AR Preview Enabled
                      </label>
                    </div>
                    <input
                      value={editingModel.previewNotes}
                      onChange={(e) => setEditingModel({ ...editingModel, previewNotes: e.target.value })}
                      placeholder="Customer preview note (e.g., 10-inch hand-stretched sourdough)"
                      className="w-full rounded-xl bg-[#120F0D] border border-stone-800 px-3 py-2 text-xs"
                    />
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => setEditingModel(null)}
                        className="rounded-xl border border-stone-700 px-4 py-2 text-xs text-stone-300"
                      >
                        Cancel
                      </button>
                      <button
                        type="submit"
                        className="flex-1 rounded-xl bg-orange-600 py-2 text-xs font-semibold text-white hover:bg-orange-700"
                      >
                        Save 3D Model Settings
                      </button>
                    </div>
                  </form>
                ) : (
                  <p className="text-xs text-stone-400">
                    Select &ldquo;Configure&rdquo; on any dish to customize its 3D plate model, upload a `.glb` asset, adjust portion scale, or toggle AR availability.
                  </p>
                )}
              </div>
            </div>
          </div>
        )}

        {/* 4 & 5. KITCHEN & FLOOR SHORTCUT VIEWS */}
        {(section === 'kitchen' || section === 'floor') && (
          <div className="rounded-2xl bg-[#1B1613] border border-stone-800 p-8 space-y-4">
            <h1 className="text-2xl font-display font-bold">
              {section === 'kitchen' ? 'Kitchen Display Operations' : 'Live Floor Operations'}
            </h1>
            <p className="text-sm text-stone-400">
              {section === 'kitchen'
                ? `${orders.filter((o) => ['Pending', 'Accepted', 'Cooking'].includes(o.status)).length} active kitchen tickets currently in queue.`
                : `${tables.filter((t) => t.status !== 'Available').length} of ${tables.length} tables currently active.`}
            </p>
            <button
              type="button"
              onClick={() => onNavigateWorkspace(section === 'kitchen' ? 'kds' : 'floor')}
              className="rounded-xl bg-orange-600 px-5 py-3 text-sm font-semibold text-white hover:bg-orange-700"
            >
              Launch Full {section === 'kitchen' ? 'Kitchen Display System' : 'Interactive Floor Map'}
            </button>
          </div>
        )}

        {/* 6. TABLE MANAGEMENT */}
        {section === 'tables' && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h1 className="text-2xl font-display font-bold">Tables &amp; QR Security</h1>
              <button
                type="button"
                onClick={() => onNavigateWorkspace('floor')}
                className="rounded-xl bg-orange-600 px-4 py-2 text-xs font-semibold text-white"
              >
                Manage Floor &amp; QR Codes
              </button>
            </div>
            <div className="rounded-2xl bg-[#1B1613] border border-stone-800 overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="border-b border-stone-800 text-stone-400">
                  <tr>
                    <th className="py-3 px-4">Table</th>
                    <th className="py-3 px-4">Zone</th>
                    <th className="py-3 px-4">Capacity</th>
                    <th className="py-3 px-4">Status</th>
                    <th className="py-3 px-4">QR Token</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-stone-800/80">
                  {tables.map((t) => (
                    <tr key={t.id}>
                      <td className="py-3 px-4 font-semibold text-white">
                        {t.tableNumber} · {t.label}
                      </td>
                      <td className="py-3 px-4">{t.zone}</td>
                      <td className="py-3 px-4 font-mono tabular-nums">{t.capacity}</td>
                      <td className="py-3 px-4 text-orange-400">{t.status}</td>
                      <td className="py-3 px-4 font-mono text-stone-400">
                        v{t.qrVersion} · {t.qrToken.slice(0, 12)}...
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* 7. CUSTOMERS */}
        {section === 'customers' && (
          <div className="space-y-4">
            <h1 className="text-2xl font-display font-bold">Customer Directory</h1>
            <div className="rounded-2xl bg-[#1B1613] border border-stone-800 overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="border-b border-stone-800 text-stone-400">
                  <tr>
                    <th className="py-3 px-4">Guest Name</th>
                    <th className="py-3 px-4">Orders</th>
                    <th className="py-3 px-4 text-right">Lifetime Spend</th>
                    <th className="py-3 px-4 text-right">Last Visit</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-stone-800/80">
                  {uniqueCustomers.map((c) => (
                    <tr key={c.name}>
                      <td className="py-3 px-4 font-semibold text-white">{c.name}</td>
                      <td className="py-3 px-4 font-mono tabular-nums">{c.ordersCount}</td>
                      <td className="py-3 px-4 text-right font-mono tabular-nums">
                        {formatMoney(c.totalSpentCents, restaurant.currencySymbol)}
                      </td>
                      <td className="py-3 px-4 text-right text-stone-400 font-mono">
                        {new Date(c.lastOrder).toLocaleDateString()}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* 8. STAFF & SHIFTS */}
        {section === 'staff' && (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
            <div className="lg:col-span-8 space-y-4">
              <h1 className="text-2xl font-display font-bold">Staff &amp; Role Access</h1>
              <div className="rounded-2xl bg-[#1B1613] border border-stone-800 overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="border-b border-stone-800 text-stone-400">
                    <tr>
                      <th className="py-3 px-4">Name</th>
                      <th className="py-3 px-4">Email</th>
                      <th className="py-3 px-4">Role</th>
                      <th className="py-3 px-4">Title</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-stone-800/80">
                    {staff.map((m) => (
                      <tr key={m.id}>
                        <td className="py-3 px-4 font-semibold text-white">{m.fullName}</td>
                        <td className="py-3 px-4 text-stone-400">{m.email}</td>
                        <td className="py-3 px-4 text-orange-400 font-medium">{m.roleCode}</td>
                        <td className="py-3 px-4">{m.staffTitle}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <h2 className="text-base font-semibold pt-2">Today&apos;s Shifts ({shifts.length})</h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {shifts.map((s) => (
                  <div key={s.id} className="rounded-xl bg-[#1B1613] border border-stone-800 p-3.5 text-xs">
                    <p className="font-semibold text-white">{s.station}</p>
                    <p className="text-stone-400 font-mono mt-1">
                      {s.shiftDate} · {s.startTime} – {s.endTime}
                    </p>
                  </div>
                ))}
              </div>
            </div>

            <form
              onSubmit={handleAddStaff}
              className="lg:col-span-4 rounded-2xl bg-[#1B1613] border border-stone-800 p-5 space-y-3"
            >
              <h2 className="text-base font-semibold">Add Team Member</h2>
              <input
                required
                placeholder="Full Name"
                value={newStaff.fullName}
                onChange={(e) => setNewStaff({ ...newStaff, fullName: e.target.value })}
                className="w-full rounded-xl bg-[#120F0D] border border-stone-800 px-3 py-2.5 text-xs"
              />
              <input
                required
                type="email"
                placeholder="Work Email"
                value={newStaff.email}
                onChange={(e) => setNewStaff({ ...newStaff, email: e.target.value })}
                className="w-full rounded-xl bg-[#120F0D] border border-stone-800 px-3 py-2.5 text-xs"
              />
              <select
                value={newStaff.roleCode}
                onChange={(e) =>
                  setNewStaff({
                    ...newStaff,
                    roleCode: e.target.value as typeof newStaff.roleCode,
                  })
                }
                className="w-full rounded-xl bg-[#120F0D] border border-stone-800 px-3 py-2.5 text-xs"
              >
                <option value="manager">Manager</option>
                <option value="kitchen">Kitchen Staff</option>
                <option value="waiter">Waiter</option>
                <option value="cashier">Cashier</option>
                <option value="owner">Owner</option>
              </select>
              <input
                required
                placeholder="Title (e.g., Sous Chef)"
                value={newStaff.staffTitle}
                onChange={(e) => setNewStaff({ ...newStaff, staffTitle: e.target.value })}
                className="w-full rounded-xl bg-[#120F0D] border border-stone-800 px-3 py-2.5 text-xs"
              />
              <button
                type="submit"
                className="w-full rounded-xl bg-orange-600 py-2.5 text-xs font-semibold text-white hover:bg-orange-700"
              >
                Invite &amp; Assign Role
              </button>
            </form>
          </div>
        )}

        {/* 9. SERVICE REQUESTS */}
        {section === 'service' && (
          <div className="space-y-4">
            <h1 className="text-2xl font-display font-bold">Service Request Log</h1>
            <div className="space-y-2.5">
              {serviceRequests.map((sr) => (
                <div
                  key={sr.id}
                  className="flex items-center justify-between rounded-2xl bg-[#1B1613] border border-stone-800 p-4 text-xs"
                >
                  <div>
                    <p className="font-semibold text-white">
                      {sr.tableNumber} · {sr.requestType}
                    </p>
                    <p className="text-stone-400 mt-0.5">{sr.customMessage || 'Standard table request'}</p>
                  </div>
                  <span className="text-orange-400 font-semibold">{sr.status}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* 9B. CUSTOMER MESSAGING TEMPLATES & SMART NOTIFICATIONS */}
        {section === 'messaging' && (
          <div className="space-y-6">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div>
                <h1 className="text-2xl font-display font-bold">
                  Customer Messaging &amp; Smart Notification Engine
                </h1>
                <p className="text-xs text-stone-400 mt-0.5">
                  Customize dynamic lifecycle templates, configure role delivery channels, and audit message dispatch logs.
                </p>
              </div>
              <button
                type="button"
                onClick={async () => {
                  const res = await apiFetch<{ alertsTriggered: number }>('/api/notifications/check-delays', {
                    method: 'POST',
                    body: JSON.stringify({ restaurantId: restaurant.id }),
                  });
                  setBanner(`Checked active kitchen tickets: ${res.alertsTriggered} delay alert(s) triggered.`);
                  loadDashboardData();
                }}
                className="rounded-xl bg-orange-600 px-4 py-2.5 text-xs font-semibold text-white hover:bg-orange-700"
              >
                Check Order Delays Now
              </button>
            </div>

            {/* Dynamic Templates */}
            <div className="space-y-3">
              <h2 className="text-base font-semibold">
                Personalized Lifecycle Templates (Supports{' '}
                <code className="text-orange-400">{'{{restaurant_name}}'}</code>,{' '}
                <code className="text-orange-400">{'{{table_number}}'}</code>,{' '}
                <code className="text-orange-400">{'{{order_id}}'}</code>,{' '}
                <code className="text-orange-400">{'{{customer_name}}'}</code>,{' '}
                <code className="text-orange-400">{'{{estimated_time}}'}</code>,{' '}
                <code className="text-orange-400">{'{{payment_amount}}'}</code>)
              </h2>
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                {templates.map((tpl) => (
                  <div key={tpl.id} className="rounded-2xl bg-[#1B1613] border border-stone-800 p-4 space-y-2.5">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-mono font-bold text-orange-400">{tpl.eventKey}</span>
                      <label className="flex items-center gap-1.5 text-xs text-stone-300">
                        <input
                          type="checkbox"
                          checked={tpl.isEnabled}
                          onChange={async (e) => {
                            await apiFetch(`/api/communication/templates/${tpl.eventKey}`, {
                              method: 'PATCH',
                              body: JSON.stringify({
                                restaurantId: restaurant.id,
                                isEnabled: e.target.checked,
                              }),
                            });
                            loadDashboardData();
                          }}
                        />
                        Enabled
                      </label>
                    </div>
                    <input
                      defaultValue={tpl.title}
                      onBlur={async (e) => {
                        if (e.target.value === tpl.title) return;
                        await apiFetch(`/api/communication/templates/${tpl.eventKey}`, {
                          method: 'PATCH',
                          body: JSON.stringify({ restaurantId: restaurant.id, title: e.target.value }),
                        });
                        setBanner(`Updated title for ${tpl.eventKey}.`);
                      }}
                      className="w-full rounded-xl bg-[#120F0D] border border-stone-800 px-3 py-2 text-xs font-semibold text-white"
                    />
                    <textarea
                      rows={2}
                      defaultValue={tpl.messageBody}
                      onBlur={async (e) => {
                        if (e.target.value === tpl.messageBody) return;
                        await apiFetch(`/api/communication/templates/${tpl.eventKey}`, {
                          method: 'PATCH',
                          body: JSON.stringify({
                            restaurantId: restaurant.id,
                            messageBody: e.target.value,
                          }),
                        });
                        setBanner(`Updated template message for ${tpl.eventKey}.`);
                      }}
                      className="w-full rounded-xl bg-[#120F0D] border border-stone-800 px-3 py-2 text-xs text-stone-300"
                    />
                  </div>
                ))}
              </div>
            </div>

            {/* Role Preferences */}
            <div className="space-y-3">
              <h2 className="text-base font-semibold">
                Role Delivery Preferences (External SMS/WhatsApp/Email require provider credentials; logged honestly otherwise)
              </h2>
              <div className="rounded-2xl bg-[#1B1613] border border-stone-800 overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="border-b border-stone-800 text-stone-400">
                    <tr>
                      <th className="py-3 px-4">Role</th>
                      <th className="py-3 px-4">In-App</th>
                      <th className="py-3 px-4">Browser Push</th>
                      <th className="py-3 px-4">SMS</th>
                      <th className="py-3 px-4">WhatsApp</th>
                      <th className="py-3 px-4">Email</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-stone-800/80">
                    {notifPreferences.map((pref) => (
                      <tr key={pref.id}>
                        <td className="py-3 px-4 font-semibold text-orange-400 capitalize">
                          {pref.targetRole}
                        </td>
                        {(
                          [
                            'inAppEnabled',
                            'browserPushEnabled',
                            'smsEnabled',
                            'whatsappEnabled',
                            'emailEnabled',
                          ] as const
                        ).map((field) => (
                          <td key={field} className="py-3 px-4">
                            <input
                              type="checkbox"
                              checked={pref[field]}
                              onChange={async (e) => {
                                await apiFetch(`/api/notifications/preferences/${pref.targetRole}`, {
                                  method: 'PATCH',
                                  body: JSON.stringify({
                                    restaurantId: restaurant.id,
                                    [field]: e.target.checked,
                                  }),
                                });
                                loadDashboardData();
                              }}
                            />
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Audit Logs */}
            <div className="space-y-3">
              <h2 className="text-base font-semibold">Recent Notification Delivery Audit Log ({notifLogs.length})</h2>
              <div className="rounded-2xl bg-[#1B1613] border border-stone-800 overflow-x-auto max-h-80 overflow-y-auto">
                <table className="w-full text-left text-xs">
                  <thead className="border-b border-stone-800 text-stone-400">
                    <tr>
                      <th className="py-3 px-4">Event</th>
                      <th className="py-3 px-4">Recipient</th>
                      <th className="py-3 px-4">Channel</th>
                      <th className="py-3 px-4">Status</th>
                      <th className="py-3 px-4">Rendered Message</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-stone-800/80">
                    {notifLogs.slice(0, 25).map((lg) => (
                      <tr key={lg.id}>
                        <td className="py-2.5 px-4 font-mono text-orange-400">{lg.eventKey}</td>
                        <td className="py-2.5 px-4">{lg.recipientRole}</td>
                        <td className="py-2.5 px-4 font-mono">{lg.channel}</td>
                        <td className="py-2.5 px-4 text-emerald-400 font-mono">{lg.deliveryStatus}</td>
                        <td className="py-2.5 px-4 text-stone-300 max-w-md truncate">{lg.renderedMessage}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* 10. BILLING */}
        {section === 'billing' && (
          <div className="space-y-4">
            <h1 className="text-2xl font-display font-bold">Digital Invoices</h1>
            <div className="rounded-2xl bg-[#1B1613] border border-stone-800 overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="border-b border-stone-800 text-stone-400">
                  <tr>
                    <th className="py-3 px-4">Invoice #</th>
                    <th className="py-3 px-4">Status</th>
                    <th className="py-3 px-4 text-right">Total</th>
                    <th className="py-3 px-4 text-right">Receipt</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-stone-800/80">
                  {invoices.map((inv) => (
                    <tr key={inv.id}>
                      <td className="py-3 px-4 font-mono text-white">{inv.invoiceNumber}</td>
                      <td className="py-3 px-4 font-semibold text-orange-400">{inv.status}</td>
                      <td className="py-3 px-4 text-right font-mono tabular-nums">
                        {formatMoney(inv.totalCents, restaurant.currencySymbol)}
                      </td>
                      <td className="py-3 px-4 text-right">
                        <button
                          type="button"
                          onClick={() => downloadInvoicePdf(inv, restaurant)}
                          className="inline-flex items-center gap-1 text-orange-400 hover:underline"
                        >
                          <Download className="w-3.5 h-3.5" />
                          PDF
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* 11. PAYMENTS */}
        {section === 'payments' && (
          <div className="space-y-4">
            <h1 className="text-2xl font-display font-bold">Payments &amp; Reconciliation</h1>
            <div className="rounded-2xl bg-[#1B1613] border border-stone-800 overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="border-b border-stone-800 text-stone-400">
                  <tr>
                    <th className="py-3 px-4">Gateway Order ID</th>
                    <th className="py-3 px-4">Method</th>
                    <th className="py-3 px-4">HMAC Verified</th>
                    <th className="py-3 px-4">Status</th>
                    <th className="py-3 px-4 text-right">Amount</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-stone-800/80">
                  {payments.map((p) => (
                    <tr key={p.id}>
                      <td className="py-3 px-4 font-mono text-white">{p.providerOrderId}</td>
                      <td className="py-3 px-4">{p.paymentMethod}</td>
                      <td className="py-3 px-4">{p.webhookVerified ? 'Verified' : 'Pending'}</td>
                      <td className="py-3 px-4 text-emerald-400">{p.status}</td>
                      <td className="py-3 px-4 text-right font-mono tabular-nums">
                        {formatMoney(p.amountCents, restaurant.currencySymbol)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* 12. INVENTORY */}
        {section === 'inventory' && (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
            <div className="lg:col-span-8 space-y-4">
              <h1 className="text-2xl font-display font-bold">Inventory &amp; Stock Control</h1>
              <div className="space-y-3">
                {inventory.map((item) => {
                  const low = item.currentStock <= item.minThreshold;
                  return (
                    <div
                      key={item.id}
                      className={`rounded-2xl bg-[#1B1613] border p-4 flex flex-wrap items-center justify-between gap-4 ${
                        low ? 'border-amber-600/80' : 'border-stone-800'
                      }`}
                    >
                      <div>
                        <p className="text-sm font-semibold text-white">
                          {item.name} <span className="text-xs font-mono text-stone-400">({item.sku})</span>
                        </p>
                        <p className="text-xs text-stone-400 mt-0.5">
                          Stock:{' '}
                          <span className="font-mono tabular-nums font-bold text-white">
                            {item.currentStock} {item.unit}
                          </span>{' '}
                          · Min {item.minThreshold} {item.unit}
                          {low && ' · LOW STOCK ALERT'}
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => handleAdjustStock(item.id, 5, 'purchase')}
                          className="rounded-lg bg-emerald-800/70 px-3 py-1.5 text-xs font-medium text-emerald-100 hover:bg-emerald-700"
                        >
                          +5 Restock
                        </button>
                        <button
                          type="button"
                          onClick={() => handleAdjustStock(item.id, -1, 'adjustment')}
                          className="rounded-lg bg-stone-800 px-3 py-1.5 text-xs font-medium text-stone-200 hover:bg-stone-700"
                        >
                          -1 Adjust
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            <form
              onSubmit={handleAddIngredient}
              className="lg:col-span-4 rounded-2xl bg-[#1B1613] border border-stone-800 p-5 space-y-3"
            >
              <h2 className="text-base font-semibold flex items-center gap-2">
                <Plus className="w-4 h-4 text-orange-500" />
                Add Ingredient
              </h2>
              <input
                required
                placeholder="Ingredient Name"
                value={newIngredient.name}
                onChange={(e) => setNewIngredient({ ...newIngredient, name: e.target.value })}
                className="w-full rounded-xl bg-[#120F0D] border border-stone-800 px-3 py-2 text-xs"
              />
              <div className="grid grid-cols-2 gap-2">
                <input
                  required
                  placeholder="SKU (INV-009)"
                  value={newIngredient.sku}
                  onChange={(e) => setNewIngredient({ ...newIngredient, sku: e.target.value })}
                  className="rounded-xl bg-[#120F0D] border border-stone-800 px-3 py-2 text-xs"
                />
                <input
                  required
                  placeholder="Unit (kg/L/pcs)"
                  value={newIngredient.unit}
                  onChange={(e) => setNewIngredient({ ...newIngredient, unit: e.target.value })}
                  className="rounded-xl bg-[#120F0D] border border-stone-800 px-3 py-2 text-xs"
                />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <input
                  required
                  type="number"
                  step="0.1"
                  placeholder="Initial Stock"
                  value={newIngredient.currentStock}
                  onChange={(e) =>
                    setNewIngredient({ ...newIngredient, currentStock: Number(e.target.value) })
                  }
                  className="rounded-xl bg-[#120F0D] border border-stone-800 px-3 py-2 text-xs"
                />
                <input
                  required
                  type="number"
                  step="0.1"
                  placeholder="Min Threshold"
                  value={newIngredient.minThreshold}
                  onChange={(e) =>
                    setNewIngredient({ ...newIngredient, minThreshold: Number(e.target.value) })
                  }
                  className="rounded-xl bg-[#120F0D] border border-stone-800 px-3 py-2 text-xs"
                />
              </div>
              <button
                type="submit"
                className="w-full rounded-xl bg-orange-600 py-2.5 text-xs font-semibold text-white hover:bg-orange-700"
              >
                Save Ingredient
              </button>
            </form>
          </div>
        )}

        {/* 13. REVIEWS */}
        {section === 'reviews' && (
          <div className="space-y-4">
            <h1 className="text-2xl font-display font-bold">Customer Reviews Moderation</h1>
            <div className="space-y-3">
              {reviews.map((r) => (
                <div
                  key={r.id}
                  className="rounded-2xl bg-[#1B1613] border border-stone-800 p-4 flex items-start justify-between gap-4"
                >
                  <div>
                    <p className="text-sm font-semibold text-white">
                      {r.customerName} · {r.overallRating}/5 Stars
                    </p>
                    <p className="text-xs text-stone-300 mt-1">{r.comment}</p>
                  </div>
                  <button
                    type="button"
                    onClick={async () => {
                      await apiFetch(`/api/reviews/${r.id}`, {
                        method: 'PATCH',
                        body: JSON.stringify({ isApproved: !r.isApproved }),
                      });
                      loadDashboardData();
                    }}
                    className="rounded-lg border border-stone-700 px-3 py-1.5 text-xs font-medium text-stone-200 hover:bg-stone-800 shrink-0"
                  >
                    {r.isApproved ? 'Published (Hide)' : 'Hidden (Publish)'}
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* 14. RESERVATIONS */}
        {section === 'reservations' && (
          <div className="space-y-4">
            <h1 className="text-2xl font-display font-bold">Table Reservations</h1>
            <div className="rounded-2xl bg-[#1B1613] border border-stone-800 overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="border-b border-stone-800 text-stone-400">
                  <tr>
                    <th className="py-3 px-4">Guest</th>
                    <th className="py-3 px-4">Date &amp; Time</th>
                    <th className="py-3 px-4">Party</th>
                    <th className="py-3 px-4">Zone</th>
                    <th className="py-3 px-4">Status</th>
                    <th className="py-3 px-4 text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-stone-800/80">
                  {reservations.map((r) => (
                    <tr key={r.id}>
                      <td className="py-3 px-4 font-semibold text-white">{r.customerName}</td>
                      <td className="py-3 px-4 font-mono">
                        {r.reservationDate} · {r.reservationTime}
                      </td>
                      <td className="py-3 px-4 font-mono tabular-nums">{r.partySize}</td>
                      <td className="py-3 px-4">{r.preferredZone}</td>
                      <td className="py-3 px-4 text-orange-400">{r.status}</td>
                      <td className="py-3 px-4 text-right">
                        <select
                          value={r.status}
                          onChange={async (e) => {
                            await apiFetch(`/api/reservations/${r.id}`, {
                              method: 'PATCH',
                              body: JSON.stringify({ status: e.target.value }),
                            });
                            loadDashboardData();
                          }}
                          className="rounded-lg bg-[#120F0D] border border-stone-700 px-2 py-1 text-xs"
                        >
                          <option value="confirmed">confirmed</option>
                          <option value="seated">seated</option>
                          <option value="completed">completed</option>
                          <option value="cancelled">cancelled</option>
                        </select>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* 15. ANALYTICS */}
        {section === 'analytics' && analytics && (
          <div className="space-y-6">
            <h1 className="text-2xl font-display font-bold">Business Analytics</h1>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <div className="rounded-2xl bg-[#1B1613] border border-stone-800 p-5">
                <h2 className="text-sm font-semibold mb-4">Peak Business Hours</h2>
                <div className="h-64">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={analytics.peakHours}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#292524" />
                      <XAxis dataKey="hour" stroke="#A8A29E" fontSize={11} />
                      <YAxis stroke="#A8A29E" fontSize={11} />
                      <Tooltip
                        contentStyle={{
                          backgroundColor: '#191411',
                          borderColor: '#44403C',
                          color: '#F5F0EB',
                          fontSize: 12,
                        }}
                      />
                      <Bar dataKey="orders" fill="#F97316" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>

              <div className="rounded-2xl bg-[#1B1613] border border-stone-800 p-5">
                <h2 className="text-sm font-semibold mb-4">Payment Method Distribution</h2>
                <div className="h-64">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={analytics.paymentDistribution}
                        dataKey="amount"
                        nameKey="method"
                        cx="50%"
                        cy="50%"
                        outerRadius={88}
                        label
                      >
                        {analytics.paymentDistribution.map((_, idx) => (
                          <Cell key={idx} fill={PIE_COLORS[idx % PIE_COLORS.length]} />
                        ))}
                      </Pie>
                      <Tooltip />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* 16. REPORTS & AUDIT LOGS */}
        {section === 'reports' && (
          <div className="space-y-6">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div>
                <h1 className="text-2xl font-display font-bold">Exports &amp; Security Audit Trail</h1>
                <p className="text-xs text-stone-400 mt-0.5">
                  Download real-time financial reports or inspect tenant audit logs.
                </p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleDownloadCsv}
                  className="inline-flex items-center gap-2 rounded-xl border border-stone-700 px-4 py-2.5 text-xs font-semibold text-stone-200 hover:bg-stone-800"
                >
                  <Download className="w-4 h-4 text-orange-400" />
                  Export Orders CSV
                </button>
                {analytics && (
                  <button
                    type="button"
                    onClick={() =>
                      downloadAnalyticsReportPdf({
                        restaurant,
                        kpis: analytics.kpis,
                        popularDishes: analytics.popularDishes,
                      })
                    }
                    className="inline-flex items-center gap-2 rounded-xl bg-orange-600 px-4 py-2.5 text-xs font-semibold text-white hover:bg-orange-700"
                  >
                    <Download className="w-4 h-4" />
                    Export Summary PDF
                  </button>
                )}
              </div>
            </div>

            <div className="rounded-2xl bg-[#1B1613] border border-stone-800 overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="border-b border-stone-800 text-stone-400">
                  <tr>
                    <th className="py-3 px-4">Timestamp</th>
                    <th className="py-3 px-4">Actor</th>
                    <th className="py-3 px-4">Role</th>
                    <th className="py-3 px-4">Action</th>
                    <th className="py-3 px-4">Entity</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-stone-800/80">
                  {auditLogs.map((log) => (
                    <tr key={log.id}>
                      <td className="py-3 px-4 font-mono text-stone-400">
                        {new Date(log.createdAt).toLocaleString()}
                      </td>
                      <td className="py-3 px-4">{log.actorEmail}</td>
                      <td className="py-3 px-4 text-orange-400">{log.actorRole}</td>
                      <td className="py-3 px-4 font-mono">{log.action}</td>
                      <td className="py-3 px-4 font-mono">
                        {log.entityType} #{log.entityId}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* 17. RESTAURANT SETTINGS */}
        {section === 'settings' && (
          <form
            onSubmit={handleSaveSettings}
            className="max-w-3xl rounded-2xl bg-[#1B1613] border border-stone-800 p-6 space-y-4"
          >
            <h1 className="text-2xl font-display font-bold">Restaurant &amp; Website Settings</h1>
            <p className="text-xs text-stone-400">
              Changes immediately update your public restaurant website, billing rules, and UPI VPA.
            </p>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs text-stone-400 mb-1">Restaurant Name</label>
                <input
                  value={settingsForm.name}
                  onChange={(e) => setSettingsForm({ ...settingsForm, name: e.target.value })}
                  className="w-full rounded-xl bg-[#120F0D] border border-stone-800 px-3.5 py-2.5 text-sm"
                />
              </div>
              <div>
                <label className="block text-xs text-stone-400 mb-1">UPI VPA</label>
                <input
                  value={settingsForm.upiVpa}
                  onChange={(e) => setSettingsForm({ ...settingsForm, upiVpa: e.target.value })}
                  className="w-full rounded-xl bg-[#120F0D] border border-stone-800 px-3.5 py-2.5 text-sm font-mono"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs text-stone-400 mb-1">Website Tagline</label>
              <input
                value={settingsForm.tagline}
                onChange={(e) => setSettingsForm({ ...settingsForm, tagline: e.target.value })}
                className="w-full rounded-xl bg-[#120F0D] border border-stone-800 px-3.5 py-2.5 text-sm"
              />
            </div>

            <div>
              <label className="block text-xs text-stone-400 mb-1">Website Description</label>
              <textarea
                rows={3}
                value={settingsForm.description}
                onChange={(e) => setSettingsForm({ ...settingsForm, description: e.target.value })}
                className="w-full rounded-xl bg-[#120F0D] border border-stone-800 px-3.5 py-2.5 text-sm"
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div>
                <label className="block text-xs text-stone-400 mb-1">GST / Tax (%)</label>
                <input
                  type="number"
                  step="0.5"
                  value={settingsForm.taxRatePercent}
                  onChange={(e) =>
                    setSettingsForm({ ...settingsForm, taxRatePercent: Number(e.target.value) })
                  }
                  className="w-full rounded-xl bg-[#120F0D] border border-stone-800 px-3.5 py-2.5 text-sm font-mono"
                />
              </div>
              <div>
                <label className="block text-xs text-stone-400 mb-1">Service Charge (%)</label>
                <input
                  type="number"
                  step="0.5"
                  value={settingsForm.serviceChargePercent}
                  onChange={(e) =>
                    setSettingsForm({
                      ...settingsForm,
                      serviceChargePercent: Number(e.target.value),
                    })
                  }
                  className="w-full rounded-xl bg-[#120F0D] border border-stone-800 px-3.5 py-2.5 text-sm font-mono"
                />
              </div>
              <div>
                <label className="block text-xs text-stone-400 mb-1">Cancel Window (mins)</label>
                <input
                  type="number"
                  value={settingsForm.cancellationRuleMinutes}
                  onChange={(e) =>
                    setSettingsForm({
                      ...settingsForm,
                      cancellationRuleMinutes: Number(e.target.value),
                    })
                  }
                  className="w-full rounded-xl bg-[#120F0D] border border-stone-800 px-3.5 py-2.5 text-sm font-mono"
                />
              </div>
            </div>

            <label className="flex items-center gap-2 text-xs text-stone-300">
              <input
                type="checkbox"
                checked={settingsForm.allowNegativeStock}
                onChange={(e) =>
                  setSettingsForm({ ...settingsForm, allowNegativeStock: e.target.checked })
                }
              />
              Allow orders even if recipe ingredient stock goes below zero
            </label>

            <button
              type="submit"
              className="rounded-xl bg-orange-600 px-6 py-3 text-sm font-semibold text-white hover:bg-orange-700"
            >
              Save Settings
            </button>
          </form>
        )}
      </main>

      <FoodArViewer
        open={Boolean(previewArDish)}
        onClose={() => setPreviewArDish(null)}
        item={previewArDish}
        model3d={models3d.find((m) => m.menuItemId === previewArDish?.id) || null}
        restaurant={restaurant}
      />
    </div>
  );
};
