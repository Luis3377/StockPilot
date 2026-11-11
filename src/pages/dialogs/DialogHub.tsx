import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { ItemFormDialog } from './ItemFormDialog';
import { SaleFormDialog, type SalePrefill } from './SaleFormDialog';
import { PayoutImportDialog } from './PayoutImportDialog';
import { StockDialog, type StockMode } from './StockDialog';
import { ImportDialog } from './ImportDialog';
import { RestoreDialog } from './RestoreDialog';
import { LotFormDialog, type BidLotPrefill } from './LotFormDialog';
import { LotEditDialog } from './LotEditDialog';

interface DialogApi {
  addItem(): void;
  /** Add Item with the AI scanner highlighted (only offered when the scanner is enabled). */
  scanItem(): void;
  editItem(itemId: string): void;
  recordSale(itemId?: string, prefill?: SalePrefill): void;
  /** Import an eBay transaction or payout report. */
  importPayouts(): void;
  editSale(saleId: string): void;
  stock(itemId: string, mode: StockMode): void;
  importCsv(): void;
  restoreBackup(): void;
  /** Add a bulk lot: several items bought for one price. */
  addLot(): void;
  /** Record a Max Bid plan's purchase as a bulk lot (the lot form, filled from the plan). */
  addLotFromBid(prefill: BidLotPrefill): void;
  editLot(lotId: string): void;
}

const Ctx = createContext<DialogApi | null>(null);

type Open =
  | { kind: 'item'; itemId: string | null; scan?: boolean }
  | { kind: 'sale'; itemId: string | null; saleId: string | null; prefill?: SalePrefill }
  | { kind: 'payouts' }
  | { kind: 'stock'; itemId: string; mode: StockMode }
  | { kind: 'import' }
  | { kind: 'restore' }
  | { kind: 'lot'; fromBid?: BidLotPrefill }
  | { kind: 'editLot'; lotId: string }
  | null;

/** Hosts the app's shared dialogs so any screen can open them. */
export function DialogHub({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState<Open>(null);
  const close = useCallback(() => setOpen(null), []);

  const api = useMemo<DialogApi>(
    () => ({
      addItem: () => setOpen({ kind: 'item', itemId: null }),
      scanItem: () => setOpen({ kind: 'item', itemId: null, scan: true }),
      editItem: (itemId) => setOpen({ kind: 'item', itemId }),
      recordSale: (itemId, prefill) => setOpen({ kind: 'sale', itemId: itemId ?? null, saleId: null, prefill }),
      importPayouts: () => setOpen({ kind: 'payouts' }),
      editSale: (saleId) => setOpen({ kind: 'sale', itemId: null, saleId }),
      stock: (itemId, mode) => setOpen({ kind: 'stock', itemId, mode }),
      importCsv: () => setOpen({ kind: 'import' }),
      restoreBackup: () => setOpen({ kind: 'restore' }),
      addLot: () => setOpen({ kind: 'lot' }),
      addLotFromBid: (prefill) => setOpen({ kind: 'lot', fromBid: prefill }),
      editLot: (lotId) => setOpen({ kind: 'editLot', lotId }),
    }),
    [],
  );

  return (
    <Ctx.Provider value={api}>
      {children}
      <ItemFormDialog
        open={open?.kind === 'item'}
        itemId={open?.kind === 'item' ? open.itemId : null}
        scan={open?.kind === 'item' && Boolean(open.scan)}
        onClose={close}
      />
      <SaleFormDialog
        open={open?.kind === 'sale'}
        itemId={open?.kind === 'sale' ? open.itemId : null}
        saleId={open?.kind === 'sale' ? open.saleId : null}
        prefill={open?.kind === 'sale' ? (open.prefill ?? null) : null}
        onClose={close}
        onAddItem={() => setOpen({ kind: 'item', itemId: null })}
      />
      <StockDialog open={open?.kind === 'stock'} itemId={open?.kind === 'stock' ? open.itemId : null} mode={open?.kind === 'stock' ? open.mode : 'restock'} onClose={close} />
      <ImportDialog open={open?.kind === 'import'} onClose={close} />
      <RestoreDialog open={open?.kind === 'restore'} onClose={close} />
      <PayoutImportDialog open={open?.kind === 'payouts'} onClose={close} />
      <LotFormDialog open={open?.kind === 'lot'} fromBid={open?.kind === 'lot' ? (open.fromBid ?? null) : null} onClose={close} />
      <LotEditDialog open={open?.kind === 'editLot'} lotId={open?.kind === 'editLot' ? open.lotId : null} onClose={close} />
    </Ctx.Provider>
  );
}

export function useDialogs(): DialogApi {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useDialogs must be used inside DialogHub');
  return ctx;
}
