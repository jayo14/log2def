# OCR pipeline diagnosis

**Status: awaiting the anonymized 14-page evaluation fixture.** On 5 November 2026, `eval/fixtures/` contained no PDF or image files. The reported outcome (12 of 14 pages yielded no activity) therefore has not been reproduced, and none of the loss categories below is asserted as the cause. No ground truth has been fabricated.

## Current path to inspect

- PDF pages first use PyMuPDF native text. Pages with fewer than 50 extracted characters are rasterized at 150 dpi, sent to the configured multimodal vision path, and sent to Tesseract only if that call returns no text.
- Image pages go to the multimodal vision path first and Tesseract only if the vision path returns no text.
- The current local Tesseract preprocessing converts to grayscale, applies contrast enhancement at 1.8, then a median filter. Its intermediate image is deleted after OCR.
- Structured entries are created from the vision response when present, otherwise from the selected text using `extract_logbook_entries_from_text`.

## Per-page trace

The dev-only management command `trace_ocr_fixture` runs the existing document-processing path on an input PDF or naturally sorted page-image directory. It requires `DEBUG=True` and SQLite, and stores trace outputs in the supplied local directory. The trace keeps the original page image, the current preprocessed image when Tesseract runs, raw Tesseract TSV and word boxes/confidences, native PDF word boxes when available, selected pipeline text, vision output, confidence/notes, and structured logbook records.

The trace-only Tesseract TSV call does not feed back into the current pipeline result. No OCR engine or preprocessing behavior has been changed. Trace output may contain personal handwriting and is ignored by Git.

## Loss categories to classify after the fixture is supplied

| Category | Evidence to compare per page | Finding |
|---|---|---|
| Orientation | Original image orientation, OCR boxes, and text output | Not assessed |
| Perspective or shadow | Original and current preprocessed images | Not assessed |
| Handwriting not read | Visible writing versus raw OCR output and confidences | Not assessed |
| Text read but not parsed | Raw OCR text versus structured output | Not assessed |
| Parsing dropped it | Structured output versus persisted `LogbookEntry` rows | Not assessed |
| Visible ink with near-zero text | Original page image versus extracted text length | Not assessed |

## Next input required

Provide the anonymized 14-page fixture in the local ignored path `eval/fixtures/` (PDF or numbered page images). The diagnosis and any silent-loss threshold must be based on those pages. The harness instructions are in [eval/ocr/README.md](../eval/ocr/README.md).
