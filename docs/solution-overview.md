# Solution Overview (New Developer Guide)

Generated: 2026-03-06T18:58:07.661Z

## What This Solution Does
This project builds a Freeport-branded PowerPoint deck from either raw source content (`--input`) or a prebuilt slide plan (`--plan-file`).
The pipeline enforces narrative quality and structural correctness before writing a final deck.

## End-to-End Flow
1. `pipeline/generate-freeport-deck.js` starts the run, parses args, and orchestrates every step.
2. `pipeline/load-env.js` loads `.env` values (API key/model/base URL overrides).
3. If `--input` is used, `scripts/extract_input_text.py` extracts source text.
4. `pipeline/llm-slide-planner.js` creates prompts and calls Anthropic (`POST /messages`) to produce a plan.
5. The same planner file normalizes and validates the plan against strict narrative/layout/schema rules.
6. `pipeline/freeport-deck-engine.js` renders validated slides into a styled `.pptx`.
7. `scripts/qa_rendered_deck.py` converts to PDF and checks title/bullet presence and clipping risk.
8. On success, artifacts are written to `output/` (`.plan.json`, `.pptx`, and QA PDF).

## Core Components
- `behavior/freeport-slide-storytelling-skill.md`: Prompt contract for narrative shape (SCQA + pyramid), source refs, and layout intent.
- `behavior/freeport-slide-styleguide.js`: Visual system (theme, text styles, shape styles, chart defaults, slide helpers).
- `pipeline/llm-slide-planner.js`: Planning brain and pre-render gatekeeper.
- `pipeline/freeport-deck-engine.js`: Rendering layer from logical layouts to visual slides.
- `scripts/qa_rendered_deck.py`: Post-render quality gate.

## Where The LLM Is Called
The outbound LLM call happens in `pipeline/llm-slide-planner.js` inside `requestAnthropicJson()`, which uses `fetch()` to call Anthropic `.../messages`.
This function is invoked by `planSlidesFromText()`.

## Runtime Modes
- Input mode: `node pipeline/generate-freeport-deck.js --input <file>`
- Plan mode: `node pipeline/generate-freeport-deck.js --plan-file <plan.json>`

## Failure Behavior
- Validation failure: run stops before rendering and prints detailed rule violations.
- Rendering failure: run stops with render error.
- QA failure: run stops after render and prints slide-level QA issues.

## Generated Documentation Artifacts
- `docs/solution-flow.mmd`: Mermaid source for the architecture flow.
- `docs/solution-flow.png`: Rendered flow diagram.
- `docs/solution-flow.md`: Lightweight page that displays the PNG.
- `docs/solution-overview.md`: This narrative guide.

## How To Regenerate This Documentation
Run one command from project root:

```bash
npm run docs:generate
```
