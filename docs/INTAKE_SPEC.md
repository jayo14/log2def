# Guided report interview

## Flow

The dashboard wizard now has seven steps: Your details, Logbook, Review,
Missing info, About your organisation, Images, and Generate. The organisation
step opens the existing resumable guided interview; the images step is
optional and continues directly to generation when no pictures are added.

`GET /api/projects/{id}/intake/` returns the current answers, the required
questions still missing from the active v2 template manifest, optional
questions, the project completeness result, and a read-only duties prefill from
verified logbook entries. That prefill is labelled “From your logbook — confirm
before using”; it is never saved until the student selects it and submits the
answer.

The mobile route `/projects/{id}/intake` shows one question at a time. Required
questions are filtered from the template manifest and saved separately with
`PATCH /api/projects/{id}/intake/`. Hints are rendered as muted helper text and
never populate the answer field. Optional personal pages remain opt-in. Empty
dedication or acknowledgement data produces no page. The “thank God” and
family acknowledgement choices default to off.

Organisation profile answers include the products/services sentence, optional
history/location, objectives, structure, organogram tree, and optional pasted
source text plus its origin. Pasted source is stored as a student-provided fact;
the system does not fetch or search the organisation.

Images are uploaded one at a time through `/api/projects/{id}/report-images/`.
The server applies EXIF orientation, removes metadata, bounds the long side at
1800 pixels, stores a private original, and embeds only the processed copy.
Captions require at least three words. Pictures are optional, capped at six,
editable and reorderable, and render after References in `Appendix A / Pictures`.

The required interview inputs cover organisation work/objectives/structure,
an indented organogram, the student's unit, duties, paired challenges and
solutions (or explicit “I had none”), and recommendations. Organisation history
is optional when the student cannot confirm it. An industrial supervisor name
is optional; certification signatures remain blank.

## Provenance and document output

Each saved answer is stored on the project and also as a confirmed
`STUDENT_PROVIDED` Fact with a `source_field` key and evidence quote. Challenge
and solution entries are paired by index. “I had none” is recorded as an
explicit student choice but does not count as an encountered challenge.

The v2 generator uses the interview answers for Chapter 2, duties, challenge /
solution sections, recommendations and optional personal pages. Empty optional
pages and the two challenge sections are omitted. Each student-derived section
is stored as a `ReportParagraph` linked to its supporting Fact IDs. Paragraphs
written later in the report editor must reference confirmed Facts and require
student confirmation before the paragraph is saved to the document model.

The organogram currently accepts a two-space indented tree. The parser rejects
indentation jumps and tabs. Image upload is not part of this interview screen.
Profile dates continue to use the existing date validator; this interview does
not add free-form dates or quantity fields. No standard recommendation is
preselected or inserted.

## Generation blockers

The completeness checker reads the required guided-intake steps from the same
manifest and reports a `guided_intake:<key>` Missing field for each unanswered
required item. Empty required text and incomplete challenge/solution pairs are
rejected at save time. Date range errors from the student profile continue to
block generation. Optional history and personal pages never block.

## Known limitations

The interview covers organisation details and personal narrative; it does not
replace Fact extraction/review for logbook activities, tools or skills. Those
remain subject to confirmed Fact sufficiency. There is no organogram image
upload, recommendation menu, or dedicated quantity input in this version.
