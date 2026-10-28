import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { ItemFormDialog } from './ItemFormDialog';
import { SaleFormDialog } from './SaleFormDialog';
import { StockDialog, type StockMode } from './StockDialog';
import { ImportDialog } from './ImportDialog';
import { RestoreDialog } from './RestoreDialog';

interface DialogApi {
  addItem(): void;
  editItem(itemId: string): void;
  recordSale(itemId?: string): void;
  editSale(saleId: string): void;
  stock(itemId: string, mode: StockMode): void;
  importCsv(): void;
  restoreBackup(): void;
}

const Ctx = createContext<DialogApi | null>(null);

type Open =
  | { kind: 'item'; itemId: string | null }
  | { kind: 'sale'; itemId: string | null; saleId: string | null }
  | { kind: 'stock'; itemId: string; mode: StockMode }
  | { kind: 'import' }
  | { kind: 'restore' }
  | null;

/** Hosts the app's shared dialogs so any screen can open them. */
export function DialogHub({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState<Open>(null);
  const close = useCallback(() => setOpen(null), []);

  const api = useMemo<DialogApi>(
    () => ({
      addItem: () => setOpen({ kind: 'item', itemId: null }),
      editItem: (itemId) => setOpen({ kind: 'item', itemId }),
      recordSale: (itemId) => setOpen({ kind: 'sale', itemId: itemId ?? null, saleId: null }),
      editSale: (saleId) => setOpen({ kind: 'sale', itemId: null, saleId }),
      stock: (itemId, mode) => setOpen({ kind: 'stock', itemId, mode }),
      importCsv: () => setOpen({ kind: 'import' }),
      restoreBackup: () => setOpen({ kind: 'restore' }),
    }),
    [],
  );

  return (
    <Ctx.Provider value={api}>
      {children}
      <ItemFormDialog
        open={open?.kind === 'item'}
        itemId={open?.kind === 'item' ? open.itemId : null}
        onClose={close}
      />
      <SaleFormDialog
        open={open?.kind === 'sale'}
        itemId={open?.kind === 'sale' ? open.itemId : null}
        saleId={open?.kind === 'sale' ? open.saleId : null}
        onClose={close}
        onAddItem={() => setOpen({ kind: 'item', itemId: null })}
      />
      <StockDialog open={open?.kind === 'stock'} itemId={open?.kind === 'stock' ? open.itemId : null} mode={open?.kind === 'stock' ? open.mode : 'restock'} onClose={close} />
      <ImportDialog open={open?.kind === 'import'} onClose={close} />
      <RestoreDialog open={open?.kind === 'restore'} onClose={close} />
    </Ctx.Provider>
  );
}

export function useDialogs(): DialogApi {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useDialogs must be used inside DialogHub');
  return ctx;
}
