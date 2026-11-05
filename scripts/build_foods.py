#!/usr/bin/env python3
"""Build foods.json from USDA FNDDS, USDA SR Legacy and INDB. Asserts data sanity at the end.

usage: build_foods.py FNDDS_DIR SR_DIR INDB.xlsx OUT.json   (needs openpyxl)
Row: [name, source, kcal, protein, carbs, fat, [[portion, grams], ...]] with nutrients per 100 g.
"""
import csv, json, re, sys
from collections import defaultdict
import openpyxl

# FNDDS stores legacy nutrient numbers where SR Legacy stores nutrient ids.
FNDDS_NUTRIENTS = "208", "203", "204", "205"  # energy, protein, fat, carbs
SR_NUTRIENTS = "1008", "1003", "1004", "1005"
SR_SKIP_CATEGORIES = {"3", "24"}  # baby foods, Alaska Native foods
BAD_PORTION = re.compile(r"not specified|guideline|^$", re.I)

# INDB portions that describe a whole batch rather than what one person eats.
BATCH_UNITS = {"jar", "half-pints", "dish", "small casserole dish", "souffle dish", "gm", "ml", "small", ""}
# Some INDB "1 piece" servings look like a whole batch or include all the frying oil
# (e.g. 814 kcal per samosa), so single items above this are rejected.
SINGLE_UNITS = {"piece", "biscuit", "cookie", "cutlet", "poori", "pakora", "samosa", "kachori", "ladoo", "burfi",
                "vada", "kabab", "egg", "roti", "dosa", "uttapam", "idli", "parantha", "cheela", "pancake", "tart",
                "pastry", "bread roll", "slice", "triangle", "toasted triangle", "large slice", "sandwich"}
MAX_SINGLE_KCAL = 350
# Same problem on plated dishes: no pulao or curry is 582 kcal/100 g.
PLATED_UNITS = {"plate", "bowl", "curry bowl", "soup bowl", "small bowl", "glass", "tall glass", "cup", "tea cup"}
MAX_PLATED_KCAL_100G = 350
# INDB dishes checked against the same food in FNDDS; rejected if they differ too much.
CROSS_CHECK = {"Boiled egg (Ubla anda)": "Egg, whole, boiled or poached", "Boiled rice (Uble chawal)": "Rice, white, cooked, no added fat",
               "Plain dosa": "Dosa, plain", "Idli": "Idli", "Potato samosa (Aloo ka samosa)": "Samosa", "Poha": "Poha",
               "Vegetable samosa": "Samosa", "Chicken curry": "Chicken curry", "Plain parantha/paratha": "Bread, paratha"}
CROSS_CHECK_LIMIT = 0.40


def rows(path):
    with open(path, newline="", encoding="utf-8") as f:
        yield from csv.DictReader(f)


def usda(folder, source, ids, skip=frozenset()):
    ENERGY, PROTEIN, FAT, CARB = ids
    foods = {r["fdc_id"]: r["description"].strip() for r in rows(f"{folder}/food.csv")
             if r.get("food_category_id") not in skip or source == "F"}
    nutrients = defaultdict(dict)
    for r in rows(f"{folder}/food_nutrient.csv"):
        if r["fdc_id"] in foods and r["nutrient_id"] in ids:
            nutrients[r["fdc_id"]][r["nutrient_id"]] = float(r["amount"])
    portions = defaultdict(list)
    for r in rows(f"{folder}/food_portion.csv"):
        label = r["portion_description"].strip() or f'{r["amount"]} {r["modifier"]}'.strip()
        grams = float(r["gram_weight"] or 0)
        if r["fdc_id"] in foods and grams >= 0.1 and not BAD_PORTION.search(label):
            portions[r["fdc_id"]].append([label, round(grams, 1)])
    out = []
    for fid, name in foods.items():
        n = nutrients[fid]
        if ENERGY in n:
            out.append([name, source, round(n[ENERGY]), round(n.get(PROTEIN, 0), 1), round(n.get(CARB, 0), 1),
                        round(n.get(FAT, 0), 1), sorted(portions[fid], key=lambda p: " oz" in p[0].lower())[:5]])  # metric-friendly portions first
    return out


def indb(path, reference):
    ws = openpyxl.load_workbook(path, read_only=True, data_only=True).active
    it = ws.iter_rows(values_only=True)
    header = next(it)
    out, rejected = [], defaultdict(list)
    for raw in it:
        r = dict(zip(header, raw))
        name = " ".join(str(r["food_name"]).replace("\xa0", " ").split())
        kcal, serving_kcal = r["energy_kcal"] or 0, r["unit_serving_energy_kcal"] or 0
        p, c, f = r["protein_g"] or 0, r["carb_g"] or 0, r["fat_g"] or 0
        unit = str(r["servings_unit"] or "").strip()
        atwater = 4 * p + 4 * c + 9 * f
        grams = serving_kcal / kcal * 100 if kcal else 0
        ref = reference.get(CROSS_CHECK.get(name))

        if not kcal or abs(atwater - kcal) / max(atwater, kcal) > 0.25:
            rejected["energy disagrees with macros"].append(name)
        elif kcal > 600:
            rejected["over 600 kcal/100 g"].append(name)
        elif unit in SINGLE_UNITS and serving_kcal > MAX_SINGLE_KCAL:
            rejected["single item too large"].append(name)
        elif unit in PLATED_UNITS and kcal > MAX_PLATED_KCAL_100G:
            rejected["plated dish too dense"].append(name)
        elif ref and abs(kcal - ref) / ref > CROSS_CHECK_LIMIT:
            rejected["disagrees with USDA"].append(name)
        else:
            portion = [[f"1 {unit}", round(grams, 1)]] if unit not in BATCH_UNITS and 3 <= grams <= 700 else []
            out.append([name, "I", round(kcal), round(p, 1), round(c, 1), round(f, 1), portion])
    for why, names in rejected.items():
        print(f"INDB rejected, {why}: {len(names)}")
    return out, rejected


def check(foods, rejected):
    by_name = {f[0]: f for f in foods}
    assert len(foods) > 12000, len(foods)
    assert all(0 <= f[2] <= 902 for f in foods), "kcal/100 g outside the physical range"
    assert all(g > 0 for f in foods for _, g in f[6]), "portion without weight"
    assert "Potato samosa (Aloo ka samosa)" in sum(rejected.values(), []), "814 kcal samosa got through"
    assert "Paneer pulao" not in by_name, "582 kcal/100 g pulao got through"
    assert "Boiled egg (Ubla anda)" in sum(rejected.values(), []), "45 kcal/100 g egg got through"
    for name, low, high in [("Samosa", 200, 350), ("Dal", 80, 180), ("Idli", 90, 180), ("Cheese, paneer", 250, 380),
                            ("Ghee, clarified butter", 850, 902), ("Bread, naan", 250, 340), ("Chapati/Roti", 180, 320)]:
        assert low <= by_name[name][2] <= high, (name, by_name[name][2])
    for f in foods:
        if f[1] == "I":  # filtered INDB rows must still add up
            assert abs(4 * f[3] + 4 * f[4] + 9 * f[5] - f[2]) / max(f[2], 1) < 0.35 or f[2] < 30, f


def main(fndds_dir, sr_dir, indb_path, out):
    fndds = usda(fndds_dir, "F", FNDDS_NUTRIENTS)
    sr = usda(sr_dir, "S", SR_NUTRIENTS, SR_SKIP_CATEGORIES)
    indian, rejected = indb(indb_path, {f[0]: f[2] for f in fndds})
    foods = fndds + indian + sr
    check(foods, rejected)
    with open(out, "w", encoding="utf-8") as f:
        json.dump(foods, f, ensure_ascii=False, separators=(",", ":"))
    print(f"{len(foods)} foods: FNDDS {len(fndds)}, INDB {len(indian)}, SR {len(sr)}")


if __name__ == "__main__":
    main(*sys.argv[1:])
