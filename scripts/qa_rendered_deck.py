#!/usr/bin/env python3
import json
import re
import shutil
import subprocess
import sys
from pathlib import Path

try:
    import fitz
except Exception as exc:
    print(json.dumps({"ok": False, "issues": [f"PyMuPDF unavailable: {exc}"]}))
    sys.exit(2)


def normalize_text(s: str) -> str:
    return re.sub(r"\s+", " ", re.sub(r"[^a-z0-9 ]", " ", s.lower())).strip()


def title_tokens(title: str):
    toks = [t for t in re.findall(r"[a-z0-9]+", title.lower()) if len(t) > 1]
    return toks[:8]


def find_token_sequence(words, tokens):
    if not tokens:
        return None
    i = 0
    start = None
    y_max = 0.0
    for w in words:
        tok = re.sub(r"[^a-z0-9]", "", w[4].lower())
        if tok == tokens[i]:
            if i == 0:
                start = w
                y_max = w[3]
            else:
                y_max = max(y_max, w[3])
            i += 1
            if i == len(tokens):
                return {"y_max": y_max, "start": start}
        else:
            # allow restart when current token matches first
            if tok == tokens[0]:
                i = 1
                start = w
                y_max = w[3]
            else:
                i = 0
                start = None
                y_max = 0.0
    return None


def ensure_pdf(pptx_path: Path) -> Path:
    pdf_path = pptx_path.with_suffix('.pdf')
    soffice = shutil.which('soffice')
    fallback = Path.home() / '.local' / 'bin' / 'soffice'
    if not soffice and fallback.exists():
        soffice = str(fallback)
    if not soffice:
        raise RuntimeError('soffice not found for post-render QA')

    subprocess.run(
        [soffice, '--headless', '--convert-to', 'pdf', '--outdir', str(pptx_path.parent), str(pptx_path)],
        check=True,
        capture_output=True,
        text=True,
    )
    if not pdf_path.exists():
        raise RuntimeError(f'PDF conversion failed: {pdf_path} not found')
    return pdf_path


def main() -> int:
    if len(sys.argv) != 3:
        print(json.dumps({"ok": False, "issues": ["Usage: qa_rendered_deck.py <deck.pptx> <plan.json>"]}))
        return 2

    pptx_path = Path(sys.argv[1]).resolve()
    plan_path = Path(sys.argv[2]).resolve()
    plan = json.loads(plan_path.read_text())

    issues = []
    pdf_path = ensure_pdf(pptx_path)
    doc = fitz.open(pdf_path)

    slides = plan.get('slides', [])
    # slide 1 in PPTX is the title slide; plan starts at content slide 1 => page index offset 1
    for idx, slide in enumerate(slides):
        page_no = idx + 1
        if page_no >= len(doc):
            issues.append(f"Slide {idx+1}: missing rendered page {page_no+1} in PDF")
            continue

        page = doc[page_no]
        page_text_norm = normalize_text(page.get_text('text'))

        title = str(slide.get('title', '')).strip()
        layout = str(slide.get('layout', '')).strip().lower()
        summary = str(slide.get('summary', '')).strip()
        if title:
            title_norm = normalize_text(title)
            summary_norm = normalize_text(summary) if summary else ""
            if layout == 'summary_card':
                # Executive-summary layout may render headline differently from the
                # plan title; accept either title or summary presence.
                if title_norm not in page_text_norm and (not summary_norm or summary_norm not in page_text_norm):
                    issues.append(f"Slide {idx+1}: summary_card headline not fully present in rendered text")
            else:
                if title_norm not in page_text_norm:
                    issues.append(f"Slide {idx+1}: title not fully present in rendered text")

            words = page.get_text('words')
            seq = find_token_sequence(words, title_tokens(title))
            if seq:
                # header band guardrail: title should stay in top ~19% of page height
                if layout != 'summary_card' and (seq['y_max'] / page.rect.height) > 0.19:
                    issues.append(f"Slide {idx+1}: title likely overflows header band")
            else:
                # Wrapped/styled title runs can prevent reliable word-sequence matching.
                # If title text is present on the page, do not fail on overflow check.
                pass

        # bullet/readout presence check using first 5 words of each bullet line
        bullet_pool = []
        bullet_pool.extend(slide.get('bullets', []) or [])
        bullet_pool.extend(slide.get('leftBullets', []) or [])
        bullet_pool.extend(slide.get('rightBullets', []) or [])

        for b in bullet_pool:
            words = re.findall(r"[a-z0-9]+", str(b).lower())
            if not words:
                continue
            probe = normalize_text(' '.join(words[:5]))
            if probe and probe not in page_text_norm:
                issues.append(f"Slide {idx+1}: bullet/readout likely missing or clipped: {b[:60]}")
                break

    out = {"ok": len(issues) == 0, "issues": issues, "pdf": str(pdf_path)}
    print(json.dumps(out))
    return 0 if out["ok"] else 1


if __name__ == '__main__':
    raise SystemExit(main())
