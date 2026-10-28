import { useRef, useState, type FormEvent, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { AlertOctagon, AlertTriangle, ArrowUp, Bot, CheckCircle2, ChevronDown, Info, Lightbulb, Settings2, TrendingUp, User } from 'lucide-react';
import { ruleBasedProvider, SUGGESTED_QUESTIONS, type AssistantAnswer } from '../insights/assistant';
import type { InsightSection, Severity } from '../insights/rules';
import { formatDate } from '../domain/dates';
import { useAppState } from '../data/store';
import { useInsights } from '../lib/hooks';
import { salesEnabled } from '../lib/modes';
import { PageHeader, Card } from '../ui/Card';
import { Badge } from '../ui/Badge';
import { cn } from '../ui/cn';
import { inputClass } from '../ui/Fields';

interface Turn {
  id: number;
  question: string;
  answer: AssistantAnswer;
}

export function InsightsPage() {
  const report = useInsights();
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
          <Link to="/settings#alerts" className="inline-flex items-center gap-1.5 text-sm font-medium text-accent-text hover:underline">
            <Settings2 className="size-4" /> Adjust thresholds
          </Link>
        }
      />
      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1fr)_420px]">
        <div className="space-y-3 xl:order-2">
          <Assistant />
        </div>
        <div className="space-y-3 xl:order-1">
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
      <p className="truncate text-sm font-medium text-ink">{title}</p>
      <p className="text-xs text-ink-2">{detail}</p>
    </>
  );
  return <li className="py-2.5">{to ? <Link to={to} className="block hover:opacity-80">{body}</Link> : body}</li>;
}

function Assistant() {
  const data = useAppState((s) => s.data);
  const settings = useAppState((s) => s.settings);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [question, setQuestion] = useState('');
  const nextId = useRef(1);
  const endRef = useRef<HTMLDivElement>(null);

  const ask = async (q: string) => {
    const text = q.trim();
    if (!text) return;
    const answer = await ruleBasedProvider.ask(text, { data, settings });
    setTurns((t) => [...t, { id: nextId.current++, question: text, answer }].slice(-20));
    setQuestion('');
    requestAnimationFrame(() => endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }));
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    void ask(question);
  };

  return (
    <Card className="flex flex-col p-4 sm:p-5 xl:sticky xl:top-6" data-testid="assistant">
      <div className="flex items-center gap-2">
        <span className="flex size-9 items-center justify-center rounded-xl bg-accent-soft text-accent-text">
          <Bot className="size-5" />
        </span>
        <div>
          <h2 className="text-base font-semibold text-ink">Ask about your inventory</h2>
          <p className="text-xs text-ink-2">Answers use fixed rules over your records — not a live AI model.</p>
        </div>
      </div>

      <div className="mt-4 max-h-[60vh] space-y-4 overflow-y-auto" aria-live="polite">
        {turns.length === 0 && <p className="text-sm text-ink-2">Try one of these questions, or type your own:</p>}
        {turns.map((t) => (
          <div key={t.id} className="space-y-2">
            <div className="flex justify-end gap-2">
              <p className="max-w-[85%] rounded-2xl rounded-tr-md bg-accent px-3 py-2 text-sm text-white">{t.question}</p>
              <User className="mt-1 size-5 shrink-0 text-muted" aria-hidden />
            </div>
            <AnswerCard answer={t.answer} onAsk={(q) => void ask(q)} />
          </div>
        ))}
        <div ref={endRef} />
      </div>

      <div className="mt-3 flex flex-wrap gap-1.5">
        {(turns.length ? (turns[turns.length - 1].answer.followUps.length ? turns[turns.length - 1].answer.followUps : SUGGESTED_QUESTIONS.slice(0, 3)) : SUGGESTED_QUESTIONS).map((q) => (
          <button key={q} type="button" onClick={() => void ask(q)} className="rounded-full border border-line-strong bg-surface px-3 py-1.5 text-left text-xs font-medium text-ink-2 hover:border-accent hover:text-accent-text">
            {q}
          </button>
        ))}
      </div>

      <form onSubmit={submit} className="mt-3 flex gap-2">
        <input
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          placeholder="e.g. How much profit did I make last month?"
          aria-label="Ask a question"
          className={cn(inputClass, 'border-line-strong')}
          enterKeyHint="send"
        />
        <button type="submit" disabled={!question.trim()} aria-label="Ask" className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-accent text-white hover:bg-accent-hover disabled:opacity-40">
          <ArrowUp className="size-5" />
        </button>
      </form>
    </Card>
  );
}

function AnswerCard({ answer, onAsk }: { answer: AssistantAnswer; onAsk: (q: string) => void }) {
  return (
    <div className="flex gap-2" data-testid="assistant-answer">
      <Bot className="mt-1 size-5 shrink-0 text-accent" aria-hidden />
      <div className="min-w-0 flex-1 rounded-2xl rounded-tl-md bg-surface-2 px-3 py-2.5 text-sm">
        <p className="text-ink">{answer.text}</p>
        {answer.details.length > 0 && (
          <ul className="mt-2 space-y-1 text-xs text-ink-2">
            {answer.details.map((d) => (
              <li key={d} className="flex gap-1.5">
                <span aria-hidden>•</span>
                <span>{d}</span>
              </li>
            ))}
          </ul>
        )}
        {answer.table && (
          <div className="mt-2 overflow-x-auto rounded-lg border border-line bg-surface">
            <table className="w-full text-xs">
              <thead className="bg-surface-2 text-left text-ink-2">
                <tr>
                  {answer.table.columns.map((c, i) => (
                    <th key={c} className={cn('px-2 py-1.5 font-medium whitespace-nowrap', i > 0 && 'text-right')}>
                      {c}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="tabular">
                {answer.table.rows.map((r, ri) => (
                  <tr key={ri} className="border-t border-line">
                    {r.map((c, ci) => (
                      <td key={ci} className={cn('px-2 py-1.5 text-ink', ci > 0 ? 'text-right whitespace-nowrap' : 'max-w-[180px] truncate')}>
                        {ci === 0 && answer.items?.some((i) => i.name === c) ? (
                          <Link to={`/inventory/${answer.items.find((i) => i.name === c)!.id}`} className="text-accent-text hover:underline">
                            {c}
                          </Link>
                        ) : (
                          c
                        )}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {answer.items && !answer.table && answer.items.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {answer.items.map((i) => (
              <Link key={i.id} to={`/inventory/${i.id}`} className="text-xs font-medium text-accent-text hover:underline">
                Open {i.name} →
              </Link>
            ))}
          </div>
        )}
        <div className="mt-2 flex items-center justify-between gap-2">
          <span className="text-[10px] tracking-wide text-muted uppercase">Rule-based answer</span>
          {answer.intent === 'unknown' && (
            <button type="button" onClick={() => onAsk('help')} className="text-xs font-medium text-accent-text hover:underline">
              What can I ask?
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
