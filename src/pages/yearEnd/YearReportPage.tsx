// The accountant-ready year-end summary: the finalized version (or any superseded one), or a
// draft from today's records. Print / Save as PDF uses the browser; Download saves a standalone
// HTML file; the CSV files hold every movement, sale and year-end item behind the figures.

import { Link, useParams, useSearchParams } from 'react-router-dom';
import { ArrowLeft, Download, Printer } from 'lucide-react';
import type { ReportSnapshot } from '../../domain/types';
import { formatDate, formatDateTime, todayISO } from '../../domain/dates';
import { reportHtml, type ReportLineKind } from '../../insights/controllerReport';
import { movementsCsv, YEAR_REPORT_DISCLAIMER, yearInventoryCsv, yearReport, yearReportSnapshot, yearSalesCsv, type YearReportData } from '../../insights/yearReport';
import { currentReview, YEAR_KEY } from '../../insights/yearEnd';
import { useAppState } from '../../data/store';
import { downloadText } from '../../lib/download';
import { Card, PageHeader } from '../../ui/Card';
import { Badge, type Tone } from '../../ui/Badge';
import { Button } from '../../ui/Button';
import { EmptyState } from '../../ui/EmptyState';

const KIND: Record<ReportLineKind, [string, Tone] | null> = {
  verified: ['From records', 'good'],
  contributing: null,
  possible: null,
  attention: ['Needs attention', 'warn'],
  limitation: ['Limitation', 'neutral'],
  plain: null,
};

export function YearReportPage() {
  const { year = '' } = useParams();
  const [params] = useSearchParams();
  const data = useAppState((s) => s.data);
  const settings = useAppState((s) => s.settings);
  if (!YEAR_KEY.test(year)) return <EmptyState title="Year not found">Choose a year in Year-End Review.</EmptyState>;
  const versions = data.yearEnd.reviews.filter((r) => r.periodKey === year);
  const wanted = params.get('version');
  const review = wanted ? versions.find((r) => String(r.version) === wanted) : params.get('live') === '1' ? null : currentReview(data, year);
  const live = review ? null : yearReport(data, settings, year, todayISO());
  const snap: ReportSnapshot = review ? review.report : yearReportSnapshot(live!);
  const status = review
    ? review.status === 'finalized'
      ? `Finalized ${formatDateTime(review.finalizedAt)} · version ${review.version}`
      : `Superseded version ${review.version} · finalized ${formatDateTime(review.finalizedAt)}, reopened ${formatDateTime(review.supersededAt ?? review.finalizedAt)}: ${review.reopenReason}`
    : `Draft from the current records, ${formatDate(todayISO())}${currentReview(data, year) ? ' (recalculated; the finalized summary is kept separately)' : ' · not finalized'}`;
  const figures = live?.figures ?? yearReport(data, settings, year, todayISO()).figures;
  const csv = (name: string, text: string) => downloadText(`stockpilot-${year}-${name}.csv`, text);
  return (
    <>
      <Link to={`/sales/year-end?year=${year}`} className="mb-3 inline-flex items-center gap-1 text-sm text-ink-2 hover:text-ink print:hidden">
        <ArrowLeft className="size-4" /> Year-End Review
      </Link>
      <PageHeader
        title={snap.title}
        description={status}
        actions={
          <div className="flex flex-wrap gap-2 print:hidden">
            <Button icon={<Printer className="size-4" />} onClick={() => window.print()} data-testid="year-report-print">
              Print / Save as PDF
            </Button>
            <Button icon={<Download className="size-4" />} onClick={() => downloadText(`stockpilot-year-end-${year}${review ? `-v${review.version}` : '-draft'}.html`, reportHtml(snap, { status }), 'text/html;charset=utf-8')} data-testid="year-report-download">
              Download (.html)
            </Button>
          </div>
        }
      />
      <p className="mb-4 rounded-xl border border-line bg-surface-2 p-3 text-sm text-ink-2" data-testid="year-report-disclaimer">
        {YEAR_REPORT_DISCLAIMER}
      </p>
      <Card className="mb-4 p-4 print:hidden" data-testid="year-csv">
        <p className="text-sm font-medium text-ink">Supporting detail for your accountant (CSV, from today’s records)</p>
        <div className="mt-2 flex flex-wrap gap-2">
          <Button size="sm" icon={<Download className="size-4" />} onClick={() => csv('inventory-movements', movementsCsv(figures))} data-testid="csv-movements">
            Inventory movements
          </Button>
          <Button size="sm" icon={<Download className="size-4" />} onClick={() => csv('sales-cost-of-goods-sold', yearSalesCsv(data, figures))} data-testid="csv-sales">
            Sales and cost of goods sold
          </Button>
          <Button size="sm" icon={<Download className="size-4" />} onClick={() => csv('inventory-at-year-end', yearInventoryCsv(data, figures))} data-testid="csv-inventory">
            Inventory at year-end
          </Button>
        </div>
      </Card>
      {versions.length > 0 && (
        <p className="mb-4 flex flex-wrap gap-x-3 gap-y-1 text-sm print:hidden">
          {versions.map((v) => (
            <Link key={v.id} to={`/sales/year-end/${year}/report?version=${v.version}`} className="text-accent-text hover:underline">
              Version {v.version} ({v.status === 'finalized' ? 'current' : 'superseded'})
            </Link>
          ))}
          <Link to={`/sales/year-end/${year}/report?live=1`} className="text-accent-text hover:underline">
            Current recalculation
          </Link>
        </p>
      )}
      {live ? <LiveYearReport report={live} /> : <SnapshotYearReport snap={snap} />}
    </>
  );
}

function LiveYearReport({ report }: { report: YearReportData }) {
  return (
    <div className="space-y-4" data-testid="year-report">
      {report.sections.map((s) => (
        <Card key={s.key} className="p-4 sm:p-5 print:break-inside-avoid print:shadow-none" data-testid={`year-report-${s.key}`}>
          <h2 className="text-base font-semibold text-ink">{s.title}</h2>
          {s.rows && (
            <table className="mt-2 w-full text-sm">
              <caption className="sr-only">{s.title}</caption>
              <tbody className="divide-y divide-line">
                {s.rows.map((r) => (
                  <tr key={r.label}>
                    <th scope="row" className="py-1.5 text-left font-normal text-ink-2">
                      {r.label}
                    </th>
                    <td className="tabular py-1.5 text-right text-ink">{r.current}</td>
                  </tr>
                ))}
              </tbody>
            </table>
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

function SnapshotYearReport({ snap }: { snap: ReportSnapshot }) {
  return (
    <div className="space-y-4" data-testid="year-report">
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
