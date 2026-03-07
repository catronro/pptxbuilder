# Environment Setup (New Machine)

Generated from live scan: 2026-03-07T03:46:22.521Z

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

Set these values (detected from code):
- `ANTHROPIC_API_KEY`
- `ANTHROPIC_BASE_URL`
- `ANTHROPIC_MODEL`
- `ANTHROPIC_VERSION`

## 4. Verify Installation
```bash
node -v
python3 --version
soffice --version
npm run test:validator
npm run docs:generate
```

## 5. Run The Pipeline
Input mode:
```bash
npm run generate:freeport -- --input <path-to-pdf-or-text> --output output/my-deck.pptx
```

Plan-file mode:
```bash
npm run generate:freeport -- --plan-file <path-to-plan.json> --output output/my-deck.pptx
```

## 6. Expected Outputs
- `output/*.plan.json`
- `output/*.pptx`
- `output/*.pdf` (QA conversion output)

## Troubleshooting
- Missing API key: add it to `.env`.
- `soffice not found`: install LibreOffice and ensure the binary is on PATH.
- PyMuPDF import error: `python3 -m pip install pymupdf`.
- pypdf import error: `python3 -m pip install pypdf`.
