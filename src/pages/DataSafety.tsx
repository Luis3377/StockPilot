// Plain-language guidance about where inventory is saved and how to protect it. Used during
// onboarding, in Settings → Your data, and by the backup reminder. Nothing here moves or
// deletes data: moving between browsers, devices or the Home Screen app is always done by the
// user with a backup file and Restore.

import { useId, useState } from 'react';
import { ChevronDown, Share, Smartphone } from 'lucide-react';
import { installContext, type InstallContext } from '../lib/platform';
import { cn } from '../ui/cn';

/** What can make inventory disappear, given that it's stored only in this browser. */
export function DataRisks({ context = installContext() }: { context?: InstallContext }) {
  return (
    <ul className="list-disc space-y-1 pl-5" data-testid="data-risks">
      <li>You delete website data or clear your browsing history in your browser’s settings.</li>
      <li>You switch to a different browser or a different phone or computer. Your inventory won’t be there.</li>
      {context !== 'other' ? (
        <>
          <li>In Safari on iPhone and iPad, website data can be removed automatically if you use Safari for about a week without opening StockPilot.</li>
          <li>You delete the StockPilot icon from your Home Screen (if you installed it). That removes its data too.</li>
        </>
      ) : (
        <li>Some browsers remove website data on their own when the device is low on storage.</li>
      )}
    </ul>
  );
}

/** The steps to move inventory safely, with a backup file and Restore. */
export function MoveDataSteps() {
  return (
    <ol className="list-decimal space-y-1.5 pl-5" data-testid="move-data-steps">
      <li>
        Where your inventory is now, open <strong className="text-ink">Settings → Backup &amp; restore</strong> and tap <strong className="text-ink">Download backup</strong>. On iPhone, choose
        <strong className="text-ink"> Save to Files</strong> (iCloud Drive is a good place).
      </li>
      <li>Open StockPilot where you want your inventory: the other browser, the new device, or the Home Screen app.</li>
      <li>
        Tap <strong className="text-ink">Restore a backup</strong> on the welcome screen (or <strong className="text-ink">Settings → Restore from backup</strong>) and choose the file.
      </li>
      <li>Check that your items, photos and sales are there. Restoring replaces what’s in that place; the original copy isn’t changed.</li>
      <li>Keep using one place from then on, and keep downloading backups.</li>
    </ol>
  );
}

/** iPhone / iPad advice about the Home Screen app. No promises: installing reduces risk, it doesn't remove it. */
export function HomeScreenAdvice({ context = installContext(), className }: { context?: InstallContext; className?: string }) {
  if (context === 'other') return null;
  if (context === 'ios-home-screen') {
    return (
      <div className={cn('rounded-2xl bg-accent-soft/50 p-4 text-sm text-ink-2', className)} data-testid="home-screen-advice">
        <p className="flex items-center gap-2 font-medium text-ink">
          <Smartphone className="size-4 text-accent" /> You’re using the Home Screen app
        </p>
        <p className="mt-1">
          On iPhone and iPad, the Home Screen app keeps its own data, separate from Safari. Inventory you added in Safari may not appear here. To bring it over, download a backup in
          Safari and restore it here.
        </p>
      </div>
    );
  }
  return (
    <div className={cn('rounded-2xl bg-accent-soft/50 p-4 text-sm text-ink-2', className)} data-testid="home-screen-advice">
      <p className="flex items-center gap-2 font-medium text-ink">
        <Smartphone className="size-4 text-accent" /> On iPhone or iPad? Add StockPilot to your Home Screen first
      </p>
      <ol className="mt-2 list-decimal space-y-1 pl-5">
        <li>
          Tap the <strong className="text-ink">Share</strong> button <Share className="inline size-3.5 align-[-2px]" aria-label="(the square with an arrow)" /> in Safari.
        </li>
        <li>
          Choose <strong className="text-ink">Add to Home Screen</strong>, then <strong className="text-ink">Add</strong>.
        </li>
        <li>Open StockPilot from the new icon and enter your inventory there.</li>
      </ol>
      <p className="mt-2">
        Safari’s automatic clean-up of unused websites doesn’t apply to Home Screen apps, so this lowers the risk of losing data. It isn’t a guarantee, so keep downloading backups. The
        Home Screen app keeps its own data, separate from Safari: anything you’ve already added in Safari won’t appear there automatically. Move it with a backup file and Restore (the
        steps are in Settings → Your data).
      </p>
    </div>
  );
}

/** A collapsible section (keyboard and screen-reader friendly). */
export function Disclosure({ title, children, testId, defaultOpen = false }: { title: string; children: React.ReactNode; testId?: string; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  const id = useId();
  return (
    <div className="rounded-2xl border border-line" data-testid={testId}>
      <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} aria-controls={id} className="flex w-full items-center gap-2 px-4 py-3 text-left text-sm font-medium text-ink">
        <span className="min-w-0 flex-1">{title}</span>
        <ChevronDown className={cn('size-4 shrink-0 text-muted transition-transform', open && 'rotate-180')} />
      </button>
      <div id={id} hidden={!open} className="px-4 pb-4 text-sm text-ink-2">
        {children}
      </div>
    </div>
  );
}
