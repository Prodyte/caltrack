# Thali

A calorie tracker for one person's phone. It works offline, installs to the home screen and has no accounts or server. The diary stays in the browser's storage on the device; export a backup from Settings.

Open https://prodyte.github.io/thali/ and add it to the home screen. On iPhone use Safari, Share, Add to Home Screen. On Android use Chrome, menu, Install app.

## Food data

`foods.json` holds nutrients per 100 g plus portion weights, merged from:

| Source | Foods | Used for |
|---|---|---|
| [USDA FoodData Central, FNDDS 2021–2023](https://fdc.nal.usda.gov/download-datasets) | 5,431 | Foods as eaten, including samosa, dal, idli, dosa, naan, paneer |
| [USDA FoodData Central, SR Legacy](https://fdc.nal.usda.gov/download-datasets) | 7,283 | Ingredients. Baby foods and Alaska Native foods are left out |
| [Indian Nutrient Databank (INDB)](https://github.com/lindsayjaacks/Indian-Nutrient-Databank-INDB-) | 820 of 1,014 | Indian home recipes |

INDB: Vijayakumar A, et al. "Development of an Indian Food Composition Database." *Current Developments in Nutrition*, 2024;8(7):103790. Its repository states the files are freely available but has no licence file.

INDB values are calculated from recipes, and some are implausible: fried dishes run high, as if all the frying oil were eaten, and one samosa is listed at 814 kcal. `scripts/build_foods.py` rejects rows whose energy disagrees with their macros, that are implausibly dense or large, or that disagree with the same food in FNDDS.

Rebuild with `python3 scripts/build_foods.py FNDDS_DIR SR_DIR INDB.xlsx foods.json` (needs `openpyxl`; it asserts the result is sane).

## Check

`node scripts/check.mjs`
