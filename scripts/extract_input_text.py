#!/usr/bin/env python3
import json
import sys
from pathlib import Path

from pdf_image_extractor import extract_pdf_images


def extract_pdf_text(path: Path) -> str:
    try:
        from pypdf import PdfReader
    except Exception as exc:
        raise RuntimeError(f"pypdf is required for PDF extraction: {exc}") from exc

    reader = PdfReader(str(path))
    chunks = []
    for i, page in enumerate(reader.pages, start=1):
        txt = page.extract_text() or ""
        chunks.append(f"===== PAGE {i} =====\n{txt.strip()}\n")
    return "\n".join(chunks).strip()


def extract_text(path: Path) -> str:
    suffix = path.suffix.lower()
    if suffix in {".txt", ".md"}:
        return path.read_text(encoding="utf-8", errors="ignore").strip()
    if suffix == ".pdf":
        return extract_pdf_text(path)
    raise RuntimeError(f"Unsupported input type: {suffix}. Use .pdf, .txt, or .md")


def main() -> int:
    if len(sys.argv) < 2 or len(sys.argv) > 3:
        print("Usage: extract_input_text.py <input-file> [assets-output-dir]", file=sys.stderr)
        return 2

    path = Path(sys.argv[1]).expanduser().resolve()
    assets_root = Path(sys.argv[2]).expanduser().resolve() if len(sys.argv) == 3 else None
    if not path.exists():
        print(json.dumps({"error": f"Input file not found: {path}"}))
        return 1

    try:
        text = extract_text(path)
    except Exception as exc:
        print(json.dumps({"error": str(exc)}))
        return 1

    payload = {"path": str(path), "chars": len(text), "text": text}
    if path.suffix.lower() == ".pdf" and assets_root is not None:
        payload["imageAssets"] = extract_pdf_images(path, assets_root)

    print(json.dumps(payload))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
