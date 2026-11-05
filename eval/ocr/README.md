# OCR diagnosis harness

The 14-page fixture is intentionally not included in the repository. Place an anonymized copy in `eval/fixtures/`; files in that directory are ignored by Git. Do not create synthetic ground truth or use a real student's identifying details in a committed fixture.

Run the current pipeline only after the fixture is present. Use a disposable SQLite database so the trace command cannot write into the configured Neon database:

```sh
cd backend
DATABASE_URL_UNPOOLED='' DATABASE_URL='' DB_ENGINE=sqlite SQLITE_DB_NAME=/tmp/log2def-ocr-eval.sqlite3 ./.venv/bin/python manage.py migrate
DATABASE_URL_UNPOOLED='' DATABASE_URL='' DB_ENGINE=sqlite SQLITE_DB_NAME=/tmp/log2def-ocr-eval.sqlite3 ./.venv/bin/python manage.py trace_ocr_fixture ../eval/fixtures --trace-dir ../eval/ocr/runs/current
```

The command calls the existing `process_source_document` path and does not select a new OCR engine. Tracing is enabled only with `DEBUG=True` and an explicit trace directory. Each document/page directory can contain:

- `original.*`: original source image or PDF page raster
- `preprocessed.png`: current Tesseract preprocessing result, when local OCR runs
- `tesseract.tsv` and `raw_ocr.json`: raw word boxes and Tesseract confidence values, when available
- `raw_pipeline_text.txt`: text that proceeded to structuring
- `pipeline.json`: engine output, confidence, notes, native PDF word boxes, and structured activity records
- `structured_output.json`: structured records after the current anti-fabrication parser

Trace outputs are local-only because they can contain handwriting and personal information. The `eval/fixtures` directory and `eval/ocr/runs` are Git-ignored.
