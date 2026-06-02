"""
[EC-03] Major redesign: data-driven state routing.
Instead of strict sequential progression, we now determine the next
unsatisfied state based on what data we already have.
This allows users who give multiple answers at once to skip ahead.
"""

# ── question for each state ───────────────────────────────────────

QUESTIONS = {
    "intent": (
        "👋 Hi! I help you find the perfect property. "
        "Are you looking to **buy** or **rent**?"
    ),
    "budget": "What's your budget range? (e.g., ₹50L–₹1Cr)",
    "rent_budget": (
        "What monthly rent are you comfortable with? "
        "(e.g., ₹10k–₹25k)"
    ),
    "location": "Which location or area are you interested in?",
    "timeline": (
        "When are you planning to buy? "
        "(e.g., immediately, 1 month, 3 months, just exploring)"
    ),
    "loan_status": "Do you have a home loan pre-approved? (Yes/No)",
    "move_in_timeline": (
        "When are you planning to move in? "
        "(e.g., immediately, 2 weeks, 1 month)"
    ),
    "property_type": (
        "What type of property? "
        "(e.g., 1BHK, 2BHK — or type 'skip' if not sure)"
    ),
}

# ── flow order per intent ─────────────────────────────────────────

BUY_FLOW = ["budget", "location", "timeline", "loan_status"]
RENT_FLOW = ["rent_budget", "location", "move_in_timeline", "property_type"]

# ── vague values that don't count as real answers ─────────────────

VAGUE_VALUES = {
    "", "not sure", "any", "anywhere", "n/a", "na",
    "idk", "don't know", "no idea", "whatever",
    "not specified", "skip", "doesn't matter",
}

# ── state satisfaction logic ──────────────────────────────────────

def is_state_satisfied(state: str, data: dict) -> bool:
    """
    Check if a state's required data is already present.
    [EC-03] This enables skipping ahead when user provides
    multiple answers in one message.
    """
    if state == "budget":
        return (
            data.get("budget_min") is not None
            or data.get("budget_max") is not None
        )
    if state == "rent_budget":
        return (
            data.get("rent_min") is not None
            or data.get("rent_max") is not None
        )
    if state == "location":
        loc = (data.get("location") or "").strip().lower()
        return bool(loc) and loc not in VAGUE_VALUES
    if state == "timeline":
        return data.get("timeline_days") is not None
    if state == "loan_status":
        return data.get("loan_status") in ("yes", "no")
    if state == "move_in_timeline":
        return data.get("move_in_days") is not None
    if state == "property_type":
        return True  # [EC-10] optional — always satisfied
    return False


def get_next_unsatisfied_state(intent: str, data: dict) -> str | None:
    """
    [EC-03] Returns the next state that needs data, or None if all satisfied.
    This replaces the old sequential get_next_state().
    """
    flow = BUY_FLOW if intent == "buy" else RENT_FLOW

    for state in flow:
        if not is_state_satisfied(state, data):
            return state

    return None  # all satisfied → complete


def get_question(state: str) -> str:
    return QUESTIONS.get(state, "")


def is_complete(state: str | None) -> bool:
    return state is None  # get_next_unsatisfied_state returns None when complete


def minimum_data_met(intent: str, data: dict) -> tuple[bool, str]:
    """
    [EC-10] Check if we have enough data to produce a meaningful lead.
    Returns (is_sufficient, missing_description).
    """
    if intent == "buy":
        has_budget = data.get("budget_min") is not None or data.get("budget_max") is not None
        has_location = bool(data.get("location"))
        if not has_budget and not has_location:
            return False, "budget and location"
        if not has_budget:
            return False, "budget range"
        if not has_location:
            return False, "preferred location"
    else:
        has_rent = data.get("rent_min") is not None or data.get("rent_max") is not None
        has_location = bool(data.get("location"))
        if not has_rent and not has_location:
            return False, "rent budget and location"
        if not has_rent:
            return False, "rent budget"
        if not has_location:
            return False, "preferred location"
    return True, ""