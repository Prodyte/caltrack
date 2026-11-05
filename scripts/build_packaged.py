#!/usr/bin/env python3
"""Build packaged.json: products sold in India from the Open Food Facts dump (ODbL), read from stdin.

usage: curl -L https://static.openfoodfacts.org/data/en.openfoodfacts.org.products.csv.gz | gunzip | build_packaged.py packaged.json
Row: [name, "P", kcal, protein, carbs, fat, [[portion, grams], ...]] with nutrients per 100 g.
"""
import csv, json, re, sys

csv.field_size_limit(10**8)


def number(row, key):
    try:
        value = float(row.get(key) or "")
    except ValueError:
        return None
    return value if 0 <= value < 1e6 else None


def clean(text):
    return " ".join((text or "").split())[:80]


def to_row(r):
    """Returns a food row, or None if the crowd-sourced entry can't be trusted."""
    if "india" not in (r.get("countries_en") or "").lower():
        return None
    name = clean(r.get("product_name"))
    kcal, p, c, f = (number(r, k) for k in ("energy-kcal_100g", "proteins_100g", "carbohydrates_100g", "fat_100g"))
    if len(name) < 3 or not re.search("[a-zA-Z]{3}", name) or None in (kcal, p, c, f):
        return None
    if not 0 < kcal <= 902 or p + c + f > 105:
        return None
    if kcal >= 20 and abs(4 * p + 4 * c + 9 * f - kcal) / kcal > 0.3:  # label energy must match its own macros
        return None
    brand = clean((r.get("brands") or "").split(",")[0])
    if brand and brand.lower() not in name.lower():
        name = f"{name} ({brand})"
    grams = number(r, "serving_quantity")
    portion = [[f"1 serving ({grams:g} g)", round(grams, 1)]] if grams and 1 <= grams <= 1000 else []
    return [name, "P", round(kcal), round(p, 1), round(c, 1), round(f, 1), portion]


def main(out, lines):
    seen, rows, scanned = set(), [], 0
    for r in csv.DictReader(lines, delimiter="\t", quoting=csv.QUOTE_NONE):
        scanned += 1
        row = to_row(r)
        if row and (key := re.sub(r"[^a-z0-9]", "", row[0].lower())) not in seen:
            seen.add(key)
            rows.append(row)
    assert len(rows) > 500, f"only {len(rows)} products; the dump format may have changed"
    assert all(0 <= x[2] <= 902 for x in rows)
    with open(out, "w", encoding="utf-8") as f:
        json.dump(rows, f, ensure_ascii=False, separators=(",", ":"))
    print(f"{len(rows)} products kept of {scanned} scanned")


def demo():
    base = {"countries_en": "India", "product_name": "Good Day Cashew", "brands": "Britannia, Other", "energy-kcal_100g": "500",
            "proteins_100g": "6", "carbohydrates_100g": "65", "fat_100g": "24", "serving_quantity": "25"}
    assert to_row(base)[0] == "Good Day Cashew (Britannia)" and to_row(base)[6] == [["1 serving (25 g)", 25.0]]
    assert to_row({**base, "countries_en": "France"}) is None
    assert to_row({**base, "energy-kcal_100g": "5000"}) is None, "impossible energy"
    assert to_row({**base, "energy-kcal_100g": "100"}) is None, "energy disagrees with macros"
    assert to_row({**base, "fat_100g": ""}) is None, "missing macro"


if __name__ == "__main__":
    demo()
    main(sys.argv[1], sys.stdin)
