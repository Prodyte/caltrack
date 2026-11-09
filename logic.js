// Pure logic, no DOM, so scripts/check.mjs can run it under node.

export const MEALS = ["Breakfast", "Lunch", "Dinner", "Snacks"];
const SOURCE_ORDER = { C: 0, F: 1, I: 2, P: 3, S: 4 };

// Names people type here versus the words the datasets use.
const SYNONYMS = {
  curd: ["yogurt"], dahi: ["yogurt", "curd"], anda: ["egg"], chawal: ["rice"], aloo: ["potato"], doodh: ["milk"],
  murgh: ["chicken"], chai: ["tea"], atta: ["wheat"], chini: ["sugar"], rajma: ["kidney"], chole: ["chickpea"],
  chana: ["chickpea"], makhan: ["butter"], roti: ["chapati"], chapati: ["roti"], phulka: ["chapati"], dhal: ["dal"],
  daal: ["dal"], maida: ["flour"], kela: ["banana"], seb: ["apple"], aam: ["mango"], paratha: ["parantha"],
};

// What a bare one-word search almost always means. scripts/check.mjs fails if a name stops existing.
export const STAPLES = {
  rice: "Rice, white, cooked, no added fat", chawal: "Rice, white, cooked, no added fat", egg: "Egg, whole, boiled or poached",
  eggs: "Egg, whole, boiled or poached", anda: "Egg, whole, boiled or poached", chai: "Hot tea (Garam Chai)", tea: "Hot tea (Garam Chai)",
  roti: "Chapati/Roti", chapati: "Chapati/Roti", phulka: "Chapati/Roti", paneer: "Cheese, paneer", milk: "Milk, whole", doodh: "Milk, whole",
  chicken: "Chicken breast, grilled without sauce, skin not eaten", potato: "Potato, boiled, NFS", aloo: "Potato, boiled, NFS",
  apple: "Apple, raw", bread: "Bread, white", coffee: "Coffee, brewed", oats: "Oatmeal, regular or quick, made with water, no added fat",
  curd: "Yogurt, plain, whole milk", dahi: "Yogurt, plain, whole milk", rajma: "Kidney bean curry (Rajmah curry)",
};
// ponytail: crude "plain food" test on the name; good enough to sort "Banana, raw" above "Banana, baked".
const PLAIN = /\b(nfs|raw|plain|cooked|boiled|whole)\b/;

// Local date, not toISOString: at 2am in India the UTC date is still yesterday.
export function isoDate(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function shiftDate(iso, days) {
  const [y, m, d] = iso.split("-").map(Number);
  return isoDate(new Date(y, m - 1, d + days));
}

export function mealForHour(hour) {
  return hour < 11 ? "Breakfast" : hour < 16 ? "Lunch" : hour < 18 ? "Snacks" : hour < 23 ? "Dinner" : "Snacks";
}

const words = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

export function prepare(row) {
  const lower = row[0].toLowerCase();
  return { row, hay: ` ${words(row[0])}`, parts: lower.split(/[,(/]/).map((p) => p.replace(/\)/g, "").trim()) };
}

function alternatives(token) {
  const alts = [token, ...(SYNONYMS[token] || [])];
  if (token.length > 3 && token.endsWith("s")) alts.push(token.slice(0, -1));
  return alts;
}

// Every typed word must start a word in the name, so "lassi" doesn't match "classic".
export function search(foods, query, recent = new Set(), limit = 50) {
  const q = words(query);
  if (!q) return [];
  const tokens = q.split(" ").map(alternatives);
  const wanted = tokens.length === 1 ? tokens[0] : [q];
  const hits = [];
  for (const food of foods) {
    if (!tokens.every((alts) => alts.some((a) => food.hay.includes(` ${a}`)))) continue;
    const name = food.row[0];
    const tier = STAPLES[q] === name ? 0 : wanted.includes(food.parts[0]) ? 1
      : food.parts.some((p) => wanted.includes(p)) ? 2
      : wanted.some((w) => food.parts[0].startsWith(w)) ? 3 : 4;
    hits.push({ food, key: [tier, recent.has(name) ? 0 : 1, PLAIN.test(name.toLowerCase()) ? 0 : 1, SOURCE_ORDER[food.row[1]] ?? 9, name.length] });
  }
  hits.sort((a, b) => a.key.reduce((d, v, i) => d || v - b.key[i], 0));
  return hits.slice(0, limit).map((h) => h.food.row);
}

// An entry keeps its own per-100 g values, so a later dataset rebuild can't rewrite past days.
export function makeEntry(row, meal, label, grams, qty, id = crypto.randomUUID()) {
  const [name, src, kcal, p, c, f] = row;
  return { id, meal, name, src, kcal, p, c, f, label, grams, qty };
}

export function nutrition(entry) {
  const scale = (entry.grams * entry.qty) / 100;
  return { kcal: entry.kcal * scale, p: entry.p * scale, c: entry.c * scale, f: entry.f * scale };
}

export function totals(entries = []) {
  return entries.map(nutrition).reduce(
    (t, n) => ({ kcal: t.kcal + n.kcal, p: t.p + n.p, c: t.c + n.c, f: t.f + n.f }),
    { kcal: 0, p: 0, c: 0, f: 0 },
  );
}

export function recentNames(days, limit = 30) {
  const seen = new Map();
  for (const date of Object.keys(days).sort().reverse()) {
    for (const e of [...days[date]].reverse()) {
      if (e.src !== "Q" && !seen.has(e.name)) seen.set(e.name, e);
      if (seen.size >= limit) return seen;
    }
  }
  return seen;
}

export function copyEntries(entries, meal) {
  return entries.filter((e) => e.meal === meal).map((e) => ({ ...e, id: crypto.randomUUID() }));
}

// Average of finished days only: today's half-logged total would drag it down.
export function averageKcal(dates, kcals, today) {
  const done = kcals.filter((k, i) => k > 0 && dates[i] !== today);
  return done.length ? { kcal: done.reduce((a, b) => a + b, 0) / done.length, days: done.length } : null;
}

export const ACTIVITY = { "Mostly sitting": 1.2, "Light, 1–3 workouts a week": 1.375, "Moderate, 3–5 workouts a week": 1.55, "Very active, 6–7 workouts a week": 1.725 };
export const PACE = { "Lose about 0.5 kg a week": -500, "Stay the same": 0, "Gain slowly": 300 };

// Mifflin-St Jeor, rounded to 50 kcal. Returns null until the inputs are believable.
export function suggestGoal({ sex, age, height, weight, activity, pace }) {
  if (!(age >= 15 && age <= 100 && height >= 100 && height <= 250 && weight >= 30 && weight <= 300)) return null;
  if (!(activity in ACTIVITY) || !(pace in PACE)) return null;
  const rest = 10 * weight + 6.25 * height - 5 * age + (sex === "Female" ? -161 : 5);
  return Math.max(1200, Math.round((rest * ACTIVITY[activity] + PACE[pace]) / 50) * 50);
}

export function backupDue(days, lastBackup, today) {
  const logged = Object.keys(days).length;
  return logged >= 14 && (!lastBackup || shiftDate(lastBackup, 30) <= today);
}

const round5 = (n) => Math.round(n / 5) * 5;

// Used until someone sets macro targets: 20% protein, 50% carbs, 30% fat.
export function defaultMacros(kcal) {
  return { p: round5((kcal * 0.2) / 4), c: round5((kcal * 0.5) / 4), f: round5((kcal * 0.3) / 9) };
}

// Protein by body weight (1.8 g/kg while losing, 1.6 otherwise), fat at 30% of calories, carbs fill the rest.
// A lower target weight is used for protein so heavier people aren't told to eat for weight they want to lose.
export function suggestTargets(profile) {
  const kcal = suggestGoal(profile);
  if (!kcal) return null;
  const ref = profile.target > 0 && profile.target < profile.weight ? profile.target : profile.weight;
  const p = round5(ref * (PACE[profile.pace] < 0 ? 1.8 : 1.6));
  const f = round5((kcal * 0.3) / 9);
  return { kcal, p, f, c: Math.max(0, round5((kcal - p * 4 - f * 9) / 4)) };
}

export const LB = 0.45359237;
export const OZ = 28.349523;
export const toUnit = (kg, unit) => (unit === "lb" ? kg / LB : kg);
export const fromUnit = (v, unit) => (unit === "lb" ? v * LB : v);

export function daysBetween(a, b) {
  const utc = (iso) => { const [y, m, d] = iso.split("-").map(Number); return Date.UTC(y, m - 1, d); };
  return Math.round((utc(b) - utc(a)) / 864e5);
}

export const datesEnding = (end, count) => Array.from({ length: count }, (_, i) => shiftDate(end, i - count + 1));

// Foods logged on at least two days in the window, most often first.
export function frequent(days, today, windowDays = 30, limit = 30) {
  const counts = new Map();
  for (const date of datesEnding(today, windowDays)) {
    const seen = new Set();
    for (const e of days[date] || []) {
      if (e.src === "Q" || seen.has(e.name)) continue;
      seen.add(e.name);
      const c = counts.get(e.name) || { entry: e, count: 0 };
      counts.set(e.name, { entry: e, count: c.count + 1 });
    }
  }
  return [...counts.values()].filter((c) => c.count >= 2).sort((a, b) => b.count - a.count).slice(0, limit);
}

// The recent foods that add the most protein for their calories, at the amount usually eaten.
export function proteinIdeas(recents, kcalLeft, limit = 2) {
  return [...recents.values()].map((e) => ({ e, n: nutrition(e) }))
    .filter(({ n }) => n.p >= 8 && (kcalLeft <= 0 || n.kcal <= kcalLeft))
    .sort((a, b) => b.n.p / Math.max(1, b.n.kcal) - a.n.p / Math.max(1, a.n.kcal))
    .slice(0, limit).map(({ e }) => e);
}

const NUMBER_WORDS = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, half: 0.5, quarter: 0.25, couple: 2 };
const UNIT_WORDS = {
  g: "g", gm: "g", gms: "g", gram: "g", grams: "g", gr: "g", kg: "kg", ml: "ml", l: "l", litre: "l", liter: "l", oz: "oz", ounce: "oz", ounces: "oz",
  cup: "cup", cups: "cup", glass: "glass", glasses: "glass", bowl: "bowl", bowls: "bowl", katori: "bowl", katoris: "bowl", plate: "plate", plates: "plate",
  slice: "slice", slices: "slice", piece: "piece", pieces: "piece", pc: "piece", pcs: "piece", tbsp: "tbsp", tablespoon: "tbsp", tablespoons: "tbsp",
  tsp: "tsp", teaspoon: "tsp", teaspoons: "tsp", scoop: "scoop", scoops: "scoop", serving: "serving", servings: "serving",
};
// What each unit is called in the datasets' portion names.
const UNIT_LABELS = { cup: ["cup"], glass: ["glass", "cup"], bowl: ["bowl", "katori", "cup"], plate: ["plate", "serving"], slice: ["slice"],
  piece: ["piece", "item", "pc"], tbsp: ["tbsp", "tablespoon"], tsp: ["tsp", "teaspoon"], scoop: ["scoop", "serving"], serving: ["serving"] };

function quantity(token) {
  if (token === "½") return 0.5;
  if (/^\d+\/\d+$/.test(token)) { const [a, b] = token.split("/").map(Number); return b ? a / b : null; }
  if (/^\d*\.?\d+$/.test(token)) return parseFloat(token);
  return NUMBER_WORDS[token] ?? null;
}

// "2 boiled eggs, 150g chicken breast and a banana" -> one item per food, each with an amount and the words to search.
// ponytail: plain word rules, not a language model; anything it misreads is fixed on the review screen.
export function parseMeal(text) {
  return text.toLowerCase().split(/[,;\n+&]|\band\b|\bplus\b/).map((s) => s.trim()).filter(Boolean).map((part) => {
    const tokens = part.replace(/(\d)([a-z])/g, "$1 $2").replace(/([a-z])(\d)/g, "$1 $2").split(/\s+/);
    let qty = null, unit = null;
    while (tokens.length > 1 && quantity(tokens[0]) !== null) {
      const v = quantity(tokens.shift());
      qty = qty === null ? v : qty * v; // "half a banana" is 0.5 x 1
    }
    if (tokens[0] === "x" && tokens.length > 1) tokens.shift();
    if (UNIT_WORDS[tokens[0]] && tokens.length > 1) unit = UNIT_WORDS[tokens.shift()];
    if (tokens[0] === "of" && tokens.length > 1) tokens.shift();
    // "chicken breast 150 g": the amount can come last too.
    const n = tokens.length;
    if (qty === null && n > 2 && quantity(tokens[n - 2]) !== null && UNIT_WORDS[tokens[n - 1]]) {
      unit = UNIT_WORDS[tokens.pop()];
      qty = quantity(tokens.pop());
    } else if (qty === null && n > 1 && quantity(tokens[n - 1]) !== null) qty = quantity(tokens.pop());
    return { text: part, qty: qty ?? 1, unit, query: tokens.join(" ") };
  }).filter((item) => item.query && item.qty > 0);
}

// Turns a parsed amount into one of the food's portions: [label, grams per unit, quantity].
export function portionFor(row, { qty, unit, query }) {
  if (unit === "g" || unit === "ml") return ["g", 1, qty]; // ponytail: ml taken as grams, near enough for drinks and dal
  if (unit === "kg" || unit === "l") return ["g", 1, qty * 1000];
  if (unit === "oz") return ["oz", OZ, qty];
  const portions = row[6];
  const has = (words) => portions.find(([label]) => words.some((w) => new RegExp(`\\b${w}`).test(label.toLowerCase())));
  const nouns = query.replace(/[^a-z0-9 ]/g, " ").split(" ").filter((w) => w.length > 2).flatMap((w) => (w.endsWith("s") ? [w, w.slice(0, -1)] : [w]));
  const found = (unit && has(UNIT_LABELS[unit])) || (!unit && (has(nouns) || has(["medium"]) || has(["piece", "item", "serving"])
    || portions.find(([label]) => !/inch|cubic|slice|oz|cup|tbsp|tsp|tablespoon|teaspoon/.test(label))));
  if (found) return [found[0], found[1], qty];
  if (portions.length && unit) return [portions[0][0], portions[0][1], qty];
  return portions.length ? [portions[0][0], portions[0][1], qty] : ["g", 1, qty * 100];
}

// Exponentially smoothed weight, about a ten-day memory, that bridges gaps between weigh-ins.
export function weightTrend(weights) {
  let trend = null, prev = null;
  return Object.keys(weights).sort().map((date) => {
    const w = weights[date];
    trend = trend === null ? w : trend + (1 - 0.9 ** daysBetween(prev, date)) * (w - trend);
    prev = date;
    return { date, weight: w, trend };
  });
}

// Trend change per week over the last two weeks or so; null until a week of data spans it.
export function weeklyRate(series, today) {
  if (series.length < 2) return null;
  const last = series.at(-1);
  const from = series.findLast((s) => daysBetween(s.date, last.date) >= 14) || series[0];
  const span = daysBetween(from.date, last.date);
  if (span < 7 || daysBetween(last.date, today) > 14) return null;
  return ((last.trend - from.trend) / span) * 7;
}

// Weeks to reach the target at the current rate, only when heading towards it.
export function weeksToTarget(trend, target, rate) {
  if (!target || rate === null || Math.abs(rate) < 0.05) return null;
  const weeks = (target - trend) / rate;
  return weeks > 0 && weeks < 520 ? weeks : null;
}

const sum = (list) => list.reduce((a, b) => a + b, 0);
export const burnedTotal = (burned = []) => sum(burned.map((b) => b.kcal));

// Finished, logged days only: today is half done and an unlogged day is unknown, not zero.
export function summarize(days, dates, targets, today, burned = {}) {
  const done = dates.filter((d) => d !== today && days[d]?.length).map((d) => ({ ...totals(days[d]), goal: targets.kcal + burnedTotal(burned[d]) }));
  if (!done.length) return null;
  const avg = (k) => sum(done.map((t) => t[k])) / done.length;
  return {
    logged: done.length, kcal: avg("kcal"), p: avg("p"), c: avg("c"), f: avg("f"), goal: avg("goal"),
    proteinHit: done.filter((t) => Math.round(t.p) >= targets.p).length,
    onTarget: done.filter((t) => Math.abs(t.kcal - t.goal) <= t.goal * 0.1).length,
  };
}

// Energy out estimated from intake and how the weight trend moved: about 7,700 kcal per kg of body weight.
export function maintenance(days, weights, today) {
  const window = datesEnding(shiftDate(today, -1), 28);
  const stats = summarize(days, window, { kcal: 0, p: 0 }, today);
  const series = weightTrend(weights).filter((s) => s.date >= window[0] && s.date < today);
  if (!stats || stats.logged < 14 || series.length < 4) return null;
  const span = daysBetween(series[0].date, series.at(-1).date);
  if (span < 14) return null;
  return Math.round((stats.kcal - ((series.at(-1).trend - series[0].trend) * 7700) / span) / 50) * 50;
}

// Backups come from a file the user picks, so check the shape before replacing their diary.
export function validBackup(data) {
  const num = (v) => typeof v === "number" && Number.isFinite(v) && v >= 0;
  const entry = (e) => typeof e.name === "string" && typeof e.label === "string" && MEALS.includes(e.meal) && [e.kcal, e.p, e.c, e.f, e.grams, e.qty].every(num);
  const dated = (obj, ok) => obj === undefined || (typeof obj === "object" && obj !== null && Object.entries(obj).every(([d, v]) => /^\d{4}-\d{2}-\d{2}$/.test(d) && ok(v)));
  return Boolean(data) && num(data.goal) && data.goal > 0 && Array.isArray(data.custom) && typeof data.days === "object" && data.days !== null
    && dated(data.days, (list) => Array.isArray(list) && list.every(entry))
    && dated(data.weights, (w) => num(w) && w > 0)
    && dated(data.burned, (list) => Array.isArray(list) && list.every((b) => typeof b.name === "string" && num(b.kcal)))
    && (data.macros === undefined || [data.macros.p, data.macros.c, data.macros.f].every(num))
    && (data.saved === undefined || (Array.isArray(data.saved) && data.saved.every((s) => typeof s.name === "string" && Array.isArray(s.items) && s.items.every(entry))))
    && (data.favs === undefined || (Array.isArray(data.favs) && data.favs.every((f) => typeof f === "string")));
}
