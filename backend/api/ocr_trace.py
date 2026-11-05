"""Development-only artifact capture for diagnosing current OCR information loss."""
from __future__ import annotations

import json
import os
import shutil
import subprocess
from pathlib import Path
from typing import Any

from django.conf import settings


def trace_root() -> Path | None:
    """Tracing is unavailable outside DEBUG and requires an explicit output path."""
    configured = (os.environ.get("LOG2DEF_OCR_TRACE_DIR") or getattr(settings, "LOG2DEF_OCR_TRACE_DIR", "")).strip()
    if not settings.DEBUG or not configured:
        return None
    root = Path(configured).expanduser().resolve()
    root.mkdir(parents=True, exist_ok=True)
    return root


def page_trace_dir(document_id: int, page_number: int) -> Path | None:
    root = trace_root()
    if root is None:
        return None
    target = root / f"document-{document_id}" / f"page-{page_number:03d}"
    target.mkdir(parents=True, exist_ok=True)
    return target


def copy_original_image(source: str | Path, target_dir: Path | None) -> None:
    if target_dir is None or not source or not Path(source).is_file():
        return
    suffix = Path(source).suffix or ".img"
    shutil.copy2(source, target_dir / f"original{suffix}")


def engine_version(engine_name: str) -> str:
    if engine_name == "gemini_vision":
        return str(getattr(settings, "GEMINI_MODEL", "unspecified"))
    if engine_name == "tesseract":
        configured = getattr(settings, "TESSERACT_CMD", "tesseract")
        binary = configured if os.path.isabs(configured) and Path(configured).exists() else shutil.which(configured) or shutil.which("tesseract")
        if binary:
            try:
                result = subprocess.run([binary, "--version"], capture_output=True, text=True, timeout=5)
                return result.stdout.splitlines()[0] if result.stdout else "unknown"
            except Exception:
                pass
    if engine_name == "pymupdf_native":
        try:
            import pymupdf
            return str(pymupdf.VersionBind)
        except Exception:
            return "unknown"
    return "unknown"


def save_tesseract_tsv(tsv: str, target_dir: Path | None) -> dict[str, Any]:
    """Persist raw TSV and a parsed word/box/confidence view from Tesseract."""
    if target_dir is None:
        return {"text": "", "words": []}
    (target_dir / "tesseract.tsv").write_text(tsv, encoding="utf-8")
    lines = tsv.splitlines()
    if not lines:
        result = {"text": "", "words": []}
    else:
        words = []
        for line in lines[1:]:
            columns = line.split("\t", 11)
            if len(columns) < 12 or not columns[11].strip():
                continue
            try:
                confidence = float(columns[10])
                box = {
                    "left": int(columns[6]), "top": int(columns[7]),
                    "width": int(columns[8]), "height": int(columns[9]),
                }
            except ValueError:
                continue
            words.append({"text": columns[11], "confidence": confidence, "box": box,
                          "block": columns[2], "paragraph": columns[3], "line": columns[4]})
        result = {"text": " ".join(word["text"] for word in words), "words": words}
    (target_dir / "raw_ocr.json").write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    return result


def save_page_trace(
    target_dir: Path | None,
    *,
    page_number: int,
    final_text: str,
    engine: str,
    engine_version: str,
    engine_data: dict[str, Any],
    structured_output: list[dict[str, Any]],
    native_pdf_words: list[dict[str, Any]] | None = None,
) -> None:
    if target_dir is None:
        return
    payload = {
        "page_number": page_number,
        "engine": engine,
        "engine_version": engine_version,
        "raw_pipeline_text": final_text,
        "engine_output": engine_data,
        "native_pdf_words": native_pdf_words or [],
        "structured_output": structured_output,
    }
    (target_dir / "pipeline.json").write_text(json.dumps(payload, ensure_ascii=False, indent=2, default=str), encoding="utf-8")
    (target_dir / "raw_pipeline_text.txt").write_text(final_text, encoding="utf-8")
    (target_dir / "structured_output.json").write_text(json.dumps(structured_output, ensure_ascii=False, indent=2, default=str), encoding="utf-8")
