// What the assistant's AI layer is given to explain an answer: only the verified calculation's
// figures, already formatted, plus a few of its records' names. Never notes, photos, buyer
// details, the rest of the inventory, or anything the calculation didn't use.

import { FACT_LIMITS, unverifiedNumbers, type ExplainFacts } from '../ai/explainSchema';
import { formatMoney } from '../domain/money';
import { calculationAmounts, type Calculation } from './calculations';

export function buildExplainFacts(answerText: string, calc: Calculation, currency: string): ExplainFacts {
  const money = (n: number) => formatMoney(n, currency);
  return {
    answer: answerText,
    title: calc.title,
    period: calc.period?.label ?? `as of ${calc.asOf}`,
    formula: calc.formula,
    basis: calc.basis,
    lines: calc.lines.slice(0, FACT_LIMITS.lines).map((l) => ({
      label: l.label,
      amount: `${l.op === '-' || l.negative ? '−' : l.op === '+' ? '+' : ''}${money(l.amount)}`,
    })),
    records: calc.records.slice(0, FACT_LIMITS.records).map((r) => ({
      label: r.label,
      detail: r.detail,
      amounts: Object.values(r.parts)
        .filter((v) => v !== 0)
        .slice(0, 8)
        .map((v) => money(Math.abs(v))),
    })),
    recordCount: calc.records.length,
    warnings: calc.warnings.slice(0, FACT_LIMITS.warnings),
  };
}

/**
 * The app's final check before showing an AI explanation: every money amount in it must be one
 * the engine computed for this calculation, and every other number must appear in the facts.
 * Returns the numbers that fail ([] means it can be shown as checked against your records).
 */
export function checkExplanation(explanation: string, facts: ExplainFacts, calc: Calculation): string[] {
  return unverifiedNumbers(explanation, facts, calculationAmounts(calc));
}
