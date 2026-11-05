"""Template-driven guided intake completeness helpers."""


def intake_answer_complete(step, answers):
    value = answers.get(step["key"])
    if step["key"] == "challenge_pairs":
        return isinstance(value, dict) and (value.get("none") is True or (
            isinstance(value.get("pairs"), list) and len(value["pairs"]) >= 2 and
            all(str(pair.get("challenge", "")).strip() and str(pair.get("solution", "")).strip() for pair in value["pairs"][:3])
        ))
    return bool(str(value or "").strip())
