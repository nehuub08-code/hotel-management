import { useCallback, useEffect, useState } from 'react';
import { apiFetch, loadStoredAuth } from './lib/api.ts';
import { OfflineIndicator, PWAInstallButton } from './lib/pwa.tsx';
import type {
  AuthSession,
  MenuCategoryDTO,
  MenuItemDTO,
  RestaurantDTO,
  ReviewDTO,
} from './shared/types.ts';
import { AuthModal } from './components/AuthModal.tsx';
import { CustomerWebsite } from './components/CustomerWebsite.tsx';
import { QrDiningApp } from './components/QrDiningApp.tsx';
import { KitchenDisplay } from './components/KitchenDisplay.tsx';
import { FloorManagement } from './components/FloorManagement.tsx';
import { AdminDashboard } from './components/AdminDashboard.tsx';

type AppWorkspace = 'website' | 'qr' | 'kds' | 'floor' | 'admin';

export default function App() {
  const [workspace, setWorkspace] = useState<AppWorkspace>(() => {
    const params = new URLSearchParams(window.location.search);
    return params.get('qr') ? 'qr' : 'website';
  });
  const [activeQrToken, setActiveQrToken] = useState<string>(() => {
    const params = new URLSearchParams(window.location.search);
    return params.get('qr') || '';
  });

  const [restaurants, setRestaurants] = useState<RestaurantDTO[]>([]);
  const [activeRestaurant, setActiveRestaurant] = useState<RestaurantDTO | null>(null);
  const [categories, setCategories] = useState<MenuCategoryDTO[]>([]);
  const [menuItems, setMenuItems] = useState<MenuItemDTO[]>([]);
  const [reviews, setReviews] = useState<ReviewDTO[]>([]);
  const [authSession, setAuthSession] = useState<AuthSession | null>(() => loadStoredAuth());
  const [authModalOpen, setAuthModalOpen] = useState(false);
  const [bootError, setBootError] = useState('');

  // Sync dark class for operational consoles vs light alabaster for customer screens
  useEffect(() => {
    const isOps = workspace === 'kds' || workspace === 'floor' || workspace === 'admin';
    document.documentElement.classList.toggle('dark', isOps);
  }, [workspace]);

  const loadRestaurantDetails = useCallback(async (slug: string) => {
    const [menuRes, revRes] = await Promise.all([
      apiFetch<{ restaurant: RestaurantDTO; categories: MenuCategoryDTO[]; items: MenuItemDTO[] }>(
        `/api/restaurants/${slug}/menu`
      ),
      apiFetch<ReviewDTO[]>(`/api/restaurants/${slug}/reviews`),
    ]);
    setActiveRestaurant(menuRes.restaurant);
    setCategories(menuRes.categories);
    setMenuItems(menuRes.items);
    setReviews(revRes);
  }, []);

  useEffect(() => {
    apiFetch<RestaurantDTO[]>('/api/restaurants')
      .then((list) => {
        setRestaurants(list);
        if (list.length > 0) {
          const preferred =
            list.find((r) => r.id === authSession?.restaurantId) || list[0];
          return loadRestaurantDetails(preferred.slug);
        }
      })
      .catch((err: unknown) => {
        setBootError(err instanceof Error ? err.message : 'Unable to connect to platform.');
      });
  }, [authSession?.restaurantId, loadRestaurantDetails]);

  const handleLaunchQrSession = (qrToken: string) => {
    setActiveQrToken(qrToken);
    const url = new URL(window.location.href);
    url.searchParams.set('qr', qrToken);
    window.history.replaceState({}, '', url.toString());
    setWorkspace('qr');
  };

  const handleOpenQrTab = async () => {
    if (activeQrToken) {
      setWorkspace('qr');
      return;
    }
    if (!activeRestaurant) return;
    try {
      const dir = await apiFetch<{ qrToken: string }[]>(
        `/api/restaurants/${activeRestaurant.slug}/qr-directory`
      );
      if (dir[0]?.qrToken) {
        handleLaunchQrSession(dir[0].qrToken);
      }
    } catch {
      setWorkspace('website');
    }
  };

  const handleExitQr = () => {
    const url = new URL(window.location.href);
    url.searchParams.delete('qr');
    window.history.replaceState({}, '', url.toString());
    setActiveQrToken('');
    setWorkspace('website');
  };

  const handleRestaurantSwitch = (r: RestaurantDTO) => {
    setActiveRestaurant(r);
    loadRestaurantDetails(r.slug);
    if (authSession) {
      setAuthSession({ ...authSession, restaurantId: r.id });
    }
  };

  const isOpsTheme = workspace === 'kds' || workspace === 'floor' || workspace === 'admin';

  return (
    <div className={isOpsTheme ? 'bg-[#120F0D] text-[#F5F0EB]' : 'bg-[#FAF8F5] text-[#1A1411]'}>
      <OfflineIndicator />

      {/* Strict 3-Zone Top Bar Contract */}
      <header
        className={`sticky top-0 z-40 border-b backdrop-blur-md no-print ${
          isOpsTheme
            ? 'bg-[#14100E]/90 border-stone-800 text-[#F5F0EB]'
            : 'bg-[#FAF8F5]/90 border-stone-200 text-[#1A1411]'
        }`}
      >
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-14 flex items-center justify-between gap-8">
          {/* Zone 1: Single-line brand wordmark */}
          <button
            type="button"
            onClick={handleExitQr}
            className="text-lg font-display font-bold tracking-tight whitespace-nowrap shrink-0"
          >
            EmberTable
          </button>

          {/* Zone 2: 5 concise single-line navigation links */}
          <nav className="flex items-center gap-4 sm:gap-6 text-xs sm:text-sm font-medium overflow-x-auto">
            <button
              type="button"
              onClick={() => setWorkspace('website')}
              className={`whitespace-nowrap shrink-0 py-1 border-b-2 transition-colors ${
                workspace === 'website'
                  ? 'border-orange-600 text-orange-600'
                  : 'border-transparent opacity-75 hover:opacity-100'
              }`}
            >
              Website
            </button>
            <button
              type="button"
              onClick={handleOpenQrTab}
              className={`whitespace-nowrap shrink-0 py-1 border-b-2 transition-colors ${
                workspace === 'qr'
                  ? 'border-orange-600 text-orange-600'
                  : 'border-transparent opacity-75 hover:opacity-100'
              }`}
            >
              QR Dining
            </button>
            <button
              type="button"
              onClick={() => setWorkspace('kds')}
              className={`whitespace-nowrap shrink-0 py-1 border-b-2 transition-colors ${
                workspace === 'kds'
                  ? 'border-orange-500 text-orange-400'
                  : 'border-transparent opacity-75 hover:opacity-100'
              }`}
            >
              Kitchen KDS
            </button>
            <button
              type="button"
              onClick={() => setWorkspace('floor')}
              className={`whitespace-nowrap shrink-0 py-1 border-b-2 transition-colors ${
                workspace === 'floor'
                  ? 'border-orange-500 text-orange-400'
                  : 'border-transparent opacity-75 hover:opacity-100'
              }`}
            >
              Floor Map
            </button>
            <button
              type="button"
              onClick={() => setWorkspace('admin')}
              className={`whitespace-nowrap shrink-0 py-1 border-b-2 transition-colors ${
                workspace === 'admin'
                  ? 'border-orange-500 text-orange-400'
                  : 'border-transparent opacity-75 hover:opacity-100'
              }`}
            >
              Admin OS
            </button>
          </nav>

          {/* Zone 3: Single Primary Action */}
          <div className="shrink-0">
            <button
              type="button"
              onClick={() => setAuthModalOpen(true)}
              className="rounded-lg bg-orange-600 px-3.5 py-2 text-xs font-semibold text-white hover:bg-orange-700 transition-colors whitespace-nowrap shrink-0"
            >
              {authSession ? `${authSession.role}` : 'Sign In'}
            </button>
          </div>
        </div>
      </header>

      {/* Install PWA Strip (below header when eligible, keeping header strictly 3-zone) */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-2 flex justify-end no-print">
        <PWAInstallButton variant={isOpsTheme ? 'dark' : 'light'} />
      </div>

      {bootError && (
        <div className="max-w-4xl mx-auto mt-8 p-4 rounded-xl bg-red-950/80 border border-red-800 text-red-200 text-sm">
          {bootError}
        </div>
      )}

      {!activeRestaurant && !bootError ? (
        <div className="min-h-[80vh] flex items-center justify-center">
          <div className="w-8 h-8 rounded-full border-2 border-orange-600 border-t-transparent animate-spin" />
        </div>
      ) : activeRestaurant ? (
        <>
          {workspace === 'website' && (
            <CustomerWebsite
              restaurant={activeRestaurant}
              categories={categories}
              menuItems={menuItems}
              reviews={reviews}
              onLaunchQrSession={handleLaunchQrSession}
              onRefreshReviews={() => loadRestaurantDetails(activeRestaurant.slug)}
            />
          )}

          {workspace === 'qr' && activeQrToken && (
            <QrDiningApp qrToken={activeQrToken} onExitToWebsite={handleExitQr} />
          )}

          {workspace === 'kds' && (
            <KitchenDisplay
              restaurant={activeRestaurant}
              authSession={authSession}
              onRequestAuth={() => setAuthModalOpen(true)}
            />
          )}

          {workspace === 'floor' && (
            <FloorManagement
              restaurant={activeRestaurant}
              authSession={authSession}
              onRequestAuth={() => setAuthModalOpen(true)}
              onLaunchQrSession={handleLaunchQrSession}
            />
          )}

          {workspace === 'admin' && (
            <AdminDashboard
              restaurant={activeRestaurant}
              authSession={authSession}
              onRequestAuth={() => setAuthModalOpen(true)}
              onNavigateWorkspace={(v) => setWorkspace(v)}
              onRestaurantUpdated={(updated) => {
                setActiveRestaurant(updated);
                setRestaurants((prev) => prev.map((r) => (r.id === updated.id ? updated : r)));
              }}
            />
          )}
        </>
      ) : null}

      <AuthModal
        open={authModalOpen}
        onClose={() => setAuthModalOpen(false)}
        currentAuth={authSession}
        onAuthChange={(s) => setAuthSession(s)}
        restaurants={restaurants}
        activeRestaurantId={activeRestaurant?.id || 1}
        onRestaurantSelect={handleRestaurantSwitch}
      />
    </div>
  );
}
