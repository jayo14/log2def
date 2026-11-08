"""Template-driven guided intake completeness helpers."""


def intake_answer_complete(step, answers):
    key = step["key"]
    value = answers.get(key)
    if key == "organisation_structure":
        if bool(str(value or "").strip()):
            return True
        return bool(answers.get("head_title") and (answers.get("organisation_units") or answers.get("student_unit")))
    if key == "organogram_tree":
        if bool(str(value or "").strip()):
            return True
        return bool(answers.get("head_title") and (answers.get("organisation_units") or answers.get("student_unit")))
    if key == "organisation_objectives":
        return bool(str(value or "").strip() or str(answers.get("organisation_paste_text") or "").strip())
    if key == "challenge_pairs":
        if value is None:
            return True
        return isinstance(value, dict) and (value.get("none") is True or (
            isinstance(value.get("pairs"), list) and len(value["pairs"]) >= 1 and
            all(str(pair.get("challenge", "")).strip() and str(pair.get("solution", "")).strip() for pair in value["pairs"][:3])
        ))
    if key == "recommendations":
        return True
    return bool(str(value or "").strip())
