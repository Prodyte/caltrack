#!/usr/bin/env python3
"""Build world.json from the UK (CoFID 2021) and Australian (AFCD Release 3) food composition tables.

usage: build_world.py COFID.xlsx AFCD_NUTRIENT_PROFILES.xlsx OUT.json   (needs openpyxl)
Row: [name, source, kcal, protein, carbs, fat, []] with nutrients per 100 g. Neither table publishes portion weights.
"""
import json, re, sys
import openpyxl

KJ_PER_KCAL = 4.184
SKIP = re.compile(r"\b(infant|toddler|formula)\b", re.I)  # not "baby": baby spinach and baby corn are food for adults


def number(value):
    """Tables mark traces as 'Tr' (counted as 0) and unknowns as 'N' or blank (None)."""
    if isinstance(value, (int, float)):
        return float(value)
    text = str(value or "").strip().strip("()")
    if text.lower() == "tr":
        return 0.0
    try:
        return float(text)
    except ValueError:
        return None


def to_row(name, source, kcal, p, c, f, alcohol=0, fibre=0):
    """Returns a food row, or None when the energy is missing, impossible or disagrees with its own macros."""
    name = " ".join(str(name or "").split())
    if not name or SKIP.search(name) or None in (kcal, p, c, f) or not 0 < kcal <= 902:
        return None
    worked = 4 * p + 4 * c + 9 * f + 7 * (alcohol or 0) + 2 * (fibre or 0)
    if kcal >= 30 and abs(worked - kcal) / max(worked, kcal) > 0.25:
        return None
    return [name, source, round(kcal), round(p, 1), round(c, 1), round(f, 1), []]


def sheet(path, title, header_row, skip_after):
    ws = openpyxl.load_workbook(path, read_only=True, data_only=True)[title]
    it = ws.iter_rows(values_only=True)
    for _ in range(header_row):
        next(it)
    header = [" ".join(str(h or "").split()) for h in next(it)]
    for _ in range(skip_after):
        next(it)
    for raw in it:
        if raw[0]:
            yield dict(zip(header, raw))


def cofid(path):
    for r in sheet(path, "1.3 Proximates", 0, 2):
        yield to_row(r["Food Name"], "U", number(r["Energy (kcal) (kcal)"]), number(r["Protein (g)"]), number(r["Carbohydrate (g)"]),
                     number(r["Fat (g)"]), number(r["Alcohol (g)"]))


def afcd(path):
    for r in sheet(path, "All solids & liquids per 100 g", 2, 0):
        kj = number(r["Energy with dietary fibre, equated (kJ)"])
        yield to_row(r["Food Name"], "A", kj and kj / KJ_PER_KCAL, number(r["Protein (g)"]), number(r["Available carbohydrate, with sugar alcohols (g)"]),
                     number(r["Fat, total (g)"]), number(r["Alcohol (g)"]), number(r["Total dietary fibre (g)"]))


def main(cofid_path, afcd_path, out):
    foods, seen = [], set()
    for label, rows in (("CoFID", list(cofid(cofid_path))), ("AFCD", list(afcd(afcd_path)))):
        kept = [r for r in rows if r and (r[1], r[0].lower()) not in seen and not seen.add((r[1], r[0].lower()))]
        print(f"{label}: kept {len(kept)} of {len(rows)}")
        foods += kept
    by_name = {f[0]: f for f in foods}
    assert len(foods) > 3500, f"only {len(foods)} foods; a sheet layout may have changed"
    for name, low, high in [("Chapatis, made without fat", 180, 320), ("Ghee, butter", 850, 902), ("Rice, white, long grain, boiled in unsalted water", 100, 160)]:
        assert low <= by_name[name][2] <= high, (name, by_name[name][2])
    with open(out, "w", encoding="utf-8") as f:
        json.dump(foods, f, ensure_ascii=False, separators=(",", ":"))
    print(f"{len(foods)} foods")


def demo():
    assert number("Tr") == 0 and number("N") is None and number("(1.5)") == 1.5 and number(3) == 3.0
    assert to_row("Dhal, lentil", "U", 110, 7, 15, 3) == ["Dhal, lentil", "U", 110, 7, 15, 3, []]
    assert to_row("Dhal, lentil", "U", 400, 7, 15, 3) is None, "energy disagrees with macros"
    assert to_row("Dhal, lentil", "U", 110, None, 15, 3) is None, "missing macro"
    assert to_row("Whisky", "U", 222, 0, 0, 0, 31.7), "alcohol carries the energy"
    assert to_row("Infant formula", "U", 60, 1.5, 7, 3.5) is None


if __name__ == "__main__":
    demo()
    main(*sys.argv[1:])
