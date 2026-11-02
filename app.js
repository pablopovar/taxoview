const FIELD_TYPES = {
  taxonomy: {
    label: "Taxonomía",
    render(value, parent) {
      const ranks = ["Reino", "División / filo", "Clase", "Orden", "Familia", "Género", "Especie"];
      const path = value && typeof value === "object" ? value : {};
      const list = document.createElement("dl"); list.className = "taxonomy-path";
      ranks.forEach((rank, index) => {
        const key = ["kingdom", "phylum", "class", "order", "family", "genus", "species"][index];
        if (!path[key]) return;
        const term = document.createElement("dt"); term.textContent = rank;
        const detail = document.createElement("dd"); detail.textContent = path[key];
        list.append(term, detail);
      });
      if (!list.childElementCount) parent.append(emptyValue("Sin datos taxonómicos")); else parent.append(list);
    },
  },
  interaction: {
    label: "Perfil de interacción",
    options: ["Alimentario", "Medicinal", "Psicoactivo o recreativo", "Tóxico", "Protegido", "Regulado", "Otros usos humanos"],
    render(value, parent) {
      const selected = Array.isArray(value) ? value : [];
      if (!selected.length) { parent.append(emptyValue("Sin dimensiones marcadas")); return; }
      const list = document.createElement("ul"); list.className = "interaction-tags";
      selected.forEach((label) => { const item = document.createElement("li"); item.textContent = label; list.append(item); });
      parent.append(list);
    },
  },
  name: {
    label: "Nombres",
    render(value, parent) {
      const list = document.createElement("div");
      list.className = "name-list";
      (Array.isArray(value) ? value : []).forEach((name, index) => {
        const item = document.createElement("span");
        item.className = "name-entry" + (index === 0 ? " primary-name" : "");
        item.textContent = name;
        list.append(item);
      });
      if (!list.childElementCount) list.append(emptyValue("Sin nombres"));
      parent.append(list);
    },
  },
  location: { label: "Ubicación", render(value, parent) { parent.append(textValue(value, "Sin ubicación")); } },
  pictures: {
    label: "Imágenes",
    render(value, parent) {
      const gallery = document.createElement("div");
      gallery.className = "picture-grid";
      (Array.isArray(value) ? value : []).forEach((url) => {
        const link = document.createElement("a");
        link.href = url;
        link.target = "_blank";
        link.rel = "noreferrer";
        const image = document.createElement("img");
        image.src = url;
        image.alt = "Ejemplar";
        link.append(image);
        gallery.append(link);
      });
      if (!gallery.childElementCount) gallery.append(emptyValue("Sin imágenes"));
      parent.append(gallery);
    },
  },
  videos: {
    label: "Videos",
    render(value, parent) {
      const gallery = document.createElement("div");
      gallery.className = "video-list";
      (Array.isArray(value) ? value : []).forEach((url) => {
        const video = document.createElement("video");
        video.src = url;
        video.controls = true;
        video.preload = "metadata";
        video.setAttribute("aria-label", "Video del ejemplar");
        gallery.append(video);
      });
      if (!gallery.childElementCount) gallery.append(emptyValue("Sin videos"));
      parent.append(gallery);
    },
  },
  coordinates: {
    label: "Coordenadas",
    render(value, parent) {
      const points = Array.isArray(value) ? value : [];
      if (!points.length) {
        parent.append(emptyValue("Sin coordenadas"));
        return;
      }
      parent.append(makeCoordinateMap(points, false));
      const button = document.createElement("button");
      button.type = "button";
      button.className = "text-button map-open-button";
      button.textContent = "Ver mapa · " + points.length + (points.length === 1 ? " ubicación" : " ubicaciones");
      button.addEventListener("click", () => showCoordinateMap(points));
      parent.append(button);
    },
  },
  description: {
    label: "Descripción",
    render(value, parent) {
      const text = textValue(value, "Sin descripción");
      text.classList.add("description-text");
      parent.append(text);
    },
  },
};
const FIELD_TYPE_NAMES = Object.fromEntries(Object.entries(FIELD_TYPES).map(([id, spec]) => [id, spec.label]));
let categories = [];
let datasets = new Map();
let categoryView = { order: [], collapsed: [], stacksHidden: false };
let activeCategoryId = null;
let editingId = null;
let removedAssets = new Map();
let messageTimer;
const board = document.getElementById("category-board");
const dialog = document.getElementById("item-dialog");
const form = document.getElementById("item-form");
const categoryDialog = document.getElementById("category-dialog");
const categoryForm = document.getElementById("category-form");
const mapDialog = document.getElementById("map-dialog");
const collapsedRecords = new Set();

function makeCoordinateMap(points, large) {
  const svgNS = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(svgNS, "svg");
  svg.setAttribute("viewBox", "0 0 200 120");
  svg.setAttribute("role", "img");
  svg.setAttribute("aria-label", "Mapa esquemático de " + points.length + " ubicaciones");
  svg.classList.add("coordinate-map");
  if (large) svg.classList.add("coordinate-map-large");
  const valid = points.filter((point) => Number.isFinite(Number(point.latitude)) && Number.isFinite(Number(point.longitude)));
  if (!valid.length) return svg;
  const latitudes = valid.map((point) => Number(point.latitude));
  const longitudes = valid.map((point) => Number(point.longitude));
  const minLat = Math.min(...latitudes), maxLat = Math.max(...latitudes);
  const minLon = Math.min(...longitudes), maxLon = Math.max(...longitudes);
  const latSpan = maxLat - minLat || 0.01, lonSpan = maxLon - minLon || 0.01;
  const pad = 18;
  valid.forEach((point, index) => {
    const x = maxLon === minLon ? 100 : pad + ((Number(point.longitude) - minLon) / lonSpan) * (200 - 2 * pad);
    const y = maxLat === minLat ? 60 : 120 - pad - ((Number(point.latitude) - minLat) / latSpan) * (120 - 2 * pad);
    const circle = document.createElementNS(svgNS, "circle");
    circle.setAttribute("cx", String(x)); circle.setAttribute("cy", String(y)); circle.setAttribute("r", large ? "5" : "4");
    circle.setAttribute("class", "coordinate-marker"); svg.append(circle);
    const label = document.createElementNS(svgNS, "text");
    label.setAttribute("x", String(x + 7)); label.setAttribute("y", String(y - 6)); label.textContent = String(index + 1); svg.append(label);
  });
  return svg;
}
function showCoordinateMap(points) {
  const box = document.getElementById("map-dialog-content");
  box.replaceChildren(makeCoordinateMap(points, true));
  const list = document.createElement("ol");
  points.forEach((point) => {
    const item = document.createElement("li");
    const name = point.label ? point.label + " — " : "";
    item.textContent = name + Number(point.latitude).toFixed(6) + ", " + Number(point.longitude).toFixed(6);
    list.append(item);
  });
  box.append(list);
  mapDialog.showModal();
}

function createRecordId() {
  if (globalThis.crypto && typeof globalThis.crypto.randomUUID === "function") return globalThis.crypto.randomUUID();
  return "registro-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 10);
}
function emptyValue(label) {
  const node = document.createElement("span");
  node.className = "empty-value";
  node.textContent = label;
  return node;
}
function textValue(value, fallback) {
  const node = document.createElement("div");
  node.className = value ? "value-text" : "empty-value";
  node.textContent = value || fallback;
  return node;
}
function orderedCategories() {
  const byId = new Map(categories.map((category) => [category.id, category]));
  const result = categoryView.order.map((id) => byId.get(id)).filter(Boolean);
  categories.forEach((category) => { if (!result.includes(category)) result.push(category); });
  return result;
}
function render() {
  board.replaceChildren();
  const ordered = orderedCategories();
  const visible = ordered.filter((category) => !(categoryView.stacksHidden && categoryView.collapsed.includes(category.id)));
  board.style.gridTemplateColumns = visible.map((category) => categoryView.collapsed.includes(category.id) ? "36px" : "minmax(280px, 1fr)").join(" ");
  board.style.minWidth = Math.max(850, visible.reduce((width, category) => width + (categoryView.collapsed.includes(category.id) ? 36 : 285), 0)) + "px";
  [document.getElementById("hide-stacks-left"), document.getElementById("hide-stacks-right")].forEach((button) => {
    button.hidden = !ordered.some((category) => categoryView.collapsed.includes(category.id));
    button.textContent = categoryView.stacksHidden
      ? (button.classList.contains("stack-toggle-left") ? "›" : "‹")
      : (button.classList.contains("stack-toggle-left") ? "‹" : "›");
    button.title = categoryView.stacksHidden ? "Mostrar grupos laterales" : "Ocultar grupos laterales";
    button.setAttribute("aria-label", button.title);
  });
  let totalItems = 0;
  ordered.forEach((category) => {
    const items = datasets.get(category.id)?.items || [];
    totalItems += items.length;
    if (visible.includes(category)) board.append(renderCategory(category, items));
  });
  document.getElementById("item-count").textContent = ordered.length + (ordered.length === 1 ? " categoría · " : " categorías · ") + totalItems + (totalItems === 1 ? " registro" : " registros");
}
function renderCategory(category, items) {
  const collapsed = categoryView.collapsed.includes(category.id);
  const column = document.createElement("section");
  column.className = "category-column" + (collapsed ? " is-collapsed" : "");
  column.dataset.category = category.id;
  const header = document.createElement("header");
  header.className = "category-header";
  const drag = document.createElement("span");
  drag.className = "drag-handle";
  drag.textContent = "⠿";
  drag.title = "Arrastrar para ordenar categorías";
  drag.setAttribute("aria-label", "Arrastrar para ordenar " + category.title);
  drag.draggable = true;
  drag.addEventListener("dragstart", (event) => { event.dataTransfer.setData("text/plain", category.id); event.dataTransfer.effectAllowed = "move"; column.classList.add("is-dragging"); });
  drag.addEventListener("dragend", () => column.classList.remove("is-dragging"));
  column.addEventListener("dragover", (event) => event.preventDefault());
  column.addEventListener("drop", (event) => { event.preventDefault(); moveCategory(event.dataTransfer.getData("text/plain"), category.id); });
  const heading = document.createElement("div");
  heading.className = "category-title-wrap";
  const title = document.createElement("h2");
  title.textContent = category.title;
  const count = document.createElement("span");
  count.className = "category-count";
  count.textContent = String(items.length);
  heading.append(title, count);
  const controls = document.createElement("div");
  controls.className = "category-controls";
  const add = document.createElement("button");
  add.type = "button"; add.className = "icon-button add-category-item"; add.textContent = "+";
  add.title = "Agregar a " + category.title; add.setAttribute("aria-label", add.title); add.addEventListener("click", () => openEditor(category.id));
  const collapse = document.createElement("button");
  collapse.type = "button"; collapse.className = "icon-button collapse-category"; collapse.textContent = collapsed ? "›" : "‹";
  collapse.title = collapsed ? "Expandir categoría" : "Contraer categoría"; collapse.setAttribute("aria-label", collapse.title + " " + category.title);
  collapse.addEventListener("click", () => toggleCategory(category.id));
  controls.append(add, collapse); header.append(drag, heading, controls); column.append(header);
  const content = document.createElement("div"); content.className = "category-content";
  const addButton = document.createElement("button"); addButton.type = "button"; addButton.className = "button button-add";
  addButton.textContent = "+ Agregar a " + category.title; addButton.addEventListener("click", () => openEditor(category.id)); content.append(addButton);
  const list = document.createElement("div"); list.className = "entry-list";
  if (!items.length) { const empty = document.createElement("p"); empty.className = "category-empty"; empty.textContent = "Todavía no hay registros."; list.append(empty); }
  else items.forEach((record) => list.append(renderEntry(category, record)));
  content.append(list); column.append(content); return column;
}
function renderEntry(category, record) {
  const card = document.createElement("details");
  card.className = "entry-card item-card";
  card.open = !collapsedRecords.has(record.id);
  const summary = document.createElement("summary");
  summary.className = "entry-card-summary";
  const nameField = (category.fields || []).find((field) => field.type === "name");
  const primaryName = nameField && Array.isArray(record[nameField.id]) ? record[nameField.id][0] : "";
  const fallbackField = (category.fields || []).find((field) => {
    const value = record[field.id];
    return Array.isArray(value) ? value.length > 0 : Boolean(value);
  });
  const fallbackValue = fallbackField ? record[fallbackField.id] : "";
  const titleText = primaryName || (Array.isArray(fallbackValue) ? fallbackValue[0] : fallbackValue) || "Registro";
  const title = document.createElement("span"); title.className = "entry-record-title"; title.textContent = titleText;
  const indicator = document.createElement("span"); indicator.className = "entry-record-indicator"; indicator.setAttribute("aria-hidden", "true");
  summary.append(title, indicator); card.append(summary);
  card.addEventListener("toggle", () => {
    if (card.open) collapsedRecords.delete(record.id);
    else collapsedRecords.add(record.id);
  });
  const content = document.createElement("div"); content.className = "entry-card-content";
  (category.fields || []).forEach((field) => {
    const renderer = FIELD_TYPES[field.type]; if (!renderer) return;
    let fieldValue = record[field.id];
    if (field === nameField && Array.isArray(fieldValue)) fieldValue = fieldValue.slice(1);
    if (field === nameField && !fieldValue.length) return;
    const section = document.createElement("section"); section.className = "entry-field field-" + field.type;
    const label = document.createElement("h3"); label.textContent = field.label || renderer.label;
    const value = document.createElement("div"); value.className = "entry-value"; renderer.render(fieldValue, value, record);
    section.append(label, value); content.append(section);
  });
  const actions = document.createElement("footer"); actions.className = "entry-actions";
  const edit = document.createElement("button"); edit.type = "button"; edit.className = "text-button"; edit.textContent = "Editar"; edit.addEventListener("click", () => openEditor(category.id, record));
  const remove = document.createElement("button"); remove.type = "button"; remove.className = "text-button text-button-delete"; remove.textContent = "Eliminar"; remove.addEventListener("click", () => deleteRecord(category.id, record));
  actions.append(edit, remove); content.append(actions); card.append(content); return card;
}
function moveCategory(from, to) {
  if (!from || from === to) return;
  const order = orderedCategories().map((category) => category.id); const sourceIndex = order.indexOf(from); const targetIndex = order.indexOf(to);
  if (sourceIndex < 0 || targetIndex < 0) return;
  order.splice(targetIndex, 0, order.splice(sourceIndex, 1)[0]); categoryView.order = order; render(); saveCategoryView();
}
function toggleCategory(id) {
  categoryView.collapsed = categoryView.collapsed.includes(id) ? categoryView.collapsed.filter((item) => item !== id) : [...categoryView.collapsed, id];
  render(); saveCategoryView();
}
function toggleSideStacks() {
  categoryView.stacksHidden = !categoryView.stacksHidden;
  render();
  saveCategoryView();
}
async function request(path, options = {}) {
  const response = await fetch(path, options); const result = await response.json();
  if (!response.ok) throw new Error(result.error || "No se pudo completar la solicitud."); return result;
}
async function saveDataset(categoryId) {
  const data = datasets.get(categoryId);
  await request("/api/datasets/" + encodeURIComponent(categoryId), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ items: data.items }, null, 2) });
}
async function saveCategoryView() {
  try { await request("/api/category-view", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(categoryView) }); }
  catch (error) { showMessage("No se pudo guardar el orden de las categorías: " + error.message, true); }
}
function showMessage(text, isError = false) {
  const box = document.getElementById("message"); box.textContent = text; box.classList.toggle("error", isError); box.hidden = false;
  clearTimeout(messageTimer); messageTimer = setTimeout(() => { box.hidden = true; }, 4500);
}
function fieldControl(field, record) {
  const wrap = document.createElement("div"); wrap.className = "form-field dynamic-field";
  const title = document.createElement("span"); title.textContent = field.label || FIELD_TYPE_NAMES[field.type]; wrap.append(title);
  const value = record ? record[field.id] : null;
  if (field.type === "interaction") {
    const selected = Array.isArray(value) ? value : [];
    const list = document.createElement("div"); list.className = "interaction-checkboxes"; list.dataset.fieldId = field.id;
    FIELD_TYPES.interaction.options.forEach((option, index) => {
      const label = document.createElement("label"); label.className = "interaction-choice";
      const input = document.createElement("input"); input.type = "checkbox"; input.value = option; input.checked = selected.includes(option); input.dataset.interactionOption = "true";
      const text = document.createElement("span"); text.textContent = option; label.append(input, text); list.append(label);
    });
    wrap.append(list);
  } else if (field.type === "taxonomy") {
    const path = value && typeof value === "object" ? value : {};
    const ranks = [["kingdom", "Reino"], ["phylum", "División / filo"], ["class", "Clase"], ["order", "Orden"], ["family", "Familia"], ["genus", "Género"], ["species", "Especie"]];
    const fields = document.createElement("div"); fields.className = "taxonomy-inputs"; fields.dataset.fieldId = field.id;
    ranks.forEach(([key, labelText]) => {
      const label = document.createElement("label"); label.className = "taxonomy-rank"; label.textContent = labelText;
      const input = document.createElement("input"); input.type = "text"; input.value = path[key] || ""; input.dataset.taxonomyRank = key; input.setAttribute("aria-label", labelText);
      const listId = "taxonomy-choices-" + field.id.replace(/[^a-zA-Z0-9_-]/g, "-") + "-" + key;
      const choices = new Set();
      datasets.forEach((dataset) => (dataset.items || []).forEach((item) => {
        (Object.values(item).filter((candidate) => candidate && typeof candidate === "object" && !Array.isArray(candidate))).forEach((candidate) => { if (candidate[key]) choices.add(String(candidate[key])); });
      }));
      const datalist = document.createElement("datalist"); datalist.id = listId;
      [...choices].sort((a, b) => a.localeCompare(b, "es")).forEach((choice) => { const option = document.createElement("option"); option.value = choice; datalist.append(option); });
      input.setAttribute("list", listId); label.append(input, datalist); fields.append(label);
    });
    wrap.append(fields);
  } else if (field.type === "pictures" || field.type === "videos") {
    const isVideo = field.type === "videos";
    const row = document.createElement("div"); row.className = "file-picker-row";
    const noun = isVideo ? "videos" : "imágenes";
    const picker = document.createElement("button"); picker.type = "button"; picker.className = "button button-quiet"; picker.textContent = "Seleccionar " + noun; picker.setAttribute("aria-label", picker.textContent);
    const input = document.createElement("input"); input.type = "file"; input.accept = isVideo ? "video/*" : "image/*"; input.multiple = true; input.hidden = true; input.dataset.fieldId = field.id;
    const selected = document.createElement("span"); selected.className = "selected-files"; selected.textContent = "Sin " + noun + " seleccionados";
    picker.addEventListener("click", () => input.click()); input.addEventListener("change", () => { const n=input.files.length; selected.textContent=n ? n+(n===1?" archivo seleccionado":" archivos seleccionados") : "Sin " + noun + " seleccionados"; });
    row.append(picker, selected, input); wrap.append(row);
    const existing = document.createElement("div"); existing.className = isVideo ? "video-file-list" : "picture-list";
    (Array.isArray(value) ? value : []).forEach((url) => existing.append(assetThumb(url, field.id, isVideo)));
    wrap.append(existing);
  } else if (field.type === "coordinates") {
    const rows = document.createElement("div"); rows.className = "coordinate-rows"; rows.dataset.fieldId = field.id;
    const points = Array.isArray(value) && value.length ? value : [{}];
    points.forEach((point) => addCoordinateRow(rows, point));
    const add = document.createElement("button"); add.type = "button"; add.className = "button button-quiet coordinate-add";
    add.textContent = "+ Agregar ubicación"; add.addEventListener("click", () => addCoordinateRow(rows));
    wrap.append(rows, add);
  } else {
    const input = document.createElement("textarea"); input.rows = field.type === "name" ? 3 : field.type === "location" ? 2 : 4;
    input.dataset.fieldId = field.id;
    input.setAttribute("aria-label", field.label || FIELD_TYPE_NAMES[field.type]);
    input.placeholder = field.type === "name" ? "Un valor por línea" : "Agregar " + (field.label || FIELD_TYPE_NAMES[field.type]).toLowerCase();
    if (field.type === "name") input.value = (Array.isArray(value) ? value : []).join("\n");
    else input.value = value || "";
    wrap.append(input);
  }
  return wrap;
}
function assetThumb(url, fieldId, isVideo) {
  const thumb = document.createElement("div"); thumb.className = isVideo ? "video-file-thumb" : "picture-thumb";
  const preview = document.createElement(isVideo ? "video" : "img"); preview.src = url;
  if (isVideo) { preview.controls = true; preview.preload = "metadata"; }
  else preview.alt = "Imagen guardada";
  const remove = document.createElement("button"); remove.type = "button"; remove.textContent = "×"; remove.setAttribute("aria-label", isVideo ? "Quitar este video del registro" : "Quitar esta imagen del registro");
  remove.addEventListener("click", () => { if (!removedAssets.has(fieldId)) removedAssets.set(fieldId, new Set()); removedAssets.get(fieldId).add(url); thumb.remove(); });
  thumb.append(preview, remove); return thumb;
}
function addCoordinateRow(container, point = {}) {
  const row = document.createElement("div"); row.className = "coordinate-row";
  const place = document.createElement("input"); place.type = "text"; place.placeholder = "Lugar (opcional)"; place.value = point.label || ""; place.dataset.coordinate = "label"; place.setAttribute("aria-label", "Nombre del lugar");
  const latitude = document.createElement("input"); latitude.type = "number"; latitude.step = "any"; latitude.min = "-90"; latitude.max = "90"; latitude.placeholder = "Latitud"; latitude.value = point.latitude ?? ""; latitude.dataset.coordinate = "latitude"; latitude.setAttribute("aria-label", "Latitud");
  const longitude = document.createElement("input"); longitude.type = "number"; longitude.step = "any"; longitude.min = "-180"; longitude.max = "180"; longitude.placeholder = "Longitud"; longitude.value = point.longitude ?? ""; longitude.dataset.coordinate = "longitude"; longitude.setAttribute("aria-label", "Longitud");
  const remove = document.createElement("button"); remove.type = "button"; remove.className = "icon-button"; remove.textContent = "×"; remove.title = "Quitar ubicación"; remove.setAttribute("aria-label", "Quitar ubicación");
  remove.addEventListener("click", () => { if (container.childElementCount > 1) row.remove(); else { place.value = ""; latitude.value = ""; longitude.value = ""; } });
  row.append(place, latitude, longitude, remove); container.append(row);
}
function openEditor(categoryId, record = null) {
  activeCategoryId = categoryId; editingId = record ? record.id : null; removedAssets = new Map();
  const category = categories.find((item) => item.id === categoryId);
  document.getElementById("form-category").textContent = category.title.toUpperCase();
  document.getElementById("form-title").textContent = record ? "Editar registro" : "Agregar registro";
  document.getElementById("save-item").textContent = record ? "Guardar cambios" : "Guardar registro";
  const box = document.getElementById("record-fields"); box.replaceChildren();
  (category.fields || []).forEach((field) => box.append(fieldControl(field, record)));
  dialog.showModal(); box.querySelector("textarea")?.focus();
}
async function uploadImage(file) {
  if (!file.type.startsWith("image/")) throw new Error(file.name + " no es un archivo de imagen.");
  if (file.size > 12 * 1024 * 1024) throw new Error(file.name + " supera el límite de 12 MB.");
  const response = await fetch("/api/images", { method: "POST", headers: { "Content-Type": file.type }, body: file });
  const result = await response.json(); if (!response.ok) throw new Error(result.error || "No se pudo guardar " + file.name); return result.url;
}
async function uploadVideo(file) {
  if (!file.type.startsWith("video/")) throw new Error(file.name + " no es un archivo de video.");
  if (file.size > 100 * 1024 * 1024) throw new Error(file.name + " supera el límite de 100 MB.");
  const response = await fetch("/api/videos", { method: "POST", headers: { "Content-Type": file.type }, body: file });
  const result = await response.json(); if (!response.ok) throw new Error(result.error || "No se pudo guardar " + file.name); return result.url;
}
form.addEventListener("submit", async (event) => {
  event.preventDefault(); const button = document.getElementById("save-item"); button.disabled = true;
  try {
    const category = categories.find((item) => item.id === activeCategoryId); const data = datasets.get(activeCategoryId);
    const existing = data.items.find((item) => item.id === editingId); const item = { id: editingId || createRecordId() };
    for (const field of category.fields || []) {
      if (field.type === "taxonomy") {
        const fields = form.querySelector('.taxonomy-inputs[data-field-id="' + CSS.escape(field.id) + '"]');
        item[field.id] = {};
        fields?.querySelectorAll("[data-taxonomy-rank]").forEach((input) => { const value = input.value.trim(); if (value) item[field.id][input.dataset.taxonomyRank] = value; });
      } else if (field.type === "interaction") {
        const fields = form.querySelector('.interaction-checkboxes[data-field-id="' + CSS.escape(field.id) + '"]');
        item[field.id] = [...(fields?.querySelectorAll('input[type="checkbox"]:checked') || [])].map((input) => input.value);
      } else if (field.type === "pictures" || field.type === "videos") {
        const old = existing && Array.isArray(existing[field.id]) ? existing[field.id] : [];
        item[field.id] = old.filter((url) => !removedAssets.get(field.id)?.has(url));
        const input = form.querySelector('input[type="file"][data-field-id="' + CSS.escape(field.id) + '"]');
        if (input) for (const file of input.files) item[field.id].push(field.type === "videos" ? await uploadVideo(file) : await uploadImage(file));
      } else if (field.type === "coordinates") {
        const rows = form.querySelectorAll('.coordinate-rows[data-field-id="' + CSS.escape(field.id) + '"] .coordinate-row');
        item[field.id] = [];
        for (const row of rows) {
          const label = row.querySelector('[data-coordinate="label"]').value.trim();
          const latValue = row.querySelector('[data-coordinate="latitude"]').value.trim();
          const lonValue = row.querySelector('[data-coordinate="longitude"]').value.trim();
          if (!latValue && !lonValue) continue;
          if (!latValue || !lonValue) throw new Error("Completá latitud y longitud para cada ubicación.");
          const latitude = Number(latValue), longitude = Number(lonValue);
          if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) throw new Error("Revisá las coordenadas: latitud va de -90 a 90 y longitud de -180 a 180.");
          item[field.id].push({ label, latitude, longitude });
        }
      } else {
        const input = form.querySelector('[data-field-id="' + CSS.escape(field.id) + '"]');
        if (!input) continue;
        item[field.id] = field.type === "name" ? input.value.split("\n").map((value) => value.trim()).filter(Boolean) : input.value.trim();
      }
    }
    const hasNameField = (category.fields || []).some((field) => field.type === "name");
    if (hasNameField && !(category.fields || []).filter((field) => field.type === "name").some((field) => item[field.id]?.length)) throw new Error("Agregá al menos un nombre.");
    data.items = editingId ? data.items.map((current) => current.id === editingId ? item : current) : [item, ...data.items];
    await saveDataset(activeCategoryId); render(); dialog.close(); showMessage("Registro guardado en " + category.title + ".");
  } catch (error) { showMessage(error.message, true); }
  finally { button.disabled = false; }
});
async function deleteRecord(categoryId, record) {
  const category = categories.find((item) => item.id === categoryId); const firstField = (category.fields || []).find((field) => field.type === "name") || category.fields?.[0];
  const value = firstField ? record[firstField.id] : ""; const label = Array.isArray(value) ? value.join(" / ") : value;
  if (!window.confirm("¿Eliminar " + (label || "este registro") + "?")) return;
  const data = datasets.get(categoryId); data.items = data.items.filter((item) => item.id !== record.id);
  try { await saveDataset(categoryId); render(); showMessage("Registro eliminado."); } catch (error) { showMessage(error.message, true); }
}
function addSchemaField(type = "name", labelText = null) {
  const row = document.createElement("div"); row.className = "schema-field-row";
  const select = document.createElement("select"); select.setAttribute("aria-label", "Tipo de campo");
  Object.entries(FIELD_TYPE_NAMES).forEach(([id, label]) => { const option=document.createElement("option"); option.value=id; option.textContent=label; select.append(option); });
  select.value = type;
  const label = document.createElement("input"); label.type="text"; label.maxLength=60; label.required=true; label.setAttribute("aria-label", "Nombre visible del campo"); label.value=labelText || FIELD_TYPE_NAMES[type];
  select.addEventListener("change", () => { label.value = FIELD_TYPE_NAMES[select.value]; });
  const remove = document.createElement("button"); remove.type="button"; remove.className="icon-button"; remove.textContent="×"; remove.title="Quitar campo"; remove.setAttribute("aria-label", "Quitar campo"); remove.addEventListener("click", () => row.remove());
  row.append(select,label,remove); document.getElementById("schema-fields").append(row);
}
function openCategoryDialog() {
  categoryForm.reset(); document.getElementById("schema-fields").replaceChildren();
  addSchemaField("name", "Nombres"); addSchemaField("location", "Ubicación"); addSchemaField("pictures", "Imágenes"); addSchemaField("description", "Descripción");
  addSchemaField("taxonomy", "Taxonomía"); addSchemaField("interaction", "Perfil de interacción");
  categoryDialog.showModal(); document.getElementById("category-title").focus();
}
categoryForm.addEventListener("submit", async (event) => {
  event.preventDefault(); const button=document.getElementById("save-category"); button.disabled=true;
  try {
    const fields=[...document.querySelectorAll(".schema-field-row")].map((row) => ({type:row.querySelector("select").value,label:row.querySelector("input").value.trim()}));
    if (!fields.length) throw new Error("Agregá al menos un campo.");
    const category=await request("/api/categories", {method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({title:document.getElementById("category-title").value.trim(),fields})});
    categories.push(category); datasets.set(category.id,{category:category.title,fields:category.fields,items:[]}); categoryView.order.push(category.id); render(); await saveCategoryView();
    categoryDialog.close(); showMessage("Categoría creada: " + category.title + ".");
  } catch(error) { showMessage(error.message,true); }
  finally {button.disabled=false;}
});
document.getElementById("new-category").addEventListener("click",openCategoryDialog);
document.getElementById("add-schema-field").addEventListener("click",() => addSchemaField());
document.getElementById("hide-stacks-left").addEventListener("click",toggleSideStacks);
document.getElementById("hide-stacks-right").addEventListener("click",toggleSideStacks);
document.getElementById("close-dialog").addEventListener("click",() => dialog.close());
document.getElementById("cancel-dialog").addEventListener("click",() => dialog.close());
document.getElementById("close-category-dialog").addEventListener("click",() => categoryDialog.close());
document.getElementById("cancel-category-dialog").addEventListener("click",() => categoryDialog.close());
document.getElementById("close-map-dialog").addEventListener("click",() => mapDialog.close());
document.getElementById("done-map-dialog").addEventListener("click",() => mapDialog.close());
async function start() {
  try {
    const [loadedCategories, loadedView] = await Promise.all([request("/api/categories"),request("/api/category-view")]);
    categories=loadedCategories; categoryView={order:Array.isArray(loadedView.order)?loadedView.order:categories.map((item)=>item.id),collapsed:Array.isArray(loadedView.collapsed)?loadedView.collapsed:[],stacksHidden:loadedView.stacksHidden===true};
    const loadedDatasets=await Promise.all(categories.map(async(category)=>[category.id,await request("/api/datasets/"+encodeURIComponent(category.id))]));
    datasets=new Map(loadedDatasets); render();
  } catch(error) { showMessage("No se pudieron cargar los datos. Iniciá el servidor con python3 server.py. "+error.message,true); }
}
start();
