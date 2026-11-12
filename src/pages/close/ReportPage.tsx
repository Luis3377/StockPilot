// The Monthly Controller's Report. For an open month: a draft generated from the current
// records, with links to the records behind each statement. For a closed month: the report as
// kept at closing (or any earlier, superseded version), with the current recalculation one
// click away. Printable (the browser's "Save as PDF" makes a PDF) and downloadable as HTML.

import { Link, useParams, useSearchParams } from 'react-router-dom';
import { ArrowLeft, Download, Printer } from 'lucide-react';
import type { ReportSnapshot } from '../../domain/types';
import { formatDate, formatDateTime, todayISO } from '../../domain/dates';
import { controllerReport, REPORT_DISCLAIMER, reportHtml, reportSnapshot, type ControllerReport, type ReportLineKind } from '../../insights/controllerReport';
import { currentClose, MONTH_KEY, monthLabel } from '../../insights/monthly';
import { useAppState } from '../../data/store';
import { downloadText } from '../../lib/download';
import { Card, PageHeader } from '../../ui/Card';
import { Badge, type Tone } from '../../ui/Badge';
import { Button } from '../../ui/Button';
import { EmptyState } from '../../ui/EmptyState';

const KIND: Record<ReportLineKind, [string, Tone] | null> = {
  verified: ['Verified', 'good'],
  contributing: ['Contributing factor', 'accent'],
  possible: ['Possible explanation, not proven', 'neutral'],
  attention: ['Needs attention', 'warn'],
  limitation: ['Limitation', 'neutral'],
  plain: null,
};

export function ReportPage() {
  const { month = '' } = useParams();
  const [params] = useSearchParams();
  const data = useAppState((s) => s.data);
  const settings = useAppState((s) => s.settings);
  if (!MONTH_KEY.test(month)) return <EmptyState title="Month not found">Choose a month in Monthly Close.</EmptyState>;
  const versions = data.monthlyClose.closes.filter((c) => c.month === month);
  const wanted = params.get('version');
  const live = params.get('live') === '1';
  const close = wanted ? versions.find((c) => String(c.version) === wanted) : live ? null : currentClose(data, month);
  const report = close ? null : controllerReport(data, settings, month, todayISO());
  const snap: ReportSnapshot = close ? close.report : reportSnapshot(report!);
  const status = close
    ? close.status === 'closed'
      ? `Closing report · closed ${formatDateTime(close.closedAt)} · version ${close.version}`
      : `Superseded version ${close.version} · closed ${formatDateTime(close.closedAt)}, reopened ${formatDateTime(close.supersededAt ?? close.closedAt)}: ${close.reopenReason}`
    : `Draft from the current records, ${formatDate(todayISO())}${currentClose(data, month) ? ' (recalculated; the closing report is kept separately)' : ' · the month isn’t closed'}`;
  return (
    <>
      <Link to={`/sales/close?month=${month}`} className="mb-3 inline-flex items-center gap-1 text-sm text-ink-2 hover:text-ink print:hidden">
        <ArrowLeft className="size-4" /> Monthly Close
      </Link>
      <PageHeader
        title={snap.title}
        description={status}
        actions={
          <div className="flex flex-wrap gap-2 print:hidden">
            <Button icon={<Printer className="size-4" />} onClick={() => window.print()} data-testid="report-print">
              Print / Save as PDF
            </Button>
            <Button icon={<Download className="size-4" />} onClick={() => downloadText(`stockpilot-controllers-report-${month}${close ? `-v${close.version}` : '-draft'}.html`, reportHtml(snap, { status }), 'text/html;charset=utf-8')} data-testid="report-download">
              Download (.html)
            </Button>
          </div>
        }
      />
      <p className="mb-4 rounded-xl border border-line bg-surface-2 p-3 text-sm text-ink-2" data-testid="report-disclaimer">
        {REPORT_DISCLAIMER}
      </p>
      {(versions.length > 0 || close) && (
        <p className="mb-4 flex flex-wrap gap-x-3 gap-y-1 text-sm print:hidden" data-testid="report-versions">
          {versions.map((v) => (
            <Link key={v.id} to={`/sales/close/${month}/report?version=${v.version}`} className="text-accent-text hover:underline">
              Version {v.version} ({v.status === 'closed' ? 'current close' : 'superseded'})
            </Link>
          ))}
          <Link to={`/sales/close/${month}/report?live=1`} className="text-accent-text hover:underline">
            Current recalculation
          </Link>
        </p>
      )}
      {report ? <LiveReport report={report} /> : <SnapshotReport snap={snap} />}
    </>
  );
}

function LiveReport({ report }: { report: ControllerReport }) {
  return (
    <div className="space-y-4" data-testid="report">
      {report.sections.map((s) => (
        <Card key={s.key} className="p-4 sm:p-5 print:break-inside-avoid print:shadow-none" data-testid={`report-${s.key}`}>
          <h2 className="text-base font-semibold text-ink">{s.title}</h2>
          {s.rows && (
            <div className="mt-2 overflow-x-auto" tabIndex={0} role="region" aria-label={s.title}>
              <table className="w-full min-w-[480px] text-sm">
                <thead>
                  <tr className="text-left text-xs text-muted">
                    <th className="py-1 font-medium">Figure</th>
                    <th className="py-1 text-right font-medium">{monthLabel(report.month)}</th>
                    <th className="py-1 text-right font-medium">{monthLabel(report.previous)}</th>
                    <th className="py-1 text-right font-medium">Change</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {s.rows.map((r) => (
                    <tr key={r.label}>
                      <th scope="row" className="py-1.5 text-left font-normal text-ink-2">
                        {r.label}
                      </th>
                      <td className="tabular py-1.5 text-right text-ink">{r.current}</td>
                      <td className="tabular py-1.5 text-right text-ink-2">{r.previous}</td>
                      <td className="tabular py-1.5 text-right text-ink-2">{r.change}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {s.lines.length > 0 && (
            <ul className="mt-2 space-y-2 text-sm">
              {s.lines.map((l, i) => (
                <li key={i} className="text-ink">
                  {KIND[l.kind] && (
                    <Badge tone={KIND[l.kind]![1]} className="mr-1.5 align-middle">
                      {KIND[l.kind]![0]}
                    </Badge>
                  )}
                  {l.text}
                  {l.links.length > 0 && (
                    <span className="ml-1 text-xs print:hidden">
                      {l.links.map((k) => (
                        <Link key={k.href + k.label} to={k.href} className="mr-2 text-accent-text underline">
                          {k.label}
                        </Link>
                      ))}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Card>
      ))}
    </div>
  );
}

function SnapshotReport({ snap }: { snap: ReportSnapshot }) {
  return (
    <div className="space-y-4" data-testid="report">
      {snap.sections
        .filter((s) => s.title !== 'About this report')
        .map((s) => (
          <Card key={s.title} className="p-4 sm:p-5 print:break-inside-avoid print:shadow-none">
            <h2 className="text-base font-semibold text-ink">{s.title}</h2>
            <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-ink">
              {s.lines.map((l, i) => (
                <li key={i}>{l}</li>
              ))}
            </ul>
          </Card>
        ))}
    </div>
  );
}
