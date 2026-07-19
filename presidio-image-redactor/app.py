"""
Thin Presidio image-redactor HTTP sidecar for SecondOp (SEC-129).

Endpoints:
  GET  /health
  POST /redact-image  — multipart field `file` (PNG/JPEG/WebP/…); returns redacted image bytes
  POST /redact-dicom  — multipart field `file` (Part-10 DICOM); returns redacted DICOM bytes

Response headers (never include PHI values):
  X-Entity-Count: total entities redacted
  X-Entity-Types: comma-separated entity type names
  X-Skipped: "true" when no OCR/PHI boxes found (still returns original-like bytes)
"""

from __future__ import annotations

import io
import logging
import os
import tempfile
from collections import Counter
from typing import Any

import pydicom
from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.responses import Response
from PIL import Image
from presidio_image_redactor import DicomImageRedactorEngine, ImageRedactorEngine

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("presidio-image-redactor")

app = FastAPI(title="SecondOp Presidio Image Redactor", version="1.0.0")

SCORE_THRESHOLD = float(os.environ.get("PRESIDIO_MIN_SCORE", "0.5"))
FILL_COLOR = (0, 0, 0)

_image_engine: ImageRedactorEngine | None = None
_dicom_engine: DicomImageRedactorEngine | None = None


def get_image_engine() -> ImageRedactorEngine:
    global _image_engine
    if _image_engine is None:
        _image_engine = ImageRedactorEngine()
    return _image_engine


def get_dicom_engine() -> DicomImageRedactorEngine:
    global _dicom_engine
    if _dicom_engine is None:
        _dicom_engine = DicomImageRedactorEngine()
    return _dicom_engine


def entity_headers(bboxes: list[Any] | None) -> dict[str, str]:
    if not bboxes:
        return {
            "X-Entity-Count": "0",
            "X-Entity-Types": "",
            "X-Skipped": "true",
        }

    types: Counter[str] = Counter()
    for box in bboxes:
        entity_type = getattr(box, "entity_type", None) or (
            box.get("entity_type") if isinstance(box, dict) else None
        )
        if entity_type:
            types[str(entity_type)] += 1
        else:
            types["UNKNOWN"] += 1

    return {
        "X-Entity-Count": str(sum(types.values())),
        "X-Entity-Types": ",".join(sorted(types.keys())),
        "X-Skipped": "false",
    }


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/redact-image")
async def redact_image(file: UploadFile = File(...)) -> Response:
    raw = await file.read()
    if not raw:
        raise HTTPException(status_code=400, detail="Empty image payload")

    try:
        image = Image.open(io.BytesIO(raw)).convert("RGB")
    except Exception as exc:  # noqa: BLE001 — surface parse errors to caller
        raise HTTPException(status_code=400, detail=f"Unable to decode image: {exc}") from exc

    engine = get_image_engine()
    bboxes: list[Any] | None = None
    try:
        # Prefer API that returns boxes for audit counts; fall back to redact-only.
        if hasattr(engine, "redact_with_analyzer_results"):
            redacted, analyze_results = engine.redact_with_analyzer_results(  # type: ignore[attr-defined]
                image,
                score_threshold=SCORE_THRESHOLD,
                fill=FILL_COLOR,
            )
            bboxes = list(analyze_results or [])
        else:
            redacted = engine.redact(image, score_threshold=SCORE_THRESHOLD, fill=FILL_COLOR)
            bboxes = None
    except TypeError:
        # Older signature without score_threshold kwarg.
        redacted = engine.redact(image, fill=FILL_COLOR)
        bboxes = None
    except Exception as exc:  # noqa: BLE001
        logger.exception("Image redaction failed")
        raise HTTPException(status_code=502, detail=f"Image redaction failed: {exc}") from exc

    out = io.BytesIO()
    content_type = (file.content_type or "image/png").lower()
    if content_type in ("image/jpeg", "image/jpg"):
        redacted.save(out, format="JPEG", quality=92)
        media_type = "image/jpeg"
    else:
        redacted.save(out, format="PNG")
        media_type = "image/png"

    headers = entity_headers(bboxes)
    logger.info(
        "redact-image complete entity_count=%s types=%s",
        headers["X-Entity-Count"],
        headers["X-Entity-Types"] or "-",
    )
    return Response(content=out.getvalue(), media_type=media_type, headers=headers)


@app.post("/redact-dicom")
async def redact_dicom(file: UploadFile = File(...)) -> Response:
    raw = await file.read()
    if not raw:
        raise HTTPException(status_code=400, detail="Empty DICOM payload")

    engine = get_dicom_engine()
    bboxes: list[Any] | None = None

    with tempfile.TemporaryDirectory(prefix="sec-image-deid-") as tmp:
        in_path = os.path.join(tmp, "input.dcm")
        out_dir = os.path.join(tmp, "out")
        os.makedirs(out_dir, exist_ok=True)
        with open(in_path, "wb") as fh:
            fh.write(raw)

        try:
            instance = pydicom.dcmread(in_path, force=True)
            if hasattr(engine, "redact_and_return_bbox"):
                redacted_ds, bboxes = engine.redact_and_return_bbox(  # type: ignore[attr-defined]
                    instance,
                    fill="black",
                    use_metadata=True,
                    score_threshold=SCORE_THRESHOLD,
                )
                out_path = os.path.join(out_dir, "redacted.dcm")
                redacted_ds.save_as(out_path)
            elif hasattr(engine, "redact"):
                redacted_ds = engine.redact(
                    instance,
                    fill="black",
                    use_metadata=True,
                )
                out_path = os.path.join(out_dir, "redacted.dcm")
                redacted_ds.save_as(out_path)
            else:
                engine.redact_and_save_dcm(
                    in_path,
                    out_dir,
                    fill="black",
                    use_metadata=True,
                )
                written = [n for n in os.listdir(out_dir) if n.lower().endswith(".dcm")]
                if not written:
                    raise RuntimeError("DicomImageRedactorEngine wrote no output file")
                out_path = os.path.join(out_dir, written[0])
        except Exception as exc:  # noqa: BLE001
            logger.exception("DICOM pixel redaction failed")
            raise HTTPException(status_code=502, detail=f"DICOM redaction failed: {exc}") from exc

        with open(out_path, "rb") as fh:
            redacted_bytes = fh.read()

    headers = entity_headers(bboxes)
    logger.info(
        "redact-dicom complete entity_count=%s types=%s bytes=%s",
        headers["X-Entity-Count"],
        headers["X-Entity-Types"] or "-",
        len(redacted_bytes),
    )
    return Response(content=redacted_bytes, media_type="application/dicom", headers=headers)
