# Freeport Slide Storytelling Skill

Use this as the governing instruction for LLM slide planning before any deck rendering.

## 1) Purpose and Scope
- Transform raw input text into a clear executive narrative that can be rendered by the Freeport deck engine.
- Focus on factual signal, not verbosity.
- Prefer 5-8 content slides unless source input is very short.

## 2) Hard Constraints (Non-Negotiable)
- Do not invent numbers, dates, or claims.
- Preserve key numeric values exactly when present.
- Any numeric claim must map to source text evidence.
- Do not convert precise values into rounded claims unless both are shown.
- Never rescale chart values or units (for example, do not convert `$0.53` into `53` or label categories with `×100`).
- If source quality is low or ambiguous, state uncertainty explicitly.
- Remove operational noise (logs, UI chrome, stack traces, repeated footer/page labels).
- Each slide must include 1-3 `sourceRefs`, formatted as: `PAGE N: short anchor phrase`.

## 3) Narrative Framework (SCQA + Pyramid)
- Use SCQA logic with Question implied:
  - Situation: current fact pattern.
  - Complication: what changed or went off-target.
  - Answer: recommendation or conclusion.
- Start with one governing thought (`mainAnswer`) for the whole deck.
- Build 2-4 supporting arguments that are MECE.
- Order supporting arguments using one mode only:
  - time sequence, or
  - structural decomposition, or
  - cause-effect chain.
- Story flow must be: executive summary -> supporting logic -> evidence -> implication.
- Each slide must represent one idea node in the pyramid.

## 4) Slide Writing Rules
- Every slide has one primary message.
- Titles must be assertion-based complete sentences.
- Avoid topic titles such as "Overview", "Analysis", "Findings", "Next Steps", or "Executive Summary".
- Titles must fit within two lines at 28pt in the Freeport title box.
- Target title length: <= 14 words and <= 85 characters.
- A reader should understand the core story by reading titles only, in order.
- Bullets must support the slide assertion; no disconnected bullet dumps.
- Keep bullets short and scannable, with parallel structure within a slide.
- Avoid repeating bullet content across slides.

## 5) Planning Contract (JSON + Field Rules)
Return JSON only with this schema:

```json
{
  "deckTitle": "string",
  "deckSubtitle": "string",
  "mainAnswer": "string",
  "supportingArguments": [
    { "id": "A1", "claim": "string" }
  ],
  "slides": [
    {
      "layout": "summary_card | two_column | metrics | chart_bar | action_split",
      "pyramidRole": "executive_summary | supporting_logic | evidence | implication",
      "supportsArgument": "A1 | A2 | A3 | A4 | ALL",
      "title": "string",
      "summary": "string",
      "sourceRefs": ["PAGE N: short anchor phrase"],
      "bullets": ["string"],
      "leftTitle": "string",
      "leftBullets": ["string"],
      "rightTitle": "string",
      "rightBullets": ["string"],
      "metrics": [
        { "label": "string", "value": "string", "note": "string" }
      ],
      "chart": {
        "title": "string",
        "categories": ["string"],
        "series": [
          { "name": "string", "values": [0] }
        ]
      }
    }
  ]
}
```

Required field behavior:
- `mainAnswer` must be one sentence stating the governing thought.
- `supportingArguments` must contain 2-4 MECE claims.
- Every slide must include `pyramidRole`.
- Every non-summary slide must include `supportsArgument` and point to `A1-A4` or `ALL`.
- At least one slide must use `pyramidRole=evidence`.
- Final slide must use `pyramidRole=implication`.

## 6) Layout Policy
Hard mapping:
- `executive_summary` -> `summary_card`
- `supporting_logic` -> `metrics` or `two_column`
- `evidence` -> `chart_bar` or `two_column`
- `implication` -> `action_split`
- Do not use `chart_bar` unless source contains numeric comparisons.

Soft layout guidance:
- Value diversity in slide layouts, target 3+ layouts when natural.
- Prefer 1 `metrics` slide when KPI signal is strong.

Soft per-layout guidance:
- `summary_card`: one large card with 4-6 bullets.
- `two_column`: comparison or design vs execution, 3-5 bullets per side.
- `metrics`: 3-5 metric cards with value + short note.
- `chart_bar`: 2-4 categories, up to 3 series, plus 3-4 readout bullets.
- `action_split`: left = impact/risks, right = actions/next steps.
- Keep bullets <= 16 words where possible.

## 7) Content Prioritization
1. Executive summary and headline outcome.
2. Quantitative performance deltas.
3. Design/execution observations.
4. Operational impact.
5. Improvement actions and next steps.

## 8) Final Self-Check
- One governing thought exists and is explicit.
- Supporting arguments are 2-4, MECE, and logically ordered.
- Every title is an assertion sentence and fits title constraints.
- Story flows from summary -> logic -> evidence -> implication.
- All numeric claims and references are evidence-anchored.
