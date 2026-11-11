// The Smart Insights assistant: a concise answer first, then the calculation behind it, which
// opens to show the period, formula and every record used, with links. In builds with the AI
// backend, the user can ask the AI to explain an answer or to understand a question. The AI
// never calculates, and its wording is shown only if every figure in it checks out.

import { useRef, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, ArrowUp, Bot, CheckCircle2, ChevronDown, ShieldCheck, Sparkles, User } from 'lucide-react';
import { answerQuestion, SUGGESTED_QUESTIONS, type AssistantAnswer } from '../../insights/assistant';
import { verifyCalculation, type Calculation, type CalcLine } from '../../insights/calculations';
import { buildExplainFacts, checkExplanation } from '../../insights/explainFacts';
import { canonicalQuestion } from '../../ai/explainSchema';
import { explainAnswer, interpretQuestion, AssistantError } from '../../ai/assistantClient';
import { scannerEnabled } from '../../ai/config';
import { useTesterCode } from '../../ai/testerCode';
import { formatDate } from '../../domain/dates';
import { useAppState } from '../../data/store';
import { useMoney } from '../../lib/hooks';
import { Card } from '../../ui/Card';
import { Badge } from '../../ui/Badge';
import { Button } from '../../ui/Button';
import { inputClass } from '../../ui/Fields';
import { cn } from '../../ui/cn';

interface Turn {
  id: number;
  question: string;
  answer: AssistantAnswer;
  /** Set when the AI mapped the user's own words to this supported question. */
  interpretedAs?: string;
}

export function AssistantPanel() {
  const data = useAppState((s) => s.data);
  const settings = useAppState((s) => s.settings);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [question, setQuestion] = useState('');
  const nextId = useRef(1);
  const endRef = useRef<HTMLDivElement>(null);

  const push = (turn: Omit<Turn, 'id'>) => {
    setTurns((t) => [...t, { id: nextId.current++, ...turn }].slice(-20));
    requestAnimationFrame(() => endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }));
  };

  const ask = (q: string) => {
    const text = q.trim();
    if (!text) return;
    push({ question: text, answer: answerQuestion(text, { data, settings }) });
    setQuestion('');
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    ask(question);
  };

  const last = turns[turns.length - 1];
  const chips = last ? (last.answer.followUps.length ? last.answer.followUps : SUGGESTED_QUESTIONS.slice(0, 4)) : SUGGESTED_QUESTIONS.slice(0, 8);

  return (
    <Card className="flex flex-col p-4 sm:p-5 xl:sticky xl:top-6" data-testid="assistant">
      <div className="flex items-center gap-2">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-accent-soft text-accent-text">
          <Bot className="size-5" />
        </span>
        <div className="min-w-0">
          <h2 className="text-base font-semibold text-ink">Ask about your inventory</h2>
          <p className="text-xs text-ink-2">
            Every figure comes from your records, with its calculation.{' '}
            {scannerEnabled ? 'AI can explain an answer when you ask; it never calculates.' : 'Answers use fixed rules, not an AI model.'}
          </p>
        </div>
      </div>

      <div className="mt-4 space-y-4 xl:max-h-[65vh] xl:overflow-y-auto" aria-live="polite">
        {turns.length === 0 && <p className="text-sm text-ink-2">Try one of these questions, or type your own:</p>}
        {turns.map((t) => (
          <div key={t.id} className="space-y-2">
            <div className="flex justify-end gap-2">
              <p className="max-w-[85%] rounded-2xl rounded-tr-md bg-accent px-3 py-2 text-sm break-words text-white">{t.question}</p>
              <User className="mt-1 size-5 shrink-0 text-muted" aria-hidden />
            </div>
            <AnswerCard
              turn={t}
              onAsk={ask}
              onInterpreted={(canonical) => push({ question: t.question, answer: answerQuestion(canonical, { data, settings }), interpretedAs: canonical })}
            />
          </div>
        ))}
        <div ref={endRef} />
      </div>

      <div className="mt-3 flex flex-wrap gap-1.5" data-testid="assistant-suggestions">
        {chips.map((q) => (
          <button key={q} type="button" onClick={() => ask(q)} className="rounded-full border border-line-strong bg-surface px-3 py-1.5 text-left text-xs font-medium text-ink-2 hover:border-accent hover:text-accent-text">
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
          maxLength={500}
        />
        <button type="submit" disabled={!question.trim()} aria-label="Ask" className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-accent text-white hover:bg-accent-hover disabled:opacity-40">
          <ArrowUp className="size-5" />
        </button>
      </form>
    </Card>
  );
}

function AnswerCard({ turn, onAsk, onInterpreted }: { turn: Turn; onAsk: (q: string) => void; onInterpreted: (canonical: string) => void }) {
  const { answer } = turn;
  const calc = answer.calculation;
  const problems = calc ? verifyCalculation(calc) : [];
  return (
    <div className="flex gap-2" data-testid="assistant-answer" data-intent={answer.intent}>
      <Bot className="mt-1 size-5 shrink-0 text-accent" aria-hidden />
      <div className="min-w-0 flex-1 rounded-2xl rounded-tl-md bg-surface-2 px-3 py-2.5 text-sm">
        {turn.interpretedAs && (
          <p className="mb-1 flex items-center gap-1 text-xs text-ink-2" data-testid="interpreted-as">
            <Sparkles className="size-3.5 shrink-0 text-demo" aria-hidden /> AI understood this as “{turn.interpretedAs}”. The answer below is calculated from your records.
          </p>
        )}
        <p className="break-words text-ink">{answer.text}</p>
        {answer.details.length > 0 && (
          <ul className="mt-2 space-y-1 text-xs text-ink-2">
            {answer.details.map((d) => (
              <li key={d} className="flex gap-1.5">
                <span aria-hidden>•</span>
                <span className="min-w-0 break-words">{d}</span>
              </li>
            ))}
          </ul>
        )}
        {calc && problems.length === 0 && <CalculationSummary calc={calc} />}
        {calc && problems.length > 0 && (
          <p className="mt-2 rounded-lg bg-bad-soft p-2 text-xs text-bad-text" role="alert">
            This calculation didn’t add up when re-checked against your records, so its figures aren’t shown. Please report this.
          </p>
        )}
        {answer.table && !calc && <AnswerTable answer={answer} />}
        {answer.items && !answer.table && !calc && answer.items.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {answer.items.map((i) => (
              <Link key={i.id} to={`/inventory/${i.id}`} className="text-xs font-medium text-accent-text hover:underline">
                Open {i.name} →
              </Link>
            ))}
          </div>
        )}
        {scannerEnabled && calc && problems.length === 0 && <AiExplain question={turn.question} answer={answer} calc={calc} />}
        {scannerEnabled && answer.intent === 'unknown' && !turn.interpretedAs && <AiInterpret question={turn.question} onInterpreted={onInterpreted} />}
        <div className="mt-2 flex items-center justify-between gap-2">
          <span className="text-[10px] tracking-wide text-muted uppercase">Rule-based answer{calc ? ' · from your records' : ''}</span>
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

const BASIS: Record<Calculation['basis'], { label: string; tone: 'good' | 'warn' | 'accent' }> = {
  recorded: { label: 'Recorded figures', tone: 'good' },
  estimate: { label: 'Includes estimates', tone: 'warn' },
  reconciliation: { label: 'From payout reconciliation', tone: 'accent' },
};

function periodText(calc: Calculation): string {
  if (!calc.period) return `As of today (${formatDate(calc.asOf)})`;
  const { start, end, label } = calc.period;
  const range = start ? `${formatDate(start)} – ${formatDate(end)}` : `up to ${formatDate(end)}`;
  return `${label.charAt(0).toUpperCase()}${label.slice(1)} · ${range}`;
}

function LineRow({ line, money }: { line: CalcLine; money: (n: number) => string }) {
  // Zero has no sign; otherwise show what the line does to the total (+/−) or that it's negative.
  const sign = line.amount === 0 ? '' : line.op === '-' || line.negative ? '−' : line.op === '+' ? '+' : '';
  const strong = line.op === '=';
  return (
    <div className={cn('flex items-baseline justify-between gap-3 py-0.5', strong && 'mt-0.5 border-t border-line pt-1 font-semibold text-ink', line.op === 'sub' && 'text-ink-2 italic')}>
      <span className="min-w-0 break-words">
        {line.label}
        {line.basis === 'estimate' && <span className="ml-1 text-[10px] font-medium text-warn-text">estimate</span>}
      </span>
      <span className="tabular shrink-0">
        {sign}
        {money(line.amount)}
      </span>
    </div>
  );
}

function CalculationSummary({ calc }: { calc: Calculation }) {
  const { money } = useMoney();
  const [open, setOpen] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const records = showAll ? calc.records : calc.records.slice(0, 8);
  return (
    <div className="mt-2 rounded-xl border border-line bg-surface p-2.5 text-xs" data-testid="calculation">
      <div className="mb-1 flex flex-wrap items-center gap-1.5">
        <Badge tone={BASIS[calc.basis].tone}>{BASIS[calc.basis].label}</Badge>
        <span className="text-muted">{periodText(calc)}</span>
      </div>
      <div className="text-ink" data-testid="calculation-lines">
        {calc.lines.map((l) => (
          <LineRow key={l.key} line={l} money={money} />
        ))}
      </div>
      {calc.warnings.length > 0 && (
        <p className="mt-1.5 flex items-start gap-1 text-warn-text" data-testid="calculation-warning">
          <AlertTriangle className="mt-px size-3.5 shrink-0" aria-hidden />
          <span className="min-w-0 break-words">
            {calc.warnings[0]}
            {calc.warnings.length > 1 && ` (+${calc.warnings.length - 1} more under View calculation)`}
          </span>
        </p>
      )}
      <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} className="mt-1.5 inline-flex items-center gap-1 font-medium text-accent-text hover:underline" data-testid="view-calculation">
        {open ? 'Hide calculation' : `View calculation (${calc.records.length} record${calc.records.length === 1 ? '' : 's'})`}
        <ChevronDown className={cn('size-3.5 transition-transform', open && 'rotate-180')} aria-hidden />
      </button>
      {open && (
        <div className="mt-2 space-y-2 border-t border-line pt-2" data-testid="calculation-details">
          <p className="text-ink-2">
            <span className="font-medium text-ink">How it’s calculated: </span>
            {calc.formula}
          </p>
          {calc.lines.filter((l) => l.note).map((l) => (
            <p key={l.key} className="text-ink-2">
              <span className="font-medium text-ink">{l.label}: </span>
              {l.note}
            </p>
          ))}
          <p className="flex items-center gap-1 text-good-text" data-testid="calculation-verified">
            <ShieldCheck className="size-3.5 shrink-0" aria-hidden /> Re-checked: every figure above adds up from the {calc.records.length} record{calc.records.length === 1 ? '' : 's'} below.
          </p>
          {calc.warnings.length > 0 && (
            <ul className="space-y-1 text-warn-text">
              {calc.warnings.map((w) => (
                <li key={w} className="flex gap-1">
                  <AlertTriangle className="mt-px size-3.5 shrink-0" aria-hidden />
                  <span className="min-w-0 break-words">{w}</span>
                </li>
              ))}
            </ul>
          )}
          {calc.records.length > 0 ? (
            <ul className="divide-y divide-line" data-testid="calculation-records">
              {records.map((r) => (
                <li key={`${r.kind}:${r.id}`} className="py-1.5" data-testid="calculation-record">
                  <div className="flex flex-wrap items-baseline justify-between gap-x-2">
                    <span className="min-w-0 font-medium break-words text-ink">{r.label}</span>
                    <span className="tabular text-ink-2">
                      {calc.lines
                        .filter((l) => r.parts[l.key])
                        .map((l) => `${l.label.split(' (')[0]} ${r.parts[l.key] < 0 ? '−' : ''}${money(Math.abs(r.parts[l.key]))}`)
                        .join(' · ')}
                    </span>
                  </div>
                  <p className="break-words text-ink-2">{r.detail}</p>
                  <p className="mt-0.5 flex flex-wrap gap-x-3">
                    {r.links.map((l) => (
                      <Link key={l.href + l.label} to={l.href} className="font-medium text-accent-text hover:underline">
                        {l.label} →
                      </Link>
                    ))}
                  </p>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-ink-2">No records match, so the figure is $0.</p>
          )}
          {calc.records.length > records.length && (
            <button type="button" onClick={() => setShowAll(true)} className="font-medium text-accent-text hover:underline">
              Show all {calc.records.length} records
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function AnswerTable({ answer }: { answer: AssistantAnswer }) {
  const table = answer.table!;
  return (
    <div className="mt-2 overflow-x-auto rounded-lg border border-line bg-surface">
      <table className="w-full text-xs">
        <thead className="bg-surface-2 text-left text-ink-2">
          <tr>
            {table.columns.map((c, i) => (
              <th key={c} className={cn('px-2 py-1.5 font-medium whitespace-nowrap', i > 0 && 'text-right')}>
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="tabular">
          {table.rows.map((r, ri) => (
            <tr key={ri} className="border-t border-line">
              {r.map((c, ci) => (
                <td key={ci} className={cn('px-2 py-1.5 text-ink', ci > 0 ? 'text-right whitespace-nowrap' : 'min-w-[8rem] break-words')}>
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
  );
}

// ---------------------------------------------------------------------------
// AI layer (builds with the AI backend only; every request is the user's explicit choice)
// ---------------------------------------------------------------------------

type AiState =
  | { kind: 'idle' }
  | { kind: 'confirm' }
  | { kind: 'sending' }
  | { kind: 'done'; text: string; modelLabel: string; left: number | null }
  | { kind: 'refused'; numbers: string[] }
  | { kind: 'error'; message: string; needsCode: boolean };

function NeedsCode() {
  return (
    <p className="text-xs text-ink-2">
      AI answers need your tester invite code.{' '}
      <Link to="/settings" className="font-medium text-accent-text hover:underline">
        Add it in Settings
      </Link>
      .
    </p>
  );
}

function AiExplain({ question, answer, calc }: { question: string; answer: AssistantAnswer; calc: Calculation }) {
  const code = useTesterCode();
  const currency = useAppState((s) => s.settings.currency);
  const [state, setState] = useState<AiState>({ kind: 'idle' });
  const facts = buildExplainFacts(answer.text, calc, currency);

  const send = async () => {
    if (!code) return;
    setState({ kind: 'sending' });
    try {
      const r = await explainAnswer(code, question, facts);
      // The backend already refuses unverified numbers; check again here against the engine's own amounts.
      const bad = r.text === null ? r.unverified : checkExplanation(r.text, facts, calc);
      if (r.text === null || bad.length) setState({ kind: 'refused', numbers: bad.length ? bad : r.unverified });
      else setState({ kind: 'done', text: r.text, modelLabel: r.modelLabel, left: r.requestsLeftToday });
    } catch (e) {
      const err = e instanceof AssistantError ? e : new AssistantError('network');
      setState({ kind: 'error', message: err.message, needsCode: err.needsCode });
    }
  };

  return (
    <div className="mt-2" data-testid="ai-explain">
      {state.kind === 'idle' && (
        <Button size="sm" variant="soft" icon={<Sparkles className="size-3.5" />} onClick={() => setState({ kind: 'confirm' })}>
          Explain with AI
        </Button>
      )}
      {state.kind === 'confirm' && (
        <div className="space-y-2 rounded-xl border border-line bg-surface p-2.5 text-xs" data-testid="ai-explain-confirm">
          <p className="text-ink-2">
            This sends your question and the figures in this calculation (the {facts.lines.length} lines above, and the names and amounts of {facts.records.length} of its {facts.recordCount} record{facts.recordCount === 1 ? '' : 's'}) to Anthropic’s Claude, through
            StockPilot’s beta server. Not your notes, photos or the rest of your inventory. It uses 1 of today’s AI requests.
          </p>
          {code ? (
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="primary" onClick={() => void send()} data-testid="ai-explain-send">
                Send and explain
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setState({ kind: 'idle' })}>
                Cancel
              </Button>
            </div>
          ) : (
            <NeedsCode />
          )}
        </div>
      )}
      {state.kind === 'sending' && <p className="text-xs text-ink-2">Asking the AI to explain these figures…</p>}
      {state.kind === 'done' && (
        <div className="rounded-xl border border-demo/30 bg-demo-soft/40 p-2.5 text-xs" data-testid="ai-explanation">
          <p className="text-sm break-words text-ink">{state.text}</p>
          <p className="mt-1.5 flex items-start gap-1 text-good-text">
            <CheckCircle2 className="mt-px size-3.5 shrink-0" aria-hidden />
            <span className="min-w-0">
              AI wording by {state.modelLabel}. Every number in it was checked against the calculation above.
              {state.left !== null && <span className="text-muted"> {state.left} AI requests left today.</span>}
            </span>
          </p>
        </div>
      )}
      {state.kind === 'refused' && (
        <p className="flex items-start gap-1 rounded-xl bg-warn-soft p-2.5 text-xs text-warn-text" role="status" data-testid="ai-explanation-refused">
          <AlertTriangle className="mt-px size-3.5 shrink-0" aria-hidden />
          <span>
            The AI’s explanation included {state.numbers.length === 1 ? 'a figure' : 'figures'} ({state.numbers.join(', ')}) that {state.numbers.length === 1 ? 'isn’t' : 'aren’t'} in your records, so it isn’t shown. The verified calculation above is unchanged.
          </span>
        </p>
      )}
      {state.kind === 'error' && (
        <div className="rounded-xl bg-bad-soft p-2.5 text-xs text-bad-text" role="alert" data-testid="ai-explain-error">
          <p>{state.message}</p>
          {state.needsCode && <NeedsCode />}
        </div>
      )}
    </div>
  );
}

function AiInterpret({ question, onInterpreted }: { question: string; onInterpreted: (canonical: string) => void }) {
  const code = useTesterCode();
  const [state, setState] = useState<AiState | { kind: 'unsupported' } | { kind: 'mapped' }>({ kind: 'idle' });
  const send = async () => {
    if (!code) return;
    setState({ kind: 'sending' });
    try {
      const r = await interpretQuestion(code, question);
      if (r.intent === 'unsupported') setState({ kind: 'unsupported' });
      else {
        // One request per question: the answer appears as the next turn.
        setState({ kind: 'mapped' });
        onInterpreted(canonicalQuestion(r.intent, r.period));
      }
    } catch (e) {
      const err = e instanceof AssistantError ? e : new AssistantError('network');
      setState({ kind: 'error', message: err.message, needsCode: err.needsCode });
    }
  };
  return (
    <div className="mt-2" data-testid="ai-interpret">
      {state.kind === 'idle' && (
        <Button size="sm" variant="soft" icon={<Sparkles className="size-3.5" />} onClick={() => setState({ kind: 'confirm' })}>
          Ask AI to understand the question
        </Button>
      )}
      {state.kind === 'confirm' && (
        <div className="space-y-2 rounded-xl border border-line bg-surface p-2.5 text-xs">
          <p className="text-ink-2">This sends only your question (no records) to Anthropic’s Claude, which picks the matching question StockPilot can answer. The answer is then calculated from your records. It uses 1 of today’s AI requests.</p>
          {code ? (
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="primary" onClick={() => void send()} data-testid="ai-interpret-send">
                Send question
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setState({ kind: 'idle' })}>
                Cancel
              </Button>
            </div>
          ) : (
            <NeedsCode />
          )}
        </div>
      )}
      {state.kind === 'sending' && <p className="text-xs text-ink-2">Asking the AI which question this is…</p>}
      {state.kind === 'mapped' && <p className="text-xs text-ink-2">Answered below, from your records.</p>}
      {state.kind === 'unsupported' && (
        <p className="text-xs text-ink-2" data-testid="ai-interpret-unsupported">
          The AI couldn’t match it to a question StockPilot can answer from your records, so there’s no answer rather than a guess.
        </p>
      )}
      {state.kind === 'error' && (
        <div className="rounded-xl bg-bad-soft p-2.5 text-xs text-bad-text" role="alert">
          <p>{state.message}</p>
          {'needsCode' in state && state.needsCode && <NeedsCode />}
        </div>
      )}
    </div>
  );
}
