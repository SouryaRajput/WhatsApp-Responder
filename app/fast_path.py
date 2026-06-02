"""
Fast path extraction: skip the LLM for common lead-qualification replies.

Keep this conservative. If a message is ambiguous, return None and let the
LLM handle it.
"""

import re


FILLER_WORDS = {
    "i",
    "am",
    "im",
    "i'm",
    "looking",
    "for",
    "want",
    "need",
    "a",
    "an",
    "property",
    "flat",
    "apartment",
    "house",
    "home",
    "please",
}


def try_local_extract(state: str, message: str) -> dict | None:
    msg = _normalize(message)
    if not msg:
        return None

    combined = _extract_combined(msg)
    if _has_useful_combined_data(combined, state):
        return _filter_for_state(state, combined)

    if state == "intent":
        return _extract_intent(msg)

    if state == "loan_status":
        return _extract_loan_status(msg)

    if state == "budget":
        return _extract_budget(msg)

    if state == "rent_budget":
        return _extract_rent(msg)

    if state == "timeline":
        return _extract_timeline(msg, buy=True)

    if state == "move_in_timeline":
        return _extract_timeline(msg, buy=False)

    if state == "property_type":
        return _extract_property_type(msg)

    if state == "location":
        return _extract_location(msg)

    return None


def _normalize(message: str) -> str:
    msg = message.lower().strip()
    msg = msg.replace("₹", "rs ")
    msg = re.sub(r"[,\u2013\u2014]", "-", msg)
    msg = re.sub(r"\s+", " ", msg)
    return msg


def _extract_combined(msg: str) -> dict:
    data = {}

    intent = _extract_intent(msg)
    if intent:
        data.update(intent)

    budget = _extract_budget(msg)
    if budget:
        data.update(budget)

    rent = _extract_rent(msg)
    if rent:
        data.update(rent)

    buy_timeline = _extract_timeline(msg, buy=True)
    if buy_timeline:
        data.update(buy_timeline)

    move_in = _extract_timeline(msg, buy=False)
    if move_in:
        data.update(move_in)

    property_type = _extract_property_type(msg)
    if property_type:
        data.update(property_type)

    location = _extract_location(msg)
    if location:
        data.update(location)

    loan = _extract_loan_status(msg)
    if loan:
        data.update(loan)

    return data


def _has_useful_combined_data(data: dict, state: str) -> bool:
    if not data:
        return False

    state_fields = {
        "intent": {"intent"},
        "budget": {"budget_min", "budget_max"},
        "rent_budget": {"rent_min", "rent_max"},
        "location": {"location"},
        "timeline": {"timeline", "timeline_days"},
        "loan_status": {"loan_status"},
        "move_in_timeline": {"move_in_timeline", "move_in_days"},
        "property_type": {"property_type"},
    }
    fields = state_fields.get(state, set())
    return bool(fields & data.keys()) or len(data) >= 2


def _filter_for_state(state: str, data: dict) -> dict:
    if state in {"intent", "budget", "rent_budget"}:
        if state == "budget":
            data.pop("move_in_timeline", None)
            data.pop("move_in_days", None)
        elif state == "rent_budget":
            data.pop("timeline", None)
            data.pop("timeline_days", None)
        return data

    if state == "timeline":
        data.pop("move_in_timeline", None)
        data.pop("move_in_days", None)
    elif state == "move_in_timeline":
        data.pop("timeline", None)
        data.pop("timeline_days", None)
    return data


def _extract_intent(msg: str) -> dict | None:
    buy_words = {"buy", "purchase", "buying"}
    rent_words = {"rent", "lease", "rental", "renting"}
    tokens = set(re.findall(r"[a-z]+", msg))

    has_buy = bool(tokens & buy_words)
    has_rent = bool(tokens & rent_words)
    if has_buy and not has_rent:
        return {"intent": "buy"}
    if has_rent and not has_buy:
        return {"intent": "rent"}
    return None


def _extract_loan_status(msg: str) -> dict | None:
    yes_patterns = (
        r"\b(yes|yeah|yep|ha|haan|approved|pre[- ]?approved|ready)\b",
        r"\bloan (is )?(done|approved|ready)\b",
    )
    no_patterns = (
        r"\b(no|nope|nah|nahi|nhi)\b",
        r"\b(not yet|no loan|without loan|cash)\b",
    )

    if any(re.search(pattern, msg) for pattern in no_patterns):
        return {"loan_status": "no"}
    if any(re.search(pattern, msg) for pattern in yes_patterns):
        return {"loan_status": "yes"}
    return None


def _extract_budget(msg: str) -> dict | None:
    pattern = (
        r"(?:budget\s*(?:is|around|approx|of)?\s*)?"
        r"(?:rs\s*)?(\d+(?:\.\d+)?)\s*(l|lac|lakh|lakhs|cr|crore|crores)"
        r"(?:\s*(?:-|to|and)\s*(?:rs\s*)?(\d+(?:\.\d+)?)\s*"
        r"(l|lac|lakh|lakhs|cr|crore|crores)?)?"
    )
    match = re.search(pattern, msg)
    if not match:
        return None

    val1, unit1 = float(match.group(1)), match.group(2)
    min1, max1 = _convert_budget(val1, unit1)

    if match.group(3):
        val2 = float(match.group(3))
        unit2 = match.group(4) or unit1
        min2, max2 = _convert_budget(val2, unit2)
        return {"budget_min": min(min1, min2), "budget_max": max(max1, max2)}

    if re.search(r"\b(max|upto|up to|under|below)\b", msg):
        return {"budget_max": max1}
    if re.search(r"\b(min|above|over|at least)\b", msg):
        return {"budget_min": min1}
    return {"budget_min": min1, "budget_max": max1}


def _extract_rent(msg: str) -> dict | None:
    if re.search(r"\b(budget|buy|purchase|cr|crore|lakh|lakhs|lac)\b", msg):
        if not re.search(r"\b(rent|rental|lease|monthly|per month|pm)\b", msg):
            return None

    pattern = (
        r"(?:rent\s*(?:is|around|approx|of)?\s*)?"
        r"(?:rs\s*)?(\d+(?:\.\d+)?)\s*(k|thousand)?"
        r"(?:\s*(?:-|to|and)\s*(?:rs\s*)?(\d+(?:\.\d+)?)\s*(k|thousand)?)?"
        r"(?:\s*(?:per month|pm|monthly))?"
    )
    match = re.search(pattern, msg)
    if not match:
        return None

    if not (match.group(2) or match.group(4) or re.search(r"\b(rent|monthly|pm|per month)\b", msg)):
        return None

    min_val = _convert_rent(float(match.group(1)))
    max_val = _convert_rent(float(match.group(3))) if match.group(3) else min_val

    if re.search(r"\b(max|upto|up to|under|below)\b", msg):
        return {"rent_max": max_val}
    if re.search(r"\b(min|above|over|at least)\b", msg):
        return {"rent_min": min_val}
    return {"rent_min": min(min_val, max_val), "rent_max": max(min_val, max_val)}


def _extract_timeline(msg: str, buy: bool) -> dict | None:
    days = None
    label = None

    if re.search(r"\b(immediate|immediately|asap|now|today)\b", msg):
        days, label = 0, "immediately"
    elif re.search(r"\b(this week|within a week)\b", msg):
        days, label = 7, "within a week"
    elif re.search(r"\b(next week|2 weeks|two weeks|fortnight)\b", msg):
        days, label = 14, "2 weeks"
    else:
        match = re.search(r"\b(\d+)\s*(day|days|week|weeks|month|months)\b", msg)
        if match:
            amount = int(match.group(1))
            unit = match.group(2)
            multiplier = 1 if unit.startswith("day") else 7 if unit.startswith("week") else 30
            days = amount * multiplier
            label = f"{amount} {unit}"
        elif re.search(r"\b(next month|1 month|one month)\b", msg):
            days, label = 30, "1 month"
        elif re.search(r"\b(3 months|three months|quarter)\b", msg):
            days, label = 90, "3 months"
        elif re.search(r"\b(just exploring|exploring|not sure|later)\b", msg):
            days, label = 365, "just exploring"

    if days is None:
        return None

    if buy:
        return {"timeline": label, "timeline_days": days}
    return {"move_in_timeline": label, "move_in_days": days}


def _extract_property_type(msg: str) -> dict | None:
    if re.search(r"\b(skip|not sure|any|anything|no preference)\b", msg):
        return {"property_type": "skip"}

    match = re.search(r"\b([1-6]\s*(?:bhk|rk)|studio|villa|independent house|house|flat|apartment)\b", msg)
    if not match:
        return None

    value = re.sub(r"\s+", "", match.group(1)) if "bhk" in match.group(1) or "rk" in match.group(1) else match.group(1)
    return {"property_type": value.upper() if re.search(r"\d", value) else value}


def _extract_location(msg: str) -> dict | None:
    vague = {"any", "anywhere", "not sure", "no idea", "skip", "na", "n/a"}
    if msg in vague:
        return {"location": msg}

    location_patterns = (
        r"\b(?:in|near|around|at)\s+([a-z][a-z\s.-]{1,60}?)(?:\s+(?:in|within|after|next)\s+\d|\s+next\s+(?:week|month)|$)",
        r"\blocation\s*(?:is|:)?\s*([a-z][a-z\s.-]{1,60})$",
        r"\barea\s*(?:is|:)?\s*([a-z][a-z\s.-]{1,60})$",
    )
    for pattern in location_patterns:
        match = re.search(pattern, msg)
        if match:
            location = _clean_location(match.group(1))
            if location:
                return {"location": location}

    if _looks_like_non_location_answer(msg):
        return None

    tokens = re.findall(r"[a-z]+", msg)
    if 1 <= len(tokens) <= 4 and not (set(tokens) & FILLER_WORDS):
        return {"location": _title_location(msg)}

    return None


def _looks_like_non_location_answer(msg: str) -> bool:
    if re.search(r"\d", msg):
        return True
    if re.search(r"\b(l|lac|lakh|lakhs|cr|crore|crores|k|thousand|bhk|rk|studio)\b", msg):
        return True
    if re.search(r"\b(day|days|week|weeks|month|months|immediate|immediately|asap|today|tomorrow|exploring)\b", msg):
        return True
    if re.search(r"\b(yes|no|yep|nope|approved|loan|rent|buy|purchase|lease)\b", msg):
        return True
    return False


def _clean_location(value: str) -> str | None:
    value = re.sub(
        r"\b(?:with|for|budget|rent|buy|purchase|move|moving|shift|in|within|after|next|month|week|days?).*$",
        "",
        value,
    ).strip(" .-")
    if not value:
        return None
    return _title_location(value)


def _title_location(value: str) -> str:
    return " ".join(part.capitalize() for part in value.split())


def _convert_budget(val: float, unit: str) -> tuple[float, float]:
    if unit.startswith(("cr", "crore")):
        lakhs = val * 100
        return lakhs * 0.9, lakhs * 1.1
    return val * 0.9, val * 1.1


def _convert_rent(val: float) -> float:
    return val / 1000 if val > 100 else val
