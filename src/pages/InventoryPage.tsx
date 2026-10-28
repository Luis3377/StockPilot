import { useMemo } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Download, FileUp, LayoutGrid, List, PackagePlus, Search, SearchX, X, Boxes } from 'lucide-react';
import { acquiredDate, itemCostValue, knownCategories, knownLocations, stockStatus, uniqueSorted, daysWithoutSale } from '../domain/calc';
import { todayISO } from '../domain/dates';
import type { Item } from '../domain/types';
import { store, useAppState } from '../data/store';
import { inventoryCsv } from '../csv/exports';
import { downloadText, fileStamp } from '../lib/download';
import { useMoney } from '../lib/hooks';
import { PageHeader, Card } from '../ui/Card';
import { Button, IconButton } from '../ui/Button';
import { Badge } from '../ui/Badge';
import { EmptyState } from '../ui/EmptyState';
import { ItemThumb } from '../ui/Photo';
import { inputClass } from '../ui/Fields';
import { cn } from '../ui/cn';
import { useDialogs } from './dialogs/DialogHub';
import { useToast } from '../ui/Toast';

const SORTS = {
  newest: 'Newest first',
  oldest: 'Oldest first',
  name: 'Name (A–Z)',
  qty_desc: 'Quantity (high–low)',
  qty_asc: 'Quantity (low–high)',
  cost: 'Total cost (high–low)',
  value: 'Value (high–low)',
  price: 'Asking price (high–low)',
  age: 'Longest unsold',
} as const;
type SortKey = keyof typeof SORTS;

const STATUSES = { all: 'All items', in_stock: 'In stock', low: 'Low stock', out: 'Sold out / zero' } as const;
type StatusKey = keyof typeof STATUSES;

export function filterItems(
  items: Item[],
  f: { q: string; category: string; location: string; condition: string; status: StatusKey },
): Item[] {
  const q = f.q.trim().toLowerCase();
  return items.filter((i) => {
    if (q && ![i.name, i.sku, i.category, i.location, i.condition, i.notes].some((v) => v.toLowerCase().includes(q))) return false;
    if (f.category && i.category.toLowerCase() !== f.category.toLowerCase()) return false;
    if (f.location && i.location.toLowerCase() !== f.location.toLowerCase()) return false;
    if (f.condition && i.condition.toLowerCase() !== f.condition.toLowerCase()) return false;
    if (f.status === 'in_stock' && i.quantity === 0) return false;
    if (f.status === 'low' && !(i.lowStockThreshold !== null && i.quantity <= i.lowStockThreshold)) return false;
    if (f.status === 'out' && i.quantity !== 0) return false;
    return true;
  });
}

export function InventoryPage() {
  const data = useAppState((s) => s.data);
  const settings = useAppState((s) => s.settings);
  const dataset = useAppState((s) => s.dataset);
  const dialogs = useDialogs();
  const toast = useToast();
  const { money } = useMoney();
  const [params, setParams] = useSearchParams();

  const q = params.get('q') ?? '';
  const category = params.get('category') ?? '';
  const location = params.get('location') ?? '';
  const condition = params.get('condition') ?? '';
  const status = (params.get('status') as StatusKey) in STATUSES ? (params.get('status') as StatusKey) : 'all';
  const sort = (params.get('sort') as SortKey) in SORTS ? (params.get('sort') as SortKey) : 'newest';
  const view = settings.inventoryView;

  const setParam = (key: string, value: string) => {
    // Read the live URL rather than this render's params: two quick changes (clear search,
    // then pick a category) must not overwrite each other with stale values.
    const next = new URLSearchParams(window.location.hash.split('?')[1] ?? '');
    if (value && !(key === 'status' && value === 'all') && !(key === 'sort' && value === 'newest')) next.set(key, value);
    else next.delete(key);
    setParams(next, { replace: true });
  };

  const categories = useMemo(() => knownCategories({ ...data, sales: [] }), [data]);
  const locations = useMemo(() => knownLocations(data), [data]);
  const conditions = useMemo(() => uniqueSorted(data.items.map((i) => i.condition)), [data]);
  const today = todayISO();

  const results = useMemo(() => {
    const filtered = filterItems(data.items, { q, category, location, condition, status });
    const value = (i: Item) => (i.estimatedValue ?? i.askingPrice ?? i.unitCost) * i.quantity;
    const cmp: Record<SortKey, (a: Item, b: Item) => number> = {
      newest: (a, b) => b.createdAt.localeCompare(a.createdAt),
      oldest: (a, b) => acquiredDate(a).localeCompare(acquiredDate(b)),
      name: (a, b) => a.name.localeCompare(b.name),
      qty_desc: (a, b) => b.quantity - a.quantity,
      qty_asc: (a, b) => a.quantity - b.quantity,
      cost: (a, b) => itemCostValue(b) - itemCostValue(a),
      value: (a, b) => value(b) - value(a),
      price: (a, b) => (b.askingPrice ?? -1) - (a.askingPrice ?? -1),
      age: (a, b) => daysWithoutSale(b, data.sales, today) - daysWithoutSale(a, data.sales, today) || (b.quantity > 0 ? 1 : 0) - (a.quantity > 0 ? 1 : 0),
    };
    return [...filtered].sort(cmp[sort]);
  }, [data, q, category, location, condition, status, sort, today]);

  const activeFilters = [category, location, condition, status !== 'all' ? status : '', q].filter(Boolean).length;
  const title = settings.mode === 'collector' ? 'Collection' : 'Inventory';
  const totalUnits = results.reduce((n, i) => n + i.quantity, 0);

  const exportCsv = () => {
    downloadText(`stockpilot-${dataset === 'demo' ? 'demo-' : ''}inventory-${fileStamp()}.csv`, inventoryCsv(data.items));
    toast.success(`Exported ${data.items.length} items to CSV.`);
  };

  if (data.items.length === 0) {
    return (
      <>
        <PageHeader title={title} />
        <Card>
          <EmptyState
            icon={<Boxes className="size-6" />}
            title={settings.mode === 'collector' ? 'Your collection is empty' : 'No inventory yet'}
            actions={
              <>
                <Button variant="primary" icon={<PackagePlus className="size-4" />} onClick={dialogs.addItem}>
                  Add your first item
                </Button>
                <Button icon={<FileUp className="size-4" />} onClick={dialogs.importCsv}>
                  Import CSV
                </Button>
              </>
            }
          >
            Add items one at a time, or import a spreadsheet you already have.
          </EmptyState>
        </Card>
      </>
    );
  }

  return (
    <>
      <PageHeader
        title={title}
        description={`${data.items.length} ${data.items.length === 1 ? 'item' : 'items'} · ${data.items.reduce((n, i) => n + i.quantity, 0)} units on hand`}
        actions={
          <>
            <Button icon={<FileUp className="size-4" />} onClick={dialogs.importCsv} className="hidden sm:inline-flex">
              Import
            </Button>
            <Button icon={<Download className="size-4" />} onClick={exportCsv}>
              Export
            </Button>
            <Button variant="primary" icon={<PackagePlus className="size-4" />} onClick={dialogs.addItem}>
              Add item
            </Button>
          </>
        }
      />

      <div className="mb-4 space-y-3">
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted" />
            <input
              type="search"
              value={q}
              onChange={(e) => setParam('q', e.target.value)}
              placeholder="Search name, SKU, category, location, notes…"
              aria-label="Search inventory"
              className={cn(inputClass, 'border-line-strong pl-9')}
            />
          </div>
          <div className="flex rounded-xl bg-surface-2 p-1" role="radiogroup" aria-label="View">
            {(['grid', 'list'] as const).map((v) => (
              <button
                key={v}
                type="button"
                role="radio"
                aria-checked={view === v}
                aria-label={v === 'grid' ? 'Grid view' : 'List view'}
                onClick={() => store.updateSettings({ inventoryView: v })}
                className={cn('flex w-10 items-center justify-center rounded-lg', view === v ? 'bg-surface text-ink shadow-card' : 'text-ink-2')}
              >
                {v === 'grid' ? <LayoutGrid className="size-4" /> : <List className="size-4" />}
              </button>
            ))}
          </div>
        </div>
        <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 sm:mx-0 sm:flex-wrap sm:px-0">
          <FilterSelect label="Status" value={status} onChange={(v) => setParam('status', v)} options={Object.entries(STATUSES).map(([k, l]) => [k, l])} />
          <FilterSelect label="Category" value={category} onChange={(v) => setParam('category', v)} options={[['', 'All categories'], ...categories.map((c) => [c, c])]} />
          <FilterSelect label="Location" value={location} onChange={(v) => setParam('location', v)} options={[['', 'All locations'], ...locations.map((c) => [c, c])]} />
          {conditions.length > 0 && (
            <FilterSelect label="Condition" value={condition} onChange={(v) => setParam('condition', v)} options={[['', 'Any condition'], ...conditions.map((c) => [c, c])]} />
          )}
          <FilterSelect label="Sort" value={sort} onChange={(v) => setParam('sort', v)} options={Object.entries(SORTS).map(([k, l]) => [k, l])} />
          {activeFilters > 0 && (
            <Button variant="ghost" size="sm" className="h-9 shrink-0" icon={<X className="size-4" />} onClick={() => {
                const current = new URLSearchParams(window.location.hash.split('?')[1] ?? '').get('sort');
                setParams(current ? { sort: current } : {}, { replace: true });
              }}>
              Clear filters
            </Button>
          )}
        </div>
        <p className="text-sm text-ink-2" data-testid="result-count" aria-live="polite">
          {results.length === data.items.length ? `Showing all ${results.length} items` : `${results.length} of ${data.items.length} items match`} · {totalUnits} units
        </p>
      </div>

      {results.length === 0 ? (
        <Card>
          <EmptyState icon={<SearchX className="size-6" />} title="No items match" actions={<Button onClick={() => setParams({}, { replace: true })}>Clear search & filters</Button>}>
            Try a different search or remove a filter.
          </EmptyState>
        </Card>
      ) : view === 'grid' ? (
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4" data-testid="inventory-grid">
          {results.map((item) => (
            <li key={item.id}>
              <Link to={`/inventory/${item.id}`} className="group block overflow-hidden rounded-2xl border border-line bg-surface shadow-card transition-shadow hover:shadow-pop" data-testid="inventory-item">
                <div className="relative aspect-square overflow-hidden bg-surface-2">
                  <ItemThumb photoId={item.photoIds[0]} name={item.name} className="size-full transition-transform group-hover:scale-[1.02]" />
                  <div className="absolute top-2 left-2">
                    <StatusBadge item={item} />
                  </div>
                </div>
                <div className="p-3">
                  <p className="line-clamp-2 min-h-[2.5em] text-sm leading-tight font-medium text-ink">{item.name}</p>
                  <p className="mt-1 truncate text-xs text-muted">{[item.sku, item.category].filter(Boolean).join(' · ')}</p>
                  <div className="mt-2 flex items-end justify-between gap-2">
                    <span className="tabular text-sm font-semibold text-ink">{priceLabel(item, settings.mode, money)}</span>
                    <span className="tabular text-xs text-ink-2">Qty {item.quantity}</span>
                  </div>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <Card className="overflow-hidden" data-testid="inventory-list">
          <table className="w-full text-sm">
            <thead className="hidden bg-surface-2 text-left text-xs text-ink-2 md:table-header-group">
              <tr>
                <th className="px-4 py-2.5 font-medium">Item</th>
                <th className="px-3 py-2.5 font-medium">Category</th>
                <th className="px-3 py-2.5 font-medium">Location</th>
                <th className="px-3 py-2.5 text-right font-medium">Qty</th>
                <th className="px-3 py-2.5 text-right font-medium">Cost / item</th>
                <th className="px-3 py-2.5 text-right font-medium">{settings.mode === 'collector' ? 'Est. value' : 'Asking'}</th>
                <th className="px-4 py-2.5 text-right font-medium">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {results.map((item) => (
                <tr key={item.id} className="relative hover:bg-surface-2" data-testid="inventory-item">
                  <td className="px-4 py-2.5">
                    <Link to={`/inventory/${item.id}`} className="flex items-center gap-3 after:absolute after:inset-0">
                      <ItemThumb photoId={item.photoIds[0]} name={item.name} className="size-10 shrink-0 rounded-lg" />
                      <span className="min-w-0">
                        <span className="block truncate font-medium text-ink">{item.name}</span>
                        <span className="block truncate text-xs text-muted">
                          {item.sku}
                          <span className="md:hidden"> · Qty {item.quantity} · {priceLabel(item, settings.mode, money)}</span>
                        </span>
                      </span>
                    </Link>
                  </td>
                  <td className="hidden px-3 py-2.5 text-ink-2 md:table-cell">{item.category || '—'}</td>
                  <td className="hidden px-3 py-2.5 text-ink-2 md:table-cell">{item.location || '—'}</td>
                  <td className="tabular hidden px-3 py-2.5 text-right text-ink md:table-cell">{item.quantity}</td>
                  <td className="tabular hidden px-3 py-2.5 text-right text-ink md:table-cell">{money(item.unitCost)}</td>
                  <td className="tabular hidden px-3 py-2.5 text-right text-ink md:table-cell">
                    {settings.mode === 'collector' ? (item.estimatedValue === null ? '—' : money(item.estimatedValue)) : item.askingPrice === null ? '—' : money(item.askingPrice)}
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    <StatusBadge item={item} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
      <div className="fixed right-4 bottom-[calc(84px+env(safe-area-inset-bottom))] z-20 lg:hidden">
        <IconButton label="Add item" onClick={dialogs.addItem} className="size-14 rounded-2xl bg-accent text-white shadow-pop hover:bg-accent-hover hover:text-white">
          <PackagePlus className="size-6" />
        </IconButton>
      </div>
    </>
  );
}

function priceLabel(item: Item, mode: string, money: (n: number) => string): string {
  if (mode === 'collector') return item.estimatedValue !== null ? money(item.estimatedValue) : `Cost ${money(item.unitCost)}`;
  return item.askingPrice !== null ? money(item.askingPrice) : `Cost ${money(item.unitCost)}`;
}

export function StatusBadge({ item }: { item: Item }) {
  const s = stockStatus(item);
  if (s === 'out') return <Badge tone={item.lowStockThreshold !== null ? 'bad' : 'neutral'}>{item.lowStockThreshold !== null ? 'Out of stock' : 'Sold out'}</Badge>;
  if (s === 'low') return <Badge tone="warn">Low stock</Badge>;
  return <Badge tone="good">In stock</Badge>;
}

function FilterSelect({ label, value, onChange, options }: { label: string; value: string; onChange: (v: string) => void; options: string[][] }) {
  const active = value !== '' && value !== 'all' && value !== 'newest';
  return (
    <label className="relative shrink-0">
      <span className="sr-only">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-label={label}
        className={cn(
          'h-9 appearance-none rounded-xl border pr-8 pl-3 text-sm font-medium outline-none focus:border-accent',
          active ? 'border-accent bg-accent-soft text-accent-text' : 'border-line-strong bg-surface text-ink',
        )}
      >
        {options.map(([v, l]) => (
          <option key={v} value={v}>
            {label === 'Sort' ? `Sort: ${l}` : l}
          </option>
        ))}
      </select>
      <svg className="pointer-events-none absolute top-1/2 right-2.5 size-4 -translate-y-1/2 text-muted" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
        <path d="m6 9 6 6 6-6" />
      </svg>
    </label>
  );
}
