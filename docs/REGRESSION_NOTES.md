# Log2Def Report Generation — Regression Notes

Defects found in the latest generated report, with root causes traced to code.

---

## Defect 1: Page labels and page contents out of step

**Observation:** Page labelled "Dedication" held a declaration; "Acknowledgement" held the certification; "Chapter 1" held the acknowledgement; "References" held section 1.3.

**Root cause:** `templates.py::LASUSTECH_STANDARD_V1` defines sections with independent `key`, `title`, and `chapter_number` fields, and `report_generator.py` builds front matter and body sections by iterating `SECTION_DEFINITIONS` separately from the table-of-contents builder. There is no single source of truth binding a section's *label* (heading text) to its *content*. The TOC is generated independently from the rendered pages, so label/TOC/content can drift.

**Files involved:** `backend/api/templates.py`, `backend/api/report_generator.py`, `backend/api/document_exporter.py`

## Defect 2: Report stops after section 1.3 (no Chapters 2-4, no References)

**Observation:** Generated report is truncated at 1.3; later chapters absent.

**Root causes:**
- `report_generator.py::build_rule_based_section_content()` returns `base_content` (an `[INPUT NEEDED]` stub) for any `section_key` not explicitly handled, silently skipping sections instead of blocking.
- `document_exporter.py` exports whatever `ReportSection` rows exist; missing sections simply never get rows, so export proceeds with an incomplete document.
- No completeness/gate check verifies that all required sections (Chapters 1-4, References) have content before export.

**Files involved:** `backend/api/report_generator.py`, `backend/api/document_quality.py`, `backend/api/views.py` (`_quality_gate_failure`)

## Defect 3: Pages the coordinator does not ask for

**Observation:** Duplicate title page, Declaration page, Abstract page, "LEVEL: 400 LEVEL" on cover.

**Root cause:** `LASUSTECH_STANDARD_V1` sections list includes both `cover` and `title_page` plus a `declaration` section; the cover template renders a hardcoded `LEVEL: 400 LEVEL` line. The new coordinator spec requires exactly one title page, no declaration, no abstract, and no level line on the cover.

**Files involved:** `backend/api/templates.py`, `backend/api/report_generator.py`

## Defect 4: Bracketed placeholders, "INPUT NEEDED" blocks, system text

**Observation:** `[Industry Supervisor Name]`, `[Student Full Name]`, `INPUT NEEDED`, instructions to the student, leaked system sentence ("The formal Table of Contents is generated automatically during document export...").

**Root cause:** `report_generator.py` fills missing profile fields with bracketed defaults (e.g. `"[Student Full Name]"`) and returns `[INPUT NEEDED]` stubs for sections lacking source material. The old TOC generation injected a system-level explanatory sentence into the document body.

**Files involved:** `backend/api/report_generator.py`


## Defect 5: Invented content

**Observation:** Thanks to "parents and siblings", "colleagues in the Engineering / IT Unit", "strict compliance with the institution's academic calendar", "hardware/software deployments", "industry-standard tools", "Significantly, this experiential engagement bridged the gap...", "1 verified logbook milestones", fake reference to organisation's "internal documentation", hardcoded college name.

**Root cause:** `report_generator.py` AI-refinement prompts (dedication, acknowledgements) explicitly instruct the model to thank God, parents, colleagues, management, etc., and to write "creative" paragraphs. Fixed-text sections (1.1/1.2/1.3) were previously AI-generated with no registry, allowing invention. `LASUSTECH_CS_V2` hardcodes `college_name` and other invented details.

**Files involved:** `backend/api/report_generator.py`, `backend/api/templates.py`

## Defect 6: Logbook text pasted verbatim (including typos)

**Observation:** Raw logbook text appears in the report without being written up into prose.

**Root cause:** `build_rule_based_section_content()` copies `verified_text` / `activity_summary` directly into HTML output without rewriting into complete sentences or grouping into week ranges.

**Files involved:** `backend/api/report_generator.py`

## Defect 7: Mixed UK/US spelling, inconsistent dates, scheme name variants

**Observation:** "organization" vs "organisation", dates in multiple formats, "SIWES" written with and without apostrophe, truncated paragraphs, duplicated heading, 2-day training period unquestioned.

**Root cause:** No central scheme-name constant; no date-formatting rule; no spell-check or consistency gate; no minimum-duration validation (under 4 weeks should prompt confirmation). `document_quality.py` has a partial US-spelling check but it is not tied to a single scheme constant and does not block export.

**Files involved:** `backend/api/document_quality.py`, `backend/api/report_generator.py`, `backend/api/templates.py`

## Defect 8: Duplicated heading, truncated paragraphs

**Observation:** A heading appears twice; paragraphs cut off mid-sentence.

**Root cause:** AI-generated sections can repeat headings; `generate_completion()` output is truncated by token limits and returned verbatim without sentence-boundary validation. No quality check verifies paragraphs end with terminal punctuation or that headings are unique.

**Files involved:** `backend/api/report_generator.py`, `backend/api/document_quality.py`

## Summary of fixes required

1. Single authoritative report specification (one format only) — replace dual template system.
2. Fixed-text registry for 1.1, 1.2, 1.3, certification sentence, references (no invention).
3. Quality gate that blocks export on: placeholders, banned phrases, missing/empty required sections, wrong headings, TOC/page-number mismatch, unregistered fixed text, mixed spelling, inconsistent scheme name, unverified facts.
4. Duration validation (under 4 weeks → ask student to confirm).
5. Rewrite logbook entries into prose with week ranges; no verbatim copying.
6. Remove Declaration, Abstract, duplicate title page, "LEVEL" line.
7. Build DOCX with real Word structure (TOC field, section breaks, PAGE fields, styles).
8. Create negative and positive test fixtures; run full suite before/after.

