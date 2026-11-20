import React, { useCallback, useEffect, useState } from 'react';
import { Bell, Check, ChefHat, Clock, Flame, Volume2, VolumeX } from 'lucide-react';
import { apiFetch, useRealtimeSocket } from '../lib/api.ts';
import type { AuthSession, OrderDTO, OrderStatus, RestaurantDTO } from '../shared/types.ts';

interface KitchenDisplayProps {
  restaurant: RestaurantDTO;
  authSession: AuthSession | null;
  onRequestAuth: () => void;
}

function playNewOrderChime() {
  try {
    const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(660, ctx.currentTime);
    osc.frequency.setValueAtTime(880, ctx.currentTime + 0.12);
    gain.gain.setValueAtTime(0.18, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.45);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.46);
  } catch {
    // Audio playback blocked before interaction
  }
}

export const KitchenDisplay: React.FC<KitchenDisplayProps> = ({
  restaurant,
  authSession,
  onRequestAuth,
}) => {
  const [orders, setOrders] = useState<OrderDTO[]>([]);
  const [filter, setFilter] = useState<'active' | 'Pending' | 'Cooking' | 'Ready' | 'history'>('active');
  const [muted, setMuted] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [nowMs, setNowMs] = useState(() => Date.now());

  useEffect(() => {
    const id = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const fetchOrders = useCallback(async () => {
    if (!authSession) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError('');
    try {
      const data = await apiFetch<OrderDTO[]>(`/api/orders?restaurantId=${restaurant.id}`);
      setOrders(data);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Unable to load kitchen queue.');
    } finally {
      setLoading(false);
    }
  }, [authSession, restaurant.id]);

  useEffect(() => {
    fetchOrders();
  }, [fetchOrders]);

  useRealtimeSocket(restaurant.id, undefined, (evt) => {
    if (evt.type === 'order:created') {
      if (!muted) playNewOrderChime();
      fetchOrders();
    } else if (evt.type === 'order:updated') {
      fetchOrders();
    }
  });

  const handleTransition = async (orderId: number, status: OrderStatus) => {
    try {
      const updated = await apiFetch<OrderDTO>(`/api/orders/${orderId}/status`, {
        method: 'PATCH',
        body: JSON.stringify({ status }),
      });
      setOrders((prev) => prev.map((o) => (o.id === orderId ? updated : o)));
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to update status');
    }
  };

  if (!authSession) {
    return (
      <div className="min-h-[82vh] bg-[#120F0D] text-[#F5F0EB] flex items-center justify-center p-6">
        <div className="max-w-md rounded-2xl bg-[#1B1613] border border-stone-800 p-7 text-center space-y-4">
          <ChefHat className="w-8 h-8 text-orange-500 mx-auto" />
          <h2 className="text-xl font-display font-bold">Kitchen Display System</h2>
          <p className="text-sm text-stone-400">
            Sign in as Kitchen Staff, Manager, or Owner to view live preparation tickets and dispatch dishes.
          </p>
          <button
            type="button"
            onClick={onRequestAuth}
            className="rounded-xl bg-orange-600 px-5 py-3 text-sm font-semibold text-white hover:bg-orange-700"
          >
            Sign In to KDS
          </button>
        </div>
      </div>
    );
  }

  const visibleOrders = orders.filter((o) => {
    if (filter === 'active') {
      return ['Pending', 'Confirmed', 'Accepted', 'Preparing', 'Cooking', 'Ready'].includes(o.status);
    }
    if (filter === 'history') {
      return ['Served', 'Completed', 'Cancelled'].includes(o.status);
    }
    return o.status === filter;
  });

  return (
    <div className="min-h-screen bg-[#120F0D] text-[#F5F0EB] p-4 sm:p-6 lg:p-8">
      <div className="max-w-7xl mx-auto space-y-6">
        {/* Header Toolbar */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-stone-800 pb-5">
          <div>
            <p className="text-xs font-medium text-orange-400">
              {restaurant.name} · Kitchen Display System
            </p>
            <h1 className="text-2xl font-display font-bold tracking-tight mt-0.5">
              Live Prep Ticket Queue
            </h1>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {(
              [
                ['active', 'Active Queue'],
                ['Pending', 'New'],
                ['Cooking', 'Cooking'],
                ['Ready', 'Ready'],
                ['history', 'Completed History'],
              ] as const
            ).map(([key, label]) => (
              <button
                key={key}
                type="button"
                onClick={() => setFilter(key)}
                className={`px-3.5 py-2 rounded-xl text-xs font-semibold transition-colors min-h-[40px] ${
                  filter === key
                    ? 'bg-orange-600 text-white'
                    : 'bg-[#1B1613] border border-stone-800 text-stone-300 hover:bg-stone-800'
                }`}
              >
                {label}
              </button>
            ))}

            <button
              type="button"
              onClick={async () => {
                try {
                  const res = await apiFetch<{ alertsTriggered: number }>('/api/notifications/check-delays', {
                    method: 'POST',
                    body: JSON.stringify({ restaurantId: restaurant.id }),
                  });
                  setError(
                    res.alertsTriggered > 0
                      ? `Triggered ${res.alertsTriggered} delay alert(s) to guests and managers.`
                      : ''
                  );
                } catch {
                  // Ignore non-critical delay check errors
                }
              }}
              className="inline-flex items-center gap-1.5 rounded-xl bg-[#1B1613] border border-stone-800 px-3.5 py-2 text-xs text-amber-300 hover:bg-stone-800 min-h-[40px]"
            >
              <Clock className="w-4 h-4" />
              Notify Delays
            </button>

            <button
              type="button"
              onClick={() => setMuted((m) => !m)}
              title={muted ? 'Unmute new order chimes' : 'Mute new order chimes'}
              className="inline-flex items-center gap-1.5 rounded-xl bg-[#1B1613] border border-stone-800 px-3.5 py-2 text-xs text-stone-300 hover:bg-stone-800 min-h-[40px]"
            >
              {muted ? <VolumeX className="w-4 h-4 text-stone-500" /> : <Volume2 className="w-4 h-4 text-orange-400" />}
              {muted ? 'Muted' : 'Sound On'}
            </button>
          </div>
        </div>

        {error && (
          <div className="rounded-xl bg-amber-950/60 border border-amber-800 px-4 py-3 text-xs text-amber-200">
            {error}
          </div>
        )}

        {loading ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
            {[1, 2, 3].map((n) => (
              <div key={n} className="h-64 rounded-2xl bg-[#1B1613] border border-stone-800 animate-pulse" />
            ))}
          </div>
        ) : visibleOrders.length === 0 ? (
          <div className="rounded-2xl bg-[#1B1613] border border-stone-800 p-12 text-center">
            <p className="text-base font-semibold text-stone-200">All tickets cleared in this view</p>
            <p className="text-xs text-stone-500 mt-1">
              Incoming QR table orders appear here automatically in real time.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
            {visibleOrders.map((ord) => {
              const elapsedSec = Math.max(0, Math.floor((nowMs - new Date(ord.createdAt).getTime()) / 1000));
              const elapsedMin = Math.floor(elapsedSec / 60);
              const isDelayed = elapsedMin >= 15 && !['Ready', 'Served', 'Completed', 'Cancelled'].includes(ord.status);
              const isPriority = ord.priority === 'rush' || ord.priority === 'vip';

              return (
                <article
                  key={ord.id}
                  className={`rounded-2xl bg-[#1B1613] border p-5 flex flex-col justify-between space-y-4 ${
                    isDelayed
                      ? 'border-red-600/80'
                      : isPriority
                        ? 'border-orange-500/80'
                        : 'border-stone-800'
                  }`}
                >
                  <div className="space-y-3">
                    <div className="flex items-start justify-between gap-2 border-b border-stone-800 pb-3">
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="font-mono tabular-nums text-base font-bold text-white">
                            {ord.orderNumber}
                          </span>
                          <span className="text-xs text-orange-400 font-semibold">
                            · {ord.tableNumber}
                          </span>
                        </div>
                        <p className="text-xs text-stone-400 mt-0.5">
                          {ord.guestCount} Guests · {ord.customerName}
                          {isPriority && ` · ${ord.priority.toUpperCase()} PRIORITY`}
                        </p>
                      </div>

                      <div className="text-right">
                        <div
                          className={`inline-flex items-center gap-1 font-mono tabular-nums text-sm font-bold ${
                            isDelayed ? 'text-red-400' : 'text-stone-200'
                          }`}
                        >
                          <Clock className="w-3.5 h-3.5" />
                          {elapsedMin}m {String(elapsedSec % 60).padStart(2, '0')}s
                        </div>
                        <p className="text-[11px] text-stone-500 mt-0.5">{ord.status}</p>
                      </div>
                    </div>

                    {ord.notes && (
                      <div className="rounded-xl bg-amber-950/50 border border-amber-800/70 px-3 py-2 text-xs text-amber-200">
                        Kitchen Note: {ord.notes}
                      </div>
                    )}

                    <div className="space-y-2.5">
                      {ord.items.map((item) => (
                        <div key={item.id} className="text-sm">
                          <div className="flex items-baseline justify-between gap-2">
                            <span className="font-semibold text-stone-100">
                              {item.quantity}× {item.itemName}
                            </span>
                            <span className="text-xs text-orange-400 shrink-0">{item.spiceLevel}</span>
                          </div>
                          <p className="text-xs text-stone-400">
                            {item.variantName}
                            {item.addons.length > 0 && ` · +${item.addons.map((a) => a.name).join(', ')}`}
                          </p>
                          {item.specialInstructions && (
                            <p className="text-xs text-amber-300 mt-0.5">
                              Instruction: {item.specialInstructions}
                            </p>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* KDS Progression Action Controls */}
                  <div className="pt-3 border-t border-stone-800 grid grid-cols-2 gap-2">
                    {ord.status === 'Pending' && (
                      <button
                        type="button"
                        onClick={() => handleTransition(ord.id, 'Accepted')}
                        className="col-span-2 rounded-xl bg-orange-600 py-3 text-xs font-semibold text-white hover:bg-orange-700 flex items-center justify-center gap-1.5 min-h-[44px]"
                      >
                        <Check className="w-4 h-4" />
                        Accept Ticket (Deduct Inventory)
                      </button>
                    )}
                    {['Confirmed', 'Accepted', 'Preparing'].includes(ord.status) && (
                      <button
                        type="button"
                        onClick={() => handleTransition(ord.id, 'Cooking')}
                        className="col-span-2 rounded-xl bg-amber-600 py-3 text-xs font-semibold text-white hover:bg-amber-700 flex items-center justify-center gap-1.5 min-h-[44px]"
                      >
                        <Flame className="w-4 h-4" />
                        Start Cooking
                      </button>
                    )}
                    {ord.status === 'Cooking' && (
                      <button
                        type="button"
                        onClick={() => handleTransition(ord.id, 'Ready')}
                        className="col-span-2 rounded-xl bg-emerald-600 py-3 text-xs font-semibold text-white hover:bg-emerald-700 flex items-center justify-center gap-1.5 min-h-[44px]"
                      >
                        <Bell className="w-4 h-4" />
                        Mark Ready for Runner
                      </button>
                    )}
                    {ord.status === 'Ready' && (
                      <button
                        type="button"
                        onClick={() => handleTransition(ord.id, 'Served')}
                        className="col-span-2 rounded-xl bg-stone-800 border border-stone-700 py-3 text-xs font-semibold text-white hover:bg-stone-700 min-h-[44px]"
                      >
                        Mark Served to Table
                      </button>
                    )}
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};
