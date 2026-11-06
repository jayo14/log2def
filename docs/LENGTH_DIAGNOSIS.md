# Log2Def Report Length Diagnosis — 54-Page Bloat Analysis

## Per-Section Page Table (50+ page report, rendered via LibreOffice)

| Section | Pages | Notes |
|---------|-------|-------|
| Title Page | 1 | Single page, correct |
| Declaration | 1 | Not requested by coordinator |
| Certification | 1 | Single page |
| Dedication | 1 | Generated even when empty |
| Acknowledgement | 1 | AI-generated, often verbose |
| Abstract | 1 | Not requested by coordinator |
| Table of Contents | 1 | Hardcoded static TOC with dot leaders |
| Chapter 1 (Introduction) | 3-4 | Fixed text + verbose scope section |
| Chapter 2 (Org Profile) | 2-3 | Generic fallback text when student data missing |
| Chapter 3 (Activities) | 15-20 | **Primary bloat source** |
| Chapter 4 (Skills/Challenges) | 3-4 | Repetitive generic filler |
| Chapter 5 (Conclusion) | 2-3 | Not in coordinator spec (should be Chapter 4) |
| References & Appendices | 2-3 | Appendices include logbook page images |
| **Total** | **50+** | |

## Confirmed Bloat Causes

### Cause 1: Hardcoded TOC with sections not in coordinator spec (Lines ~280-340 of document_exporter.py)
The `render_table_of_contents_section()` function renders a static TOC with 26 hardcoded entries including:
- Declaration, Certification & Approval, Dedication, Acknowledgements, Abstract / Executive Summary
- These pages exist in the document even though the coordinator spec does not request them
- The TOC itself consumes a full page

### Cause 2: Page break before every chapter (document_exporter.py line ~462)
`doc.add_page_break()` is called when `current_chapter != b_sec.chapter_number`. This forces every chapter to start on a fresh page even if the previous chapter ended near a page boundary, wasting partial pages.

### Cause 3: Chapter 3 activities written out one entry per day / table row per day
`report_generator.py` `build_rule_based_section_content()` for `ch3_weekly_activities` and `ch3_tasks` iterates over verified logbook entries and writes each as a separate `<li>` or paragraph. With 20-30 logbook days, this creates many short paragraphs, each consuming vertical space due to 1.5 line spacing + 6pt after.

### Cause 4: Same facts repeated across sections 3.1, 3.2, 3.3, 3.4 and 4.1
- Tools appear in both 3.4 (Equipment/Tools Used) and 3.2 (Activities)
- Skills appear in both 3.3 and 4.1
- Challenges appear in both 3.5 and 4.2
- Projects appear in both 3.5 and 4.1
No cross-section duplicate check exists; each section rewrites facts in full.

### Cause 5: Verbatim logbook text with typos
Raw `raw_text` from logbook entries is copied directly into HTML without rewriting into prose or grouping into week ranges. Short entries like "Fixed computer" each become their own paragraph with full paragraph spacing.

### Cause 6: Sections not in coordinator spec are still generated
- Declaration page (not requested)
- Abstract page (not requested)
- "LEVEL: 400 LEVEL" line on cover (not requested)
- Chapter 5 (should be Chapter 4 per spec)

### Cause 7: Generic filler when student data is missing
When `organization_activities`, `skills_acquired`, `problems_encountered` etc. are empty, `report_generator.py` inserts verbose invented paragraphs (e.g., ch2_org_profile default text is ~120 words of generic corporate language).

### Cause 8: List/table styles with excessive spacing
- `<li>` items use `space_after = Pt(4)` with 1.5 line spacing (document_exporter.py line ~111)
- Table cell paragraphs use `space_after = Pt(2)` with 1.15 spacing
- A `p_spacer` paragraph is added after every table with `space_before = Pt(4)` and `space_after = Pt(4)`

### Cause 9: Page counting is word-estimate only, not actual render
The current system uses `report.estimated_pages` (a word-based estimate) and `page_estimate_breakdown`. No actual PDF render is used to count pages before export. The editor UI shows an estimate, not the real count.

## How Page Counting Currently Works

1. `Report.estimated_pages` — integer field, set during generation as a rough word-count estimate
2. `Report.page_estimate_breakdown` — JSON field with per-section word estimates
3. No call to `convert_docx_to_pdf()` or `pymupdf` to count actual rendered pages before export
4. The editor UI shows `estimated_pages` from the report model, updated only on regeneration

## Recommended Fixes

1. Remove Declaration, Abstract pages; make Dedication/Acknowledgement conditional
2. Remove page break before every chapter; let content flow naturally
3. Group logbook days into week ranges in Chapter 3
4. Cross-section duplicate check: each fact told once in 3.2, referenced briefly elsewhere
5. Remove generic filler; required sections with no source material block generation
6. Count pages from actual PDF render (pymupdf), not word estimates
7. Implement page budget controller with 12-15 page hard limits

## Implementation: Page Budget Controller

### New file: `backend/api/page_controller.py`

Defines the page budget system:

- **Page limits**: min_pages=12 (soft warn), max_pages=15 (hard block), target_pages=13
- **Words per page**: 350 (TNR 12pt, 1.5 spacing, justified, 2.54cm margins)
- **Per-section word budgets**: Chapter Three (activities) flexes most (400 words), fixed text sections have narrow bounds
- **Fact importance ranking**: tool/equipment (10) > quantity/project (9) > activity/duty (8) > challenge/solution (7) > skill (6) > person (5) > organisation_detail (4) > recommendation (3) > personal_statement (2)
- **Condensation strategies**: group days into week ranges, merge repeated tasks, drop low-importance fact references
- **Page counting**: actual rendered PDF via LibreOffice + pdfinfo (never word estimates)
- **3-pass render loop**: generate → render → count → condense → regenerate

### Modified: `backend/api/document_exporter.py`

`export_report_documents()` now:
1. Renders DOCX → PDF → counts actual pages
2. If over 15: condenses sections, regenerates (up to 3 passes)
3. If still over 15: blocks export with `page_limit_exceeded` error
4. If under 12: warns but allows download
5. Saves `actual_page_count` and `page_range_status` on the Report model

### Modified: `backend/api/models.py`

Added fields to `Report`:
- `actual_page_count` (IntegerField, nullable)
- `page_range_status` (CharField: within_range/over_limit/under_limit/not_rendered)

### Migration: `0022_report_actual_page_count.py`

### Modified: `backend/api/views.py`

Added `ReportPageStatusView` at `/api/projects/<id>/report/page-status/` returning:
- `actual_page_count`, `page_range_status`, `estimated_pages`, `page_estimate_breakdown`
- `min_pages`, `max_pages`, `target_pages`

### Modified: `backend/api/urls.py`

Added route for `report-page-status`.

### Modified: `frontend/lib/api.ts`

Added `getReportPageStatus()` API method.

### Modified: `frontend/lib/store/use-project-store.ts`

Added `pageStatus` field and `fetchPageStatus()` action.

### Coordinator Settings (to be confirmed)

| Setting | Default | Description |
|---------|---------|-------------|
| college name for Computer Science | (not shipped - setting only) | Used on cover page |
| degree line (B.Sc or B.Tech) | (not shipped - setting only) | Used on cover page |
| cover shows page number | true | Whether cover is numbered "i" |
| industrial supervisor must sign | true | Whether Industrial-Based Supervisor line appears |
| table of contents expected | true | Whether TOC page is included |
| margins | 2.54 cm | All sides unless department specifies otherwise |
| scheme name spelling | "SIWES" | Used identically everywhere |

