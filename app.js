import { MEALS, ACTIVITY, PACE, isoDate, shiftDate, mealForHour, prepare, search, makeEntry, nutrition, totals, recentNames, copyEntries, averageKcal, suggestGoal, backupDue, validBackup } from "./logic.js";

// Named before the app was renamed from Haldi; changing it would orphan existing diaries.
const KEY = "haldi.v1";
const $ = (id) => document.getElementById(id);
const fmt = (n) => Math.round(n).toLocaleString("en-IN");
const SOURCES = { F: "USDA", S: "USDA ingredient", I: "Indian recipe estimate", P: "Packaged, Open Food Facts", C: "My food", Q: "Quick add" };

// Always builds text nodes, never innerHTML: names can come from a restored backup file.
function h(tag, props = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
    else if (k === "class") el.className = v;
    else if (k.startsWith("aria-") || k === "for") el.setAttribute(k, v);
    else el[k] = v;
  }
  el.append(...kids.flat().filter((k) => k !== null && k !== undefined && k !== false));
  return el;
}

function icon(name) {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("class", "ic");
  svg.setAttribute("aria-hidden", "true");
  const use = document.createElementNS("http://www.w3.org/2000/svg", "use");
  use.setAttribute("href", `#i-${name}`);
  svg.append(use);
  return svg;
}

function load() {
  const raw = localStorage.getItem(KEY);
  try {
    const saved = JSON.parse(raw);
    if (validBackup(saved)) return saved;
  } catch { /* handled below */ }
  // Never overwrite a diary we can't read without keeping a copy to recover from.
  if (raw) localStorage.setItem(`${KEY}.unreadable`, raw);
  return { goal: 2000, days: {}, custom: [] };
}

let state = load();
let date = isoDate();
let foods = [];
let foodsLoaded = false;
let foodsFailed = false;

// ponytail: localStorage holds about 5 MB, roughly 3 years of logging; move to IndexedDB if it ever fills.
function save() {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
    return true;
  } catch {
    alert("This change could not be saved because storage is full. Export a backup in Settings.");
    return false;
  }
}

let toastTimer;
function toast(message, undo) {
  const el = $("toast");
  $("toasttext").textContent = message;
  $("undo").onclick = () => { undo(); el.hidden = true; };
  ($("sheet").open ? $("sheet") : document.body).append(el);
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, 6000);
}

// Every diary change goes through here, so each one can be undone and a failed save rolls back.
function change(message, mutate) {
  const before = JSON.stringify(state.days);
  mutate();
  if (!save()) { state.days = JSON.parse(before); return false; }
  render();
  toast(message, () => { state.days = JSON.parse(before); save(); render(); });
  return true;
}

function render() {
  const today = isoDate();
  const list = state.days[date] || [];
  const t = totals(list);
  const left = state.goal - t.kcal;
  const over = Math.round(left) < 0;

  $("dayname").textContent = date === today ? "Today" : date === shiftDate(today, -1) ? "Yesterday"
    : new Date(`${date}T12:00`).toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short" });
  $("next").disabled = date >= today;
  $("hero").classList.toggle("over", over);
  $("level").style.height = `${Math.max(0, Math.min(100, (left / state.goal) * 100))}%`;
  // The status bar sits against the top of the hero in the installed app, so it follows the hero's colour.
  document.querySelector("meta[name=theme-color]").content = over ? "#A81F15" : left / state.goal >= 0.98 ? "#F2B100" : "#DDE2DF";
  $("left").textContent = fmt(Math.abs(left));
  $("left").classList.toggle("long", $("left").textContent.length > 5);
  $("leftlabel").textContent = over ? "kcal over" : "kcal left";
  $("of").textContent = `${fmt(t.kcal)} eaten of ${fmt(state.goal)}`;
  $("of").setAttribute("aria-label", `${fmt(t.kcal)} eaten of ${fmt(state.goal)}. Change daily goal`);

  $("macros").replaceChildren(...[["Protein", t.p], ["Carbs", t.c], ["Fat", t.f]].map(([label, g]) =>
    h("div", {}, h("b", {}, `${fmt(g)} g`), h("span", {}, label))));

  const emptyDay = list.length ? [] : [h("p", { class: "empty-day" }, date === today ? "Nothing logged yet. Add your first food below." : "Nothing logged on this day.")];
  $("meals").replaceChildren(...emptyDay, ...MEALS.map((meal) => {
    const items = list.filter((e) => e.meal === meal);
    const earlier = shiftDate(date, -1);
    const copyable = items.length ? [] : copyEntries(state.days[earlier] || [], meal);
    return h("section", { class: "meal" },
      h("div", { class: "mealhead" },
        h("h2", {}, meal),
        h("span", {}, items.length ? `${fmt(totals(items).kcal)} kcal` : ""),
        h("button", { "aria-label": `Add food to ${meal}`, onclick: () => openSearch(meal) }, icon("plus"))),
      h("ul", { class: "rows" }, items.map((e) => h("li", {},
        h("button", { class: "row", onclick: () => openPortion(rowFor(e), e.meal, e) },
          h("span", { class: "text" }, h("span", { class: "name" }, e.name), h("small", {}, amount(e))),
          h("span", { class: "kcal" }, fmt(nutrition(e).kcal)))))),
      copyable.length > 0 && h("button", { class: "copy", onclick: () => change(`Copied ${meal.toLowerCase()}`, () => { (state.days[date] ||= []).push(...copyable); }) },
        `Copy from ${date === today ? "yesterday" : "the day before"}, ${fmt(totals(copyable).kcal)} kcal`));
  }));
  renderWeek();
  renderNudge();
}

function renderNudge() {
  const old = document.querySelector(".nudge");
  old?.remove();
  if (!backupDue(state.days, state.lastBackup, isoDate())) return;
  $("week").after(h("section", { class: "nudge" }, h("p", {}, "Your diary is only on this phone. Export a backup so you can't lose it."),
    h("button", { class: "outline", onclick: openSettings }, "Open backup settings")));
}

const amount = (e) => (e.label === "g" ? `${fmt(e.qty)} g`
  : e.qty === 1 ? e.label : `${+e.qty.toFixed(2)} × ${e.label.replace(/^1 /, "")}`);

function renderWeek() {
  // Tapping a day inside the window selects it without moving the bars under your finger.
  const today = isoDate();
  const end = date >= shiftDate(today, -6) ? today : date;
  const dates = Array.from({ length: 7 }, (_, i) => shiftDate(end, i - 6));
  const kcals = dates.map((d) => totals(state.days[d]).kcal);
  const top = Math.max(state.goal, ...kcals) * 1.15;
  const average = averageKcal(dates, kcals, today);
  const dayLabel = (d) => new Date(`${d}T12:00`).toLocaleDateString("en-IN", { weekday: "short" }).slice(0, 2);
  $("week").replaceChildren(
    h("div", { class: "weekhead" }, h("h2", {}, end === today ? "Last 7 days" : `7 days to ${new Date(`${end}T12:00`).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}`), h("span", {}, `Line marks your ${fmt(state.goal)} goal`)),
    h("div", { class: "bars" },
      h("div", { class: "goal-line", style: `bottom:${(state.goal / top) * 100}%` }),
      dates.map((d, i) => {
        const high = Math.round(kcals[i]) > state.goal;
        return h("button", {
          class: `col${high ? " high" : ""}${kcals[i] ? "" : " empty"}`,
          "aria-label": `${d}: ${fmt(kcals[i])} kcal${high ? ", over goal" : ""}`,
          onclick: () => { date = d; render(); },
        },
          d === date && kcals[i] ? h("em", {}, fmt(kcals[i]), high && icon("over")) : high ? h("em", {}, icon("over")) : null,
          h("i", { style: `height:${(kcals[i] / top) * 100}%` }));
      })),
    h("div", { class: "days" }, dates.map((d) => h("span", { class: d === date ? "now" : "" }, dayLabel(d)))),
    ...average ? [h("p", { class: "weeknote" }, `Average ${fmt(average.kcal)} kcal over ${average.days} logged ${average.days === 1 ? "day" : "days"}, not counting today`)] : []);
}

// Finds the full food so its other portions are offered, falling back to what the entry stored.
function rowFor(e) {
  const known = [...state.custom, ...foods.map((f) => f.row)].find((r) => r[0] === e.name && r[1] === e.src);
  return known || [e.name, e.src, e.kcal, e.p, e.c, e.f, e.label === "g" ? [] : [[e.label, e.grams]]];
}

function showSheet(...kids) {
  $("sheetbody").replaceChildren(...kids.filter(Boolean));
  if (!$("sheet").open) $("sheet").showModal();
}

const closeSheet = () => $("sheet").close();
const head = (title, back) => h("div", { class: "sheethead" },
  back && h("button", { class: "link", onclick: back }, "Back"),
  h("h2", {}, title),
  h("button", { class: "link", onclick: closeSheet }, "Close"));

function openSearch(meal, query = "") {
  const allFoods = () => [...state.custom.map(prepare), ...foods];
  let recents = recentNames(state.days);
  const results = h("div", { class: "results" });
  const input = h("input", { type: "search", placeholder: "Search: roti, dal, samosa, egg", value: query, enterKeyHint: "search",
    autocomplete: "off", autocorrect: "off", "aria-label": "Search foods", oninput: draw });
  const mealButtons = h("div", { class: "meals", role: "group", "aria-label": "Meal" });
  const drawMeals = () => mealButtons.replaceChildren(...MEALS.map((m) =>
    h("button", { "aria-pressed": String(m === meal), onclick: () => { meal = m; drawMeals(); } }, m)));

  function foodRow(row) {
    const known = recents.get(row[0]);
    const last = known?.src === row[1] ? known : null;
    const [label, grams] = last ? [amount(last), last.grams * last.qty] : row[6][0] || ["100 g", 100];
    return h("div", { class: "foodline" },
      h("button", { class: "row", onclick: () => openPortion(row, meal, null, input.value, last) },
        h("span", { class: "text" }, h("span", { class: "name" }, row[0]), h("small", {}, `${label}, ${SOURCES[row[1]]}`)),
        h("span", { class: "kcal" }, fmt((row[2] * grams) / 100))),
      last && h("button", { class: "repeat", "aria-label": `Add ${amount(last)} of ${row[0]} to ${meal}`, onclick: () => {
        change(`Added ${row[0]} to ${meal}`, () => { (state.days[date] ||= []).push(makeEntry(row, meal, last.label, last.grams, last.qty)); });
      } }, icon("plus")));
  }

  function draw() {
    const q = input.value.trim();
    recents = recentNames(state.days);
    const own = h("button", { class: "row", onclick: () => openCustom(meal, q) },
      h("span", { class: "text" }, h("span", { class: "name" }, q ? `Add “${q}” as my own food` : "Add my own food"),
        h("small", {}, "Use the numbers on the pack label")));
    const offline = foodsFailed ? h("p", { class: "error" }, "The food list has not downloaded. Connect to the internet and reopen CalTrack.") : null;
    if (!q) {
      const rows = [...recents.values()].map(rowFor);
      results.replaceChildren(...[offline, rows.length ? h("h3", {}, "Recent") : h("p", { class: "hint" }, "Search for your first food."), ...rows.map(foodRow), own].filter(Boolean));
      return;
    }
    const rows = search(allFoods(), q, new Set(recents.keys()));
    const loading = !foodsLoaded && !foodsFailed ? h("p", { class: "hint", role: "status" }, "Loading the food list…") : null;
    const none = !rows.length && foodsLoaded ? h("p", { class: "hint" }, `No food matches “${q}”. Check the spelling or add it yourself.`) : null;
    results.replaceChildren(...[offline, loading, ...rows.map(foodRow), none, own].filter(Boolean));
  }

  drawMeals();
  draw();
  showSheet(head("Add food"), input, mealButtons,
    h("div", { class: "tools" }, h("button", { class: "link", onclick: () => openQuick(meal, input.value) }, "Quick add calories")), results);
  input.focus();
}

function openPortion(row, meal, entry = null, query = "", last = null) {
  const [name, src, kcal] = row;
  const custom = src === "C" || src === "Q";
  const from = entry || last;
  const portions = [...row[6]];
  if (!custom) portions.push(["g", 1]);
  let chosen = (from && portions.find(([l]) => l === from.label)) || (from ? [from.label, from.grams] : portions[0]);
  if (from && !portions.includes(chosen)) portions.unshift(chosen);
  const qtyFor = (portion) => (portion[0] === "g" ? 100 : 1);

  const qty = h("input", { type: "number", inputMode: "decimal", min: "0", step: "any", value: from ? from.qty : qtyFor(chosen), "aria-label": "Amount", oninput: draw });
  const result = h("div", { class: "result", "aria-live": "polite" });
  const chips = h("div", { class: "portions", role: "group", "aria-label": "Portion" });
  const action = h("button", { class: "primary", onclick: submit });
  const amountNow = () => { const v = parseFloat(qty.value); return v > 0 && Number.isFinite(v) ? v : 0; };

  function drawChips() {
    chips.replaceChildren(...portions.map((portion) => h("button", {
      "aria-pressed": String(portion === chosen),
      onclick: () => { chosen = portion; qty.value = qtyFor(portion); drawChips(); draw(); },
    }, portion[0] === "g" ? "Grams" : portion[0])));
  }

  function draw() {
    const n = nutrition(makeEntry(row, meal, chosen[0], chosen[1], amountNow(), "preview"));
    result.replaceChildren(h("b", {}, `${fmt(n.kcal)} kcal`), h("p", {}, `Protein ${fmt(n.p)} g, carbs ${fmt(n.c)} g, fat ${fmt(n.f)} g`));
    action.disabled = !amountNow();
    action.textContent = entry ? "Save changes" : `Add to ${meal}`;
  }

  function step(delta) {
    const size = chosen[0] === "g" ? 10 : 0.5;
    qty.value = Math.max(size, +(amountNow() + delta * size).toFixed(2));
    draw();
  }

  function submit() {
    const made = makeEntry(row, meal, chosen[0], chosen[1], amountNow(), entry?.id);
    const done = change(entry ? `Updated ${name}` : `Added ${name} to ${meal}`, () => {
      const list = state.days[date] ||= [];
      if (entry) list[list.findIndex((e) => e.id === entry.id)] = made;
      else list.push(made);
    });
    if (done) closeSheet();
  }

  function removeEntry() {
    const done = change(`Deleted ${name}`, () => {
      state.days[date] = state.days[date].filter((e) => e.id !== entry.id);
      if (!state.days[date].length) delete state.days[date];
    });
    if (done) closeSheet();
  }

  function forgetFood() {
    state.custom = state.custom.filter((r) => r[0] !== name);
    save();
    openSearch(meal);
  }

  drawChips();
  draw();
  showSheet(
    head(name, entry ? null : () => openSearch(meal, query)),
    h("p", { class: "note" }, `${SOURCES[src] || "USDA"}${custom ? "" : `, ${fmt(kcal)} kcal per 100 g`}.${src === "I" ? " Worked out from a recipe, so treat it as a guide." : ""}${src === "P" ? " Added by volunteers, so check it against the pack." : ""}`),
    chips,
    h("div", { class: "stepper" },
      h("button", { "aria-label": "Less", onclick: () => step(-1) }, icon("minus")),
      qty,
      h("button", { "aria-label": "More", onclick: () => step(1) }, icon("plus"))),
    result,
    action,
    entry && h("button", { class: "danger", onclick: removeEntry }, "Delete from diary"),
    src === "C" && !entry && h("button", { class: "danger", onclick: forgetFood }, "Remove from my foods"));
}

const field = (label, props) => { const input = h("input", props); return [h("label", {}, label, input), input]; };

function choice(label, options, value) {
  const select = h("select", {}, options.map((o) => h("option", { value: o }, o)));
  if (options.includes(value)) select.value = value;
  return [h("label", {}, label, select), select];
}

function openQuick(meal, query = "") {
  const [kcalL, kcalI] = field("Calories", { type: "number", inputMode: "decimal", min: "0" });
  const [nameL, nameI] = field("What was it? Optional", { autocomplete: "off" });
  const error = h("p", { class: "error", role: "alert" });
  function add() {
    const kcal = parseFloat(kcalI.value);
    if (!(kcal > 0 && kcal <= 20000)) { error.textContent = "Enter the calories, from 1 to 20,000."; kcalI.focus(); return; }
    const row = [nameI.value.trim() || "Quick add", "Q", kcal, 0, 0, 0, []];
    if (change(`Added ${row[0]} to ${meal}`, () => { (state.days[date] ||= []).push(makeEntry(row, meal, "estimate", 100, 1)); })) closeSheet();
  }
  showSheet(head("Quick add calories", () => openSearch(meal, query)),
    h("div", { class: "stack" }, kcalL, nameL, error, h("button", { class: "primary", onclick: add }, `Add to ${meal}`)));
  kcalI.focus();
}

function openGoal(firstRun = false) {
  const saved = state.profile || {};
  const [sexL, sexI] = choice("Sex", ["Male", "Female"], saved.sex);
  const [ageL, ageI] = field("Age", { type: "number", inputMode: "numeric", value: saved.age ?? "", oninput: draw });
  const [heightL, heightI] = field("Height, cm", { type: "number", inputMode: "numeric", value: saved.height ?? "", oninput: draw });
  const [weightL, weightI] = field("Weight, kg", { type: "number", inputMode: "decimal", value: saved.weight ?? "", oninput: draw });
  const [activityL, activityI] = choice("Activity", Object.keys(ACTIVITY), saved.activity ?? "Light, 1–3 workouts a week");
  const [paceL, paceI] = choice("Goal", Object.keys(PACE), saved.pace ?? "Stay the same");
  const result = h("div", { class: "suggest", "aria-live": "polite" });
  const use = h("button", { class: "primary", onclick: apply });
  sexI.onchange = activityI.onchange = paceI.onchange = draw;
  const profile = () => ({ sex: sexI.value, age: +ageI.value, height: +heightI.value, weight: +weightI.value, activity: activityI.value, pace: paceI.value });

  function draw() {
    const goal = suggestGoal(profile());
    result.replaceChildren(...goal
      ? [h("b", {}, `${fmt(goal)} kcal`), h("p", { class: "note" }, "A starting estimate from the Mifflin-St Jeor formula, never below 1,200. Adjust it once you see how your weight responds.")]
      : [h("p", { class: "note" }, "Enter your age, height and weight to see a daily goal.")]);
    use.disabled = !goal;
    use.textContent = goal ? `Use ${fmt(goal)} kcal a day` : "Use this goal";
  }

  function apply() {
    state.goal = suggestGoal(profile());
    state.profile = profile();
    if (save()) { render(); closeSheet(); }
  }

  draw();
  showSheet(head(firstRun ? "Set your daily goal" : "Work out my goal", firstRun ? null : openSettings),
    h("div", { class: "stack" }, sexL, h("div", { class: "grid3" }, ageL, heightL, weightL), activityL, paceL, result, use,
      firstRun && h("button", { class: "link skip", onclick: closeSheet }, `Keep ${fmt(state.goal)} kcal for now`)));
}

function openCustom(meal, name = "") {
  const [nameL, nameI] = field("Name", { value: name, autocomplete: "off" });
  const [kcalL, kcalI] = field("Calories per serving", { type: "number", inputMode: "decimal", min: "0" });
  const [pL, pI] = field("Protein, g", { type: "number", inputMode: "decimal", min: "0" });
  const [cL, cI] = field("Carbs, g", { type: "number", inputMode: "decimal", min: "0" });
  const [fL, fI] = field("Fat, g", { type: "number", inputMode: "decimal", min: "0" });
  const error = h("p", { class: "error", role: "alert" });

  function create() {
    const num = (input) => Math.max(0, parseFloat(input.value) || 0);
    if (!nameI.value.trim()) { error.textContent = "Enter a name."; nameI.focus(); return; }
    if (!(parseFloat(kcalI.value) >= 0)) { error.textContent = "Enter the calories per serving."; kcalI.focus(); return; }
    const title = nameI.value.trim();
    // One serving counts as 100 "grams" so custom foods use the same per-100 g maths as everything else.
    const row = [title, "C", num(kcalI), num(pI), num(cI), num(fI), [["1 serving", 100]]];
    state.custom = [row, ...state.custom.filter((r) => r[0] !== title)];
    if (save()) openPortion(row, meal, null, title);
  }

  showSheet(head("Add my own food", () => openSearch(meal, name)),
    h("div", { class: "stack" }, nameL, kcalL, h("div", { class: "grid3" }, pL, cL, fL), error,
      h("button", { class: "primary", onclick: create }, "Save food")));
}

async function exportBackup() {
  const name = `caltrack-backup-${isoDate()}.json`;
  const done = () => { state.lastBackup = isoDate(); save(); render(); };
  const file = new File([JSON.stringify(state)], name, { type: "application/json" });
  if (navigator.canShare?.({ files: [file] })) {
    try { await navigator.share({ files: [file] }); done(); } catch { /* user closed the share sheet */ }
    return;
  }
  const link = h("a", { href: URL.createObjectURL(file), download: name });
  link.click();
  URL.revokeObjectURL(link.href);
  done();
}

function openSettings() {
  const goal = h("input", { type: "number", inputMode: "numeric", min: "500", max: "10000", value: state.goal });
  const status = h("p", { class: "error", role: "status" });
  const picker = h("input", { type: "file", accept: "application/json,.json", hidden: true, onchange: restore });

  async function restore() {
    const file = picker.files[0];
    if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      if (!validBackup(data)) throw new Error();
      const days = Object.keys(data.days).length;
      if (!confirm(`Replace everything in CalTrack with this backup of ${days} days?`)) return;
      state = { ...data, onboarded: true };
      save();
      render();
      closeSheet();
    } catch {
      status.textContent = "That file is not a CalTrack backup. Nothing was changed.";
    } finally {
      picker.value = "";
    }
  }

  function saveGoal() {
    const value = Math.round(parseFloat(goal.value));
    if (!(value >= 500 && value <= 10000)) { status.textContent = "Enter a goal from 500 to 10,000 kcal."; goal.focus(); return; }
    state.goal = value;
    if (save()) { render(); closeSheet(); }
  }

  showSheet(head("Settings"),
    h("div", { class: "stack" },
      h("section", {}, h("label", {}, "Daily goal, kcal", goal), status, h("button", { class: "outline", onclick: saveGoal }, "Save goal"), h("button", { class: "outline", onclick: () => openGoal() }, "Work out my goal")),
      h("section", {}, h("h3", {}, "Backup"),
        h("p", { class: "note" }, `Your diary is stored only on this phone. Export a backup before you change phones or clear browser data. ${state.lastBackup ? `Last backup: ${state.lastBackup}.` : "You haven't made a backup yet."}`),
        h("button", { class: "outline", onclick: exportBackup }, "Export backup"),
        h("button", { class: "outline", onclick: () => picker.click() }, "Restore backup"), picker),
      h("section", {}, h("h3", {}, "Where the numbers come from"),
        h("p", { class: "note" }, `${foods.length ? `${fmt(foods.length)} foods` : "Foods"} from USDA FoodData Central (FNDDS 2021–2023 and SR Legacy) and the Indian Nutrient Databank (Vijayakumar et al., 2024), plus packaged products from Open Food Facts (ODbL). Indian recipe figures are estimates and packaged figures are added by volunteers. Rows that failed sanity checks were removed.`))));
}

const redrawSearch = () => document.querySelector("dialog[open] input[type=search]")?.dispatchEvent(new Event("input"));
$("sheet").addEventListener("close", () => document.body.append($("toast")));

$("prev").onclick = () => { date = shiftDate(date, -1); render(); };
$("next").onclick = () => { date = shiftDate(date, 1); render(); };
$("add").onclick = () => openSearch(mealForHour(new Date().getHours()));
$("settings-open").onclick = openSettings;
$("of").onclick = openSettings;

// An installed app can stay open overnight; move on to the new day if it was showing today.
let lastSeen = isoDate();
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState !== "visible" || isoDate() === lastSeen) return;
  if (date === lastSeen) date = isoDate();
  lastSeen = isoDate();
  render();
});

render();
navigator.storage?.persist?.();
if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js");

fetch("foods.json")
  .then((r) => { if (!r.ok) throw new Error(r.status); return r.json(); })
  .then((rows) => { foods = foods.concat(rows.map(prepare)); foodsLoaded = true; }) // packaged.json may have landed first
  .catch(() => { foodsFailed = true; })
  .finally(redrawSearch);

// Packaged foods are a bonus: if this file fails, everything else still works.
fetch("packaged.json")
  .then((r) => { if (!r.ok) throw new Error(r.status); return r.json(); })
  .then((rows) => { foods = foods.concat(rows.map(prepare)); redrawSearch(); })
  .catch(() => {});

if (!state.onboarded) {
  state.onboarded = true;
  save();
  if (!Object.keys(state.days).length) openGoal(true);
}
