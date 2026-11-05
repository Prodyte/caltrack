// Run: node scripts/check.mjs (from the repo root)
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { STAPLES, copyEntries, averageKcal, suggestGoal, backupDue, isoDate, shiftDate, mealForHour, prepare, search, makeEntry, nutrition, totals, recentNames, validBackup } from "../logic.js";

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
console.log("ok");
