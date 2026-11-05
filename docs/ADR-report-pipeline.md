# ADR: Versioned report templates and document pipeline

**Status:** Accepted  
**Date:** 5 November 2026

## Context

The original pipeline is `api/report_generator.py` → persisted `ReportSection.content` HTML → `api/document_exporter.py` parses that HTML into DOCX → LibreOffice converts DOCX to PDF. `api/templates.py` defines v1 as five chapters; the DOCX exporter repeats the five chapter headings and a hardcoded sample TOC. The report model already pins `template_version` and `template_snapshot`.

The generator also contained default names and claims such as `Engineering / IT Unit`, `College of Basic Science`, generic acknowledgements and dedication text, `Standard toolkit`, and default supervisor placeholders. `document_processor.py` treats `Mika Labs` as a special replacement case. These are v1 behavior and are not valid v2 defaults. The report project model also defaults the university name to LASUSTECH.

## Decision

Template v1 remains registered as `lasustech-standard:1.0.0` for reports already pinned to it. The four chapter coordinator structure is stored independently as `lasustech_cs:2.0.0` in `backend/api/templates/lasustech_cs_v2.json`, with its section input manifest, format settings, template flags, and confirmation statuses.

`Report.document_model` stores a typed section tree with provenance metadata. DOCX export reads that model; PDF conversion uses the resulting DOCX. If a preexisting v1 report lacks a model, the exporter derives a temporary model from its pinned snapshot and section content. The section HTML remains for compatibility with the current editor API while the editor is migrated.

## Consequences and gaps

- New report creation still needs to select v2 and build sections from v2 inputs; the current generator entry point remains v1 pending that integration.
- Preview still reads `ReportSection` records, so preview and exports are not yet fully unified on the typed model.
- V1 exact regeneration requires retaining its old section builder and exporter behavior. The v1 JSON snapshot is kept as a regression fixture.
- Page-number fields and TOC behavior need programmatic DOCX validation in the project virtual environment.
- The v2 file marks all unresolved choices as `NEEDS_CONFIRMATION`: college field policy; abstract default OFF; TOC default ON; cover numbering ON; department margins were not supplied, so 2.54 cm all round is provisional; references require edition/document verification; date formatting is configurable.
