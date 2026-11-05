// Pure logic, no DOM, so scripts/check.mjs can run it under node.

export const MEALS = ["Breakfast", "Lunch", "Dinner", "Snacks"];
const SOURCE_ORDER = { C: 0, F: 1, I: 2, S: 3 };

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
      if (!seen.has(e.name)) seen.set(e.name, e);
      if (seen.size >= limit) return seen;
    }
  }
  return seen;
}

// Backups come from a file the user picks, so check the shape before replacing their diary.
export function validBackup(data) {
  const num = (v) => typeof v === "number" && Number.isFinite(v) && v >= 0;
  return Boolean(data) && num(data.goal) && data.goal > 0 && Array.isArray(data.custom) && typeof data.days === "object" && data.days !== null
    && Object.entries(data.days).every(([date, list]) => /^\d{4}-\d{2}-\d{2}$/.test(date) && Array.isArray(list)
      && list.every((e) => typeof e.name === "string" && typeof e.label === "string" && MEALS.includes(e.meal)
        && [e.kcal, e.p, e.c, e.f, e.grams, e.qty].every(num)));
}
