"""
[EC-09] Scorer now re-scores on any data update, not just on completion.
[EC-10] minimum_data_met check prevents scoring garbage leads.
"""

COLD_THRESHOLD = 40
WARM_THRESHOLD = 70


def score_buy_lead(data: dict) -> tuple[int, str]:
    score = 0

    # Budget defined → +20
    if data.get("budget_min") is not None or data.get("budget_max") is not None:
        score += 20

    # Timeline urgency
    days = data.get("timeline_days")
    if days is not None:
        if days <= 30:
            score += 40
        elif days <= 90:
            score += 20
        # 90+ days or "just exploring" = 0 points

    # Specific location → +20
    loc = (data.get("location") or "").strip().lower()
    VAGUE = {"", "not sure", "any", "anywhere", "n/a", "na", "idk", "doesn't matter"}
    if loc and loc not in VAGUE:
        score += 20

    # Loan ready → +20
    if data.get("loan_status") == "yes":
        score += 20

    return score, _label(score)


def score_rent_lead(data: dict) -> tuple[int, str]:
    score = 0

    # Rent budget defined → +30
    if data.get("rent_min") is not None or data.get("rent_max") is not None:
        score += 30

    # Move-in urgency
    days = data.get("move_in_days")
    if days is not None:
        if days <= 14:
            score += 40
        elif days <= 30:
            score += 20

    # Specific location → +30
    loc = (data.get("location") or "").strip().lower()
    VAGUE = {"", "not sure", "any", "anywhere", "n/a", "na", "idk", "doesn't matter"}
    if loc and loc not in VAGUE:
        score += 30

    return score, _label(score)


def _label(score: int) -> str:
    if score <= COLD_THRESHOLD:
        return "Cold"
    if score <= WARM_THRESHOLD:
        return "Warm"
    return "Hot"