import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { AlertTriangle, BarChart3, Boxes, Check, ChevronDown, ClipboardCheck, FlaskConical, LayoutDashboard, Lightbulb, Settings as SettingsIcon } from 'lucide-react';
import { store, useAppState } from '../data/store';
import { MODES, modeInfo, salesEnabled } from '../lib/modes';
import { useInsights } from '../lib/hooks';
import { useClickOutside } from '../lib/useClickOutside';
import type { UserMode } from '../domain/types';
import { cn } from '../ui/cn';
import { useToast } from '../ui/Toast';

interface NavItem {
  to: string;
  label: string;
  short: string;
  icon: ReactNode;
  badge?: number;
}

export function useNavItems(): NavItem[] {
  const settings = useAppState((s) => s.settings);
  const report = useInsights();
  const alerts = report.lowStock.findings.length;
  const items: NavItem[] = [
    { to: '/', label: 'Overview', short: 'Overview', icon: <LayoutDashboard className="size-5" /> },
    { to: '/inventory', label: settings.mode === 'collector' ? 'Collection' : 'Inventory', short: settings.mode === 'collector' ? 'Collection' : 'Inventory', icon: <Boxes className="size-5" /> },
  ];
  if (salesEnabled(settings)) items.push({ to: '/sales', label: 'Sales & Profit', short: 'Sales', icon: <BarChart3 className="size-5" /> });
  items.push(
    { to: '/insights', label: 'Smart Insights', short: 'Insights', icon: <Lightbulb className="size-5" />, badge: alerts || undefined },
    { to: '/count', label: 'Count Check', short: 'Count', icon: <ClipboardCheck className="size-5" /> },
    { to: '/settings', label: 'Settings', short: 'Settings', icon: <SettingsIcon className="size-5" /> },
  );
  return items;
}

function Logo() {
  return (
    <div className="flex items-center gap-2.5">
      <img src="./icon.svg" alt="" className="size-8 rounded-[9px]" />
      <span className="text-[17px] font-semibold tracking-tight text-ink">StockPilot</span>
    </div>
  );
}

export function ModeSwitcher({ compact = false }: { compact?: boolean }) {
  const mode = useAppState((s) => s.settings.mode);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const toast = useToast();
  const navigate = useNavigate();
  const location = useLocation();

  useClickOutside(ref, open, useCallback(() => setOpen(false), []));

  const choose = (m: UserMode) => {
    setOpen(false);
    if (m === mode) return;
    store.updateSettings({ mode: m });
    toast.success(`Switched to ${modeInfo(m).name} mode. Your inventory is unchanged.`);
    // Collectors without sales tracking don't have a Sales screen.
    if (location.pathname.startsWith('/sales') && m === 'collector' && !store.getState().settings.collectorSalesEnabled) navigate('/');
  };

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        data-testid="mode-switcher"
        className={cn(
          'flex items-center gap-1.5 rounded-xl border border-line bg-surface text-sm font-medium text-ink hover:bg-surface-2',
          compact ? 'h-9 px-2.5' : 'h-10 w-full justify-between px-3',
        )}
      >
        <span className="truncate">
          {compact ? '' : <span className="font-normal text-ink-2">Mode: </span>}
          {modeInfo(mode).name}
        </span>
        <ChevronDown className="size-4 shrink-0 text-muted" />
      </button>
      {open && (
        <div
          role="menu"
          className={cn(
            'animate-fade-in absolute z-40 w-72 rounded-2xl border border-line bg-surface p-1.5 shadow-pop',
            compact ? 'top-11 right-0' : 'bottom-12 left-0',
          )}
        >
          {MODES.map((m) => (
            <button
              key={m.id}
              role="menuitemradio"
              aria-checked={m.id === mode}
              type="button"
              onClick={() => choose(m.id)}
              className="flex w-full items-start gap-3 rounded-xl px-3 py-2.5 text-left hover:bg-surface-2"
            >
              <span className="mt-0.5 size-4 shrink-0 text-accent">{m.id === mode && <Check className="size-4" />}</span>
              <span>
                <span className="block text-sm font-medium text-ink">{m.name}</span>
                <span className="block text-xs text-ink-2">{m.tagline}</span>
              </span>
            </button>
          ))}
          <p className="px-3 pt-1 pb-2 text-xs text-muted">Switching modes changes your dashboard, not your data.</p>
        </div>
      )}
    </div>
  );
}

function DemoBanner() {
  const toast = useToast();
  return (
    <div className="flex items-center justify-center gap-3 bg-demo px-4 py-2 text-center text-sm text-white" role="status" data-testid="demo-banner">
      <FlaskConical className="size-4 shrink-0" />
      <span>
        <strong>Demo mode</strong> — you’re viewing sample data. Your real inventory is kept separately.
      </span>
      <button
        type="button"
        className="shrink-0 rounded-lg bg-white/20 px-2.5 py-1 text-xs font-semibold hover:bg-white/30"
        onClick={async () => {
          await store.setDemoActive(false);
          toast.success('Left demo mode. Showing your real inventory.');
        }}
      >
        Exit demo
      </button>
    </div>
  );
}

function StorageWarnings() {
  const storageKind = useAppState((s) => s.storageKind);
  const saveError = useAppState((s) => s.saveError);
  if (saveError) {
    return (
      <div className="flex items-center justify-center gap-2 bg-bad px-4 py-2 text-sm text-white" role="alert">
        <AlertTriangle className="size-4 shrink-0" /> Your latest change couldn’t be saved ({saveError}). Free up device storage, then try again.
      </div>
    );
  }
  if (storageKind === 'memory') {
    return (
      <div className="flex items-center justify-center gap-2 bg-warn px-4 py-2 text-sm text-black" role="alert">
        <AlertTriangle className="size-4 shrink-0" /> This browser is blocking storage (private browsing?). Changes will be lost when you close the tab.
      </div>
    );
  }
  return null;
}

export function Layout() {
  const nav = useNavItems();
  const demo = useAppState((s) => s.dataset === 'demo');
  const location = useLocation();

  useEffect(() => {
    window.scrollTo(0, 0);
  }, [location.pathname]);

  return (
    <div className="min-h-dvh">
      {/* Desktop sidebar */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 flex-col border-r border-line bg-surface px-3 py-5 lg:flex" aria-label="Sidebar">
        <div className="px-2">
          <Logo />
        </div>
        <nav className="mt-8 flex flex-1 flex-col gap-1" aria-label="Main">
          {nav.map((n) => (
            <NavLink
              key={n.to}
              to={n.to}
              end={n.to === '/'}
              className={({ isActive }) =>
                cn(
                  'flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors',
                  isActive ? 'bg-accent-soft text-accent-text' : 'text-ink-2 hover:bg-surface-2 hover:text-ink',
                )
              }
            >
              {n.icon}
              <span className="flex-1">{n.label}</span>
              {n.badge ? (
                <span className="rounded-full bg-warn px-1.5 text-xs font-semibold text-black">
                  {n.badge}
                  <span className="sr-only"> {n.badge === 1 ? 'alert' : 'alerts'}</span>
                </span>
              ) : null}
            </NavLink>
          ))}
        </nav>
        <div className="px-1">
          <ModeSwitcher />
        </div>
      </aside>

      <div className="lg:pl-64">
        <div className="sticky top-0 z-20">
          <div className="pt-safe bg-canvas lg:hidden" />
          {demo && <DemoBanner />}
          <StorageWarnings />
          {/* Mobile top bar */}
          <header className="flex h-14 items-center justify-between border-b border-line bg-canvas/90 px-4 backdrop-blur lg:hidden">
            <Logo />
            <ModeSwitcher compact />
          </header>
        </div>
        <main className="min-w-0 px-4 pt-5 pb-[calc(96px+env(safe-area-inset-bottom))] sm:px-6 lg:px-10 lg:pt-8 lg:pb-12">
          <div className="mx-auto max-w-6xl">
            <Outlet />
          </div>
        </main>
      </div>

      {/* Mobile bottom tabs */}
      <nav className="pb-safe fixed inset-x-0 bottom-0 z-30 border-t border-line bg-surface/95 backdrop-blur lg:hidden" aria-label="Main">
        <div className="mx-auto flex max-w-xl">
          {nav.map((n) => (
            <NavLink
              key={n.to}
              to={n.to}
              end={n.to === '/'}
              className={({ isActive }) =>
                cn('relative flex min-w-0 flex-1 flex-col items-center gap-0.5 pt-2 pb-1.5 text-[10.5px] font-medium', isActive ? 'text-accent-text' : 'text-muted')
              }
            >
              {n.icon}
              <span className="max-w-full truncate px-0.5">{n.short}</span>
              {n.badge ? (
                <span className="absolute top-1 left-1/2 ml-2 rounded-full bg-warn px-1 text-[10px] leading-4 font-semibold text-black">
                  {n.badge}
                  <span className="sr-only"> {n.badge === 1 ? 'alert' : 'alerts'}</span>
                </span>
              ) : null}
            </NavLink>
          ))}
        </div>
      </nav>
    </div>
  );
}
