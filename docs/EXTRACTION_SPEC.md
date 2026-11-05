# Reviewed transcript extraction specification

## Scope and source of truth

The reviewed transcript on `ExtractedPage.extracted_text` is the source text. A
`LogbookPage` points to that page and adds its page index, classification and
quality score. Editing/reviewing a page does not overwrite the original upload.
Once `is_reviewed` is true, deterministic parsing creates `WeekRecord` and
`DayEntry` rows. Each entry stores its exact line and character offsets in
`source_span`, its source page, parsed date/weekday when unambiguous, and the
page quality score. Reprocessing a reviewed page replaces only that page's day
entries. Short and table-like lines are retained with exact source spans;
blank lines remain in the reviewed transcript and are not converted into
entries.

The provenance model is:

- `Fact`: kind, text, provenance (`LOGBOOK`, `INFERRED`, `STUDENT_PROVIDED`),
  source entry links, exact evidence quote, inference reason, and status.
- `ReportParagraph`: generated/editorial paragraph with Fact links. Report
  generation must consume confirmed facts and persist the IDs used for every
  student-derived paragraph. Fixed template paragraphs carry no Fact IDs.
- `WeekRecord` stores a week range and source pages; `DayEntry` stores reviewed
  transcript segments. `LogbookPage` types are cover, student details, weekly
  record, supervisor remarks, other, and blank.

## Extraction sequence

1. **Deterministic pass:** classify blank/student-details/weekly/supervisor/cover
   pages; identify week labels, dates, weekday labels, table-like separators,
   and existing supervisor signature detection. Dates are parsed only when
   calendar-valid. Weekday/date conflicts are retained as source text and
   surfaced for review; the parser does not repair them. Table structure is
   not yet extracted. Page classification
   is a heuristic and remains editable.
2. **Candidate extraction:** the current implementation does not call an LLM.
   A future extractor must return JSON conforming to `FACT_SCHEMA` in
   `backend/api/extraction.py`. Every candidate includes `kind`, `text`,
   `provenance`, `evidence_quote`, and `inference_reason`.
3. **Evidence validation:** `evidence_quote` must be a non-empty, exact,
   case-sensitive substring of the reviewed transcript. Invalid candidates are
   rejected with a machine-readable validation error and are not persisted.
   `INFERRED` candidates also require a non-empty reason and remain `proposed`
   until the student confirms them. Nothing in the extraction service silently
   changes spelling.
4. **Report use:** only confirmed facts may support student-specific report
   statements. The report paragraph stores references to the Fact IDs used.
   Normalisation may improve grammar but must preserve all student-specific
   quantities and tool names, and may not add tools, outcomes, people, dates,
   metrics, projects or domain claims.

The current v2 generator does not yet create normalized Fact-linked paragraphs.
It therefore leaves logbook-derived duties, activities, and summary sections
empty instead of copying transcript lines verbatim. Chapter 3 tools can use
the explicitly student-provided profile field; legacy tool values from parsed
entries are not copied.

### Future LLM prompt contract

The `extraction_prompt()` helper asks for schema-constrained JSON, exact quotes,
no spelling correction, no unsupported inference, and clarifying questions for
ambiguous entries. Treat model output as untrusted even if the model claims high
confidence. Validate every quote and schema field before saving. Ambiguous
phrases such as “Waste Redution Marketplace setup” must yield a question about
whether the student built or used the system; “Redution” may be offered as a
spelling suggestion but the stored transcript remains unchanged.

## Confidence, uncertainty and domain

Page quality and OCR confidence are evidence about legibility, not truth.
Uncertain facts remain proposed and must be shown for student review. Domain
labels may be derived only from confirmed facts. Generic report templates must
not inject hardware, PPE, engineering, IT, diagnostic equipment, or other
specialist content without supporting confirmed facts.

## Material sufficiency and completeness

`material_sufficiency(project)` reports confirmed activities and tools by
section, blank transcript pages first, and short targeted questions. One
confirmed activity Fact is `insufficient_material`; legacy
`LogbookEntry.is_verified` is not counted because its provenance is inconsistent.
Template boilerplate does not increase this count. In v2 completeness, this status blocks report generation
and is returned with other required-field blockers. The default activity
threshold is two confirmed entries; it is a conservative product rule, not an
accuracy claim. It should be revisited against anonymised reviewed examples.

The template section requirements remain in the v2 manifest and completeness
checker. Profile and required section fields report `Found`, `Missing`, or
`Uncertain`. Missing required fields block generation. Proposed/inferred facts
are not counted as confirmed section material.

## Anti-fabrication and privacy

Tests should include brief transcripts, vague work descriptions, and entries
with no named tools. For each student-derived output, compare proper nouns and
digits against the confirmed source facts; any unsupported token is a failure.
Also verify quote rejection for non-substrings and that a single activity yields
`insufficient_material`. Real-document fixtures must be anonymised and stored
only under ignored evaluation directories. Synthetic fixtures may be committed.

No real logbook fixture or ground truth was available during this implementation,
so no extraction accuracy, field accuracy, or missed-error rate is claimed.
The Fact confirmation endpoint and client review cards are also not yet
implemented; proposed facts can currently be created by the service layer only.

## Failure modes

- Blank or nearly empty transcript: retain the page as blank/low-text and show
  it before other review tasks; request a retake or typed transcript.
- Invalid date: preserve the line, leave the date unset, and request review.
- Weekday/date disagreement: retain both and request confirmation.
- Missing/non-verbatim quote: reject the fact candidate and record
  `evidence_quote_not_verbatim_substring`.
- Inference without a reason: reject with `inference_reason_required`.
- Ambiguous activity or suspected typo: ask a targeted question; do not resolve
  by guessing or altering source text.
- No named tool/equipment: leave that section empty and ask the student; never
  insert a placeholder tool.
- Thin source material: expose the section counts and enrichment questions and
  block full report generation instead of padding with generic prose.
