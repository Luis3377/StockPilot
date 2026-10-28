import { useEffect } from 'react';
import { HashRouter, Route, Routes } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { useAppState } from './data/store';
import { ToastProvider } from './ui/Toast';
import { ConfirmProvider } from './ui/Confirm';
import { DialogHub } from './pages/dialogs/DialogHub';
import { Layout } from './pages/Layout';
import { Onboarding } from './pages/Onboarding';
import { OverviewPage } from './pages/overview/OverviewPage';
import { InventoryPage } from './pages/InventoryPage';
import { ItemDetailPage } from './pages/ItemDetailPage';
import { SalesPage } from './pages/SalesPage';
import { InsightsPage } from './pages/InsightsPage';
import { CountCheckPage } from './pages/CountCheckPage';
import { SettingsPage } from './pages/SettingsPage';
import { NotFound } from './pages/NotFound';

function useTheme() {
  const theme = useAppState((s) => s.settings.theme);
  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const apply = () => {
      const dark = theme === 'dark' || (theme === 'system' && media.matches);
      document.documentElement.classList.toggle('dark', dark);
      document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? '#0d0d0d' : '#f5f5f3');
    };
    apply();
    try {
      localStorage.setItem('stockpilot-theme', theme);
    } catch {
      // Storage blocked; the theme still applies for this session.
    }
    media.addEventListener('change', apply);
    return () => media.removeEventListener('change', apply);
  }, [theme]);
}

function LoadError({ message }: { message: string }) {
  return (
    <div className="mx-auto max-w-lg px-6 py-20 text-center">
      <h1 className="text-xl font-semibold">StockPilot couldn’t open your data</h1>
      <p className="mt-2 text-sm text-ink-2">{message}</p>
      <p className="mt-4 text-sm text-ink-2">Try reloading the page. If you have StockPilot open in another tab, close it first.</p>
      <button className="mt-6 rounded-xl bg-accent px-4 py-2 text-sm font-medium text-white" onClick={() => window.location.reload()}>
        Reload
      </button>
    </div>
  );
}

export function App() {
  const status = useAppState((s) => s.status);
  const loadError = useAppState((s) => s.loadError);
  const onboarded = useAppState((s) => s.settings.onboarded);
  useTheme();

  if (status === 'loading') {
    return (
      <div className="flex min-h-dvh items-center justify-center text-ink-2" aria-busy>
        <Loader2 className="size-6 animate-spin" aria-label="Loading" />
      </div>
    );
  }
  if (status === 'error') return <LoadError message={loadError ?? 'Unknown error'} />;

  return (
    <ToastProvider>
      <ConfirmProvider>
        {!onboarded ? (
          <Onboarding />
        ) : (
          <HashRouter>
            <DialogHub>
              <Routes>
                <Route element={<Layout />}>
                  <Route index element={<OverviewPage />} />
                  <Route path="inventory" element={<InventoryPage />} />
                  <Route path="inventory/:id" element={<ItemDetailPage />} />
                  <Route path="sales" element={<SalesPage />} />
                  <Route path="insights" element={<InsightsPage />} />
                  <Route path="count" element={<CountCheckPage />} />
                  <Route path="settings" element={<SettingsPage />} />
                  <Route path="*" element={<NotFound />} />
                </Route>
              </Routes>
            </DialogHub>
          </HashRouter>
        )}
      </ConfirmProvider>
    </ToastProvider>
  );
}
