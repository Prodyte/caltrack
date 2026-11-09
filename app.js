import {
  MEALS, ACTIVITY, PACE, isoDate, shiftDate, mealForHour, prepare, search, makeEntry, nutrition, totals, recentNames, copyEntries, averageKcal,
  suggestTargets, defaultMacros, backupDue, validBackup, OZ, toUnit, fromUnit, datesEnding, frequent, proteinIdeas, parseMeal, portionFor,
  weightTrend, weeklyRate, weeksToTarget, summarize, maintenance, burnedTotal, daysBetween,
} from "./logic.js";

// Named before the app was renamed from Haldi; changing it would orphan existing diaries.
const KEY = "haldi.v1";
const $ = (id) => document.getElementById(id);
const fmt = (n) => Math.round(n).toLocaleString("en-IN");
const fmt1 = (n) => (Math.round(n * 10) / 10).toLocaleString("en-IN", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const calm = matchMedia("(prefers-reduced-motion: reduce)").matches;
const EASE = "cubic-bezier(.16,1,.3,1)";
const SOURCES = { F: "USDA", S: "USDA ingredient", I: "Indian recipe estimate", P: "Packaged, Open Food Facts", C: "My food", Q: "Quick add" };
const MACROS = [["p", "Protein", "protein"], ["c", "Carbs", "carbs"], ["f", "Fat", "fat"]];
const buzz = (ms = 8) => navigator.vibrate?.(ms);

// Always builds text nodes, never innerHTML: names can come from a restored backup file.
function h(tag, props = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
    else if (k === "class") el.className = v;
    else if (k.startsWith("aria-") || k === "for" || k === "role") el.setAttribute(k, v);
    else el[k] = v;
  }
  el.append(...kids.flat().filter((k) => k !== null && k !== undefined && k !== false));
  return el;
}

const SVG = "http://www.w3.org/2000/svg";
function svg(tag, attrs = {}, ...kids) {
  const el = document.createElementNS(SVG, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  el.append(...kids);
  return el;
}

function icon(name, extra = "") {
  return svg("svg", { class: `ic ${extra}`, "aria-hidden": "true" }, svg("use", { href: `#i-${name}` }));
}

const blank = () => ({ goal: 2000, days: {}, custom: [] });
// Fields added after the first release, filled in so older diaries and backups keep working.
const upgrade = (s) => ({ weights: {}, burned: {}, saved: [], favs: [], units: { weight: "kg", food: "g" }, ...s });

function load() {
  const raw = localStorage.getItem(KEY);
  try {
    const saved = JSON.parse(raw);
    if (validBackup(saved)) return upgrade(saved);
  } catch { /* handled below */ }
  // Never overwrite a diary we can't read without keeping a copy to recover from.
  if (raw) localStorage.setItem(`${KEY}.unreadable`, raw);
  return upgrade(blank());
}

let state = load();
let date = isoDate();
let foods = [];
const foodIndex = new Map();
let foodsLoaded = false;
let foodsFailed = false;

const targets = () => ({ kcal: state.goal, ...(state.macros || defaultMacros(state.goal)) });
const burnedOn = (d) => burnedTotal(state.burned[d]);
const weightUnit = () => state.units.weight;
const showWeight = (kg, digits = 1) => `${toUnit(kg, weightUnit()).toFixed(digits)} ${weightUnit()}`;

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

// Each sheet is its own <dialog> with a history entry, so the phone's Back button and gesture close it
// instead of leaving the app.
const layers = [];
let backDone = null;
history.replaceState({ depth: 0 }, "");

function openLayer(kind, build) {
  // Taking focus itself stops the browser ringing the first button or raising a keyboard on open.
  const inner = h("div", { class: "layerbody", tabIndex: -1, autofocus: true });
  const dialog = h("dialog", { class: `layer ${kind}` }, inner);
  const layer = { dialog, inner, refresh: null, opened: null };
  dialog.addEventListener("cancel", (e) => { e.preventDefault(); closeTop(); });
  dialog.addEventListener("click", (e) => { if (e.target === dialog) closeTop(); });
  inner.append(...build(layer).filter(Boolean));
  document.body.append(dialog);
  layers.push(layer);
  history.pushState({ depth: layers.length }, "");
  $("toast").hidden = true; // moving on; it would sit over the new sheet's controls
  document.documentElement.classList.add("locked");
  dialog.showModal();
  draggable(dialog);
  placeToast();
  layer.opened?.();
  return layer;
}

function closeTop(count = 1) {
  if (!layers.length) return Promise.resolve();
  if (backDone) return backDone.promise; // a double tap must not walk out of the app
  let resolve;
  const promise = new Promise((r) => { resolve = r; });
  backDone = { promise, resolve };
  history.go(-count);
  return promise;
}
const closeAll = () => closeTop(layers.length);

addEventListener("popstate", (e) => {
  const depth = e.state?.depth ?? 0;
  while (layers.length > depth) {
    const { dialog } = layers.pop();
    dialog.classList.add("closing");
    setTimeout(() => { dialog.close(); dialog.remove(); }, 180);
  }
  placeToast();
  if (!layers.length) {
    document.documentElement.classList.remove("locked");
    render();
  }
  backDone?.resolve();
  backDone = null;
});

// Dragging a sheet's top edge down dismisses it, the way native sheets do.
function draggable(dialog) {
  const grip = dialog.querySelector(".grip");
  if (!grip) return;
  let startY = null, lastY = 0, lastT = 0, speed = 0, moved = 0;
  grip.addEventListener("pointerdown", (e) => {
    if (e.target.closest("button")) return;
    startY = lastY = e.clientY; lastT = e.timeStamp; speed = 0; moved = 0;
    grip.setPointerCapture(e.pointerId);
  });
  grip.addEventListener("pointermove", (e) => {
    if (startY === null) return;
    moved = Math.max(0, e.clientY - startY);
    speed = (e.clientY - lastY) / Math.max(1, e.timeStamp - lastT);
    lastY = e.clientY; lastT = e.timeStamp;
    dialog.style.setProperty("--drag", `${moved}px`);
    dialog.style.transition = "none";
    dialog.style.transform = `translateY(${moved}px)`;
  });
  const release = () => {
    if (startY === null) return;
    startY = null;
    dialog.style.transition = "";
    if (moved > 90 || speed > 0.5) { dialog.style.transform = ""; closeTop(); return; }
    dialog.style.transform = "";
    dialog.style.setProperty("--drag", "0px");
  };
  grip.addEventListener("pointerup", release);
  grip.addEventListener("pointercancel", release);
}

const head = (title, ...extra) => h("div", { class: "grip" }, h("div", { class: "handle" }),
  h("div", { class: "sheethead" }, h("h2", {}, title), ...extra,
    h("button", { class: "iconbtn", "aria-label": "Close", onclick: () => closeTop() }, icon("close"))));

let toastTimer;
function placeToast() {
  (layers.at(-1)?.dialog || document.body).append($("toast"));
}

function toast(message, undo) {
  const el = $("toast");
  $("toasttext").textContent = message;
  $("undo").hidden = !undo;
  $("undo").onclick = () => { undo(); el.hidden = true; };
  placeToast();
  el.hidden = false;
  if (!calm) el.animate([{ opacity: 0, transform: "translateY(12px)" }, { opacity: 1, transform: "none" }], { duration: 220, easing: EASE });
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, 6000);
}

const fresh = new Set();
function diaryChanged() {
  render();
  layers.forEach((l) => l.refresh?.());
}

// Every diary change goes through here, so each one can be undone and a failed save rolls back.
const UNDOABLE = ["days", "burned", "weights", "saved"];
function change(message, mutate) {
  const before = JSON.stringify(UNDOABLE.map((k) => state[k]));
  const restore = () => JSON.parse(before).forEach((v, i) => { state[UNDOABLE[i]] = v; });
  const known = new Set((state.days[date] || []).map((e) => e.id));
  mutate();
  if (!save()) { restore(); return false; }
  (state.days[date] || []).forEach((e) => { if (!known.has(e.id)) fresh.add(e.id); });
  buzz();
  diaryChanged();
  toast(message, () => { restore(); fresh.clear(); save(); diaryChanged(); });
  return true;
}

const addEntries = (entries) => { (state.days[date] ||= []).push(...entries); };

function dayName(d) {
  const today = isoDate();
  return d === today ? "Today" : d === shiftDate(today, -1) ? "Yesterday"
    : new Date(`${d}T12:00`).toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short" });
}
const shortDate = (d) => new Date(`${d}T12:00`).toLocaleDateString("en-IN", { day: "numeric", month: "short" });
const dayLabel = (d) => new Date(`${d}T12:00`).toLocaleDateString("en-IN", { weekday: "short" }).slice(0, 2);

function goTo(d) {
  const today = isoDate();
  if (d > today) d = today;
  const dir = d > date ? 1 : -1;
  if (d === date) return;
  date = d;
  render();
  if (calm) return;
  for (const el of [$("insight"), $("meals")]) {
    el.animate([{ opacity: 0, transform: `translateX(${dir * 24}px)` }, { opacity: 1, transform: "none" }], { duration: 240, easing: EASE });
  }
}

// The number counts together with the ring, so the two read as one change.
let shownLeft = null, tween = 0;
function showLeft(value) {
  const paint = (v) => { $("left").textContent = fmt(Math.abs(v)); };
  cancelAnimationFrame(tween);
  $("left").classList.toggle("long", fmt(Math.abs(value)).length > 5);
  if (shownLeft === null || calm || shownLeft === value) { paint(value); shownLeft = value; return; }
  const from = shownLeft, began = performance.now();
  shownLeft = value;
  const frame = (now) => {
    const t = Math.min(1, (now - began) / 500);
    paint(from + (value - from) * (1 - (1 - t) ** 3));
    if (t < 1) tween = requestAnimationFrame(frame);
  };
  tween = requestAnimationFrame(frame);
}

const pct = (value, of) => Math.max(0, Math.min(100, of > 0 ? (value / of) * 100 : 0));

function render() {
  const today = isoDate();
  const list = state.days[date] || [];
  const t = totals(list);
  const goal = targets();
  const burned = burnedOn(date);
  const budget = goal.kcal + burned;
  const left = budget - t.kcal;
  const over = Math.round(left) < 0;

  $("dayname").textContent = dayName(date);
  $("datepick").value = date;
  $("datepick").max = today;
  $("next").disabled = date >= today;
  $("today").hidden = date === today;

  const eaten = pct(t.kcal, budget);
  $("ring-fill").style.strokeDashoffset = 100 - eaten;
  $("ring-fill").style.opacity = t.kcal > 0 ? 1 : 0;
  $("ring-over").style.strokeDashoffset = 100 - (over ? pct(-left, budget) : 0);
  $("ring-over").style.opacity = over ? 1 : 0;
  $("ring").setAttribute("aria-label", `${fmt(Math.abs(left))} kcal ${over ? "over" : "left"} of ${fmt(budget)}`);
  showLeft(left);
  $("leftlabel").textContent = over ? "kcal over" : "kcal left";
  $("leftlabel").classList.toggle("over", over);
  $("eaten").textContent = fmt(t.kcal);
  $("burned").textContent = fmt(burned);
  $("target").textContent = fmt(goal.kcal);
  $("target-open").setAttribute("aria-label", `Target ${fmt(goal.kcal)} kcal. Change targets`);
  $("burned-open").setAttribute("aria-label", `Exercise ${fmt(burned)} kcal. Log exercise`);

  $("macros").replaceChildren(...MACROS.map(([k, label, cls]) => {
    const togo = goal[k] - t[k];
    return h("div", { class: `macro ${cls}${k === "p" ? " big" : ""}` },
      h("div", { class: "mhead" }, h("span", { class: "mname" }, label), h("span", { class: "mval" }, h("b", {}, fmt(t[k])), ` / ${fmt(goal[k])} g`)),
      h("div", { class: "meter", "aria-hidden": "true" }, h("i", { style: `width:${pct(t[k], goal[k])}%` })),
      k === "p" && (Math.round(togo) > 0 ? h("small", {}, `${fmt(togo)} g to go`) : h("small", { class: "met" }, "Target reached")));
  }));

  renderInsight({ t, goal, left, over, list, today });

  const flash = !layers.length && fresh.size > 0;
  $("meals").replaceChildren(...MEALS.map((meal) => {
    const items = list.filter((e) => e.meal === meal);
    const copyable = items.length ? [] : copyFor(meal);
    const mt = totals(items);
    const summary = items.length ? [...new Set(items.map((e) => e.name))].join(", ")
      : copyable.length ? `${date === today ? "Yesterday" : "Day before"}: ${fmt(totals(copyable).kcal)} kcal, tap to copy` : "Nothing yet";
    return h("section", { class: `meal${flash && items.some((e) => fresh.has(e.id)) ? " fresh" : ""}` },
      h("button", { class: "mealrow", onclick: () => (items.length || copyable.length ? openMeal(meal) : openSearch(meal)) },
        h("span", { class: "text" }, h("span", { class: "mealname" }, meal), h("small", {}, summary)),
        items.length > 0 && h("span", { class: "num" }, `${fmt(mt.kcal)}`, h("small", {}, `${fmt(mt.p)}p ${fmt(mt.c)}c ${fmt(mt.f)}f`))),
      h("button", { class: "mealadd", "aria-label": `Add food to ${meal}`, onclick: () => openSearch(meal) }, icon("plus")));
  }));
  if (flash) fresh.clear();

  const due = backupDue(state.days, state.lastBackup, today);
  $("settings-open").classList.toggle("due", due);
  $("settings-open").setAttribute("aria-label", due ? "Settings, backup due" : "Settings");
  renderWeek();
  renderWeightRow(today);
}

// One observation at a time, always worked out from what's logged. Over target is stated plainly, without alarm.
function renderInsight({ t, goal, left, over, list, today }) {
  const el = $("insight");
  const p = goal.p - t.p;
  const week = averageKcal(datesEnding(today, 8), datesEnding(today, 8).map((d) => totals(state.days[d]).kcal), today);
  let text, ideas = [];
  if (!list.length) {
    text = date === today
      ? (Object.keys(state.days).length ? [h("b", {}, "Nothing logged today. "), "Tap a meal or Add food to start."] : [h("b", {}, "Welcome. "), "Log your first food with Add food below. Recent foods then come back in one tap."])
      : [h("b", {}, "Nothing logged on this day. "), "You can still add what you remember."];
  } else if (over) {
    text = [h("b", {}, `${fmt(-left)} kcal over. `), week ? `Your 7-day average is ${fmt(week.kcal)}, and the average is what moves your weight.` : "One day barely moves your weight trend."];
  } else if (Math.round(p) > 0) {
    ideas = date === today ? proteinIdeas(recentNames(state.days), left).filter((e) => !list.some((l) => l.name === e.name)) : [];
    text = [h("b", {}, `${fmt(p)} g protein to go`), `, ${fmt(left)} kcal left.`, ideas.length ? " Quick picks:" : ""];
  } else {
    text = [h("b", {}, "Protein target reached. "), `${fmt(left)} kcal left for the day.`];
  }
  el.replaceChildren(h("p", {}, text), h("div", { class: "ideas", hidden: !ideas.length }, ideas.map((e) => {
    const n = nutrition(e);
    const meal = mealForHour(new Date().getHours());
    return h("button", { "aria-label": `Add ${amount(e)} of ${e.name} to ${meal}, ${fmt(n.p)} g protein`,
      onclick: () => change(`Added ${e.name} to ${meal}`, () => addEntries([{ ...e, meal, id: crypto.randomUUID() }])) },
    icon("plus"), h("span", {}, `${e.name}, ${fmt(n.p)} g`));
  })));
}

const copyFor = (meal) => copyEntries(state.days[shiftDate(date, -1)] || [], meal);

const amount = (e) => (e.label === "g" ? `${fmt(e.qty)} g` : e.label === "oz" ? `${+e.qty.toFixed(2)} oz`
  : e.qty === 1 ? e.label : `${+e.qty.toFixed(2)} × ${e.label.replace(/^1 /, "")}`);

// Tapping a day inside the window selects it without moving the bars under your finger.
function weekWindow() {
  const today = isoDate();
  const end = date >= shiftDate(today, -6) ? today : date;
  const dates = datesEnding(end, 7);
  const kcals = dates.map((d) => totals(state.days[d]).kcal);
  return { today, end, dates, kcals, top: Math.max(state.goal, ...kcals) * 1.15 };
}

function renderWeek() {
  const { today, dates, kcals, top } = weekWindow();
  const avg = averageKcal(dates, kcals, today);
  $("weekavg").textContent = avg ? `Avg ${fmt(avg.kcal)} kcal · Trends ›` : "Trends ›";
  $("week").replaceChildren(...dates.map((d, i) => {
    const goal = state.goal + burnedOn(d);
    const high = Math.round(kcals[i]) > goal;
    return h("button", { class: `wk${d === date ? " now" : ""}${high ? " high" : ""}${kcals[i] ? "" : " empty"}`,
      "aria-label": `${dayName(d)}: ${fmt(kcals[i])} kcal${high ? ", over target" : ""}`, onclick: () => goTo(d) },
      h("span", { class: "track" }, h("u", { style: `bottom:${(goal / top) * 100}%` }), h("i", { style: `height:${(kcals[i] / top) * 100}%` })),
      h("span", {}, dayLabel(d)));
  }));
}

function renderWeightRow(today) {
  const series = weightTrend(state.weights);
  const last = series.at(-1);
  const rate = weeklyRate(series, today);
  const todays = state.weights[date];
  $("weight-open").replaceChildren(icon("scale"),
    h("span", { class: "text" }, last
      ? [h("b", {}, `Trend ${showWeight(last.trend)}`), h("small", {}, rate === null ? "  Keep weighing in to see your rate" : `  ${rate > 0 ? "+" : "−"}${showWeight(Math.abs(rate), 2)} a week`)]
      : [h("b", {}, "Log your weight"), h("small", {}, "  The trend appears after a few weigh-ins")]),
    h("small", {}, todays ? showWeight(todays) : date === today ? "Add today" : "Add"), icon("chev"));
}

// ——— Sheets: the day's meal ———

function openMeal(meal) {
  const total = h("p", { class: "note" });
  const list = h("ul", { class: "rows" });
  const more = h("div", {});
  function draw() {
    const items = (state.days[date] || []).filter((e) => e.meal === meal);
    const copyable = items.length ? [] : copyFor(meal);
    const t = totals(items);
    total.textContent = items.length ? `${dayName(date)} · ${fmt(t.kcal)} kcal · protein ${fmt(t.p)} g, carbs ${fmt(t.c)} g, fat ${fmt(t.f)} g` : `${dayName(date)}, nothing logged yet`;
    list.replaceChildren(...items.map((e) => h("li", { class: "line" },
      h("button", { class: "row", onclick: () => openPortion(rowFor(e), e.meal, { entry: e }) },
        h("span", { class: "text" }, h("span", { class: "name" }, e.name), h("small", {}, amount(e))),
        h("span", { class: "kcal" }, fmt(nutrition(e).kcal), h("small", {}, ` kcal`))))));
    // h() drops false children; replaceChildren alone would print "false".
    more.replaceChildren(h("div", {},
      copyable.length > 0 && h("button", { class: "copy", onclick: () => change(`Copied ${meal.toLowerCase()}`, () => addEntries(copyable)) },
        `Copy from ${date === isoDate() ? "yesterday" : "the day before"}, ${fmt(totals(copyable).kcal)} kcal`),
      h("button", { class: "copy", onclick: () => openCopyDay(meal) }, "Copy from another day"),
      items.length > 0 && h("button", { class: "copy", onclick: () => openSaveMeal(meal, items) }, "Save as a meal to reuse")));
  }
  draw();
  openLayer("bottom", (layer) => {
    layer.refresh = draw;
    return [head(meal), total, list, more, h("button", { class: "primary", onclick: () => openSearch(meal) }, `Add food to ${meal}`)];
  });
}

function openCopyDay(meal) {
  // Starts on the latest earlier day that has this meal, which is nearly always the one wanted.
  const start = Object.keys(state.days).sort().reverse().find((d) => d < date && state.days[d].some((e) => e.meal === meal)) || shiftDate(date, -1);
  const picker = h("input", { type: "date", value: start, max: shiftDate(date, -1), "aria-label": "Copy from", onchange: draw });
  const list = h("ul", { class: "rows" });
  const action = h("button", { class: "primary" });
  let items = [];
  function draw() {
    items = copyEntries(state.days[picker.value] || [], meal);
    list.replaceChildren(...items.length ? items.map((e) => h("li", { class: "line row" }, h("span", { class: "text" }, h("span", { class: "name" }, e.name), h("small", {}, amount(e))), h("span", { class: "kcal" }, fmt(nutrition(e).kcal))))
      : [h("li", { class: "hint" }, `No ${meal.toLowerCase()} logged on that day.`)]);
    action.disabled = !items.length;
    action.textContent = items.length ? `Copy ${items.length} ${items.length === 1 ? "food" : "foods"}, ${fmt(totals(items).kcal)} kcal` : "Copy";
  }
  action.onclick = () => { if (change(`Copied ${meal.toLowerCase()} from ${shortDate(picker.value)}`, () => addEntries(items))) closeTop(); };
  draw();
  openLayer("bottom", () => [head(`Copy ${meal.toLowerCase()} from`), picker, list, action]);
}

function openSaveMeal(meal, items) {
  const [nameL, nameI] = field("Name", { value: `My ${meal.toLowerCase()}`, autocomplete: "off", enterKeyHint: "done" });
  const error = h("p", { class: "error", role: "alert" });
  function saveMeal() {
    const name = nameI.value.trim();
    if (!name) { error.textContent = "Enter a name."; nameI.focus(); return; }
    const kept = items.map(({ id, ...rest }) => rest);
    if (change(`Saved ${name}`, () => { state.saved = [{ id: crypto.randomUUID(), name, items: kept }, ...state.saved.filter((s) => s.name !== name)]; })) closeTop();
  }
  openLayer("bottom", (layer) => {
    layer.opened = () => { nameI.focus(); nameI.select(); };
    return [head("Save as a meal"), h("p", { class: "note" }, `${items.length} ${items.length === 1 ? "food" : "foods"}, ${fmt(totals(items).kcal)} kcal. It appears under Meals when you add food.`),
      form(saveMeal, nameL, error, h("button", { class: "primary" }, "Save meal"))];
  });
}

function openSavedMeal(saved, meal, onAdded) {
  let factor = 1;
  const list = h("ul", { class: "rows" });
  const presets = h("div", { class: "presets", role: "group", "aria-label": "How much" });
  const action = h("button", { class: "primary" });
  const scaled = () => saved.items.map((e) => ({ ...e, qty: e.qty * factor }));
  function draw() {
    list.replaceChildren(...scaled().map((e) => h("li", { class: "line row" }, h("span", { class: "text" }, h("span", { class: "name" }, e.name), h("small", {}, amount(e))), h("span", { class: "kcal" }, fmt(nutrition(e).kcal)))));
    presets.replaceChildren(...[[0.5, "Half"], [1, "All of it"], [2, "Double"]].map(([v, label]) => h("button", { "aria-pressed": String(v === factor), onclick: () => { factor = v; draw(); } }, label)));
    action.textContent = `Add to ${meal}, ${fmt(totals(scaled()).kcal)} kcal`;
  }
  action.onclick = () => {
    if (change(`Added ${saved.name} to ${meal}`, () => addEntries(scaled().map((e) => ({ ...e, meal, id: crypto.randomUUID() }))))) { closeTop(); onAdded?.(); }
  };
  const remove = () => { if (change(`Deleted ${saved.name}`, () => { state.saved = state.saved.filter((s) => s.id !== saved.id); })) closeTop(); };
  draw();
  openLayer("bottom", () => [head(saved.name), list, presets, action, h("button", { class: "danger", onclick: remove }, "Delete saved meal")]);
}

// Finds the full food so its other portions are offered, falling back to what the entry stored.
function rowFor(e) {
  const known = state.custom.find((r) => r[0] === e.name && r[1] === e.src) || foodIndex.get(`${e.src}|${e.name}`);
  return known || [e.name, e.src, e.kcal, e.p, e.c, e.f, ["g", "oz"].includes(e.label) ? [] : [[e.label, e.grams]]];
}

function segmented(options, current, onPick, label, cls = "seg") {
  const group = h("div", { class: cls, role: "group", "aria-label": label });
  const draw = () => group.replaceChildren(...options.map(([value, text]) =>
    h("button", { type: "button", "aria-pressed": String(value === current), onclick: () => { current = value; onPick(value); draw(); } }, text)));
  draw();
  return group;
}
const mealPicker = (current, onPick) => segmented(MEALS.map((m) => [m, m]), current, onPick, "Meal");

const allFoods = () => [...state.custom.map(prepare), ...foods];
const favKey = (row) => `${row[1]}|${row[0]}`;
const skeleton = (n = 4) => Array.from({ length: n }, () => h("div", { class: "skel", "aria-hidden": "true" }, h("i", {}), h("i", {})));

// ——— Adding food ———

let lastTab = "recent";
function openSearch(meal) {
  const startIds = new Set((state.days[date] || []).map((e) => e.id));
  let recents = recentNames(state.days);
  const results = h("div", { class: "results" });
  const input = h("input", { type: "search", placeholder: "Search, or type 2 roti and dal", enterKeyHint: "search",
    autocomplete: "off", autocorrect: "off", "aria-label": "Search foods",
    oninput: () => { draw(); results.scrollTop = 0; },
    onkeydown: (e) => { if (e.key === "Enter") input.blur(); } });
  // Scrolling means the person is reading the list, so give it the room the keyboard was taking.
  results.addEventListener("touchmove", () => input.blur(), { passive: true });
  const bar = h("div", { class: "mealbar", hidden: true });
  const tabs = segmented([["recent", "Recent"], ["frequent", "Frequent"], ["favs", "Favourites"], ["meals", "Meals"]], lastTab, (t) => { lastTab = t; draw(); }, "Show", "seg tabs");

  const cleared = () => { input.value = ""; draw(); results.scrollTop = 0; };

  function foodRow(row, last = recents.get(row[0])) {
    last = last?.src === row[1] && last?.name === row[0] ? last : null;
    const [label, grams] = last ? [amount(last), last.grams * last.qty] : row[6][0] || ["100 g", 100];
    return h("div", { class: "foodline line" },
      h("button", { class: "row", onclick: () => openPortion(row, meal, { last, onAdded: cleared }) },
        h("span", { class: "text" }, h("span", { class: "name" }, row[0]), h("small", {}, `${label}, ${SOURCES[row[1]]}`)),
        h("span", { class: "kcal" }, fmt((row[2] * grams) / 100))),
      last && h("button", { class: "repeat", "aria-label": `Add ${amount(last)} of ${row[0]} to ${meal}`, onclick: () => {
        change(`Added ${row[0]} to ${meal}`, () => addEntries([makeEntry(row, meal, last.label, last.grams, last.qty)]));
      } }, icon("plus")));
  }

  function savedRow(saved) {
    const t = totals(saved.items);
    return h("div", { class: "foodline line" },
      h("button", { class: "row", onclick: () => openSavedMeal(saved, meal, cleared) },
        h("span", { class: "text" }, h("span", { class: "name" }, saved.name), h("small", {}, `${saved.items.length} ${saved.items.length === 1 ? "food" : "foods"}: ${saved.items.map((e) => e.name).join(", ")}`)),
        h("span", { class: "kcal" }, fmt(t.kcal))),
      h("button", { class: "repeat", "aria-label": `Add ${saved.name} to ${meal}`, onclick: () =>
        change(`Added ${saved.name} to ${meal}`, () => addEntries(saved.items.map((e) => ({ ...e, meal, id: crypto.randomUUID() })))) }, icon("plus")));
  }

  const empty = (title, body) => h("div", { class: "empty" }, h("b", {}, title), body);

  function browse() {
    if (lastTab === "meals") {
      const copy = h("button", { class: "copy", onclick: () => openCopyDay(meal) }, `Copy ${meal.toLowerCase()} from another day`);
      return [copy, ...state.saved.length ? state.saved.map(savedRow) : [empty("No saved meals yet", "Open a logged meal on the home screen and choose Save as a meal. Then it's one tap here.")]];
    }
    if (lastTab === "favs") {
      const rows = state.favs.map((k) => state.custom.find((r) => favKey(r) === k) || foodIndex.get(k)).filter(Boolean);
      if (!rows.length && !foodsLoaded && state.favs.length) return skeleton(3);
      return rows.length ? rows.map((r) => foodRow(r)) : [empty("No favourites yet", "Tap the star on any food to keep it here.")];
    }
    if (lastTab === "frequent") {
      const often = frequent(state.days, isoDate());
      return often.length ? often.map(({ entry }) => foodRow(rowFor(entry), entry)) : [empty("Nothing frequent yet", "Foods you log on two or more days this month show up here.")];
    }
    const rows = [...recents.values()].map(rowFor);
    return rows.length ? rows.map((r) => foodRow(r)) : [empty("Search for your first food", "Try roti, dal, banana or a brand like Amul. Or describe a whole meal.")];
  }

  function draw() {
    const q = input.value.trim();
    recents = recentNames(state.days);
    tabs.hidden = Boolean(q);
    const offline = foodsFailed ? h("p", { class: "error" }, "The food list has not downloaded. Connect to the internet and reopen CalTrack. Your own foods still work.") : null;
    if (!q) { results.replaceChildren(...[offline, ...browse()].filter(Boolean)); return; }
    // Typing a list of foods offers to log them all at once.
    const parts = parseMeal(q);
    const many = parts.length > 1 || (parts[0] && (parts[0].unit || /^\d|^(half|one|two|three|a|an) /.test(q)));
    const describe = many && h("button", { class: "describe-hint", onclick: () => openDescribe(meal, q, cleared) }, icon("text"),
      h("span", {}, h("b", {}, `Log ${parts.length > 1 ? `${parts.length} foods` : `“${q}”`}`), h("small", { class: "muted" }, " Review the amounts, then add them in one go")));
    const rows = search(allFoods(), many ? parts[0].query : q, new Set(recents.keys()));
    const loading = !foodsLoaded && !foodsFailed ? skeleton() : [];
    const none = !rows.length && foodsLoaded ? h("div", { class: "empty" }, h("b", {}, `No food matches “${q}”`), "Check the spelling, or ",
      h("button", { class: "link", onclick: () => openCustom(meal, q, cleared) }, "add it as your own food"), ".") : null;
    results.replaceChildren(...[offline, describe, ...rows.map((r) => foodRow(r)), ...loading, none].filter(Boolean));
  }

  function drawBar() {
    const added = (state.days[date] || []).filter((e) => !startIds.has(e.id));
    bar.hidden = !added.length;
    bar.replaceChildren(h("span", {}, `${added.length} added, ${fmt(totals(added).kcal)} kcal`),
      h("button", { class: "done", onclick: () => closeTop() }, "Done"));
  }

  draw();
  openLayer("full", (layer) => {
    layer.refresh = () => { draw(); drawBar(); };
    // The keyboard would cover the recent foods most people came to tap, so only raise it when there are none.
    layer.opened = () => { if (!recents.size) input.focus(); };
    return [head(date === isoDate() ? "Add food" : `Add food, ${dayName(date)}`),
      mealPicker(meal, (m) => { meal = m; draw(); }), input,
      h("div", { class: "actions" },
        h("button", { onclick: () => openDescribe(meal, "", cleared) }, "Describe a meal"),
        h("button", { onclick: () => openQuick(meal, cleared) }, "Quick add"),
        h("button", { onclick: () => openCustom(meal, input.value.trim(), cleared) }, "Create food")),
      tabs, results, bar];
  });
}

// Natural-language logging, worked out on the phone: the text is split into foods and amounts,
// each matched to the food list, and nothing is saved until the person has looked at it.
function openDescribe(meal, text, onAdded) {
  const area = h("textarea", { rows: 3, placeholder: "2 boiled eggs, 150 g chicken breast and a banana", value: text, autocomplete: "off", "aria-label": "What did you eat?", oninput: () => { clearTimeout(timer); timer = setTimeout(parse, 250); } });
  const list = h("ul", { class: "rows review" });
  const action = h("button", { class: "primary", onclick: submit });
  let timer, items = [], parsedWithFoods = false;
  const recentSet = () => new Set(recentNames(state.days).keys());
  const entryFor = (row, part) => { const [label, grams, qty] = portionFor(row, part); return makeEntry(row, meal, label, grams, qty); };

  function parse() {
    // Lines already reviewed keep their corrections while the rest of the text is edited.
    const before = new Map(items.map((i) => [i.part.text, i]));
    parsedWithFoods = foodsLoaded;
    items = parseMeal(area.value).map((part) => {
      const kept = before.get(part.text);
      if (kept && (kept.rows.length || !foodsLoaded)) return kept;
      const rows = search(allFoods(), part.query, recentSet(), 6);
      return { part, rows, entry: rows[0] ? entryFor(rows[0], part) : null };
    });
    draw();
  }

  function draw() {
    const found = items.filter((i) => i.entry);
    list.replaceChildren(...!foodsLoaded && !foodsFailed && items.length ? skeleton(items.length) : items.map((item, index) => {
      const remove = h("button", { class: "iconbtn", "aria-label": `Remove ${item.part.text}`, onclick: () => { items.splice(index, 1); draw(); } }, icon("close"));
      if (!item.entry) return h("li", { class: "line" }, h("div", { class: "text miss" }, `No match for “${item.part.query}”. Try other words.`), remove);
      const n = nutrition(item.entry);
      const pick = h("select", { "aria-label": `Food for ${item.part.text}`, onchange: () => { item.entry = entryFor(item.rows[+pick.value], item.part); draw(); } },
        item.rows.map((r, i) => h("option", { value: i }, r[0])));
      pick.value = Math.max(0, item.rows.findIndex((r) => r[0] === item.entry.name));
      return h("li", { class: "line" }, h("div", { class: "text" }, pick,
        h("button", { class: "amount", "aria-label": `Change amount of ${item.entry.name}`, onclick: () => openPortion(rowFor(item.entry), meal, { entry: item.entry, pick: (made) => { item.entry = made; draw(); } }) },
          h("span", {}, amount(item.entry), ` · ${fmt(n.p)} g protein`), h("b", {}, `${fmt(n.kcal)} kcal`))), remove);
    }));
    action.disabled = !found.length;
    action.textContent = found.length ? `Add ${found.length} to ${meal}, ${fmt(totals(found.map((i) => i.entry)).kcal)} kcal` : "Add to diary";
  }

  function submit() {
    const entries = items.filter((i) => i.entry).map((i) => ({ ...i.entry, meal, id: crypto.randomUUID() }));
    if (entries.length && change(`Added ${entries.length} ${entries.length === 1 ? "food" : "foods"} to ${meal}`, () => addEntries(entries))) { closeTop(); onAdded?.(); }
  }

  parse();
  openLayer("full", (layer) => {
    layer.refresh = () => { if (!parsedWithFoods && foodsLoaded) { items = []; parse(); } };
    layer.opened = () => { if (!text) area.focus(); };
    return [head("Describe a meal"), mealPicker(meal, (m) => { meal = m; items.forEach((i) => { if (i.entry) i.entry.meal = m; }); draw(); }), area,
      h("p", { class: "note" }, "Separate foods with commas or “and”. Amounts can be counts, grams or cups. Matches are a best guess, so check each one."),
      h("div", { class: "results" }, list), action];
  });
}

function openPortion(row, meal, { entry = null, last = null, onAdded = null, pick = null } = {}) {
  const [name, src, kcal] = row;
  const custom = src === "C" || src === "Q";
  const from = entry || last;
  const portions = [...row[6]];
  if (!custom) portions.push(state.units.food === "oz" ? ["oz", OZ] : ["g", 1]);
  let chosen = (from && portions.find(([l]) => l === from.label)) || (from ? [from.label, from.grams] : portions[0]);
  if (from && !portions.includes(chosen)) portions.unshift(chosen);
  const qtyFor = (portion) => (portion[0] === "g" ? 100 : portion[0] === "oz" ? 3 : 1);
  const goal = targets();

  const qty = h("input", { type: "number", inputMode: "decimal", min: "0", step: "any", enterKeyHint: "done", value: from ? +from.qty.toFixed(2) : qtyFor(chosen), "aria-label": "Amount", oninput: draw,
    onkeydown: (e) => { if (e.key === "Enter") qty.blur(); } });
  const result = h("div", { class: "result", "aria-live": "polite" });
  const chips = h("div", { class: "portions", role: "group", "aria-label": "Portion" });
  const presets = h("div", { class: "presets", role: "group", "aria-label": "Common amounts" });
  const action = h("button", { class: "primary", onclick: submit });
  const amountNow = () => { const v = parseFloat(qty.value); return v > 0 && Number.isFinite(v) ? v : 0; };
  const unitName = (l) => (l === "g" ? "Grams" : l === "oz" ? "Ounces" : l);

  function drawChips() {
    // Many portions become a dropdown, so the sheet keeps its height and never needs scrolling.
    if (portions.length > 3) {
      const select = h("select", { "aria-label": "Portion", onchange: () => { chosen = portions[+select.value]; qty.value = qtyFor(chosen); draw(); } },
        portions.map((portion, i) => h("option", { value: i }, unitName(portion[0]))));
      select.value = portions.indexOf(chosen);
      chips.replaceChildren(select);
      return;
    }
    chips.replaceChildren(...portions.map((portion) => h("button", {
      "aria-pressed": String(portion === chosen),
      onclick: () => { chosen = portion; qty.value = qtyFor(portion); drawChips(); draw(); },
    }, unitName(portion[0]))));
  }

  function draw() {
    const n = nutrition(makeEntry(row, meal, chosen[0], chosen[1], amountNow(), "preview"));
    result.replaceChildren(h("b", {}, `${fmt(n.kcal)} kcal`), h("div", { class: "mrow" }, MACROS.map(([k, label, cls]) =>
      h("span", {}, h("i", { class: "dot", style: `background:var(--${cls})` }), `${label} ${fmt(n[k])} g `, k === "p" && goal.p > 0 && h("em", {}, `(${fmt((n.p / goal.p) * 100)}% of daily)`)))));
    const values = chosen[0] === "g" ? [[50, "50 g"], [100, "100 g"], [150, "150 g"], [200, "200 g"], [250, "250 g"]]
      : chosen[0] === "oz" ? [[1, "1 oz"], [2, "2 oz"], [4, "4 oz"], [6, "6 oz"], [8, "8 oz"]] : [[0.5, "½"], [1, "1"], [1.5, "1½"], [2, "2"], [3, "3"]];
    presets.replaceChildren(...values.map(([value, label]) => h("button", { "aria-pressed": String(amountNow() === value), onclick: () => { qty.value = value; draw(); } }, label)));
    action.disabled = !amountNow();
    action.textContent = pick ? "Use this amount" : entry ? "Save changes" : `Add to ${meal}`;
  }

  function step(delta) {
    const size = chosen[0] === "g" ? 10 : 0.5;
    qty.value = Math.max(size, +(amountNow() + delta * size).toFixed(2));
    draw();
  }

  function submit() {
    const made = makeEntry(row, meal, chosen[0], chosen[1], amountNow(), entry?.id);
    if (pick) { pick(made); closeTop(); return; }
    const done = change(entry ? `Updated ${name}` : `Added ${name} to ${meal}`, () => {
      const list = state.days[date] ||= [];
      if (entry) list[list.findIndex((e) => e.id === entry.id)] = made;
      else list.push(made);
    });
    if (done) { closeTop(); onAdded?.(); }
  }

  function removeEntry() {
    const done = change(`Deleted ${name}`, () => {
      state.days[date] = state.days[date].filter((e) => e.id !== entry.id);
      if (!state.days[date].length) delete state.days[date];
    });
    if (done) closeTop();
  }

  function forgetFood() {
    state.custom = state.custom.filter((r) => r[0] !== name);
    state.favs = state.favs.filter((k) => k !== favKey(row));
    save();
    closeTop();
    layers.forEach((l) => l.refresh?.());
  }

  const isFav = () => state.favs.includes(favKey(row));
  const star = src !== "Q" && h("button", { class: "iconbtn star", "aria-label": "Favourite", "aria-pressed": String(isFav()), onclick: () => {
    state.favs = isFav() ? state.favs.filter((k) => k !== favKey(row)) : [favKey(row), ...state.favs];
    save();
    buzz();
    star.setAttribute("aria-pressed", String(isFav()));
    layers.forEach((l) => l.refresh?.());
  } }, icon("star"));

  drawChips();
  draw();
  openLayer("bottom", () => [
    head(name, star),
    !custom && h("p", { class: "note" }, `${SOURCES[src] || "USDA"}, ${fmt(kcal)} kcal per 100 g.${src === "I" ? " Worked out from a recipe, so treat it as a guide." : ""}${src === "P" ? " Added by volunteers, so check it against the pack." : ""}`),
    entry && !pick && mealPicker(meal, (m) => { meal = m; draw(); }),
    chips,
    h("div", { class: "stepper" },
      h("button", { "aria-label": "Less", onclick: () => step(-1) }, icon("minus")),
      qty,
      h("button", { "aria-label": "More", onclick: () => step(1) }, icon("plus"))),
    presets,
    result,
    action,
    entry && !pick && h("button", { class: "danger", onclick: removeEntry }, "Delete from diary"),
    src === "C" && !entry && h("button", { class: "danger", onclick: forgetFood }, "Remove from my foods"),
  ]);
}

const field = (label, props) => { const input = h("input", props); return [h("label", {}, label, input), input]; };
const numberField = (label, value, extra = {}) => field(label, { type: "number", inputMode: "decimal", min: "0", enterKeyHint: "next", value: value ?? "", ...extra });

function choice(label, options, value) {
  const select = h("select", {}, options.map((o) => h("option", { value: o }, o)));
  if (options.includes(value)) select.value = value;
  return [h("label", {}, label, select), select];
}

// A real form, so the keyboard's Go/Done key submits it.
const form = (onSubmit, ...kids) => h("form", { class: "stack", noValidate: true, onsubmit: (e) => { e.preventDefault(); onSubmit(); } }, ...kids);

function openQuick(meal, onAdded) {
  const [kcalL, kcalI] = numberField("Calories", "", { enterKeyHint: "done" });
  const [pL, pI] = numberField("Protein, g, optional", "");
  const [nameL, nameI] = field("What was it? Optional", { autocomplete: "off", enterKeyHint: "done" });
  const error = h("p", { class: "error", role: "alert" });
  function add() {
    const kcal = parseFloat(kcalI.value);
    const p = Math.max(0, parseFloat(pI.value) || 0);
    if (!(kcal > 0 && kcal <= 20000)) { error.textContent = "Enter the calories, from 1 to 20,000."; kcalI.focus(); return; }
    if (p * 4 > kcal * 1.05) { error.textContent = "That's more protein than the calories allow. Check both numbers."; pI.focus(); return; }
    const row = [nameI.value.trim() || "Quick add", "Q", kcal, p, 0, 0, []];
    if (change(`Added ${row[0]} to ${meal}`, () => addEntries([makeEntry(row, meal, "estimate", 100, 1)]))) { closeTop(); onAdded?.(); }
  }
  openLayer("bottom", (layer) => {
    layer.opened = () => kcalI.focus();
    return [head("Quick add calories"), form(add, h("div", { class: "grid2" }, kcalL, pL), nameL, error, h("button", { class: "primary" }, `Add to ${meal}`))];
  });
}

function openCustom(meal, name, onAdded) {
  const [nameL, nameI] = field("Name", { value: name, autocomplete: "off", enterKeyHint: "next" });
  const [servingL, servingI] = field("Serving name", { value: "1 serving", autocomplete: "off", enterKeyHint: "next" });
  const [gramsL, gramsI] = numberField("Serving weight, g, optional", "");
  const [kcalL, kcalI] = numberField("Calories per serving", "");
  const [pL, pI] = numberField("Protein, g", "");
  const [cL, cI] = numberField("Carbs, g", "");
  const [fL, fI] = numberField("Fat, g", "", { enterKeyHint: "done" });
  const error = h("p", { class: "error", role: "alert" });

  async function create() {
    const num = (input) => Math.max(0, parseFloat(input.value) || 0);
    if (!nameI.value.trim()) { error.textContent = "Enter a name."; nameI.focus(); return; }
    if (!(parseFloat(kcalI.value) >= 0)) { error.textContent = "Enter the calories per serving."; kcalI.focus(); return; }
    const title = nameI.value.trim();
    const grams = num(gramsI);
    const label = servingI.value.trim() || "1 serving";
    // With a weight the food scales by grams like any other; without one, a serving counts as 100 "grams".
    const per = grams > 0 ? 100 / grams : 1;
    const values = [num(kcalI), num(pI), num(cI), num(fI)].map((v) => Math.round(v * per * 100) / 100);
    const row = [title, "C", ...values, [[label, grams > 0 ? grams : 100]]];
    state.custom = [row, ...state.custom.filter((r) => r[0] !== title)];
    if (!save()) return;
    await closeTop();
    openPortion(row, meal, { onAdded });
  }

  openLayer("full", (layer) => {
    layer.opened = () => (name ? kcalI : nameI).focus();
    return [head("Create a food"), form(create, nameL, h("div", { class: "grid2" }, servingL, gramsL), kcalL, h("div", { class: "grid2" }, pL, cL), fL,
      h("p", { class: "note" }, "Copy the numbers from the pack's per-serving column. Add the serving weight to log it in grams too."), error, h("button", { class: "primary" }, "Save food"))];
  });
}

// ——— Exercise and weight ———

function openBurned() {
  const list = h("ul", { class: "rows" });
  const [nameL, nameI] = field("Activity", { autocomplete: "off", placeholder: "Walk, gym, cricket", enterKeyHint: "next" });
  const [kcalL, kcalI] = numberField("Calories burned", "", { enterKeyHint: "done" });
  const error = h("p", { class: "error", role: "alert" });
  function draw() {
    const items = state.burned[date] || [];
    list.replaceChildren(...items.map((b) => h("li", { class: "line row" },
      h("span", { class: "text" }, h("span", { class: "name" }, b.name)), h("span", { class: "kcal" }, fmt(b.kcal)),
      h("button", { class: "iconbtn", "aria-label": `Delete ${b.name}`, onclick: () => change(`Deleted ${b.name}`, () => {
        state.burned[date] = state.burned[date].filter((x) => x.id !== b.id);
        if (!state.burned[date].length) delete state.burned[date];
      }) }, icon("close")))));
  }
  function add() {
    const kcal = parseFloat(kcalI.value);
    if (!(kcal > 0 && kcal <= 5000)) { error.textContent = "Enter the calories, from 1 to 5,000."; kcalI.focus(); return; }
    const name = nameI.value.trim() || "Exercise";
    if (change(`Logged ${name}`, () => { (state.burned[date] ||= []).push({ id: crypto.randomUUID(), name, kcal }); })) { nameI.value = kcalI.value = ""; error.textContent = ""; }
  }
  draw();
  openLayer("bottom", (layer) => {
    layer.refresh = draw;
    return [head(`Exercise, ${dayName(date)}`),
      h("p", { class: "note" }, "Calories you burn are added to the day's target. Watches and machines tend to overestimate, so consider logging about half of what they say."),
      list, form(add, h("div", { class: "grid2" }, nameL, kcalL), error, h("button", { class: "primary" }, "Log exercise"))];
  });
}

function openWeight() {
  const unit = weightUnit();
  const series = weightTrend(state.weights);
  const existing = state.weights[date];
  const start = existing ?? series.at(-1)?.weight ?? state.profile?.weight;
  const [wL, wI] = numberField(`Weight, ${unit}`, start ? +toUnit(start, unit).toFixed(1) : "", { step: "0.1", enterKeyHint: "done" });
  const error = h("p", { class: "error", role: "alert" });
  const recent = series.slice(-5).reverse();
  function saveWeight() {
    const kg = fromUnit(parseFloat(wI.value), unit);
    if (!(kg >= 25 && kg <= 350)) { error.textContent = `Enter a weight from ${fmt(toUnit(25, unit))} to ${fmt(toUnit(350, unit))} ${unit}.`; wI.focus(); return; }
    if (change(`Weight saved for ${dayName(date).toLowerCase()}`, () => { state.weights = { ...state.weights, [date]: Math.round(kg * 100) / 100 }; })) closeTop();
  }
  const remove = () => { if (change("Weight deleted", () => { const { [date]: _, ...rest } = state.weights; state.weights = rest; })) closeTop(); };
  openLayer("bottom", (layer) => {
    layer.opened = () => { wI.focus(); wI.select(); };
    return [head(`Weight, ${dayName(date)}`),
      form(saveWeight, wL, error,
        h("p", { class: "note" }, "Weigh in the morning, after the bathroom and before eating. Daily numbers swing with water and salt; the trend is what counts."),
        h("button", { class: "primary" }, existing ? "Save changes" : "Save weight")),
      existing && h("button", { class: "danger", onclick: remove }, "Delete this weigh-in"),
      recent.length > 0 && h("ul", { class: "rows" }, recent.map((s) => h("li", { class: "line row" },
        h("span", { class: "text" }, dayName(s.date)), h("span", { class: "muted" }, `trend ${showWeight(s.trend)}`), h("b", {}, showWeight(s.weight))))),
    ];
  });
}

// ——— Trends ———

const RANGES = { 7: "7 days", 30: "30 days", 90: "90 days", 365: "Year" };
let trendRange = 30, trendMetric = "kcal";

// Short ranges show days; longer ones average logged days into weeks or months so bars stay readable.
function buckets(range, today) {
  const dates = datesEnding(today, range);
  const size = range <= 30 ? 1 : range <= 90 ? 7 : 0;
  const groups = [];
  for (const d of dates) {
    const key = size === 1 ? d : size === 7 ? Math.floor(daysBetween(dates[0], d) / 7) : d.slice(0, 7);
    if (groups.at(-1)?.key !== key) groups.push({ key, dates: [] });
    groups.at(-1).dates.push(d);
  }
  return groups.map((g) => {
    const done = g.dates.filter((d) => state.days[d]?.length && (d !== today || size === 1));
    const value = (k) => (done.length ? done.reduce((a, d) => a + totals(state.days[d])[k], 0) / done.length : 0);
    const first = g.dates[0], last = g.dates.at(-1);
    const label = size === 1 ? dayName(first) : size === 7 ? `${shortDate(first)} – ${shortDate(last)}` : new Date(`${first}T12:00`).toLocaleDateString("en-IN", { month: "long", year: "numeric" });
    return { dates: g.dates, label, logged: done.length, partial: last === today && size === 1, kcal: value("kcal"), p: value("p"), c: value("c"), f: value("f"),
      goal: (size === 1 ? burnedOn(first) : 0) + state.goal };
  });
}

function barChart(groups, metric, range) {
  const goal = targets();
  const [unit, color, target] = metric === "kcal" ? ["kcal", "kcal", goal.kcal] : ["g", MACROS.find(([k]) => k === metric)[2], goal[metric]];
  const top = Math.max(target, ...groups.map((g) => g[metric])) * 1.12 || 1;
  const per = range <= 30 ? "" : range <= 90 ? " a day that week" : " a day that month";
  const readout = h("div", { class: "readout", "aria-live": "polite" });
  const idle = () => {
    const logged = groups.filter((g) => g.logged && !g.partial);
    const avg = logged.length ? logged.reduce((a, g) => a + g[metric], 0) / logged.length : 0;
    readout.replaceChildren(h("b", {}, logged.length ? `${fmt(avg)} ${unit} average` : "No finished days logged"), `Target ${fmt(target)} ${unit}. Tap a bar for details.`);
    plot.classList.remove("picking");
  };
  const show = (i) => {
    const g = groups[i];
    plot.querySelectorAll(".bar").forEach((b, j) => b.classList.toggle("sel", j === i));
    plot.classList.add("picking");
    readout.replaceChildren(h("b", {}, g.logged ? `${fmt(g[metric])} ${unit}${per}${g.partial ? " so far" : ""}` : "Not logged"), g.label);
  };
  const plot = h("div", { class: `plot${groups.length > 40 ? " dense" : ""}`, role: "img",
    "aria-label": `${metric === "kcal" ? "Calories" : MACROS.find(([k]) => k === metric)[1]} by ${range <= 30 ? "day" : range <= 90 ? "week" : "month"}` },
  h("div", { class: "goal-line", style: `bottom:${(target / top) * 100}%` }, h("span", {}, fmt(target))),
  groups.map((g, i) => h("div", { class: `bar${g.logged ? "" : " empty"}${g.partial ? " partial" : ""}`, style: `--c:var(--${color})` },
    h("i", { style: `height:${(g[metric] / top) * 100}%` }))));
  // Pointer anywhere over the plot picks the nearest bar, so thin bars are still easy to hit.
  const pickAt = (e) => {
    const box = plot.getBoundingClientRect();
    show(Math.max(0, Math.min(groups.length - 1, Math.floor(((e.clientX - box.left) / box.width) * groups.length))));
  };
  plot.addEventListener("pointerdown", pickAt);
  plot.addEventListener("pointermove", (e) => { if (e.pointerType === "mouse" || e.buttons) pickAt(e); });
  plot.addEventListener("pointerleave", (e) => { if (e.pointerType === "mouse") idle(); });
  idle();
  const ends = [groups[0], groups.at(-1)].map((g) => (range <= 30 ? shortDate(g.dates[0]) : g.label.split(" – ")[0]));
  return h("div", { class: "chart" }, readout, plot, h("div", { class: "axis" }, h("span", {}, ends[0]), h("span", {}, range === 7 ? "Today" : ends[1])));
}

function weightChart(range, today, width) {
  const from = datesEnding(today, range)[0];
  const all = weightTrend(state.weights);
  const series = all.filter((s) => s.date >= from);
  const unit = weightUnit();
  const target = state.profile?.target;
  const readout = h("div", { class: "readout", "aria-live": "polite" });
  if (series.length < 2) {
    return h("div", { class: "empty" }, h("b", {}, series.length ? "One weigh-in so far" : "No weigh-ins in this range"), "Weigh in a few times a week and the trend line appears here.");
  }
  const H = 170, padL = 34, padB = 18, padT = 8;
  const vals = series.flatMap((s) => [s.weight, s.trend]).map((v) => toUnit(v, unit));
  const t = target ? toUnit(target, unit) : null;
  let lo = Math.min(...vals), hi = Math.max(...vals);
  const showTarget = t !== null && t >= lo - (hi - lo) && t <= hi + (hi - lo); // only when it won't flatten the line
  if (showTarget) { lo = Math.min(lo, t); hi = Math.max(hi, t); }
  const padV = Math.max(0.5, (hi - lo) * 0.12);
  lo -= padV; hi += padV;
  const span = Math.max(1, daysBetween(from, today));
  const x = (d) => padL + (daysBetween(from, d) / span) * (width - padL - 4);
  const y = (v) => padT + (1 - (toUnit(v, unit) - lo) / (hi - lo)) * (H - padT - padB);
  // Round-numbered gridlines: steps of 0.2, 0.5, 1, 2 or 5 units, whichever gives three or four lines.
  const step = [0.2, 0.5, 1, 2, 5, 10].find((s) => (hi - lo) / s <= 4) || 20;
  const ticks = Array.from({ length: 6 }, (_, i) => (Math.ceil(lo / step) + i) * step).filter((v) => v <= hi);
  const cursor = svg("line", { class: "cursor", y1: padT, y2: H - padB, visibility: "hidden" });
  const points = series.map((s) => svg("circle", { class: "pt", cx: x(s.date), cy: y(s.weight), r: series.length > 60 ? 2 : 3.5 }));
  const chart = svg("svg", { viewBox: `0 0 ${width} ${H}`, role: "img", "aria-label": `Weight trend from ${showWeight(series[0].trend)} to ${showWeight(series.at(-1).trend)}` },
    ...ticks.map((v) => svg("line", { class: "grid", x1: padL, x2: width, y1: y(fromUnit(v, unit)), y2: y(fromUnit(v, unit)) })),
    ...ticks.map((v) => { const tx = svg("text", { class: "tick", x: 0, y: y(fromUnit(v, unit)) + 4 }); tx.textContent = v.toFixed(step < 1 ? 1 : 0); return tx; }),
    showTarget ? svg("line", { class: "target", x1: padL, x2: width, y1: y(target), y2: y(target) }) : "",
    cursor, ...points,
    svg("polyline", { class: "trend", points: series.map((s) => `${x(s.date)},${y(s.trend)}`).join(" ") }));
  const idle = () => {
    readout.replaceChildren(h("b", {}, `Trend ${showWeight(series.at(-1).trend)}`), `${series.length} weigh-ins. Dots are weigh-ins, the line is the trend.`);
    cursor.setAttribute("visibility", "hidden");
    points.forEach((p) => p.classList.remove("sel"));
  };
  const pickAt = (e) => {
    const box = chart.getBoundingClientRect();
    const px = ((e.clientX - box.left) / box.width) * width;
    let best = 0;
    series.forEach((s, i) => { if (Math.abs(x(s.date) - px) < Math.abs(x(series[best].date) - px)) best = i; });
    const s = series[best];
    points.forEach((p, i) => p.classList.toggle("sel", i === best));
    cursor.setAttribute("x1", x(s.date)); cursor.setAttribute("x2", x(s.date)); cursor.setAttribute("visibility", "visible");
    readout.replaceChildren(h("b", {}, showWeight(s.weight)), `${dayName(s.date)}, trend ${showWeight(s.trend)}`);
  };
  chart.addEventListener("pointerdown", pickAt);
  chart.addEventListener("pointermove", (e) => { if (e.pointerType === "mouse" || e.buttons) pickAt(e); });
  chart.addEventListener("pointerleave", (e) => { if (e.pointerType === "mouse") idle(); });
  idle();
  return h("div", { class: "chart wchart" }, readout, chart, h("div", { class: "legend" },
    h("span", {}, h("i", { style: "border-top:2px solid var(--ink)" }), "Trend"),
    h("span", {}, h("i", { style: "height:8px;width:8px;border-radius:50%;border:1.5px solid var(--muted)" }), "Weigh-in"),
    showTarget && h("span", {}, h("i", { style: "border-top:2px dashed var(--good)" }), `Target ${showWeight(target)}`)));
}

const tile = (label, value, small, note) => h("div", { class: "tile" }, h("span", {}, label), h("b", {}, value, small && h("small", {}, ` ${small}`)), note && h("em", {}, note));
const signed = (n, unit) => `${n > 0 ? "+" : "−"}${fmt(Math.abs(n))}${unit}`;

function openTrends() {
  const body = h("div", { class: "stack" });
  const ranges = segmented(Object.entries(RANGES).map(([k, v]) => [+k, v]), trendRange, (r) => { trendRange = r; draw(); }, "Range");
  function draw() {
    const today = isoDate();
    const goal = targets();
    const range = trendRange;
    const dates = datesEnding(today, range);
    const now = summarize(state.days, dates, goal, today, state.burned);
    const prev = summarize(state.days, datesEnding(shiftDate(dates[0], -1), range), goal, today, state.burned);
    const nutritionPart = now ? [
      h("div", { class: "tiles" },
        tile("Average intake", fmt(now.kcal), "kcal", prev ? `${signed(now.kcal - prev.kcal, "")} vs previous ${RANGES[range].toLowerCase()}` : `Target ${fmt(now.goal)}`),
        tile("Average protein", fmt(now.p), "g", prev ? `${signed(now.p - prev.p, " g")} vs previous` : `Target ${fmt(goal.p)} g`),
        tile("Protein target hit", `${now.proteinHit}`, `of ${now.logged} days`, `${fmt(goal.p)} g or more`),
        tile("Calories on target", `${now.onTarget}`, `of ${now.logged} days`, "Within 10% of the day's target")),
      h("ul", { class: "facts" },
        h("li", {}, Math.abs(now.kcal - now.goal) < 25 ? `Your average intake was right on your ${fmt(now.goal)} kcal target.`
          : `Your average intake was ${fmt(Math.abs(now.kcal - now.goal))} kcal ${now.kcal < now.goal ? "below" : "above"} your target.`),
        h("li", {}, `Carbs averaged ${fmt(now.c)} g (target ${fmt(goal.c)} g) and fat ${fmt(now.f)} g (target ${fmt(goal.f)} g).`),
        now.logged < range - 1 && h("li", {}, `${now.logged} of the ${range - 1} finished days are logged. Averages only count logged days.`)),
    ] : [h("div", { class: "empty" }, h("b", {}, "No finished days to show yet"), "Trends start once you've logged a full day. Today counts from tomorrow.")];

    const chartPart = h("section", {}, h("h3", {}, "Intake"),
      segmented([["kcal", "Calories"], ["p", "Protein"], ["c", "Carbs"], ["f", "Fat"]], trendMetric, (m) => { trendMetric = m; draw(); }, "Nutrient", "seg tabs"),
      barChart(buckets(range, today), trendMetric, range));

    const series = weightTrend(state.weights);
    const last = series.at(-1);
    const rate = weeklyRate(series, today);
    const target = state.profile?.target;
    const eta = last && weeksToTarget(last.trend, target, rate);
    const weekly = series.filter((s) => s.date > shiftDate(today, -7));
    const tdee = maintenance(state.days, state.weights, today);
    const weightSection = h("section", {}, h("div", { class: "card-head" }, h("h3", {}, "Weight"), h("button", { class: "link", onclick: openWeight }, `Log for ${dayName(date).toLowerCase()}`)),
      last && h("div", { class: "tiles" },
        tile("Trend", toUnit(last.trend, weightUnit()).toFixed(1), weightUnit(), rate === null ? "Needs a week of weigh-ins for a rate" : `${rate > 0 ? "+" : "−"}${showWeight(Math.abs(rate), 2)} a week`),
        tile("This week's average", weekly.length ? toUnit(weekly.reduce((a, s) => a + s.weight, 0) / weekly.length, weightUnit()).toFixed(1) : "–", weekly.length ? weightUnit() : "", `${weekly.length} weigh-ins in 7 days`),
        target ? tile("To target", fmt1(Math.abs(toUnit(last.trend - target, weightUnit()))), weightUnit(), eta ? `About ${Math.ceil(eta)} weeks at this rate` : `Target ${showWeight(target)}`) : null,
        tdee ? tile("Estimated maintenance", fmt(tdee), "kcal", "From your intake and weight trend, last 4 weeks") : null),
      h("div", { class: "wslot" }),
      h("p", { class: "note" }, "The trend smooths out daily swings from water, salt and food, so a heavy morning isn't read as fat gained."));

    body.replaceChildren(h("section", {}, ranges, ...nutritionPart), chartPart, weightSection,
      h("section", {}, h("p", { class: "note" }, "Targets and estimates come from formulas and food tables, so treat them as a starting point. If your weight trend isn't moving the way you want after 2–3 weeks, adjust your calorie target by 100–200 kcal.")));
    requestAnimationFrame(() => { const slot = body.querySelector(".wslot"); if (slot) slot.replaceChildren(weightChart(range, today, Math.max(240, slot.clientWidth))); });
  }
  openLayer("full", (layer) => {
    layer.refresh = draw;
    layer.opened = draw;
    return [head("Trends"), body];
  });
}

// ——— Goals and settings ———

const kgField = (label, kg, unit) => numberField(`${label}, ${unit}`, kg ? +toUnit(kg, unit).toFixed(1) : "", { step: "0.1" });

function openGoal(firstRun = false) {
  const saved = state.profile || {};
  let unit = weightUnit();
  const [sexL, sexI] = choice("Sex", ["Male", "Female"], saved.sex);
  const [ageL, ageI] = numberField("Age", saved.age, { inputMode: "numeric", oninput: draw });
  const [heightL, heightI] = numberField("Height, cm", saved.height, { inputMode: "numeric", oninput: draw });
  let [weightL, weightI] = kgField("Weight", saved.weight, unit);
  let [targetL, targetI] = kgField("Target weight", saved.target, unit);
  const [activityL, activityI] = choice("Activity", Object.keys(ACTIVITY), saved.activity ?? "Light, 1–3 workouts a week");
  const [paceL, paceI] = choice("Goal", Object.keys(PACE), saved.pace ?? "Stay the same");
  const weights = h("div", { class: "grid2" }, weightL, targetL);
  const result = h("div", { class: "suggest", "aria-live": "polite" });
  const use = h("button", { class: "primary" });
  sexI.onchange = activityI.onchange = paceI.onchange = draw;
  weightI.oninput = targetI.oninput = draw;
  const profile = () => ({ sex: sexI.value, age: +ageI.value, height: +heightI.value, weight: fromUnit(+weightI.value, unit),
    target: targetI.value ? fromUnit(+targetI.value, unit) : undefined, activity: activityI.value, pace: paceI.value });
  const units = segmented([["kg", "Kilograms"], ["lb", "Pounds"]], unit, (u) => {
    const keep = profile();
    unit = u;
    [weightL, weightI] = kgField("Weight", keep.weight || null, unit);
    [targetL, targetI] = kgField("Target weight", keep.target, unit);
    weightI.oninput = targetI.oninput = draw;
    weights.replaceChildren(weightL, targetL);
    draw();
  }, "Weight unit");

  function draw() {
    const t = suggestTargets(profile());
    result.replaceChildren(...t
      ? [h("div", { class: "tiles" }, tile("Calories", fmt(t.kcal), "kcal"), tile("Protein", fmt(t.p), "g"), tile("Carbs", fmt(t.c), "g"), tile("Fat", fmt(t.f), "g")),
        h("p", { class: "note" }, "An estimate from the Mifflin-St Jeor formula, never below 1,200 kcal. Protein is set by body weight. Bodies differ, so adjust after 2–3 weeks if your weight trend isn't heading where you want.")]
      : [h("p", { class: "note" }, "Enter your age, height and weight to see suggested targets.")]);
    use.disabled = !t;
    use.textContent = t ? "Use these targets" : "Use these targets";
  }

  function apply() {
    const t = suggestTargets(profile());
    if (!t) { ageI.focus(); return; }
    state.goal = t.kcal;
    state.macros = { p: t.p, c: t.c, f: t.f };
    state.profile = profile();
    state.units = { ...state.units, weight: unit };
    if (save()) { closeAll(); render(); toast("Targets updated"); }
  }

  draw();
  openLayer("full", () => [head(firstRun ? "Set up your targets" : "Work out my targets"),
    form(apply, firstRun && h("p", { class: "note" }, "A few details give you calorie and protein targets. Everything stays on this phone."),
      units, h("div", { class: "grid2" }, sexL, ageL), heightL, weights, activityL, paceL, result, use,
      firstRun && h("button", { type: "button", class: "link skip", onclick: () => closeTop() }, `Skip and use ${fmt(state.goal)} kcal for now`))]);
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
  const goal = targets();
  const [kcalL, kcalI] = numberField("Calories", goal.kcal, { inputMode: "numeric", oninput: () => drawSum() });
  const [pL, pI] = numberField("Protein, g", goal.p, { inputMode: "numeric", oninput: () => drawSum() });
  const [cL, cI] = numberField("Carbs, g", goal.c, { inputMode: "numeric", oninput: () => drawSum() });
  const [fL, fI] = numberField("Fat, g", goal.f, { inputMode: "numeric", enterKeyHint: "done", oninput: () => drawSum() });
  const [tL, tI] = kgField("Target weight", state.profile?.target, weightUnit());
  const sum = h("p", { class: "note", "aria-live": "polite" });
  const status = h("p", { class: "error", role: "status" });
  const picker = h("input", { type: "file", accept: "application/json,.json", hidden: true, onchange: restore });

  function drawSum() {
    const macroKcal = (+pI.value || 0) * 4 + (+cI.value || 0) * 4 + (+fI.value || 0) * 9;
    const diff = macroKcal - (+kcalI.value || 0);
    sum.textContent = `Your macros add up to ${fmt(macroKcal)} kcal${Math.abs(diff) > 50 ? `, ${fmt(Math.abs(diff))} ${diff > 0 ? "more" : "less"} than your calorie target` : ", which matches your calorie target"}.`;
  }

  async function restore() {
    const file = picker.files[0];
    if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      if (!validBackup(data)) throw new Error();
      const days = Object.keys(data.days).length;
      if (!confirm(`Replace everything in CalTrack with this backup of ${days} days?`)) return;
      state = upgrade({ ...data, onboarded: true });
      save();
      render();
      closeAll();
    } catch {
      status.textContent = "That file is not a CalTrack backup. Nothing was changed.";
    } finally {
      picker.value = "";
    }
  }

  function saveTargets() {
    const kcal = Math.round(parseFloat(kcalI.value));
    const [p, c, f] = [pI, cI, fI].map((i) => Math.round(parseFloat(i.value)));
    if (!(kcal >= 500 && kcal <= 10000)) { status.textContent = "Enter a calorie target from 500 to 10,000."; kcalI.focus(); return; }
    if (![p, c, f].every((v) => v >= 0 && v <= 1000)) { status.textContent = "Enter protein, carbs and fat in grams, from 0 to 1,000."; pI.focus(); return; }
    const target = tI.value ? fromUnit(parseFloat(tI.value), weightUnit()) : undefined;
    if (target !== undefined && !(target >= 25 && target <= 350)) { status.textContent = "Enter a believable target weight, or leave it empty."; tI.focus(); return; }
    state.goal = kcal;
    state.macros = { p, c, f };
    state.profile = { ...state.profile, target };
    if (save()) { render(); closeTop(); toast("Targets saved"); }
  }

  const setUnit = (kind) => (u) => { state.units = { ...state.units, [kind]: u }; save(); render(); };
  drawSum();
  openLayer("full", () => [head("Settings"),
    h("div", { class: "stack" },
      h("section", {}, h("h3", {}, "Daily targets"),
        form(saveTargets, h("div", { class: "grid2" }, kcalL, pL, cL, fL), sum, tL, status,
          h("div", {}, h("button", { class: "outline" }, "Save targets"), h("button", { type: "button", class: "outline", onclick: () => openGoal() }, "Work them out for me")))),
      h("section", {}, h("h3", {}, "Units"),
        h("p", { class: "note" }, "Body weight"), segmented([["kg", "Kilograms"], ["lb", "Pounds"]], state.units.weight, setUnit("weight"), "Body weight unit"),
        h("p", { class: "note" }, "Food amounts"), segmented([["g", "Grams"], ["oz", "Ounces"]], state.units.food, setUnit("food"), "Food amount unit")),
      h("section", {}, h("h3", {}, "Backup"),
        h("p", { class: "note" }, `${backupDue(state.days, state.lastBackup, isoDate()) ? "It's time to export a backup. " : ""}Your diary is only on this phone. ${state.lastBackup ? `Last backup: ${state.lastBackup}.` : "You haven't made a backup yet."}`),
        h("button", { class: "outline", onclick: exportBackup }, "Export backup"),
        h("button", { class: "outline", onclick: () => picker.click() }, "Restore backup"), picker),
      h("section", {}, h("details", {}, h("summary", {}, "Where the numbers come from"),
        h("p", { class: "note" }, `${foods.length ? `${fmt(foods.length)} foods` : "Foods"} from USDA FoodData Central (FNDDS 2021–2023 and SR Legacy) and the Indian Nutrient Databank (Vijayakumar et al., 2024), plus packaged products from Open Food Facts (ODbL). Indian recipe figures are estimates and packaged figures are added by volunteers. Rows that failed sanity checks were removed.`),
        h("p", { class: "note" }, "Calorie targets use the Mifflin-St Jeor equation; maintenance estimates assume about 7,700 kcal per kg of body weight. Both are estimates."))))]);
}

// ——— Wiring ———

$("prev").onclick = () => goTo(shiftDate(date, -1));
$("next").onclick = () => goTo(shiftDate(date, 1));
$("today").onclick = () => goTo(isoDate());
$("datepick").onchange = (e) => { if (e.target.value) goTo(e.target.value); };
$("datepick").onclick = (e) => { try { e.target.showPicker(); } catch { /* the native control opens itself */ } };
$("add").onclick = () => openSearch(date === isoDate() ? mealForHour(new Date().getHours()) : "Lunch");
$("settings-open").onclick = openSettings;
$("target-open").onclick = openSettings;
$("burned-open").onclick = openBurned;
$("trends-open").onclick = openTrends;
$("week-head").onclick = openTrends;
$("weight-open").onclick = openWeight;

// Swipe sideways between days. Edge starts are left alone: iOS uses them for its own gestures.
let swipe = null;
document.addEventListener("touchstart", (e) => {
  const t = e.touches[0];
  swipe = !layers.length && e.touches.length === 1 && t.clientX > 24 && t.clientX < innerWidth - 24 && !e.target.closest(".ideas") ? { x: t.clientX, y: t.clientY, at: e.timeStamp } : null;
}, { passive: true });
document.addEventListener("touchend", (e) => {
  if (!swipe) return;
  const t = e.changedTouches[0];
  const dx = t.clientX - swipe.x, dy = t.clientY - swipe.y;
  const quick = e.timeStamp - swipe.at < 500;
  swipe = null;
  if (!quick || Math.abs(dx) < 70 || Math.abs(dy) > 40) return;
  if (dx > 0) goTo(shiftDate(date, -1));
  else if (date < isoDate()) goTo(shiftDate(date, 1));
}, { passive: true });

// Arrow keys step through days on a keyboard.
document.addEventListener("keydown", (e) => {
  if (layers.length || e.target.closest("input, select, textarea")) return;
  if (e.key === "ArrowLeft") goTo(shiftDate(date, -1));
  if (e.key === "ArrowRight") goTo(shiftDate(date, 1));
});

// iOS draws the keyboard over the page without resizing it, so sheets sit on top of it themselves.
const vv = window.visualViewport;
const syncKeyboard = () => {
  if (vv.scale > 1.01) return;
  document.documentElement.style.setProperty("--kb", `${Math.max(0, innerHeight - vv.height - vv.offsetTop)}px`);
};
vv?.addEventListener("resize", syncKeyboard);
vv?.addEventListener("scroll", syncKeyboard);

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

function addFoods(rows) {
  foods = foods.concat(rows.map(prepare)); // concat: packaged.json may land before foods.json
  for (const row of rows) foodIndex.set(`${row[1]}|${row[0]}`, row);
}
const refreshLayers = () => layers.forEach((l) => l.refresh?.());

fetch("foods.json")
  .then((r) => { if (!r.ok) throw new Error(r.status); return r.json(); })
  .then((rows) => { addFoods(rows); foodsLoaded = true; })
  .catch(() => { foodsFailed = true; })
  .finally(refreshLayers);

// Packaged foods are a bonus: if this file fails, everything else still works.
fetch("packaged.json")
  .then((r) => { if (!r.ok) throw new Error(r.status); return r.json(); })
  .then((rows) => { addFoods(rows); refreshLayers(); })
  .catch(() => {});

if (!state.onboarded) {
  state.onboarded = true;
  save();
  if (!Object.keys(state.days).length) openGoal(true);
}
