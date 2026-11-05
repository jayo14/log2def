# Report release checklist

Each v2 preview response includes a quality-gate result. DOCX/PDF generation, asynchronous export starts, cached download links, and direct downloads use the same gate. A failed gate returns student-readable blockers with a section anchor. Warnings do not block export.

| Original review finding | Preventive check | Test / status |
| --- | --- | --- |
| Five chapters instead of the coordinator's four | Template section order and chapter heading text must match v2; missing required headings block | TemplateV2ContractTests.test_v2_matches_coordinator_section_order; valid DOCX gate test |
| Fabricated briefings, PPE, colleagues, family thanks, mentorship claims, and fake organisation reference | Writer accepts only confirmed Fact IDs; filler, second-person instructions, and unsupported success/verification claims are rejected | ProvenanceExtractionTests.test_grounded_writer_rejects_uncited_or_unsupported_detail; DocumentQualityGateTests.test_injected_placeholder_blocks_export_at_document_boundary |
| Seven input-needed blocks and bracketed placeholders | Placeholder patterns block preview/export | DocumentQualityGateTests.test_injected_placeholder_blocks_export_at_document_boundary |
| Bracketed name placeholders | Same placeholder check, with exact section anchor | DocumentQualityGateTests.test_injected_placeholder_blocks_export_at_document_boundary |
| Second-person defense instructions | Second-person check in generated prose and final model | ProvenanceExtractionTests.test_grounded_writer_rejects_truncation_placeholders_and_bad_finish |
| Duplicated headings or duplicated sections | Duplicate headings and template section order are checked | DocumentQualityGateTests.test_duplicate_heading_and_truncated_paragraph_are_blockers |
| Paragraphs cut off mid-sentence | Each paragraph and sentence must end in terminal punctuation | DocumentQualityGateTests.test_duplicate_heading_and_truncated_paragraph_are_blockers; ProvenanceExtractionTests.test_grounded_writer_rejects_truncation_placeholders_and_bad_finish |
| Fourteen uploaded pages yielded one verbatim activity, preserving a typo | OCR trace, extraction, and Fact provenance provide evidence locations; gate rejects unlinked prose | Not proven: the anonymised 14-page evaluation fixture and verified transcript ground truth are unavailable. Do not claim an OCR recall improvement from this gate |
| “Verified” used without evidence; “Standard toolkit” placeholder | Verified requires a signature-backed Fact; generic toolkit filler blocks | DocumentQualityGateTests.test_unsupported_verified_claim_and_generic_toolkit_are_blockers |
| “On target” page count despite little student content | UI displays total pages, student-derived page estimate, blocker count, and warning count | UI update; frontend type check pending |

## Release checks

- [ ] Backend suite passes, including DocumentQualityGateTests.
- [ ] Frontend type check and tests pass.
- [ ] Playwright upload-to-export flow passes with recorded OCR and anonymised inputs.
- [ ] Placeholder and sparse-logbook failure drills return blockers.
- [ ] DOCX validation confirms fonts, styles, TOC field, and pagination.
- [ ] PDF conversion confirms headings, page labels, and compatible page count.
- [ ] 14-page OCR evaluation is run only after a privacy-safe fixture and reviewed ground truth are supplied.

The release gate cannot establish semantic truth from wording alone. It ensures citations exist and catches structural and formatting failures; manual review and the OCR evaluation remain necessary for submission readiness.
