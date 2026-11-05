"""Fact-only report prose briefs and conservative output validation."""
from __future__ import annotations

import json
import re
from dataclasses import dataclass

from .ai_provider import generate_completion


class GroundedWriterError(ValueError):
    pass


BLOCKED_PATTERNS = (
    re.compile(r"\[[^\]]*\]"), re.compile(r"\bINPUT NEEDED\b", re.I),
    re.compile(r"\byou\b|\byour\b", re.I),
    re.compile(r"\bmorning briefings?\b|\bPPE\b|\bfast-paced environment\b", re.I),
)


@dataclass(frozen=True)
class SectionBrief:
    section_key: str
    heading: str
    facts: tuple[dict, ...]
    target_words: int
    style_rules: tuple[str, ...]

    def as_dict(self):
        return {
            "section_key": self.section_key, "heading": self.heading,
            "facts": list(self.facts), "target_words": self.target_words,
            "style_rules": list(self.style_rules),
        }


def build_section_brief(section_key: str, heading: str, facts) -> SectionBrief:
    """Return only confirmed facts, with a modest length based on evidence."""
    allowed = tuple({"id": fact.id, "text": fact.text} for fact in facts if fact.status == "confirmed")
    words = sum(len(item["text"].split()) for item in allowed)
    target = min(180, max(0, words + len(allowed) * 4))
    return SectionBrief(section_key, heading, allowed, target, (
        "Use first person where it describes the student's actions.",
        "Use en-GB spelling, plain formal language and past tense for activities.",
        "Do not add claims, outcomes, tools, quantities or facts.",
        "Return JSON paragraphs; each sentence cites fact_ids or is tagged boilerplate.",
    ))


def _sentences(document):
    if not isinstance(document, dict) or not isinstance(document.get("paragraphs"), list):
        raise GroundedWriterError("writer_output_schema_invalid")
    for paragraph in document["paragraphs"]:
        if not isinstance(paragraph, dict) or not isinstance(paragraph.get("sentences"), list):
            raise GroundedWriterError("writer_output_schema_invalid")
        for sentence in paragraph["sentences"]:
            if not isinstance(sentence, dict) or not isinstance(sentence.get("text"), str):
                raise GroundedWriterError("writer_output_schema_invalid")
            yield sentence


def validate_writer_output(document: dict, brief: SectionBrief, finish_reason="STOP") -> list[dict]:
    if finish_reason not in {"STOP", "stop", "completed", ""}:
        raise GroundedWriterError("writer_output_truncated")
    facts = {int(item["id"]): item["text"] for item in brief.facts}
    result = []
    for sentence in _sentences(document):
        text = sentence["text"].strip()
        ids = sentence.get("fact_ids", [])
        boilerplate = sentence.get("boilerplate") is True
        if not text or not re.search(r"[.!?][\"')’”]*$", text):
            raise GroundedWriterError("sentence_incomplete")
        if (not boilerplate and (not isinstance(ids, list) or not ids)) or (boilerplate and ids):
            raise GroundedWriterError("sentence_citation_missing_or_mixed")
        if any(not isinstance(fid, int) or fid not in facts for fid in ids):
            raise GroundedWriterError("uncited_fact_id")
        for pattern in BLOCKED_PATTERNS:
            if pattern.search(text):
                raise GroundedWriterError("banned_pattern")
        if re.search(r"\bverified\b", text, re.I):
            raise GroundedWriterError("verification_claim_requires_signature_evidence")
        cited = " ".join(facts[fid] for fid in ids)
        tokens = re.findall(r"\b(?:\d[\w./:-]*|[A-Z][A-Za-z0-9&'’.-]*)\b", text)
        sentence_starters = {"I", "My", "The", "A", "An", "During", "At", "In", "On", "For", "This", "That"}
        for token in tokens:
            if token in sentence_starters:
                continue
            if token.casefold() not in cited.casefold():
                raise GroundedWriterError("unsupported_named_or_numeric_token")
        result.append({"text": text, "fact_ids": ids, "boilerplate": boilerplate})
    return result


def validate_student_edited_text(text: str) -> bool:
    """Student wording may add facts, but unsafe placeholders and truncation remain blocked."""
    if not text.strip() or not re.search(r"[.!?][\"')’”]*$", text.strip()):
        return False
    return not any(pattern.search(text) for pattern in BLOCKED_PATTERNS)


def write_section(brief: SectionBrief) -> list[dict]:
    if not brief.facts:
        return []
    base_prompt = json.dumps(brief.as_dict(), ensure_ascii=False)
    last_error = None
    for attempt in range(2):
        prompt = base_prompt if not last_error else (
            base_prompt + "\nThe previous response failed validation with " + str(last_error)
            + ". Return corrected JSON; remove unsupported claims rather than guessing."
        )
        response = generate_completion(
            "Write only from the supplied confirmed Facts. Return JSON with paragraphs, each containing sentences; each sentence must contain text and fact_ids. Never invent details.",
            prompt, temperature=0.1, return_metadata=True,
        )
        raw = response["text"] if isinstance(response, dict) else response
        try:
            document = json.loads(raw)
            return validate_writer_output(
                document, brief,
                finish_reason=response.get("finish_reason", "") if isinstance(response, dict) else "",
            )
        except (TypeError, json.JSONDecodeError):
            last_error = GroundedWriterError("writer_output_json_invalid")
        except GroundedWriterError as exc:
            last_error = exc
    raise last_error or GroundedWriterError("writer_output_invalid")

