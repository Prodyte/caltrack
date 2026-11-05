// Run: node scripts/check.mjs (from the repo root)
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { STAPLES, isoDate, shiftDate, mealForHour, prepare, search, makeEntry, nutrition, totals, recentNames, validBackup } from "../logic.js";

const foods = JSON.parse(readFileSync("foods.json", "utf8")).map(prepare);
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
assert.ok(search(foods, "lassi").every((r) => !/classic|olive garden/i.test(r[0])), "lassi matched inside another word");
assert.ok(search(foods, "chicken curry").some((r) => r[0] === "Chicken curry"), "two-word search");
assert.deepEqual(search(foods, "   "), []);
assert.deepEqual(search(foods, "zzzqqq"), []);
for (const [q, name] of Object.entries(STAPLES)) assert.equal(top(q), name, q);
assert.equal(search(foods, "banana", new Set(["Banana, baked"]))[0][0], "Banana, baked", "recent food ranks above other matches");

// Calories scale by portion and quantity.
const samosa = [["Samosa", "F", 310, 5, 30, 18, []]][0];
const entry = makeEntry(samosa, "Snacks", "1 small", 25, 2, "a");
assert.equal(nutrition(entry).kcal, 155);
assert.equal(totals([entry, entry]).kcal, 310);
assert.equal(totals(undefined).kcal, 0);
assert.equal(recentNames({ "2026-01-01": [entry], "2026-01-02": [{ ...entry, name: "Dal" }] }).keys().next().value, "Dal");

// A bad restore file must never replace the diary.
const good = { goal: 2000, custom: [], days: { "2026-01-01": [entry] } };
assert.ok(validBackup(good));
for (const bad of [null, {}, { ...good, goal: 0 }, { ...good, days: { nope: [] } }, { ...good, days: { "2026-01-01": [{ ...entry, kcal: "x" }] } }, { ...good, days: { "2026-01-01": [{ ...entry, meal: "Brunch" }] } }]) {
  assert.ok(!validBackup(bad), JSON.stringify(bad));
}
console.log("ok");
