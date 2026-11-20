import React, { useState } from 'react';
import { signInWithPopup, signOut } from 'firebase/auth';
import { ShieldCheck, LogOut, X, Building2 } from 'lucide-react';
import { auth, googleAuthProvider } from '../lib/firebase.ts';
import { apiFetch, saveStoredAuth } from '../lib/api.ts';
import type { AuthSession, RestaurantDTO, RoleCode } from '../shared/types.ts';

interface AuthModalProps {
  open: boolean;
  onClose: () => void;
  currentAuth: AuthSession | null;
  onAuthChange: (session: AuthSession | null) => void;
  restaurants: RestaurantDTO[];
  activeRestaurantId: number;
  onRestaurantSelect: (restaurant: RestaurantDTO) => void;
}

const ROLE_OPTIONS: { code: RoleCode; label: string; scope: string }[] = [
  { code: 'super_admin', label: 'Super Admin', scope: 'All tenants & platform settings' },
  { code: 'owner', label: 'Restaurant Owner', scope: 'Full restaurant operations & revenue' },
  { code: 'manager', label: 'Manager', scope: 'Floor, inventory, shifts & analytics' },
  { code: 'kitchen', label: 'Kitchen Staff', scope: 'Kitchen Display System (KDS) tickets' },
  { code: 'waiter', label: 'Waiter / Captain', scope: 'Floor map & guest service requests' },
  { code: 'cashier', label: 'Cashier', scope: 'Invoices, UPI & Razorpay reconciliation' },
  { code: 'customer', label: 'Guest Diner', scope: 'Customer menu & order tracking' },
];

export const AuthModal: React.FC<AuthModalProps> = ({
  open,
  onClose,
  currentAuth,
  onAuthChange,
  restaurants,
  activeRestaurantId,
  onRestaurantSelect,
}) => {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  if (!open) return null;

  const handleGoogleSignIn = async () => {
    setError('');
    setLoading(true);
    try {
      const cred = await signInWithPopup(auth, googleAuthProvider);
      const token = await cred.user.getIdToken();
      const me = await apiFetch<Omit<AuthSession, 'token'>>('/api/auth/me', {
        token,
        restaurantId: activeRestaurantId,
      });
      const session: AuthSession = { ...me, token };
      saveStoredAuth(session);
      onAuthChange(session);
      onClose();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Google Sign-In could not be completed.');
    } finally {
      setLoading(false);
    }
  };

  const handleSandboxRole = async (role: RoleCode) => {
    setError('');
    setLoading(true);
    try {
      const session = await apiFetch<AuthSession>('/api/auth/sandbox-login', {
        method: 'POST',
        body: JSON.stringify({ role, restaurantId: activeRestaurantId }),
      });
      saveStoredAuth(session);
      onAuthChange(session);
      onClose();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Role sign-in failed.');
    } finally {
      setLoading(false);
    }
  };

  const handleSignOut = async () => {
    try {
      await signOut(auth);
    } catch {
      // Ignore if not signed into Firebase
    }
    saveStoredAuth(null);
    onAuthChange(null);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
      <div className="w-full max-w-lg rounded-2xl bg-[#191411] text-[#F5F0EB] border border-stone-800 shadow-2xl overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-stone-800">
          <div className="flex items-center gap-2.5">
            <ShieldCheck className="w-5 h-5 text-orange-500" />
            <h2 className="text-lg font-semibold tracking-tight">Workspace Access &amp; Tenant</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close modal"
            className="p-2 rounded-lg text-stone-400 hover:text-white hover:bg-stone-800 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-6 space-y-6 max-h-[82vh] overflow-y-auto">
          {error && (
            <div className="rounded-lg bg-red-950/60 border border-red-800 px-4 py-3 text-xs text-red-200">
              {error}
            </div>
          )}

          {currentAuth && (
            <div className="flex items-center justify-between rounded-xl bg-stone-900/90 border border-stone-800 p-4">
              <div>
                <p className="text-sm font-semibold text-white">{currentAuth.fullName}</p>
                <p className="text-xs text-stone-400 mt-0.5">
                  {currentAuth.email} · Role: <span className="text-orange-400 font-medium">{currentAuth.role}</span>
                </p>
              </div>
              <button
                type="button"
                onClick={handleSignOut}
                className="inline-flex items-center gap-1.5 rounded-lg border border-stone-700 px-3 py-1.5 text-xs font-medium text-stone-300 hover:bg-stone-800"
              >
                <LogOut className="w-3.5 h-3.5" />
                Sign Out
              </button>
            </div>
          )}

          {/* Multi-Restaurant Tenant Selector */}
          <div>
            <label className="flex items-center gap-2 text-xs font-medium text-stone-400 mb-2.5">
              <Building2 className="w-3.5 h-3.5 text-orange-500" />
              Active Restaurant Tenant
            </label>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              {restaurants.map((r) => {
                const active = r.id === activeRestaurantId;
                return (
                  <button
                    key={r.id}
                    type="button"
                    onClick={() => onRestaurantSelect(r)}
                    className={`text-left rounded-xl p-3 border transition-colors ${
                      active
                        ? 'bg-orange-600/15 border-orange-500 text-white'
                        : 'bg-stone-900/60 border-stone-800 text-stone-300 hover:border-stone-700'
                    }`}
                  >
                    <p className="text-sm font-semibold truncate">{r.name}</p>
                    <p className="text-xs text-stone-400 truncate mt-0.5">{r.city}</p>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Firebase Google Auth */}
          <div>
            <p className="text-xs font-medium text-stone-400 mb-2">Owner &amp; Staff Single Sign-On</p>
            <button
              type="button"
              disabled={loading}
              onClick={handleGoogleSignIn}
              className="w-full flex items-center justify-center gap-2.5 rounded-xl bg-white text-stone-950 font-semibold text-sm py-3 px-4 hover:bg-stone-100 transition-colors disabled:opacity-60"
            >
              Sign in with Google (Firebase Auth)
            </button>
          </div>

          {/* Server-Verified RBAC Role Switcher */}
          <div>
            <p className="text-xs font-medium text-stone-400 mb-2.5">
              Role-Based Workspace Preview (Server-Signed Token)
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {ROLE_OPTIONS.map((opt) => (
                <button
                  key={opt.code}
                  type="button"
                  disabled={loading}
                  onClick={() => handleSandboxRole(opt.code)}
                  className={`text-left rounded-xl p-3 border transition-colors ${
                    currentAuth?.role === opt.code
                      ? 'bg-orange-600/20 border-orange-500'
                      : 'bg-stone-900/50 border-stone-800 hover:border-stone-700'
                  }`}
                >
                  <p className="text-xs font-semibold text-stone-100">{opt.label}</p>
                  <p className="text-[11px] text-stone-400 mt-0.5">{opt.scope}</p>
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
