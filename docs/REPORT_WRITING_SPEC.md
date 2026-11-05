# Fact-grounded report writing

## Brief and output contract

The module backend/api/grounded_writer.py builds a section brief from confirmed Facts only. It contains the section key and heading, Fact IDs and text, an evidence-sized word target, and the en-GB/first-person/plain-style rules. Proposed, rejected, or otherwise unconfirmed Facts are excluded.

The writer is asked for JSON shaped as:

    {
      "paragraphs": [
        {
          "sentences": [
            {"text": "I configured a router.", "fact_ids": [12]}
          ]
        }
      ]
    }

Fixed template wording may use a boilerplate tag without Fact IDs. The current v2 path does not ask the model to write fixed boilerplate.

## Validation

Before storage, the validator checks the JSON structure, non-empty terminal punctuation, the provider finish reason, citations against the brief's Fact IDs, and banned placeholder, second-person, filler, and unsupported verification wording. Numbers and capitalised name-like tokens must occur in cited Fact text. Any rejection clears that attempted generated section and stores a visible section warning; it is not silently replaced with unchecked model text.

Provider metadata includes finish reason for Gemini and OpenAI-compatible chat completions. A non-complete finish is rejected. Student-edited paragraphs may contain new student-authored information, so they bypass Fact grounding; they still must end with punctuation and pass placeholder/second-person checks.

Generated sentence paragraphs retain Fact links. Paragraph API responses include source page numbers when the supporting Facts trace to parsed DayEntries. Single-section regeneration uses only that section's existing linked confirmed Facts and updates only that section and its document-model snapshot.

## Thin material and current limits

The section brief target scales with confirmed evidence and is capped to discourage expansion. No Fact means no writer call. Existing material-sufficiency and completeness checks remain the source for generation blockers and enrichment questions.

This writer is intentionally conservative and not a substitute for evaluation against a verified, anonymised gold report. Token checks are heuristic: they catch unsupported numbers and many proper names but are not a semantic entailment proof. There is no automatic retry yet: the first invalid or truncated response fails visibly, preserving the no-unsupported-text guarantee. Live model behavior and token limits have not been evaluated in this checkout.
