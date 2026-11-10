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

// Status dots for badges drawn over photos. The pill itself is solid near-black in both
// themes, so these only need to stand out against that, not against the photo.
const dots: Record<Tone, string> = {
  neutral: '#b5b4ad',
  accent: '#5598e7',
  good: '#3ec43e',
  warn: '#fab219',
  bad: '#f06060',
  demo: '#9085e9',
};

interface BadgeProps {
  tone?: Tone;
  children: ReactNode;
  className?: string;
  icon?: ReactNode;
  /** Sits on top of a photo: use a solid pill so it stays readable on any image. */
  onImage?: boolean;
}

export function Badge({ tone = 'neutral', children, className, icon, onImage }: BadgeProps) {
  if (onImage) {
    return (
      <span
        data-on-image
        className={cn('inline-flex items-center gap-1.5 rounded-full bg-[#141413] px-2 py-0.5 text-xs font-medium whitespace-nowrap text-white shadow-sm ring-1 ring-white/15', className)}
      >
        <span aria-hidden className="size-1.5 shrink-0 rounded-full" style={{ background: dots[tone] }} />
        {icon}
        {children}
      </span>
    );
  }
  return (
    <span className={cn('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap', tones[tone], className)}>
      {icon}
      {children}
    </span>
  );
}
