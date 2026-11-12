import { useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { AlertOctagon, AlertTriangle, CheckCircle2, ChevronDown, Info, Lightbulb, Settings2, Store, TrendingUp } from 'lucide-react';
import { AssistantPanel } from './assistant/AssistantPanel';
import type { InsightSection, Severity } from '../insights/rules';
import { formatDate } from '../domain/dates';
import { useAppState } from '../data/store';
import { useInsights, useReportingPeriod } from '../lib/hooks';
import { PeriodPicker } from '../ui/PeriodPicker';
import { salesEnabled } from '../lib/modes';
import { PageHeader, Card } from '../ui/Card';
import { Badge } from '../ui/Badge';
import { cn } from '../ui/cn';

export function InsightsPage() {
  const [period, setPeriod] = useReportingPeriod();
  const report = useInsights(period);
  const settings = useAppState((s) => s.settings);
  const selling = salesEnabled(settings);

  const sections: ReactNode[] = [
    <Section key="low" section={report.lowStock} />,
    <Section key="slow" section={report.slowMoving} />,
    selling && <Section key="pricing" section={report.pricingRisks} />,
    selling && (
      <Section
        key="margin"
        section={report.lowMarginSales}
        render={(f) => <FindingRow key={f.group.key} to={f.item ? `/inventory/${f.item.id}` : undefined} title={f.group.label} detail={f.detail} />}
      />
    ),
    selling && (
      <Section
        key="top"
        section={report.topRevenue}
        render={(f, i) => <FindingRow key={f.group.key} to={f.item ? `/inventory/${f.item.id}` : undefined} title={`${i + 1}. ${f.group.label}`} detail={f.detail} />}
      />
    ),
    selling && <Section key="cat" section={report.categories} render={(f) => <FindingRow key={f.group.key} title={f.group.label} detail={f.detail} />} />,
    <Section
      key="disc"
      section={report.discrepancies}
      render={(f) => <FindingRow key={f.adjustment.id} to={`/inventory/${f.adjustment.itemId}`} title={`${f.adjustment.itemName} · ${formatDate(f.adjustment.date)}`} detail={f.detail} />}
    />,
  ].filter(Boolean);

  return (
    <>
      <PageHeader
        title="StockPilot Insights"
        description="Alerts, recommendations and answers calculated from your own inventory and sales records."
        eyebrow={
          <Badge tone="accent" icon={<Lightbulb className="size-3" />}>
            Rule-based · no AI model yet
          </Badge>
        }
        actions={
          <>
            <Link to="/insights/sourcing" className="inline-flex items-center gap-1.5 rounded-xl border border-line-strong bg-surface px-3 py-2 text-sm font-medium text-ink hover:bg-surface-2" data-testid="sourcing-link">
              <Store className="size-4" /> Sourcing Performance
            </Link>
            <Link to="/settings#alerts" className="inline-flex items-center gap-1.5 text-sm font-medium text-accent-text hover:underline">
              <Settings2 className="size-4" /> Adjust thresholds
            </Link>
          </>
        }
      />
      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1fr)_420px]">
        <div className="space-y-3 xl:order-2">
          <AssistantPanel />
        </div>
        <div className="space-y-3 xl:order-1">
          {selling && (
            <div className="space-y-1.5">
              <PeriodPicker value={period} onChange={setPeriod} />
              <p className="text-xs text-ink-2">The period applies to sales-based insights and matches the Overview. Stock-based insights always show today.</p>
            </div>
          )}
          {report.dataGaps.length > 0 && (
            <Card className="bg-accent-soft/40 p-4">
              <p className="mb-1 flex items-center gap-2 text-sm font-semibold text-ink">
                <Info className="size-4 text-accent" /> Missing information that limits these insights
              </p>
              <ul className="list-disc space-y-0.5 pl-6 text-sm text-ink-2">
                {report.dataGaps.map((g) => (
                  <li key={g}>{g}</li>
                ))}
              </ul>
            </Card>
          )}
          {sections}
        </div>
      </div>
    </>
  );
}

const SEVERITY: Record<Severity, { icon: ReactNode; tone: 'bad' | 'warn' | 'accent' | 'good' }> = {
  critical: { icon: <AlertOctagon className="size-5 text-bad" />, tone: 'bad' },
  warning: { icon: <AlertTriangle className="size-5 text-warn" />, tone: 'warn' },
  info: { icon: <Info className="size-5 text-accent" />, tone: 'accent' },
  good: { icon: <TrendingUp className="size-5 text-good" />, tone: 'good' },
};

function Section<T>({ section, render }: { section: InsightSection<T>; render?: (f: T, i: number) => ReactNode }) {
  const [expanded, setExpanded] = useState(false);
  const [showRule, setShowRule] = useState(false);
  const empty = section.findings.length === 0;
  const sev = section.insufficient || empty ? { icon: <CheckCircle2 className="size-5 text-good" />, tone: 'good' as const } : SEVERITY[section.severity];
  const shown = expanded ? section.findings : section.findings.slice(0, 5);
  const renderRow =
    render ??
    ((f: T) => {
      const { item, detail } = f as unknown as { item: { id: string; name: string }; detail: string };
      return <FindingRow key={item.id} to={`/inventory/${item.id}`} title={item.name} detail={detail} />;
    });
  return (
    <Card className="p-4 sm:p-5" data-testid={`insight-${section.id}`}>
      <div className="flex items-start gap-3">
        <span className="mt-0.5 shrink-0">{section.insufficient ? <Info className="size-5 text-muted" /> : sev.icon}</span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-base font-semibold text-ink">{section.title}</h2>
            {!section.insufficient && section.findings.length > 0 && section.severity !== 'good' && section.severity !== 'info' && (
              <Badge tone={sev.tone}>{section.findings.length}</Badge>
            )}
            <span className="rounded-md bg-surface-2 px-1.5 py-0.5 text-[11px] font-medium text-ink-2" data-testid="insight-period">
              {section.period === 'today' ? 'Today' : section.period.charAt(0).toUpperCase() + section.period.slice(1)}
            </span>
          </div>
          <p className="mt-0.5 text-sm text-ink-2">{section.insufficient ?? section.summary}</p>
          <button type="button" onClick={() => setShowRule((v) => !v)} className="mt-1 inline-flex items-center gap-1 text-xs font-medium text-muted hover:text-ink" aria-expanded={showRule}>
            How this is worked out <ChevronDown className={cn('size-3 transition-transform', showRule && 'rotate-180')} />
          </button>
          {showRule && <p className="mt-1 rounded-lg bg-surface-2 px-3 py-2 text-xs text-ink-2">{section.rule}</p>}
        </div>
      </div>
      {!section.insufficient && section.findings.length > 0 && (
        <ul className="mt-3 divide-y divide-line border-t border-line">
          {shown.map((f, i) => renderRow(f, i))}
        </ul>
      )}
      {section.findings.length > 5 && (
        <button type="button" onClick={() => setExpanded((v) => !v)} className="mt-2 text-sm font-medium text-accent-text hover:underline">
          {expanded ? 'Show fewer' : `Show all ${section.findings.length}`}
        </button>
      )}
    </Card>
  );
}

function FindingRow({ title, detail, to }: { title: string; detail: string; to?: string }) {
  const body = (
    <>
      <p className="text-sm font-medium break-words text-ink">{title}</p>
      <p className="text-xs text-ink-2">{detail}</p>
    </>
  );
  return <li className="py-2.5">{to ? <Link to={to} className="block hover:opacity-80">{body}</Link> : body}</li>;
}
