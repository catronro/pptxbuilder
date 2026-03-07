# Environment Setup (New Machine)

Generated: 2026-03-07T01:39:12.605Z

## 1. Prerequisites
- Node.js 20+ and npm
- Python 3.10+ with `pip`
- LibreOffice (`soffice`) available on PATH (required for post-render QA)
- Git

## 2. Clone and Install
```bash
git clone <your-repo-url>
cd v2PresBuild
npm install
python3 -m pip install --upgrade pypdf pymupdf
```

## 3. Configure Environment Variables
Create `.env` in the project root:

```bash
cp .env.example .env
```

Then edit `.env` and set:
- `ANTHROPIC_API_KEY` to a valid key
- Optional: `ANTHROPIC_MODEL` (defaults to `claude-opus-4-6`)
- Optional: `ANTHROPIC_BASE_URL` / `ANTHROPIC_VERSION`

## 4. Verify Basic Health
```bash
node -v
python3 --version
soffice --version
npm run test:validator
npm run docs:generate
```

## 5. Run the Pipeline
Input mode (source file to full deck):
```bash
npm run generate:freeport -- --input <path-to-pdf-or-text> --output output/my-deck.pptx
```

Plan mode (existing plan JSON to deck):
```bash
npm run generate:freeport -- --plan-file <path-to-plan.json> --output output/my-deck.pptx
```

## 6. Expected Artifacts
- `output/*.plan.json` (validated plan)
- `output/*.pptx` (rendered deck)
- `output/*.pdf` (QA conversion artifact)

## Troubleshooting
- Missing API key: set `ANTHROPIC_API_KEY` in `.env`.
- `soffice not found`: install LibreOffice and ensure `soffice` is on PATH.
- PyMuPDF errors in QA: `python3 -m pip install pymupdf`.
- PDF extraction errors: `python3 -m pip install pypdf`.
