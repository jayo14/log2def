"""
Answer validation for student inputs (guided intake, profile answers, organisation details).

Detects and rejects nonsense, keyboard-mash, gibberish, and excessively short answers.
"""
from __future__ import annotations

import re
from typing import Tuple

# Common English and academic words to evaluate word validity
COMMON_WORDS = {
    "the", "be", "to", "of", "and", "a", "in", "that", "have", "i", "it", "for", "not", "on", "with",
    "he", "as", "you", "do", "at", "this", "but", "his", "by", "from", "they", "we", "say", "her",
    "she", "or", "an", "will", "my", "one", "all", "would", "there", "their", "what", "so", "up",
    "out", "if", "about", "who", "get", "which", "go", "me", "when", "make", "can", "like", "time",
    "no", "just", "him", "know", "take", "people", "into", "year", "your", "good", "some", "could",
    "them", "see", "other", "than", "then", "now", "look", "only", "come", "its", "over", "think",
    "also", "back", "after", "use", "two", "how", "our", "work", "first", "well", "way", "even",
    "new", "want", "because", "any", "these", "give", "day", "most", "us", "is", "are", "was",
    "were", "has", "had", "been", "being", "student", "siwes", "training", "industrial", "experience",
    "organisation", "organization", "department", "unit", "company", "firm", "service", "services",
    "product", "products", "software", "hardware", "network", "system", "systems", "development",
    "data", "web", "website", "application", "technology", "technologies", "engineering", "computer",
    "science", "information", "communication", "management", "director", "manager", "supervisor",
    "head", "staff", "client", "clients", "project", "projects", "maintenance", "support", "database",
    "design", "testing", "code", "programming", "python", "java", "html", "css", "javascript",
    "lagos", "nigeria", "established", "founded", "mission", "vision", "objective", "objectives",
    "provide", "provides", "providing", "deliver", "delivers", "delivering", "solution", "solutions",
    "consulting", "logistics", "finance", "banking", "health", "education", "research", "centre",
    "center", "office", "headquarters", "branch", "located", "based", "started", "team", "division",
    "operations", "duties", "task", "tasks", "role", "responsible", "assisted", "worked", "learned",
    "installed", "configured", "troubleshot", "repaired", "monitored", "managed", "reported", "under",
    "none", "nothing", "major", "encountered", "challenges", "solutions", "guidance", "recommend",
    "recommendations", "improve", "improved", "improvement", "internship", "attachment", "university",
    "institution", "coordinator", "mentor", "mentors", "practical", "technical", "skills", "tools",
}

STRAY_PREFIX_REGEX = re.compile(r"^[a-z]{1,2}[A-Z][a-z]")


def is_valid_word(word: str) -> bool:
    """Checks if a cleaned word looks like a legitimate English/technical word."""
    clean = re.sub(r"[^a-zA-Z]", "", word).lower()
    if not clean:
        return False
    if clean in COMMON_WORDS:
        return True
    # Word length 2-25 with balanced vowels
    vowels = sum(1 for c in clean if c in "aeiouy")
    vowel_ratio = vowels / len(clean)
    if len(clean) >= 4 and (vowel_ratio < 0.15 or vowel_ratio > 0.85):
        return False
    # No 5+ consecutive consonants
    if re.search(r"[bcdfghjklmnpqrstvwxyz]{5,}", clean):
        return False
    # No repeated characters 3+ times
    if re.search(r"(.)\1{2,}", clean):
        return False
    return True


def detect_repeated_ngrams(text: str, n: int = 4, threshold: int = 3) -> bool:
    """Detects if repetitive n-grams (e.g. keyboard mash sequences) dominate."""
    clean = re.sub(r"\s+", "", text).lower()
    if len(clean) < n * threshold:
        return False
    seen: dict[str, int] = {}
    for i in range(len(clean) - n + 1):
        gram = clean[i : i + n]
        seen[gram] = seen.get(gram, 0) + 1
        if seen[gram] >= threshold:
            return True
    return False


class ValidationResult(dict):
    """
    Validation result container compatible with dict indexing (res['is_valid']),
    attribute access (res.is_valid), and 2-tuple unpacking (is_valid, msg = res).
    """
    def __init__(self, is_valid: bool, message: str):
        super().__init__(is_valid=is_valid, message=message)
        self.is_valid = is_valid
        self.message = message

    def __iter__(self):
        return iter((self.is_valid, self.message))

    def __getitem__(self, item):
        if item == 0:
            return self.is_valid
        if item == 1:
            return self.message
        return super().__getitem__(item)


def validate_answer_text(
    text: str,
    min_words: int = 3,
    min_length: int = 15,
    allow_empty: bool = False,
    field_label: str = "answer"
) -> ValidationResult:
    """
    Validates a student's answer text for meaningful content and absence of gibberish.

    Returns ValidationResult (is_valid, error_message).
    """
    val = (text or "").strip()
    if not val:
        if allow_empty:
            return ValidationResult(True, "")
        return ValidationResult(False, f"Please provide an answer for {field_label}.")

    # Check for stray leading letter before capital letter (e.g. bAwjkn... or dWho...)
    # Often happens with keyboard typos or copy-paste artifacts
    if STRAY_PREFIX_REGEX.match(val):
        return ValidationResult(
            False,
            "Please provide a clear and meaningful answer. "
            "This answer appears to begin with stray characters or keyboard noise."
        )

    words = re.findall(r"\b[A-Za-z0-9'-]+\b", val)
    if len(words) < min_words or len(val) < min_length:
        msg = f"Please provide a more descriptive answer (at least {min_words} words)." if min_words > 1 else f"Please provide a valid {field_label}."
        return ValidationResult(
            False,
            msg
        )

    # Check for repeated character sequences (e.g., 'aaaaaa', 'qwertyqwerty')
    if re.search(r"(.)\1{4,}", val):
        return ValidationResult(
            False,
            "Please provide a meaningful answer. "
            "Repeated character sequences are not accepted."
        )

    # Check for repetitive keyboard-mash n-grams
    if detect_repeated_ngrams(val, n=4, threshold=4):
        return ValidationResult(
            False,
            "Please provide a clear and meaningful answer. "
            "This appears to contain random or repetitive characters."
        )

    # Check word validity ratio
    valid_count = sum(1 for w in words if is_valid_word(w))
    valid_ratio = valid_count / len(words) if words else 0.0

    if valid_ratio < 0.40:
        return ValidationResult(
            False,
            "Please provide a clear and meaningful answer. "
            "This appears to contain random or incomplete characters."
        )

    return ValidationResult(True, "")
