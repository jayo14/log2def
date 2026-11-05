# Report template v1 behavior and hardcoded values

## V1 flow

`backend/api/templates.py` defines the `lasustech-standard:1.0.0` section list. `backend/api/report_generator.py` uses `SECTION_DEFINITIONS` to create `ReportSection` HTML, optionally asks the AI provider to rewrite prose, stores the pinned template snapshot, and records section versions. `backend/api/document_exporter.py` renders those section records to DOCX and LibreOffice converts that file to PDF. V1 templates use five chapters and a pre-rendered sample TOC. Existing reports remain pinned to the v1 snapshot and retain this renderer.

## V1-only institutional or domain defaults found

The v1 generator retains its historical behavior for reports already pinned to it. New unpinned reports use v2 and do not use these defaults.

- `backend/api/report_generator.py`: missing institution becomes “Lagos State University of Science and Technology (LASUSTECH)”; missing faculty becomes “College of Basic Science”; missing placement unit becomes “Engineering / IT Unit”; missing logbook tools become “Standard toolkit”; missing department can become “Computer Science”.
- `backend/api/report_generator.py`: the old references builder emitted a made-up 2024 LASUSTECH SIWES Directorate document citation. V2 never calls that builder and uses only the verified ITF SIWES webpage by default.
- `backend/api/templates.py`: the v1 snapshot itself identifies LASUSTECH and its old chapter names. That snapshot is retained for existing reports.
- `backend/api/models.py`: new project records no longer default `university_name`; existing project values are not rewritten.
- `backend/api/document_processor.py`: the special `Mika Labs` replacement case was removed.
- `frontend/app/dashboard/page.tsx` and `frontend/lib/store/use-project-store.ts`: new student projects no longer prefill a college, department, or institution. College and institution options are displayed as choices that the student must select; they are not sent as defaults.

V2 output is built from versioned template text, manifest-configured fields, explicitly entered profile values, and verified logbook entries. The completeness checker consumes both required profile fields and required section inputs from the manifest. Empty required narrative sections remain blank and are flagged for student completion; no bracketed instructions or generic filler are emitted.
