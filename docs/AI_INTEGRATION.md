# Adding genuine AI to StockPilot Insights

The prototype ships **rule-based** insights only. Every answer is produced by fixed, testable rules in `src/insights/` that read the user's recorded data, and the UI labels them as such (“Rule-based · no AI model yet”, “Rule-based answer”). This document describes how to add a real AI model later without a redesign.

## The seam that already exists

`src/insights/assistant.ts` defines the contract the UI depends on:

```ts
interface InsightsProvider {
  readonly kind: 'rules' | 'ai';
  readonly label: string;
  ask(question: string, ctx: InsightsContext): Promise<AssistantAnswer>;
}
```

`AssistantAnswer` carries `source: 'rules' | 'ai'`, so the UI can always tell the user which kind of answer they are reading. Today the page uses `ruleBasedProvider`. An AI provider implements the same interface.

## Recommended architecture

```
Browser (StockPilot)                 Your server (e.g. a serverless function)        Model provider
--------------------                 -------------------------------------------      --------------
AIProvider.ask(question, ctx)  --->  POST /api/insights                         --->  LLM API
  • builds a compact data summary      • authenticates the user                         (API key lives
  • sends question + summary           • rate-limits / meters usage                      only here)
                                       • adds system prompt & tools
                               <---    • returns structured answer             <---
```

Rules for a safe integration:

1. **Never put an API key in the browser.** Static sites are public; any key in the bundle can be stolen. Calls go through a server you control that holds the key in an environment secret.
2. **Require sign-in first.** The AI endpoint should only serve authenticated users (see `PRODUCTION_READINESS.md`) so it can't be abused as a free proxy, and so usage can be tied to a plan.
3. **Send the minimum data.** Build a summary on the device — totals, per-category and per-platform figures, the top/bottom N items with only the fields needed — rather than the full database. Never send photos unless the feature (e.g. photo identification) requires it and the user opts in.
4. **Ground the model in the user's numbers.** Prefer giving the model *tools* that call the existing pure functions (`totalSales`, `salesByCategory`, `buildInsights`, …) over asking it to do arithmetic. The deterministic code stays the source of truth for every figure; the model explains and recommends.
5. **Keep the rules as a fallback.** If the AI call fails, is offline, or the user hasn't consented, fall back to `ruleBasedProvider` and label it.
6. **Label clearly.** Show “AI-generated” on AI answers, note that recommendations may be wrong, and keep the “How this is worked out” explanations for rule-based alerts.
7. **Get consent.** Tell users what is sent to the AI provider and let them turn it off. Update the privacy policy accordingly.

## Suggested first AI features

- Free-form questions the rules can't parse, answered with tool calls into the existing calculations.
- Plain-language weekly summaries (“You made $412 this week; candles are 60% of profit…”).
- Pricing suggestions that cite the user's own sell-through and margins (and, later, authorised market-price data sources).
- Photo-based item identification to pre-fill the add-item form (opt-in, images sent only when requested).
