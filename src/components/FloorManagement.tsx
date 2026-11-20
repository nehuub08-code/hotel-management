import React, { useCallback, useEffect, useState } from 'react';
import {
  BellRing,
  Download,
  LayoutGrid,
  Plus,
  Printer,
  RefreshCw,
  Users,
  X,
} from 'lucide-react';
import { apiFetch, useRealtimeSocket } from '../lib/api.ts';
import type {
  AuthSession,
  OrderDTO,
  RestaurantDTO,
  ServiceRequestDTO,
  ServiceRequestStatus,
  TableDTO,
  TableStatus,
} from '../shared/types.ts';

interface FloorManagementProps {
  restaurant: RestaurantDTO;
  authSession: AuthSession | null;
  onRequestAuth: () => void;
  onLaunchQrSession: (qrToken: string) => void;
}

const TABLE_STATUSES: TableStatus[] = [
  'Available',
  'Occupied',
  'Reserved',
  'Ordering',
  'Food Preparing',
  'Ready to Serve',
  'Billing',
  'Cleaning',
];

const STATUS_STYLE: Record<TableStatus, string> = {
  Available: 'border-emerald-700/60 bg-emerald-950/25 text-emerald-300',
  Occupied: 'border-stone-700 bg-stone-900 text-stone-200',
  Reserved: 'border-indigo-700/60 bg-indigo-950/25 text-indigo-300',
  Ordering: 'border-orange-500/70 bg-orange-950/30 text-orange-300',
  'Food Preparing': 'border-amber-600/70 bg-amber-950/30 text-amber-300',
  'Ready to Serve': 'border-emerald-500 bg-emerald-950/50 text-emerald-200',
  Billing: 'border-sky-600/70 bg-sky-950/30 text-sky-300',
  Cleaning: 'border-stone-700 bg-stone-900/60 text-stone-400',
};

export const FloorManagement: React.FC<FloorManagementProps> = ({
  restaurant,
  authSession,
  onRequestAuth,
  onLaunchQrSession,
}) => {
  const [tables, setTables] = useState<TableDTO[]>([]);
  const [orders, setOrders] = useState<OrderDTO[]>([]);
  const [requests, setRequests] = useState<ServiceRequestDTO[]>([]);
  const [zoneFilter, setZoneFilter] = useState<string>('All');
  const [selectedTable, setSelectedTable] = useState<TableDTO | null>(null);
  const [qrPreview, setQrPreview] = useState<{ dataUrl: string; scanUrl: string } | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [newTable, setNewTable] = useState({
    tableNumber: '',
    label: '',
    capacity: 4,
    zone: 'Main Dining',
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const loadFloorData = useCallback(async () => {
    if (!authSession) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError('');
    try {
      const [tbls, srvs, ords] = await Promise.all([
        apiFetch<TableDTO[]>(`/api/tables?restaurantId=${restaurant.id}`),
        apiFetch<ServiceRequestDTO[]>(`/api/service-requests?restaurantId=${restaurant.id}`),
        apiFetch<OrderDTO[]>(`/api/orders?restaurantId=${restaurant.id}`).catch(() => [] as OrderDTO[]),
      ]);
      setTables(tbls);
      setRequests(srvs);
      setOrders(ords);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to load floor state.');
    } finally {
      setLoading(false);
    }
  }, [authSession, restaurant.id]);

  useEffect(() => {
    loadFloorData();
  }, [loadFloorData]);

  useRealtimeSocket(restaurant.id, undefined, (evt) => {
    if (
      ['table:updated', 'order:created', 'order:updated', 'service_request:created', 'service_request:updated'].includes(
        evt.type
      )
    ) {
      loadFloorData();
    }
  });

  const openTableDrawer = async (tbl: TableDTO) => {
    setSelectedTable(tbl);
    setQrPreview(null);
    try {
      const qr = await apiFetch<{ dataUrl: string; scanUrl: string }>(
        `/api/tables/${tbl.id}/qr-image?origin=${encodeURIComponent(window.location.origin)}`
      );
      setQrPreview(qr);
    } catch {
      // Ignore
    }
  };

  const handleUpdateTableStatus = async (tableId: number, status: TableStatus) => {
    try {
      const updated = await apiFetch<TableDTO>(`/api/tables/${tableId}`, {
        method: 'PATCH',
        body: JSON.stringify({ status }),
      });
      setTables((prev) => prev.map((t) => (t.id === tableId ? updated : t)));
      if (selectedTable?.id === tableId) setSelectedTable(updated);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Unable to update table status.');
    }
  };

  const handleRegenerateQr = async (tableId: number) => {
    try {
      const updated = await apiFetch<TableDTO>(`/api/tables/${tableId}/regenerate-qr`, {
        method: 'POST',
      });
      setTables((prev) => prev.map((t) => (t.id === tableId ? updated : t)));
      setSelectedTable(updated);
      const qr = await apiFetch<{ dataUrl: string; scanUrl: string }>(
        `/api/tables/${tableId}/qr-image?origin=${encodeURIComponent(window.location.origin)}`
      );
      setQrPreview(qr);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to regenerate QR.');
    }
  };

  const handleCreateTable = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const created = await apiFetch<TableDTO>('/api/tables', {
        method: 'POST',
        body: JSON.stringify({
          restaurantId: restaurant.id,
          ...newTable,
          capacity: Number(newTable.capacity),
        }),
      });
      setTables((prev) => [...prev, created]);
      setCreateOpen(false);
      setNewTable({ tableNumber: '', label: '', capacity: 4, zone: 'Main Dining' });
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to create table.');
    }
  };

  const handleServiceStatus = async (reqId: number, status: ServiceRequestStatus) => {
    try {
      const updated = await apiFetch<ServiceRequestDTO>(`/api/service-requests/${reqId}`, {
        method: 'PATCH',
        body: JSON.stringify({ status }),
      });
      setRequests((prev) => prev.map((r) => (r.id === reqId ? updated : r)));
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to update service request.');
    }
  };

  if (!authSession) {
    return (
      <div className="min-h-[82vh] bg-[#120F0D] text-[#F5F0EB] flex items-center justify-center p-6">
        <div className="max-w-md rounded-2xl bg-[#1B1613] border border-stone-800 p-7 text-center space-y-4">
          <LayoutGrid className="w-8 h-8 text-orange-500 mx-auto" />
          <h2 className="text-xl font-display font-bold">Live Floor &amp; Service Desk</h2>
          <p className="text-sm text-stone-400">
            Sign in as Waiter, Manager, or Owner to manage table occupancy, QR codes, and live guest calls.
          </p>
          <button
            type="button"
            onClick={onRequestAuth}
            className="rounded-xl bg-orange-600 px-5 py-3 text-sm font-semibold text-white hover:bg-orange-700"
          >
            Sign In to Floor Map
          </button>
        </div>
      </div>
    );
  }

  const zones = ['All', ...Array.from(new Set(tables.map((t) => t.zone)))];
  const visibleTables =
    zoneFilter === 'All' ? tables : tables.filter((t) => t.zone === zoneFilter);
  const openRequests = requests.filter((r) => r.status !== 'Completed');

  return (
    <div className="min-h-screen bg-[#120F0D] text-[#F5F0EB] p-4 sm:p-6 lg:p-8">
      <div className="max-w-7xl mx-auto space-y-6">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-stone-800 pb-5">
          <div>
            <p className="text-xs font-medium text-orange-400">
              {restaurant.name} · Live Floor Operations
            </p>
            <h1 className="text-2xl font-display font-bold tracking-tight mt-0.5">
              Interactive Floor Map &amp; Waiter Calls
            </h1>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {zones.map((z) => (
              <button
                key={z}
                type="button"
                onClick={() => setZoneFilter(z)}
                className={`px-3.5 py-2 rounded-xl text-xs font-semibold min-h-[40px] ${
                  zoneFilter === z
                    ? 'bg-orange-600 text-white'
                    : 'bg-[#1B1613] border border-stone-800 text-stone-300 hover:bg-stone-800'
                }`}
              >
                {z}
              </button>
            ))}
            {['super_admin', 'owner', 'manager'].includes(authSession.role) && (
              <button
                type="button"
                onClick={() => setCreateOpen(true)}
                className="inline-flex items-center gap-1.5 rounded-xl bg-white text-stone-950 px-3.5 py-2 text-xs font-semibold hover:bg-stone-100 min-h-[40px]"
              >
                <Plus className="w-3.5 h-3.5" />
                Add Table
              </button>
            )}
          </div>
        </div>

        {error && (
          <div className="rounded-xl bg-red-950/60 border border-red-800 px-4 py-3 text-xs text-red-200">
            {error}
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          {/* Interactive Floor Grid */}
          <div className="lg:col-span-8 grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
            {loading
              ? [1, 2, 3, 4, 5, 6].map((n) => (
                  <div
                    key={n}
                    className="h-40 rounded-2xl bg-[#1B1613] border border-stone-800 animate-pulse"
                  />
                ))
              : visibleTables.map((tbl) => {
                  const tableReqs = openRequests.filter((r) => r.tableId === tbl.id);
                  const activeOrd = orders.find(
                    (o) =>
                      o.tableId === tbl.id &&
                      !['Completed', 'Cancelled'].includes(o.status)
                  );
                  return (
                    <button
                      key={tbl.id}
                      type="button"
                      onClick={() => openTableDrawer(tbl)}
                      className={`text-left rounded-2xl border p-4 transition-transform hover:-translate-y-0.5 space-y-3 ${
                        STATUS_STYLE[tbl.status] || 'border-stone-800 bg-[#1B1613]'
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <p className="font-mono tabular-nums text-lg font-bold text-white">
                            {tbl.tableNumber}
                          </p>
                          <p className="text-xs text-stone-300">{tbl.label}</p>
                        </div>
                        <span className="text-[11px] font-semibold">{tbl.status}</span>
                      </div>

                      <div className="flex items-center justify-between text-xs text-stone-400 pt-2 border-t border-white/10">
                        <span className="inline-flex items-center gap-1">
                          <Users className="w-3.5 h-3.5" />
                          {tbl.currentGuestCount}/{tbl.capacity}
                        </span>
                        <span>{tbl.zone}</span>
                      </div>

                      {(activeOrd || tableReqs.length > 0) && (
                        <div className="text-[11px] pt-1 space-y-0.5">
                          {activeOrd && (
                            <p className="text-orange-300 font-mono">
                              {activeOrd.orderNumber} · {activeOrd.status}
                            </p>
                          )}
                          {tableReqs.length > 0 && (
                            <p className="text-amber-300 font-semibold">
                              {tableReqs.length} Service Call(s): {tableReqs[0].requestType}
                            </p>
                          )}
                        </div>
                      )}
                    </button>
                  );
                })}
          </div>

          {/* Live Service Request Desk */}
          <div className="lg:col-span-4 rounded-2xl bg-[#1B1613] border border-stone-800 p-5 space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <BellRing className="w-4 h-4 text-orange-400" />
                <h2 className="text-base font-semibold">Waiter Service Queue</h2>
              </div>
              <span className="font-mono tabular-nums text-xs text-stone-400">
                {openRequests.length} Open
              </span>
            </div>

            {requests.length === 0 ? (
              <p className="text-xs text-stone-500 py-6 text-center">No guest requests yet.</p>
            ) : (
              <div className="space-y-3 max-h-[600px] overflow-y-auto pr-1">
                {requests.slice(0, 14).map((sr) => (
                  <div
                    key={sr.id}
                    className="rounded-xl bg-[#120F0D] border border-stone-800 p-3.5 space-y-2.5"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <p className="text-xs font-semibold text-white">
                          {sr.tableNumber} · {sr.requestType}
                        </p>
                        {sr.customMessage && (
                          <p className="text-xs text-stone-400 mt-0.5">{sr.customMessage}</p>
                        )}
                      </div>
                      <span className="text-[11px] font-medium text-orange-400">{sr.status}</span>
                    </div>

                    {sr.status !== 'Completed' && (
                      <div className="flex items-center gap-2">
                        {sr.status === 'Pending' && (
                          <button
                            type="button"
                            onClick={() => handleServiceStatus(sr.id, 'Acknowledged')}
                            className="flex-1 rounded-lg bg-stone-800 py-1.5 text-[11px] font-medium text-stone-200 hover:bg-stone-700"
                          >
                            Acknowledge
                          </button>
                        )}
                        {['Pending', 'Acknowledged'].includes(sr.status) && (
                          <button
                            type="button"
                            onClick={() => handleServiceStatus(sr.id, 'In Progress')}
                            className="flex-1 rounded-lg bg-amber-700/80 py-1.5 text-[11px] font-medium text-white hover:bg-amber-700"
                          >
                            In Progress
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => handleServiceStatus(sr.id, 'Completed')}
                          className="flex-1 rounded-lg bg-emerald-700 py-1.5 text-[11px] font-medium text-white hover:bg-emerald-600"
                        >
                          Complete
                        </button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Selected Table Detail & QR Management Drawer */}
      {selectedTable && (
        <div className="fixed inset-0 z-50 flex justify-end bg-black/65 backdrop-blur-sm">
          <div className="w-full max-w-md bg-[#191411] text-[#F5F0EB] border-l border-stone-800 h-full overflow-y-auto p-6 space-y-6">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-xs text-orange-400 font-medium">{selectedTable.zone}</p>
                <h3 className="text-xl font-display font-bold">
                  {selectedTable.tableNumber} · {selectedTable.label}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setSelectedTable(null)}
                className="p-2 rounded-lg text-stone-400 hover:bg-stone-800"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div>
              <p className="text-xs font-medium text-stone-400 mb-2">Update Table Status</p>
              <div className="grid grid-cols-2 gap-2">
                {TABLE_STATUSES.map((st) => (
                  <button
                    key={st}
                    type="button"
                    onClick={() => handleUpdateTableStatus(selectedTable.id, st)}
                    className={`rounded-xl px-3 py-2 text-xs font-medium border text-left ${
                      selectedTable.status === st
                        ? 'bg-orange-600 border-orange-500 text-white'
                        : 'bg-[#120F0D] border-stone-800 text-stone-300 hover:border-stone-700'
                    }`}
                  >
                    {st}
                  </button>
                ))}
              </div>
            </div>

            {/* Cryptographic QR Code Management */}
            <div className="rounded-2xl bg-[#120F0D] border border-stone-800 p-4 space-y-3">
              <div className="flex items-center justify-between">
                <p className="text-xs font-semibold text-white">
                  Table QR (v{selectedTable.qrVersion})
                </p>
                <button
                  type="button"
                  onClick={() => handleRegenerateQr(selectedTable.id)}
                  className="inline-flex items-center gap-1 text-xs text-orange-400 hover:underline"
                >
                  <RefreshCw className="w-3 h-3" />
                  Regenerate Token
                </button>
              </div>
              {qrPreview && (
                <div className="flex flex-col items-center text-center space-y-3">
                  <img
                    src={qrPreview.dataUrl}
                    alt={`QR for ${selectedTable.tableNumber}`}
                    className="w-44 h-44 rounded-xl bg-white p-2"
                  />
                  <div className="flex items-center gap-2 w-full">
                    <a
                      href={qrPreview.dataUrl}
                      download={`${selectedTable.tableNumber}-qr.png`}
                      className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-xl border border-stone-700 py-2 text-xs font-medium text-stone-200 hover:bg-stone-800"
                    >
                      <Download className="w-3.5 h-3.5" />
                      Download
                    </a>
                    <button
                      type="button"
                      onClick={() => window.print()}
                      className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-xl border border-stone-700 py-2 text-xs font-medium text-stone-200 hover:bg-stone-800"
                    >
                      <Printer className="w-3.5 h-3.5" />
                      Print Card
                    </button>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedTable(null);
                      onLaunchQrSession(selectedTable.qrToken);
                    }}
                    className="w-full rounded-xl bg-orange-600 py-2.5 text-xs font-semibold text-white hover:bg-orange-700"
                  >
                    Open Customer QR View for {selectedTable.tableNumber}
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Create New Table Modal */}
      {createOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
          <form
            onSubmit={handleCreateTable}
            className="w-full max-w-md rounded-2xl bg-[#191411] border border-stone-800 p-6 space-y-4"
          >
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-semibold">Add Dining Table</h3>
              <button type="button" onClick={() => setCreateOpen(false)} className="text-stone-400">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="space-y-3">
              <input
                required
                placeholder="Table Number (e.g., T-11)"
                value={newTable.tableNumber}
                onChange={(e) => setNewTable({ ...newTable, tableNumber: e.target.value })}
                className="w-full rounded-xl bg-[#120F0D] border border-stone-800 px-3.5 py-2.5 text-sm"
              />
              <input
                required
                placeholder="Table Label (e.g., Skylight Booth 11)"
                value={newTable.label}
                onChange={(e) => setNewTable({ ...newTable, label: e.target.value })}
                className="w-full rounded-xl bg-[#120F0D] border border-stone-800 px-3.5 py-2.5 text-sm"
              />
              <div className="grid grid-cols-2 gap-3">
                <input
                  type="number"
                  min={1}
                  max={20}
                  value={newTable.capacity}
                  onChange={(e) => setNewTable({ ...newTable, capacity: Number(e.target.value) })}
                  className="rounded-xl bg-[#120F0D] border border-stone-800 px-3.5 py-2.5 text-sm"
                />
                <select
                  value={newTable.zone}
                  onChange={(e) => setNewTable({ ...newTable, zone: e.target.value })}
                  className="rounded-xl bg-[#120F0D] border border-stone-800 px-3.5 py-2.5 text-sm"
                >
                  <option value="Main Dining">Main Dining</option>
                  <option value="Patio">Patio</option>
                  <option value="Chef's Counter">Chef&apos;s Counter</option>
                  <option value="Private Booth">Private Booth</option>
                </select>
              </div>
            </div>
            <button
              type="submit"
              className="w-full rounded-xl bg-orange-600 py-3 text-sm font-semibold text-white hover:bg-orange-700"
            >
              Create Table &amp; Generate QR
            </button>
          </form>
        </div>
      )}
    </div>
  );
};
