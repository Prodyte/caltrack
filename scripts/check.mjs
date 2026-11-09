// Run: node scripts/check.mjs (from the repo root)
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { STAPLES, copyEntries, averageKcal, suggestGoal, suggestTargets, defaultMacros, parseMeal, portionFor, weightTrend, weeklyRate, weeksToTarget, summarize, maintenance, frequent, proteinIdeas, toUnit, fromUnit, backupDue, isoDate, shiftDate, mealForHour, prepare, search, makeEntry, nutrition, totals, recentNames, validBackup } from "../logic.js";

const foods = ["foods.json", "packaged.json"].flatMap((f) => JSON.parse(readFileSync(f, "utf8"))).map(prepare);
const top = (q, recent) => search(foods, q, recent)[0]?.[0];

// Dates stay local and survive month and year ends.
assert.equal(isoDate(new Date(2026, 0, 5, 1, 30)), "2026-01-05");
assert.equal(shiftDate("2026-03-01", -1), "2026-02-28");
assert.equal(shiftDate("2026-12-31", 1), "2027-01-01");
assert.equal(mealForHour(8), "Breakfast");
assert.equal(mealForHour(20), "Dinner");

// Everyday searches find the obvious food first.
assert.equal(top("samosa"), "Samosa");
assert.equal(top("dal"), "Dal");
assert.equal(top("idli"), "Idli");
assert.equal(top("paneer"), "Cheese, paneer");
assert.equal(top("ghee"), "Ghee, clarified butter");
assert.match(top("roti"), /chapati|roti/i);
assert.match(top("egg"), /^Egg/);
assert.match(top("rice"), /^Rice/);
assert.match(top("milk"), /^Milk/);
assert.match(top("curd"), /yogurt|curd/i);
assert.match(top("chai"), /tea/i);
assert.match(top("eggs"), /^Egg/);
assert.ok(search(foods, "lassi").every((r) => /\blassi/i.test(r[0])), "lassi matched inside another word");
assert.ok(search(foods, "chicken curry").some((r) => r[0] === "Chicken curry"), "two-word search");
assert.deepEqual(search(foods, "   "), []);
assert.deepEqual(search(foods, "zzzqqq"), []);
for (const [q, name] of Object.entries(STAPLES)) assert.equal(top(q), name, q);
assert.equal(search(foods, "banana", new Set(["Banana, baked"]))[0][0], "Banana, baked", "recent food ranks above other matches");

// Packaged brands are findable, and don't push generic foods off the top.
assert.match(top("amul butter"), /amul/i);
assert.match(top("good day"), /good day/i);
assert.match(top("maggi"), /maggi/i);
assert.ok(foods.filter((f) => f.row[1] === "P").length > 5000);

// Calories scale by portion and quantity.
const samosa = [["Samosa", "F", 310, 5, 30, 18, []]][0];
const entry = makeEntry(samosa, "Snacks", "1 small", 25, 2, "a");
assert.equal(nutrition(entry).kcal, 155);
assert.equal(totals([entry, entry]).kcal, 310);
assert.equal(totals(undefined).kcal, 0);
assert.equal(recentNames({ "2026-01-01": [entry], "2026-01-02": [{ ...entry, name: "Dal" }] }).keys().next().value, "Dal");

// Quick adds are one-offs, so they stay out of the recent list.
assert.equal(recentNames({ "2026-01-01": [{ ...entry, name: "Lunch out", src: "Q" }] }).size, 0);

// Copying a meal keeps the food but never reuses an entry id.
const copied = copyEntries([entry, { ...entry, meal: "Lunch" }], "Snacks");
assert.equal(copied.length, 1);
assert.notEqual(copied[0].id, entry.id);

// The week average skips today and empty days.
assert.deepEqual(averageKcal(["a", "b", "c", "d"], [1000, 0, 2000, 300], "d"), { kcal: 1500, days: 2 });
assert.equal(averageKcal(["d"], [300], "d"), null);

// Goal maths: 80 kg, 175 cm, 30 y man, light activity, losing weight is 1748.75 x 1.375 - 500.
const person = { sex: "Male", age: 30, height: 175, weight: 80, activity: "Light, 1–3 workouts a week", pace: "Lose about 0.5 kg a week" };
assert.equal(suggestGoal(person), 1900);
assert.equal(suggestGoal({ ...person, sex: "Female", pace: "Stay the same" }), 2200);
assert.equal(suggestGoal({ ...person, weight: 30, height: 100, age: 90, activity: "Mostly sitting" }), 1200, "floor");
assert.equal(suggestGoal({ ...person, age: 5 }), null);
assert.equal(suggestGoal({ ...person, weight: NaN }), null);

// Backup nudge waits for real data, then repeats monthly.
const twoWeeks = Object.fromEntries(Array.from({ length: 14 }, (_, i) => [shiftDate("2026-01-01", i), []]));
assert.ok(!backupDue({}, null, "2026-02-01"));
assert.ok(backupDue(twoWeeks, null, "2026-02-01"));
assert.ok(!backupDue(twoWeeks, "2026-01-20", "2026-02-01"));
assert.ok(backupDue(twoWeeks, "2026-01-01", "2026-02-01"));

// A bad restore file must never replace the diary.
const good = { goal: 2000, custom: [], days: { "2026-01-01": [entry] } };
assert.ok(validBackup(good));
for (const bad of [null, {}, { ...good, goal: 0 }, { ...good, days: { nope: [] } }, { ...good, days: { "2026-01-01": [{ ...entry, kcal: "x" }] } }, { ...good, days: { "2026-01-01": [{ ...entry, meal: "Brunch" }] } }]) {
  assert.ok(!validBackup(bad), JSON.stringify(bad));
}
// Older backups, without weights or macro targets, still restore; malformed new fields don't.
assert.ok(validBackup({ ...good, weights: { "2026-01-01": 80 }, burned: { "2026-01-01": [{ id: "b", name: "Run", kcal: 300 }] }, macros: { p: 120, c: 200, f: 60 }, saved: [{ id: "s", name: "Usual", items: [entry] }], favs: ["F|Dal"] }));
for (const bad of [{ weights: { "2026-01-01": -1 } }, { weights: { x: 80 } }, { burned: { "2026-01-01": [{ name: "Run", kcal: "a lot" }] } }, { saved: [{ name: "x", items: [{}] }] }, { macros: { p: "x" } }]) {
  assert.ok(!validBackup({ ...good, ...bad }), JSON.stringify(bad));
}

// Macro targets: 80 kg losing man gets 1.8 g/kg protein, 30% fat, carbs make up the rest.
assert.deepEqual(suggestTargets(person), { kcal: 1900, p: 145, f: 65, c: 185 });
assert.equal(suggestTargets({ ...person, target: 70 }).p, 125, "protein follows the lower target weight");
assert.equal(suggestTargets({ ...person, pace: "Stay the same" }).p, 130);
assert.equal(suggestTargets({ ...person, age: 5 }), null);
assert.deepEqual(defaultMacros(2000), { p: 100, c: 250, f: 65 });
assert.ok(Math.abs(fromUnit(toUnit(80, "lb"), "lb") - 80) < 1e-9);
assert.equal(Math.round(toUnit(80, "lb")), 176);

// Describing a meal splits it into foods with amounts.
const parsed = parseMeal("2 boiled eggs, 150g chicken breast and one banana");
assert.deepEqual(parsed.map((p) => [p.qty, p.unit, p.query]), [[2, null, "boiled eggs"], [150, "g", "chicken breast"], [1, null, "banana"]]);
assert.deepEqual(parseMeal("half a banana")[0], { text: "half a banana", qty: 0.5, unit: null, query: "banana" });
assert.deepEqual(parseMeal("1 bowl of dal")[0].unit, "bowl");
assert.deepEqual(parseMeal("rice 200 g")[0], { text: "rice 200 g", qty: 200, unit: "g", query: "rice" });
assert.deepEqual(parseMeal("roti 2")[0].qty, 2);
assert.deepEqual(parseMeal("chai"), [{ text: "chai", qty: 1, unit: null, query: "chai" }]);
assert.deepEqual(parseMeal(" , and "), []);
const find = (q) => search(foods, q)[0];
assert.deepEqual(portionFor(find("boiled eggs"), parsed[0]), ["1 egg", 50, 2], "a count of eggs means eggs");
assert.deepEqual(portionFor(find("banana"), parsed[2]), ["1 banana", 126, 1], "not one linear inch of banana");
assert.deepEqual(portionFor(find("chicken breast"), parsed[1]), ["g", 1, 150]);
assert.deepEqual(portionFor(find("rice"), parseMeal("1 bowl rice")[0]).slice(0, 2), ["1 cup, cooked", 158], "a bowl falls back to a cup");
assert.deepEqual(portionFor(["Thing", "P", 100, 0, 0, 0, []], parseMeal("2 thing")[0]), ["g", 1, 200], "no portions: 100 g each");
assert.deepEqual(portionFor(find("almonds"), parseMeal("2 oz almonds")[0]).slice(0, 1), ["oz"]);
for (const [text, name] of [["2 rotis", /chapati|roti/i], ["1 cup dal", /^Dal/], ["2 idli", /^Idli/], ["1 glass milk", /^Milk/]]) {
  const item = parseMeal(text)[0];
  assert.match(search(foods, item.query)[0][0], name, text);
}

// Weight trend smooths single weigh-ins and bridges gaps.
const trend = weightTrend({ "2026-01-01": 80, "2026-01-02": 82, "2026-01-12": 80 });
assert.equal(trend[0].trend, 80);
assert.ok(Math.abs(trend[1].trend - 80.2) < 1e-9, "one heavy day moves the trend a little");
assert.ok(trend[2].trend < 80.2 && trend[2].trend > 80, "a gap pulls harder towards the new weight");
const steady = Object.fromEntries(Array.from({ length: 29 }, (_, i) => [shiftDate("2026-01-01", i), 80 - i * 0.05]));
const rate = weeklyRate(weightTrend(steady), "2026-01-29");
assert.ok(rate < -0.2 && rate > -0.4, `losing 0.35 kg a week, trend lags: ${rate}`);
assert.equal(weeklyRate(weightTrend({ "2026-01-01": 80, "2026-01-03": 79 }), "2026-01-03"), null, "too short to call");
assert.equal(weeklyRate(weightTrend(steady), "2026-03-29"), null, "stale");
assert.equal(weeksToTarget(80, 75, -0.5), 10);
assert.equal(weeksToTarget(80, 85, -0.5), null, "heading away");
assert.equal(weeksToTarget(80, 75, 0), null);

// Summaries count finished, logged days only.
const sDays = { "2026-01-01": [makeEntry(["A", "F", 100, 10, 0, 0, []], "Lunch", "g", 1, 2000, "x")], "2026-01-02": [], "2026-01-03": [makeEntry(["A", "F", 100, 10, 0, 0, []], "Lunch", "g", 1, 1000, "y")] };
const sum3 = summarize(sDays, ["2026-01-01", "2026-01-02", "2026-01-03", "2026-01-04"], { kcal: 2000, p: 150 }, "2026-01-04");
assert.deepEqual([sum3.logged, sum3.kcal, sum3.p, sum3.proteinHit, sum3.onTarget], [2, 1500, 150, 1, 1]);
assert.equal(summarize(sDays, ["2026-01-03"], { kcal: 2000, p: 150 }, "2026-01-03"), null, "today alone is not a summary");
assert.equal(summarize(sDays, ["2026-01-03"], { kcal: 900, p: 0 }, "x", { "2026-01-03": [{ name: "Run", kcal: 100 }] }).onTarget, 1, "exercise raises that day's target");

// Maintenance: eating 2,000 a day while the trend falls 0.5 kg a week means burning about 2,550.
const mDays = {}, mWeights = {};
for (let i = 0; i < 28; i++) { const d = shiftDate("2026-02-01", i); mDays[d] = [makeEntry(["A", "F", 100, 0, 0, 0, []], "Lunch", "g", 1, 2000, d)]; }
for (let i = -60; i < 28; i++) mWeights[shiftDate("2026-02-01", i)] = 80 - (i * 0.5) / 7;
const tdee = maintenance(mDays, mWeights, "2026-03-01");
assert.ok(tdee >= 2450 && tdee <= 2650, `maintenance ${tdee}`);
assert.equal(maintenance({}, mWeights, "2026-03-01"), null);

// Frequent foods need two days; ideas are protein-dense recents that still fit.
const fDays = { "2026-01-01": [entry, { ...entry, name: "Dal" }], "2026-01-02": [entry, entry] };
assert.deepEqual(frequent(fDays, "2026-01-02").map((f) => [f.entry.name, f.count]), [["Samosa", 2]]);
const egg = makeEntry(["Egg", "F", 143, 12.4, 1, 10, []], "Lunch", "1 egg", 50, 2, "e");
const paneer = makeEntry(["Paneer", "F", 321, 25, 3.6, 25, []], "Lunch", "g", 1, 100, "pn");
assert.deepEqual(proteinIdeas(new Map([["Samosa", entry], ["Egg", egg], ["Paneer", paneer]]), 1000).map((e) => e.name), ["Egg", "Paneer"]);
assert.deepEqual(proteinIdeas(new Map([["Paneer", paneer]]), 200), [], "doesn't suggest what won't fit");
console.log("ok");
