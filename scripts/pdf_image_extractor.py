#!/usr/bin/env python3
import json
import re
from datetime import datetime, timezone
from hashlib import sha1
from pathlib import Path


def _normalize_snippet(text: str, max_chars: int = 180) -> str:
    clean = re.sub(r"\s+", " ", (text or "")).strip()
    if len(clean) <= max_chars:
        return clean
    return clean[: max_chars - 1].rstrip() + "…"


_STOPWORDS = {
    "the", "and", "for", "with", "from", "this", "that", "were", "was", "are", "is",
    "into", "onto", "over", "under", "than", "then", "your", "you", "have", "has", "had",
    "not", "but", "its", "it", "their", "there", "here", "about", "into", "across", "between",
    "page", "streamlit", "localhost", "standard", "error", "info", "debug",
}


def _tokenize_semantic(text: str):
    tokens = re.findall(r"[a-z0-9]+", (text or "").lower())
    return [t for t in tokens if len(t) > 2 and t not in _STOPWORDS]


def _semantic_terms(text: str, max_terms: int = 18):
    freq = {}
    for t in _tokenize_semantic(text):
        freq[t] = freq.get(t, 0) + 1
    ranked = sorted(freq.items(), key=lambda kv: (-kv[1], kv[0]))
    return [t for t, _ in ranked[:max_terms]]


def _infer_semantic_tags(text: str):
    t = (text or "").lower()
    tags = set()
    if any(k in t for k in ["overdrill", "underdrill", "drill", "vertical accuracy", "depth error", "auto-drill"]):
        tags.add("drill")
    if any(k in t for k in ["water present", "wet", "clustered", "cluster", "emulsion"]):
        tags.add("water")
    if any(k in t for k in ["ifrag", "design", "burden", "spacing", "rock", "rqd"]):
        tags.add("design")
    if any(k in t for k in ["plugged", "misfire", "isolated"]):
        tags.add("plugged")
    if any(k in t for k in ["energy", "kcal", "cost", "fragmentation", "p80"]):
        tags.add("performance")
    return sorted(tags)


def _clip_text_snippet(page, rect, max_words: int = 60, max_chars: int = 220) -> str:
    words = page.get_text("words", clip=rect)
    if not words:
        return ""
    words = sorted(words, key=lambda w: (float(w[1]), float(w[0])))
    parts = []
    for w in words:
        token = str(w[4] if len(w) > 4 else "").strip()
        if not token:
            continue
        if len(token) == 1 and not token.isalpha():
            continue
        parts.append(token)
        if len(parts) >= max_words:
            break
    return _normalize_snippet(" ".join(parts), max_chars=max_chars)


def _saturation_ratio_from_pix(pix) -> float:
    """Approximate color richness from RGB deltas."""
    try:
        w, h = int(pix.width), int(pix.height)
        n = int(pix.n)
        if w <= 0 or h <= 0 or n < 3:
            return 0.0
        data = pix.samples
        total = w * h
        if total <= 0:
            return 0.0
        colorful = 0
        idx = 0
        for _ in range(total):
            r = data[idx]
            g = data[idx + 1]
            b = data[idx + 2]
            if (max(r, g, b) - min(r, g, b)) > 16:
                colorful += 1
            idx += n
        return round(colorful / total, 6)
    except Exception:
        return 0.0


def _expand_rect(rect, page_rect, pad: float = 10.0):
    x0 = max(page_rect.x0, rect.x0 - pad)
    y0 = max(page_rect.y0, rect.y0 - pad)
    x1 = min(page_rect.x1, rect.x1 + pad)
    y1 = min(page_rect.y1, rect.y1 + pad)
    return type(rect)(x0, y0, x1, y1)


def _merge_nearby_rects(rects, x_tol=8.0, y_tol=8.0):
    merged = []
    for rect in sorted(rects, key=lambda r: (r.y0, r.x0)):
        found = False
        for i, cur in enumerate(merged):
            if (
                abs(cur.x0 - rect.x0) <= x_tol
                and abs(cur.y0 - rect.y0) <= y_tol
                and abs(cur.x1 - rect.x1) <= x_tol
                and abs(cur.y1 - rect.y1) <= y_tol
            ):
                merged[i] = type(rect)(
                    min(cur.x0, rect.x0),
                    min(cur.y0, rect.y0),
                    max(cur.x1, rect.x1),
                    max(cur.y1, rect.y1),
                )
                found = True
                break
        if not found:
            merged.append(rect)
    return merged


def _trim_narrative_edge_text(page, rect):
    out = type(rect)(rect)
    min_w = 90.0
    min_h = 90.0

    for _ in range(4):
        blocks = page.get_text("blocks")
        changed = False
        for b in blocks:
            if len(b) < 5:
                continue
            x0, y0, x1, y1, txt = b[:5]
            text = str(txt or "").strip()
            if not text:
                continue
            words = text.split()
            if len(words) < 9 or len(text) < 60:
                continue
            if not re.search(r"[.,;:]", text):
                continue

            tr = type(rect)(x0, y0, x1, y1)
            inter = out & tr
            if inter.is_empty:
                continue

            d_left = abs(tr.x0 - out.x0)
            d_right = abs(out.x1 - tr.x1)
            d_top = abs(tr.y0 - out.y0)
            d_bottom = abs(out.y1 - tr.y1)
            edge, dist = min(
                [("left", d_left), ("right", d_right), ("top", d_top), ("bottom", d_bottom)],
                key=lambda x: x[1],
            )
            if dist > 28.0:
                continue

            if edge == "left":
                candidate = type(rect)(tr.x1 + 4.0, out.y0, out.x1, out.y1)
            elif edge == "right":
                candidate = type(rect)(out.x0, out.y0, tr.x0 - 4.0, out.y1)
            elif edge == "top":
                candidate = type(rect)(out.x0, tr.y1 + 4.0, out.x1, out.y1)
            else:
                candidate = type(rect)(out.x0, out.y0, out.x1, tr.y0 - 4.0)

            if candidate.width >= min_w and candidate.height >= min_h:
                out = candidate
                changed = True
                break
        if not changed:
            break
    return out


def _trim_clipped_edge_words(page, rect):
    out = type(rect)(rect)
    words = page.get_text("words", clip=out)
    if not words:
        return out

    top_touch = [w for w in words if float(w[1]) <= out.y0 + 1.5]
    bottom_touch = [w for w in words if float(w[3]) >= out.y1 - 1.5]
    if top_touch:
        new_y0 = max(float(w[3]) for w in top_touch) + 2.0
        if (out.y1 - new_y0) >= 90.0:
            out = type(rect)(out.x0, new_y0, out.x1, out.y1)
    if bottom_touch:
        new_y1 = min(float(w[1]) for w in bottom_touch) - 2.0
        if (new_y1 - out.y0) >= 90.0:
            out = type(rect)(out.x0, out.y0, out.x1, new_y1)
    return out


def _trim_edge_caption_bands(page, rect):
    out = type(rect)(rect)
    min_h = 90.0

    def _trim_top(r):
        band_h = max(18.0, r.height * 0.14)
        band = type(r)(r.x0, r.y0, r.x1, min(r.y1, r.y0 + band_h))
        words = page.get_text("words", clip=band)
        if not words:
            return r
        text = " ".join(str(w[4]) for w in words if len(w) >= 5)
        if len(text) > 120:
            return r
        max_y1 = max(float(w[3]) for w in words)
        new_r = type(r)(r.x0, max_y1 + 2.0, r.x1, r.y1)
        return new_r if new_r.height >= min_h else r

    def _trim_bottom(r):
        band_h = max(18.0, r.height * 0.12)
        band = type(r)(r.x0, max(r.y0, r.y1 - band_h), r.x1, r.y1)
        words = page.get_text("words", clip=band)
        if not words:
            return r
        text = " ".join(str(w[4]) for w in words if len(w) >= 5)
        if len(text) > 120:
            return r
        min_y0 = min(float(w[1]) for w in words)
        new_r = type(r)(r.x0, r.y0, r.x1, min_y0 - 2.0)
        return new_r if new_r.height >= min_h else r

    out = _trim_top(out)
    out = _trim_bottom(out)
    return out


def _tighten_to_active_drawing_bands(page, rect):
    page_rect = page.rect
    draw_rects = []
    for d in page.get_drawings():
        r = d.get("rect")
        if r is None:
            continue
        rr = type(page_rect)(r)
        area = rr.width * rr.height
        if area < 1.0:
            continue
        inter = rr & rect
        if inter.is_empty:
            continue
        draw_rects.append(inter)
    if len(draw_rects) < 20:
        return rect

    bands = 100
    band_h = rect.height / bands
    density = []
    for i in range(bands):
        y0 = rect.y0 + i * band_h
        y1 = y0 + band_h
        band = type(page_rect)(rect.x0, y0, rect.x1, y1)
        count = 0
        for dr in draw_rects:
            if not (dr & band).is_empty:
                count += 1
        density.append(count)

    sorted_density = sorted(density)
    threshold = max(3, sorted_density[int((bands - 1) * 0.45)])
    active = [d >= threshold for d in density]
    active_idx = [i for i, on in enumerate(active) if on]
    if not active_idx:
        return rect

    y0 = max(rect.y0, rect.y0 + active_idx[0] * band_h - 6.0)
    y1 = min(rect.y1, rect.y0 + (active_idx[-1] + 1) * band_h + 8.0)
    if (y1 - y0) < 90.0:
        return rect
    return type(page_rect)(rect.x0, y0, rect.x1, y1)


def _tighten_to_non_bg_pixels(page, rect, fitz_mod):
    pix = page.get_pixmap(matrix=fitz_mod.Matrix(1, 1), clip=rect, alpha=False)
    w, h = int(pix.width), int(pix.height)
    if w < 20 or h < 20:
        return rect

    samples = pix.samples
    n = pix.n
    bg = samples[0:3]

    def px(i, j):
        idx = (j * w + i) * n
        return samples[idx:idx + 3]

    threshold = 18
    row_counts = []
    for y in range(h):
        ink = 0
        for x in range(w):
            r, g, b = px(x, y)
            if abs(r - bg[0]) + abs(g - bg[1]) + abs(b - bg[2]) > threshold:
                ink += 1
        row_counts.append(ink)

    col_counts = []
    for x in range(w):
        ink = 0
        for y in range(h):
            r, g, b = px(x, y)
            if abs(r - bg[0]) + abs(g - bg[1]) + abs(b - bg[2]) > threshold:
                ink += 1
        col_counts.append(ink)

    min_row_ink = max(2, int(w * 0.004))
    min_col_ink = max(2, int(h * 0.004))
    active_rows = [i for i, v in enumerate(row_counts) if v >= min_row_ink]
    active_cols = [i for i, v in enumerate(col_counts) if v >= min_col_ink]
    if not active_rows:
        active_rows = [i for i, v in enumerate(row_counts) if v > 0]
    if not active_cols:
        active_cols = [i for i, v in enumerate(col_counts) if v > 0]
    if not active_rows or not active_cols:
        return rect

    x0p = max(0, active_cols[0] - 3)
    x1p = min(w - 1, active_cols[-1] + 3)
    y0p = max(0, active_rows[0] - 3)
    y1p = min(h - 1, active_rows[-1] + 3)

    rx0 = rect.x0 + (rect.width * (x0p / max(1, w)))
    rx1 = rect.x0 + (rect.width * (x1p / max(1, w)))
    ry0 = rect.y0 + (rect.height * (y0p / max(1, h)))
    ry1 = rect.y0 + (rect.height * (y1p / max(1, h)))
    tightened = type(rect)(rx0, ry0, rx1, ry1)

    if tightened.width < 90 or tightened.height < 90:
        return rect
    return tightened


def _extract_vector_regions(page, max_regions: int = 3):
    page_rect = page.rect
    text_blocks = []
    for b in page.get_text("blocks"):
        if len(b) < 5:
            continue
        x0, y0, x1, y1, txt = b[:5]
        t = str(txt or "").strip()
        if len(t) < 20:
            continue
        text_blocks.append((float(y0), float(y1)))
    text_blocks.sort(key=lambda x: x[0])

    draw_rects = []
    for d in page.get_drawings():
        r = d.get("rect")
        if r is None:
            continue
        rect = type(page_rect)(r)
        area = rect.width * rect.height
        if area < 1.0:
            continue
        if area > (page_rect.width * page_rect.height * 0.9):
            continue
        draw_rects.append(rect)
    if not draw_rects:
        return []

    regions = []
    prev_y = float(page_rect.y0)
    boundaries = text_blocks + [(float(page_rect.y1), float(page_rect.y1))]
    for y0, y1 in boundaries:
        gap_start, gap_end = prev_y, float(y0)
        prev_y = max(prev_y, float(y1))
        if (gap_end - gap_start) < 110:
            continue

        gap_rect = type(page_rect)(page_rect.x0, gap_start, page_rect.x1, gap_end)
        in_gap = [r for r in draw_rects if not (r & gap_rect).is_empty]
        if len(in_gap) < 12:
            continue

        x0 = min(r.x0 for r in in_gap)
        x1 = max(r.x1 for r in in_gap)
        rect = type(page_rect)(x0, gap_start, x1, gap_end)
        rect = _expand_rect(rect, page_rect, pad=4.0)

        area_ratio = (rect.width * rect.height) / max(1.0, page_rect.width * page_rect.height)
        if area_ratio < 0.09 or area_ratio > 0.85:
            continue
        if rect.height < 220.0:
            continue
        regions.append(rect)

    regions = _merge_nearby_rects(regions, x_tol=14.0, y_tol=20.0)
    regions.sort(key=lambda r: r.width * r.height, reverse=True)
    return regions[:max_regions]


def extract_pdf_images(path: Path, assets_root: Path):
    try:
        import fitz
    except Exception as exc:
        return {
            "error": f"PyMuPDF unavailable for image extraction: {exc}",
            "images": [],
        }

    doc = fitz.open(path)
    images_dir = assets_root / "images"
    images_dir.mkdir(parents=True, exist_ok=True)

    dedupe = set()
    images = []
    basename = path.stem

    for page_idx in range(len(doc)):
        page = doc[page_idx]
        page_num = page_idx + 1
        page_text_snippet = _normalize_snippet(page.get_text("text"), max_chars=600)
        page_tags = _infer_semantic_tags(page_text_snippet)
        page_terms = _semantic_terms(page_text_snippet)

        for image_idx, img in enumerate(page.get_images(full=True), start=1):
            xref = int(img[0])
            payload = doc.extract_image(xref)
            if not payload or "image" not in payload:
                continue

            img_bytes = payload["image"]
            digest = sha1(img_bytes).hexdigest()
            if digest in dedupe:
                continue
            dedupe.add(digest)

            ext = payload.get("ext", "png").lower()
            width_px = int(payload.get("width", 0) or 0)
            height_px = int(payload.get("height", 0) or 0)
            if width_px < 80 or height_px < 80:
                continue

            rects = page.get_image_rects(xref)
            rect = rects[0] if rects else page.rect
            context_rect = _expand_rect(rect, page.rect, pad=16.0)
            context = _clip_text_snippet(page, rect, max_words=80, max_chars=220)
            if len(context) < 20:
                context = _normalize_snippet(page.get_textbox(context_rect))

            file_name = f"{basename}-p{page_num:02d}-img{image_idx:02d}-{digest[:10]}.{ext}"
            out_path = images_dir / file_name
            out_path.write_bytes(img_bytes)

            images.append({
                "id": f"img_p{page_num}_{image_idx}",
                "kind": "embedded",
                "page": page_num,
                "file": str(out_path),
                "ext": ext,
                "sha1": digest,
                "sizeBytes": len(img_bytes),
                "widthPx": width_px,
                "heightPx": height_px,
                "bbox": {
                    "x": round(float(rect.x0), 2),
                    "y": round(float(rect.y0), 2),
                    "w": round(float(rect.width), 2),
                    "h": round(float(rect.height), 2),
                },
                "contextSnippet": context,
                "pageTextSnippet": page_text_snippet,
                "semanticTags": page_tags,
                "semanticTerms": page_terms,
                "colorSaturationRatio": None,
            })

        regions = _extract_vector_regions(page)
        for region_idx, rect in enumerate(regions, start=1):
            crop_rect = _expand_rect(rect, page.rect, pad=2.0)
            crop_rect = _tighten_to_active_drawing_bands(page, crop_rect)
            crop_rect = _trim_narrative_edge_text(page, crop_rect)
            crop_rect = _trim_clipped_edge_words(page, crop_rect)
            crop_rect = _trim_edge_caption_bands(page, crop_rect)
            crop_rect = _tighten_to_non_bg_pixels(page, crop_rect, fitz)
            pix = page.get_pixmap(matrix=fitz.Matrix(2, 2), clip=crop_rect, alpha=False)
            img_bytes = pix.tobytes("png")
            digest = sha1(img_bytes).hexdigest()
            if digest in dedupe:
                continue
            dedupe.add(digest)

            file_name = f"{basename}-p{page_num:02d}-region{region_idx:02d}-{digest[:10]}.png"
            out_path = images_dir / file_name
            out_path.write_bytes(img_bytes)

            context_rect = _expand_rect(crop_rect, page.rect, pad=20.0)
            context = _clip_text_snippet(page, crop_rect, max_words=80, max_chars=220)
            if len(context) < 20:
                context = _normalize_snippet(page.get_textbox(context_rect))
            images.append({
                "id": f"fig_p{page_num}_{region_idx}",
                "kind": "vector_region",
                "page": page_num,
                "file": str(out_path),
                "ext": "png",
                "sha1": digest,
                "sizeBytes": len(img_bytes),
                "widthPx": int(pix.width),
                "heightPx": int(pix.height),
                "bbox": {
                    "x": round(float(crop_rect.x0), 2),
                    "y": round(float(crop_rect.y0), 2),
                    "w": round(float(crop_rect.width), 2),
                    "h": round(float(crop_rect.height), 2),
                },
                "contextSnippet": context,
                "pageTextSnippet": page_text_snippet,
                "semanticTags": page_tags,
                "semanticTerms": page_terms,
                "colorSaturationRatio": _saturation_ratio_from_pix(pix),
            })

    manifest = {
        "sourcePath": str(path),
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "assetRoot": str(assets_root),
        "imageCount": len(images),
        "images": images,
    }
    manifest_path = assets_root / "image-manifest.json"
    manifest_path.write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    manifest["manifestPath"] = str(manifest_path)
    return manifest
