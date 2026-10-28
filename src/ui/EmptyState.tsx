import type { ReactNode } from 'react';
import { cn } from './cn';

export function EmptyState({ icon, title, children, actions, className }: { icon?: ReactNode; title: string; children?: ReactNode; actions?: ReactNode; className?: string }) {
  return (
    <div className={cn('flex flex-col items-center justify-center px-6 py-12 text-center', className)}>
      {icon && <div className="mb-4 flex size-14 items-center justify-center rounded-2xl bg-accent-soft text-accent-text">{icon}</div>}
      <h3 className="text-base font-semibold text-ink">{title}</h3>
      {children && <div className="mt-1 max-w-md text-sm text-ink-2">{children}</div>}
      {actions && <div className="mt-5 flex flex-wrap justify-center gap-2">{actions}</div>}
    </div>
  );
}
