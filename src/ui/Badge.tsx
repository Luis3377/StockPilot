import type { ReactNode } from 'react';
import { cn } from './cn';

export type Tone = 'neutral' | 'accent' | 'good' | 'warn' | 'bad' | 'demo';

const tones: Record<Tone, string> = {
  neutral: 'bg-surface-2 text-ink-2',
  accent: 'bg-accent-soft text-accent-text',
  good: 'bg-good-soft text-good-text',
  warn: 'bg-warn-soft text-warn-text',
  bad: 'bg-bad-soft text-bad-text',
  demo: 'bg-demo-soft text-demo',
};

export function Badge({ tone = 'neutral', children, className, icon }: { tone?: Tone; children: ReactNode; className?: string; icon?: ReactNode }) {
  return (
    <span className={cn('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap', tones[tone], className)}>
      {icon}
      {children}
    </span>
  );
}
