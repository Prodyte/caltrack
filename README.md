# CalTrack

A calorie tracker for your phone. It works offline, installs to the home screen and has no accounts or server. The diary stays in the browser's storage on the device; export a backup from Settings.

Open https://prodyte.github.io/caltrack/ and add it to the home screen. On iPhone use Safari, Share, Add to Home Screen. On Android use Chrome, menu, Install app.

## What it does

- **Today**: a calories ring with what's left, protein (emphasised), carbs and fat against targets, exercise added to the day's budget, per-meal totals, and one observation worked out from your log, with quick-add picks from your own protein-rich foods.
- **Logging**: search with recent, frequent and favourite foods, saved meals, copy a meal from any earlier day, quick add, your own foods with a serving weight, grams or ounces, and "Describe a meal" ("2 boiled eggs, 150 g chicken breast and a banana"), which is parsed on the phone into foods you review before adding.
- **Trends**: 7 days, 30 days, 90 days (weekly averages) or a year (monthly) of calories, protein, carbs and fat against targets, target consistency, comparison with the previous period, and a maintenance estimate from intake and weight.
- **Weight**: daily weigh-ins, a smoothed trend, weekly rate, weekly average and time to a target weight.
- **Targets**: Mifflin-St Jeor calories plus protein by body weight, all editable, kg or lb.

Pure logic is in `logic.js` and tested by `scripts/check.mjs`; the interface is `app.js` and `index.html`, with no build step or dependencies.

## Food data

`foods.json` holds nutrients per 100 g plus portion weights, merged from:

| Source | Foods | Used for |
|---|---|---|
| [USDA FoodData Central, FNDDS 2021–2023](https://fdc.nal.usda.gov/download-datasets) | 5,431 | Foods as eaten, including samosa, dal, idli, dosa, naan, paneer |
| [USDA FoodData Central, SR Legacy](https://fdc.nal.usda.gov/download-datasets) | 7,283 | Ingredients. Baby foods and Alaska Native foods are left out |
| [Indian Nutrient Databank (INDB)](https://github.com/lindsayjaacks/Indian-Nutrient-Databank-INDB-) | 820 of 1,014 | Indian home recipes |
| [Open Food Facts](https://world.openfoodfacts.org) | 9,018 | Packaged products sold in India, added by volunteers |
| [UK Composition of Foods Integrated Dataset (CoFID) 2021](https://www.gov.uk/government/publications/composition-of-foods-integrated-dataset-cofid) | 2,840 of 2,887 | Takeaway and home-cooked dishes, including many South Asian ones (bhajis, curries, biryani). By weight only |
| [Australian Food Composition Database (AFCD) Release 3](https://www.foodstandards.gov.au/science-data/food-nutrient-databases/afcd) | 1,578 of 1,588 | Analysed foods and dishes. By weight only |

The UK and Australian tables are in `world.json`. CoFID is Crown copyright (Public Health England), used under the [Open Government Licence v3.0](https://www.nationalarchives.gov.uk/doc/open-government-licence/version/3/). AFCD is © Food Standards Australia New Zealand, used under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). Neither has portion weights, so these foods rank below an equal match from a source that does. Rows without an energy value, or whose energy disagrees with their macros, are left out, which drops most dried spices.

Packaged data is © Open Food Facts contributors under the [Open Database License](https://opendatacommons.org/licenses/odbl/1-0/), and `packaged.json` is shared under the same licence. It is kept separate from `foods.json`.

INDB: Vijayakumar A, et al. "Development of an Indian Food Composition Database." *Current Developments in Nutrition*, 2024;8(7):103790. Its repository states the files are freely available but has no licence file.

INDB values are calculated from recipes, and some are implausible: fried dishes run high, as if all the frying oil were eaten, and one samosa is listed at 814 kcal. `scripts/build_foods.py` rejects rows whose energy disagrees with their macros, that are implausibly dense or large, or that disagree with the same food in FNDDS.

Rebuild with `python3 scripts/build_foods.py FNDDS_DIR SR_DIR INDB.xlsx foods.json` (needs `openpyxl`; it asserts the result is sane). Rebuild packaged foods with `curl -L https://static.openfoodfacts.org/data/en.openfoodfacts.org.products.csv.gz | gunzip | python3 scripts/build_packaged.py packaged.json`. Rebuild the UK and Australian tables with `python3 scripts/build_world.py COFID.xlsx "AFCD Release 3 - Nutrient profiles.xlsx" world.json` (needs `openpyxl`).

## Check

`node scripts/check.mjs`
