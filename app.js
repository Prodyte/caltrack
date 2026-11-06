import { MEALS, ACTIVITY, PACE, isoDate, shiftDate, mealForHour, prepare, search, makeEntry, nutrition, totals, recentNames, copyEntries, averageKcal, suggestGoal, backupDue, validBackup } from "./logic.js";

// Named before the app was renamed from Haldi; changing it would orphan existing diaries.
const KEY = "haldi.v1";
const $ = (id) => document.getElementById(id);
const fmt = (n) => Math.round(n).toLocaleString("en-IN");
const calm = matchMedia("(prefers-reduced-motion: reduce)").matches;
const EASE = "cubic-bezier(.16,1,.3,1)";
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
const foodIndex = new Map();
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

const head = (title) => h("div", { class: "grip" }, h("div", { class: "handle" }),
  h("div", { class: "sheethead" }, h("h2", {}, title),
    h("button", { class: "iconbtn", "aria-label": "Close", onclick: () => closeTop() }, icon("close"))));

let toastTimer;
function placeToast() {
  (layers.at(-1)?.dialog || document.body).append($("toast"));
}

function toast(message, undo) {
  const el = $("toast");
  $("toasttext").textContent = message;
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
function change(message, mutate) {
  const before = JSON.stringify(state.days);
  const known = new Set((state.days[date] || []).map((e) => e.id));
  mutate();
  if (!save()) { state.days = JSON.parse(before); return false; }
  (state.days[date] || []).forEach((e) => { if (!known.has(e.id)) fresh.add(e.id); });
  navigator.vibrate?.(8);
  diaryChanged();
  toast(message, () => { state.days = JSON.parse(before); fresh.clear(); save(); diaryChanged(); });
  return true;
}

function dayName(d) {
  const today = isoDate();
  return d === today ? "Today" : d === shiftDate(today, -1) ? "Yesterday"
    : new Date(`${d}T12:00`).toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short" });
}

function goTo(d) {
  const dir = d > date ? 1 : -1;
  date = d;
  render();
  if (calm) return;
  for (const el of [$("macros"), $("meals")]) {
    el.animate([{ opacity: 0, transform: `translateX(${dir * 24}px)` }, { opacity: 1, transform: "none" }], { duration: 240, easing: EASE });
  }
}

// The number counts down together with the falling level, so the two read as one change.
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

function render() {
  const today = isoDate();
  const list = state.days[date] || [];
  const t = totals(list);
  const left = state.goal - t.kcal;
  const over = Math.round(left) < 0;
  const level = Math.max(0, Math.min(100, (left / state.goal) * 100));

  $("dayname").textContent = dayName(date);
  $("next").disabled = date >= today;
  $("today").hidden = date === today;
  $("hero").classList.toggle("over", over);
  $("level").style.height = `${level}%`;
  // The status bar sits against the top of the hero in the installed app, so it follows the hero's colour.
  document.querySelector("meta[name=theme-color]").content = over ? "#A81F15" : left / state.goal >= 0.98 ? "#F2B100" : "#DDE2DF";
  showLeft(left);
  $("leftlabel").textContent = over ? "kcal over" : "kcal left";
  $("of").textContent = `${fmt(t.kcal)} eaten of ${fmt(state.goal)}`;
  $("of").setAttribute("aria-label", `${fmt(t.kcal)} eaten of ${fmt(state.goal)}. Change daily goal`);

  $("macros").replaceChildren(...[["Protein", t.p], ["Carbs", t.c], ["Fat", t.f]].map(([label, g]) =>
    h("div", {}, h("b", {}, `${fmt(g)} g`), h("span", {}, label))));

  const flash = !layers.length && fresh.size > 0;
  $("meals").replaceChildren(...MEALS.map((meal) => {
    const items = list.filter((e) => e.meal === meal);
    const copyable = items.length ? [] : copyFor(meal);
    const summary = items.length ? [...new Set(items.map((e) => e.name))].join(", ")
      : copyable.length ? `${date === today ? "Yesterday" : "Day before"}: ${fmt(totals(copyable).kcal)} kcal` : "Nothing yet";
    return h("section", { class: `meal${flash && items.some((e) => fresh.has(e.id)) ? " fresh" : ""}` },
      h("button", { class: "mealrow", onclick: () => (items.length || copyable.length ? openMeal(meal) : openSearch(meal)) },
        h("span", { class: "text" }, h("span", { class: "mealname" }, meal), h("small", {}, summary)),
        items.length > 0 && h("span", { class: "kcal" }, fmt(totals(items).kcal))),
      h("button", { class: "mealadd", "aria-label": `Add food to ${meal}`, onclick: () => openSearch(meal) }, icon("plus")));
  }));
  if (flash) fresh.clear();
  const due = backupDue(state.days, state.lastBackup, today);
  $("settings-open").classList.toggle("due", due);
  $("settings-open").setAttribute("aria-label", due ? "Settings, backup due" : "Settings");
  renderWeekStrip();
}

const copyFor = (meal) => copyEntries(state.days[shiftDate(date, -1)] || [], meal);

const amount = (e) => (e.label === "g" ? `${fmt(e.qty)} g`
  : e.qty === 1 ? e.label : `${+e.qty.toFixed(2)} × ${e.label.replace(/^1 /, "")}`);

// Tapping a day inside the window selects it without moving the bars under your finger.
function weekWindow() {
  const today = isoDate();
  const end = date >= shiftDate(today, -6) ? today : date;
  const dates = Array.from({ length: 7 }, (_, i) => shiftDate(end, i - 6));
  const kcals = dates.map((d) => totals(state.days[d]).kcal);
  return { today, end, dates, kcals, top: Math.max(state.goal, ...kcals) * 1.15 };
}

const dayLabel = (d) => new Date(`${d}T12:00`).toLocaleDateString("en-IN", { weekday: "short" }).slice(0, 2);

function renderWeekStrip() {
  const { dates, kcals, top } = weekWindow();
  $("week").replaceChildren(...dates.map((d, i) => {
    const high = Math.round(kcals[i]) > state.goal;
    return h("button", { class: `wk${d === date ? " now" : ""}${high ? " high" : ""}${kcals[i] ? "" : " empty"}`,
      "aria-label": `${d}: ${fmt(kcals[i])} kcal${high ? ", over goal" : ""}`, onclick: () => goTo(d) },
      h("span", { class: "track" }, h("u", { style: `bottom:${(state.goal / top) * 100}%` }), h("i", { style: `height:${(kcals[i] / top) * 100}%` })),
      h("span", {}, dayLabel(d)));
  }));
}

function openWeek() {
  const { today, end, dates, kcals, top } = weekWindow();
  const average = averageKcal(dates, kcals, today);
  const title = end === today ? "Last 7 days" : `7 days to ${new Date(`${end}T12:00`).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}`;
  openLayer("bottom", () => [head(title),
    h("p", { class: "note" }, `The line marks your ${fmt(state.goal)} kcal goal. Tap a day to open it.`),
    h("div", { class: "bars" },
      h("div", { class: "goal-line", style: `bottom:${(state.goal / top) * 100}%` }),
      dates.map((d, i) => {
        const high = Math.round(kcals[i]) > state.goal;
        return h("button", {
          class: `col${high ? " high" : ""}${kcals[i] ? "" : " empty"}`,
          "aria-label": `${d}: ${fmt(kcals[i])} kcal${high ? ", over goal" : ""}`,
          onclick: () => { goTo(d); closeTop(); },
        },
          d === date && kcals[i] ? h("em", {}, fmt(kcals[i]), high && icon("over")) : high ? h("em", {}, icon("over")) : null,
          h("i", { style: `height:${(kcals[i] / top) * 100}%` }));
      })),
    h("div", { class: "days" }, dates.map((d) => h("span", { class: d === date ? "now" : "" }, dayLabel(d)))),
    average && h("p", { class: "weeknote" }, `Average ${fmt(average.kcal)} kcal over ${average.days} logged ${average.days === 1 ? "day" : "days"}, not counting today`)]);
}

function openMeal(meal) {
  const total = h("p", { class: "note" });
  const list = h("ul", { class: "rows mealitems" });
  const copy = h("div", {});
  function draw() {
    const items = (state.days[date] || []).filter((e) => e.meal === meal);
    const copyable = items.length ? [] : copyFor(meal);
    total.textContent = items.length ? `${dayName(date)}, ${fmt(totals(items).kcal)} kcal` : `${dayName(date)}, nothing logged yet`;
    list.replaceChildren(...items.map((e) => h("li", { class: "line" },
      h("button", { class: "row", onclick: () => openPortion(rowFor(e), e.meal, { entry: e }) },
        h("span", { class: "text" }, h("span", { class: "name" }, e.name), h("small", {}, amount(e))),
        h("span", { class: "kcal" }, fmt(nutrition(e).kcal))))));
    copy.replaceChildren(...copyable.length ? [h("button", { class: "copy", onclick: () => change(`Copied ${meal.toLowerCase()}`, () => { (state.days[date] ||= []).push(...copyable); }) },
      `Copy from ${date === isoDate() ? "yesterday" : "the day before"}, ${fmt(totals(copyable).kcal)} kcal`)] : []);
  }
  draw();
  openLayer("bottom", (layer) => {
    layer.refresh = draw;
    return [head(meal), total, list, copy, h("button", { class: "primary", onclick: () => openSearch(meal) }, `Add food to ${meal}`)];
  });
}

// Finds the full food so its other portions are offered, falling back to what the entry stored.
function rowFor(e) {
  const known = state.custom.find((r) => r[0] === e.name && r[1] === e.src) || foodIndex.get(`${e.src}|${e.name}`);
  return known || [e.name, e.src, e.kcal, e.p, e.c, e.f, e.label === "g" ? [] : [[e.label, e.grams]]];
}

function mealPicker(current, onPick) {
  const group = h("div", { class: "meals", role: "group", "aria-label": "Meal" });
  const draw = () => group.replaceChildren(...MEALS.map((m) =>
    h("button", { type: "button", "aria-pressed": String(m === current), onclick: () => { current = m; onPick(m); draw(); } }, m)));
  draw();
  return group;
}

function openSearch(meal) {
  const allFoods = () => [...state.custom.map(prepare), ...foods];
  const startIds = new Set((state.days[date] || []).map((e) => e.id));
  let recents = recentNames(state.days);
  const results = h("div", { class: "results" });
  const input = h("input", { type: "search", placeholder: "Search: roti, dal, amul butter", enterKeyHint: "search",
    autocomplete: "off", autocorrect: "off", "aria-label": "Search foods",
    oninput: () => { draw(); results.scrollTop = 0; },
    onkeydown: (e) => { if (e.key === "Enter") input.blur(); } });
  // Scrolling means the person is reading the list, so give it the room the keyboard was taking.
  results.addEventListener("touchmove", () => input.blur(), { passive: true });
  const bar = h("div", { class: "mealbar", hidden: true });

  const cleared = () => { input.value = ""; draw(); results.scrollTop = 0; };

  function foodRow(row) {
    const known = recents.get(row[0]);
    const last = known?.src === row[1] ? known : null;
    const [label, grams] = last ? [amount(last), last.grams * last.qty] : row[6][0] || ["100 g", 100];
    return h("div", { class: "foodline line" },
      h("button", { class: "row", onclick: () => openPortion(row, meal, { last, onAdded: cleared }) },
        h("span", { class: "text" }, h("span", { class: "name" }, row[0]), h("small", {}, `${label}, ${SOURCES[row[1]]}`)),
        h("span", { class: "kcal" }, fmt((row[2] * grams) / 100))),
      last && h("button", { class: "repeat", "aria-label": `Add ${amount(last)} of ${row[0]} to ${meal}`, onclick: () => {
        change(`Added ${row[0]} to ${meal}`, () => { (state.days[date] ||= []).push(makeEntry(row, meal, last.label, last.grams, last.qty)); });
      } }, icon("plus")));
  }

  // Recent foods are capped to what fits, so opening Add never needs a scroll.
  const recentsThatFit = () => Math.max(3, Math.floor((innerHeight - (bar.hidden ? 300 : 370)) / 66));

  function draw() {
    const q = input.value.trim();
    recents = recentNames(state.days);
    const offline = foodsFailed ? h("p", { class: "error" }, "The food list has not downloaded. Connect to the internet and reopen CalTrack.") : null;
    if (!q) {
      const rows = [...recents.values()].slice(0, recentsThatFit()).map(rowFor);
      results.replaceChildren(...[offline, rows.length ? h("h3", {}, "Recent") : h("p", { class: "hint" }, "Search above for your first food."), ...rows.map(foodRow)].filter(Boolean));
      return;
    }
    const rows = search(allFoods(), q, new Set(recents.keys()));
    const loading = !foodsLoaded && !foodsFailed ? h("p", { class: "hint", role: "status" }, "Loading the food list…") : null;
    const none = !rows.length && foodsLoaded ? h("p", { class: "hint" }, `No food matches “${q}”. Check the spelling or add it yourself.`) : null;
    results.replaceChildren(...[offline, loading, ...rows.map(foodRow), none].filter(Boolean));
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
        h("button", { onclick: () => openQuick(meal, cleared) }, "Quick add calories"),
        h("button", { onclick: () => openCustom(meal, input.value.trim(), cleared) }, "Add my own food")),
      results, bar];
  });
}

function openPortion(row, meal, { entry = null, last = null, onAdded = null } = {}) {
  const [name, src, kcal] = row;
  const custom = src === "C" || src === "Q";
  const from = entry || last;
  const portions = [...row[6]];
  if (!custom) portions.push(["g", 1]);
  let chosen = (from && portions.find(([l]) => l === from.label)) || (from ? [from.label, from.grams] : portions[0]);
  if (from && !portions.includes(chosen)) portions.unshift(chosen);
  const qtyFor = (portion) => (portion[0] === "g" ? 100 : 1);

  const qty = h("input", { type: "number", inputMode: "decimal", min: "0", step: "any", enterKeyHint: "done", value: from ? from.qty : qtyFor(chosen), "aria-label": "Amount", oninput: draw,
    onkeydown: (e) => { if (e.key === "Enter") qty.blur(); } });
  const result = h("div", { class: "result", "aria-live": "polite" });
  const chips = h("div", { class: "portions", role: "group", "aria-label": "Portion" });
  const presets = h("div", { class: "presets", role: "group", "aria-label": "Common amounts" });
  const action = h("button", { class: "primary", onclick: submit });
  const amountNow = () => { const v = parseFloat(qty.value); return v > 0 && Number.isFinite(v) ? v : 0; };

  function drawChips() {
    // Many portions become a dropdown, so the sheet keeps its height and never needs scrolling.
    if (portions.length > 3) {
      const select = h("select", { "aria-label": "Portion", onchange: () => { chosen = portions[+select.value]; qty.value = qtyFor(chosen); draw(); } },
        portions.map((portion, i) => h("option", { value: i }, portion[0] === "g" ? "Grams" : portion[0])));
      select.value = portions.indexOf(chosen);
      chips.replaceChildren(select);
      return;
    }
    chips.replaceChildren(...portions.map((portion) => h("button", {
      "aria-pressed": String(portion === chosen),
      onclick: () => { chosen = portion; qty.value = qtyFor(portion); drawChips(); draw(); },
    }, portion[0] === "g" ? "Grams" : portion[0])));
  }

  function draw() {
    const n = nutrition(makeEntry(row, meal, chosen[0], chosen[1], amountNow(), "preview"));
    result.replaceChildren(h("b", {}, `${fmt(n.kcal)} kcal`), h("p", {}, `Protein ${fmt(n.p)} g, carbs ${fmt(n.c)} g, fat ${fmt(n.f)} g`));
    const values = chosen[0] === "g" ? [[50, "50 g"], [100, "100 g"], [150, "150 g"], [200, "200 g"], [250, "250 g"]] : [[0.5, "½"], [1, "1"], [1.5, "1½"], [2, "2"], [3, "3"]];
    presets.replaceChildren(...values.map(([value, label]) => h("button", { "aria-pressed": String(amountNow() === value), onclick: () => { qty.value = value; draw(); } }, label)));
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
    save();
    closeTop();
    layers.forEach((l) => l.refresh?.());
  }

  drawChips();
  draw();
  openLayer("bottom", () => [
    head(name),
    !custom && h("p", { class: "note" }, `${SOURCES[src] || "USDA"}, ${fmt(kcal)} kcal per 100 g.${src === "I" ? " Worked out from a recipe, so treat it as a guide." : ""}${src === "P" ? " Added by volunteers, so check it against the pack." : ""}`),
    entry && mealPicker(meal, (m) => { meal = m; draw(); }),
    chips,
    h("div", { class: "stepper" },
      h("button", { "aria-label": "Less", onclick: () => step(-1) }, icon("minus")),
      qty,
      h("button", { "aria-label": "More", onclick: () => step(1) }, icon("plus"))),
    presets,
    result,
    action,
    entry && h("button", { class: "danger", onclick: removeEntry }, "Delete from diary"),
    src === "C" && !entry && h("button", { class: "danger", onclick: forgetFood }, "Remove from my foods"),
  ]);
}

const field = (label, props) => { const input = h("input", props); return [h("label", {}, label, input), input]; };

function choice(label, options, value) {
  const select = h("select", {}, options.map((o) => h("option", { value: o }, o)));
  if (options.includes(value)) select.value = value;
  return [h("label", {}, label, select), select];
}

// A real form, so the keyboard's Go/Done key submits it.
const form = (onSubmit, ...kids) => h("form", { class: "stack", noValidate: true, onsubmit: (e) => { e.preventDefault(); onSubmit(); } }, ...kids);

function openQuick(meal, onAdded) {
  const [kcalL, kcalI] = field("Calories", { type: "number", inputMode: "decimal", min: "0", enterKeyHint: "done" });
  const [nameL, nameI] = field("What was it? Optional", { autocomplete: "off", enterKeyHint: "done" });
  const error = h("p", { class: "error", role: "alert" });
  function add() {
    const kcal = parseFloat(kcalI.value);
    if (!(kcal > 0 && kcal <= 20000)) { error.textContent = "Enter the calories, from 1 to 20,000."; kcalI.focus(); return; }
    const row = [nameI.value.trim() || "Quick add", "Q", kcal, 0, 0, 0, []];
    if (change(`Added ${row[0]} to ${meal}`, () => { (state.days[date] ||= []).push(makeEntry(row, meal, "estimate", 100, 1)); })) { closeTop(); onAdded?.(); }
  }
  openLayer("bottom", (layer) => {
    layer.opened = () => kcalI.focus();
    return [head("Quick add calories"), form(add, kcalL, nameL, error, h("button", { class: "primary" }, `Add to ${meal}`))];
  });
}

function openGoal(firstRun = false) {
  const saved = state.profile || {};
  const number = (label, value, mode) => field(label, { type: "number", inputMode: mode, enterKeyHint: "next", value: value ?? "", oninput: draw });
  const [sexL, sexI] = choice("Sex", ["Male", "Female"], saved.sex);
  const [ageL, ageI] = number("Age", saved.age, "numeric");
  const [heightL, heightI] = number("Height, cm", saved.height, "numeric");
  const [weightL, weightI] = number("Weight, kg", saved.weight, "decimal");
  const [activityL, activityI] = choice("Activity", Object.keys(ACTIVITY), saved.activity ?? "Light, 1–3 workouts a week");
  const [paceL, paceI] = choice("Goal", Object.keys(PACE), saved.pace ?? "Stay the same");
  const result = h("div", { class: "suggest", "aria-live": "polite" });
  const use = h("button", { class: "primary" });
  sexI.onchange = activityI.onchange = paceI.onchange = draw;
  const profile = () => ({ sex: sexI.value, age: +ageI.value, height: +heightI.value, weight: +weightI.value, activity: activityI.value, pace: paceI.value });

  function draw() {
    const goal = suggestGoal(profile());
    result.replaceChildren(...goal
      ? [h("p", { class: "note" }, "A starting estimate from the Mifflin-St Jeor formula, never below 1,200.")]
      : [h("p", { class: "note" }, "Enter your age, height and weight to see a daily goal.")]);
    use.disabled = !goal;
    use.textContent = goal ? `Use ${fmt(goal)} kcal a day` : "Use this goal";
  }

  function apply() {
    const goal = suggestGoal(profile());
    if (!goal) { ageI.focus(); return; }
    state.goal = goal;
    state.profile = profile();
    if (save()) { closeAll(); render(); }
  }

  draw();
  openLayer("full", () => [head(firstRun ? "Set your daily goal" : "Work out my goal"),
    form(apply, h("div", { class: "grid2 goalform" }, sexL, ageL, heightL, weightL), h("div", { class: "goalform" }, activityL, paceL), result, use,
      firstRun && h("button", { type: "button", class: "link skip", onclick: () => closeTop() }, `Keep ${fmt(state.goal)} kcal for now`))]);
}

function openCustom(meal, name, onAdded) {
  const [nameL, nameI] = field("Name", { value: name, autocomplete: "off", enterKeyHint: "next" });
  const [kcalL, kcalI] = field("Calories per serving", { type: "number", inputMode: "decimal", min: "0", enterKeyHint: "next" });
  const [pL, pI] = field("Protein, g", { type: "number", inputMode: "decimal", min: "0", enterKeyHint: "next" });
  const [cL, cI] = field("Carbs, g", { type: "number", inputMode: "decimal", min: "0", enterKeyHint: "next" });
  const [fL, fI] = field("Fat, g", { type: "number", inputMode: "decimal", min: "0", enterKeyHint: "done" });
  const error = h("p", { class: "error", role: "alert" });

  async function create() {
    const num = (input) => Math.max(0, parseFloat(input.value) || 0);
    if (!nameI.value.trim()) { error.textContent = "Enter a name."; nameI.focus(); return; }
    if (!(parseFloat(kcalI.value) >= 0)) { error.textContent = "Enter the calories per serving."; kcalI.focus(); return; }
    const title = nameI.value.trim();
    // One serving counts as 100 "grams" so custom foods use the same per-100 g maths as everything else.
    const row = [title, "C", num(kcalI), num(pI), num(cI), num(fI), [["1 serving", 100]]];
    state.custom = [row, ...state.custom.filter((r) => r[0] !== title)];
    if (!save()) return;
    await closeTop();
    openPortion(row, meal, { onAdded });
  }

  openLayer("full", (layer) => {
    layer.opened = () => (name ? kcalI : nameI).focus();
    return [head("Add my own food"), form(create, nameL, kcalL, h("div", { class: "grid3" }, pL, cL, fL), error, h("button", { class: "primary" }, "Save food"))];
  });
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
  const goal = h("input", { type: "number", inputMode: "numeric", min: "500", max: "10000", enterKeyHint: "done", value: state.goal });
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
      closeAll();
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
    if (save()) { render(); closeTop(); }
  }

  openLayer("full", () => [head("Settings"),
    h("div", { class: "stack" },
      h("section", {}, form(saveGoal, h("label", {}, "Daily goal, kcal", goal), status, h("div", {}, h("button", { class: "outline" }, "Save goal"), h("button", { type: "button", class: "outline", onclick: () => openGoal() }, "Work out my goal")))),
      h("section", {}, h("h3", {}, "Backup"),
        h("p", { class: "note" }, `${backupDue(state.days, state.lastBackup, isoDate()) ? "It's time to export a backup. " : ""}Your diary is only on this phone. ${state.lastBackup ? `Last backup: ${state.lastBackup}.` : "You haven't made a backup yet."}`),
        h("button", { class: "outline", onclick: exportBackup }, "Export backup"),
        h("button", { class: "outline", onclick: () => picker.click() }, "Restore backup"), picker),
      h("section", {}, h("details", {}, h("summary", {}, "Where the numbers come from"),
        h("p", { class: "note" }, `${foods.length ? `${fmt(foods.length)} foods` : "Foods"} from USDA FoodData Central (FNDDS 2021–2023 and SR Legacy) and the Indian Nutrient Databank (Vijayakumar et al., 2024), plus packaged products from Open Food Facts (ODbL). Indian recipe figures are estimates and packaged figures are added by volunteers. Rows that failed sanity checks were removed.`))))]);
}

const redrawSearch = () => document.querySelector("dialog[open] input[type=search]")?.dispatchEvent(new Event("input"));

$("prev").onclick = () => goTo(shiftDate(date, -1));
$("next").onclick = () => goTo(shiftDate(date, 1));
$("today").onclick = () => goTo(isoDate());
$("add").onclick = () => openSearch(mealForHour(new Date().getHours()));
$("settings-open").onclick = openSettings;
$("of").onclick = openSettings;
$("week-open").onclick = openWeek;

// Swipe sideways between days. Edge starts are left alone: iOS uses them for its own gestures.
let swipe = null;
document.addEventListener("touchstart", (e) => {
  const t = e.touches[0];
  swipe = !layers.length && e.touches.length === 1 && t.clientX > 24 && t.clientX < innerWidth - 24 ? { x: t.clientX, y: t.clientY, at: e.timeStamp } : null;
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

fetch("foods.json")
  .then((r) => { if (!r.ok) throw new Error(r.status); return r.json(); })
  .then((rows) => { addFoods(rows); foodsLoaded = true; })
  .catch(() => { foodsFailed = true; })
  .finally(redrawSearch);

// Packaged foods are a bonus: if this file fails, everything else still works.
fetch("packaged.json")
  .then((r) => { if (!r.ok) throw new Error(r.status); return r.json(); })
  .then((rows) => { addFoods(rows); redrawSearch(); })
  .catch(() => {});

if (!state.onboarded) {
  state.onboarded = true;
  save();
  if (!Object.keys(state.days).length) openGoal(true);
}
