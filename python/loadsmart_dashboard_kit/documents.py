"""App-independent board structure. Hosts validate query semantics and sharing."""

import math

WIDTHS = {3, 4, 6, 8, 12}
HEIGHTS = {4, 6, 8, 10, 12, 14, 16}


def _name(value, error):
    if not isinstance(value, str) or not value.strip() or len(value.strip()) > 80:
        raise error("Provide a board name up to 80 characters.")
    return value.strip()


def _locked(value, error):
    if type(value) is not bool:
        raise error("Editing lock must be true or false.")
    return value


def validate_board(raw, validate_chart, *, error=ValueError, max_charts=60):
    if (
        not isinstance(raw, dict)
        or set(raw) - {"v", "name", "widgets", "layouts", "locked", "updatedAt"}
        or raw.get("v") != 2
    ):
        raise error("Provide a valid board document.")
    if not isinstance(raw.get("widgets"), list) or len(raw["widgets"]) > max_charts:
        raise error(f"A board supports up to {max_charts} charts.")
    charts = [validate_chart(w) for w in raw["widgets"]]
    ids = {w["id"] for w in charts}
    if len(ids) != len(charts):
        raise error("Each chart needs a unique ID.")
    layouts, seen = [], set()
    if not isinstance(raw.get("layouts"), list) or len(raw["layouts"]) != len(charts):
        raise error("Every chart needs one layout.")
    for item in raw["layouts"]:
        if not isinstance(item, dict) or set(item) - {
            "i",
            "x",
            "y",
            "w",
            "h",
            "minW",
            "minH",
            "maxW",
            "maxH",
        }:
            raise error("Invalid chart layout.")
        i = item.get("i")
        if not isinstance(i, str) or i not in ids or i in seen:
            raise error("Invalid chart layout ID.")
        seen.add(i)
        vals = [item.get(k) for k in ["x", "y", "w", "h"]]
        if any(type(v) is not int for v in vals):
            raise error("Chart positions must be whole numbers.")
        x, y, w, h = vals
        if (
            w not in WIDTHS
            or h not in HEIGHTS
            or not 0 <= x <= 12 - w
            or not 0 <= y <= 10000
        ):
            raise error("Choose a supported chart size and position.")
        layouts.append(dict(i=i, x=x, y=y, w=w, h=h, minW=3, minH=4))
    updated = raw.get("updatedAt", 0)
    if type(updated) not in (int, float) or not math.isfinite(updated) or updated < 0:
        raise error("Invalid board timestamp.")
    return dict(
        v=2,
        name=_name(raw.get("name"), error),
        widgets=charts,
        layouts=layouts,
        locked=_locked(raw.get("locked", False), error),
        updatedAt=raw.get("updatedAt", 0),
    )
