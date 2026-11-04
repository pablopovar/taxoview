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
let taxonSearchTimer;
let formTaxonName = "";
let formTaxonRecord = null;
let formTaxonPending = null;
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
  const speciesPage = document.getElementById("species-page");
  const detailMatch = location.hash.match(/^#species\/([^/]+)\/([^/]+)$/);
  document.querySelector(".category-board-wrap").hidden = Boolean(detailMatch);
  speciesPage.hidden = !detailMatch;
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
  if (detailMatch) renderSpeciesPage(decodeURIComponent(detailMatch[1]), decodeURIComponent(detailMatch[2]));
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
  card.dataset.recordId = record.id;
  card.open = collapsedRecords.has(record.id);
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
  const title = document.createElement("a"); title.className = "entry-record-title"; title.href = "#species/" + encodeURIComponent(category.id) + "/" + encodeURIComponent(record.id); title.textContent = titleText;
  title.addEventListener("click", (event) => { event.stopPropagation(); });
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
  const response = await fetch(path, options);
  const body = await response.text();
  let result;
  try { result = JSON.parse(body); }
  catch {
    const contentType = response.headers.get("content-type") || "respuesta sin tipo de contenido";
    throw new Error("El servidor respondió algo que no es JSON (HTTP " + response.status + ", " + contentType + "). Intentá de nuevo.");
  }
  if (!response.ok) throw new Error(result.error || "No se pudo completar la solicitud.");
  return result;
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
      if (key === "species") { input.required = true; input.placeholder = "Obligatoria"; }
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
    if (field.type === "name") input.addEventListener("change", () => populateExactTaxon(input.value.split("\n")[0].trim(), field));
    wrap.append(input);
  }
  return wrap;
}
async function searchTaxa(query) {
  if (!query || query.trim().length < 2) return [];
  return request("/api/taxa/search?q=" + encodeURIComponent(query.trim()));
}
function matchingTaxonomyField() {
  const category = categories.find((item) => item.id === activeCategoryId);
  return (category?.fields || []).find((field) => field.type === "taxonomy");
}
function findLocalTaxa(query) {
  const normalized = query.toLocaleLowerCase();
  const matches = [];
  categories.forEach((category) => {
    const nameField = (category.fields || []).find((field) => field.type === "name");
    const taxonomyField = (category.fields || []).find((field) => field.type === "taxonomy");
    (datasets.get(category.id)?.items || []).forEach((record) => {
      const names = nameField && Array.isArray(record[nameField.id]) ? record[nameField.id] : [];
      const scientific = taxonomyField && record[taxonomyField.id]?.species;
      if ([...names, scientific].filter(Boolean).some((name) => String(name).toLocaleLowerCase().includes(normalized))) {
        matches.push({ category, record, name: scientific || names[0] || "Especie" });
      }
    });
  });
  return matches;
}
function findExactLocalTaxa(query) {
  const normalized = query.toLocaleLowerCase();
  return categories.flatMap((category) => {
    const nameField = (category.fields || []).find((field) => field.type === "name");
    const taxonomyField = (category.fields || []).find((field) => field.type === "taxonomy");
    return (datasets.get(category.id)?.items || []).filter((record) => {
      const names = nameField && Array.isArray(record[nameField.id]) ? record[nameField.id] : [];
      return [...names, taxonomyField && record[taxonomyField.id]?.species].filter(Boolean).some((name) => String(name).toLocaleLowerCase() === normalized);
    }).map((record) => ({ category, record, name: (taxonomyField && record[taxonomyField.id]?.species) || (nameField && record[nameField.id]?.[0]) || "Especie" }));
  });
}
function showTaxonMessage(message) {
  const node = document.createElement("p"); node.className = "taxon-result-rank"; node.textContent = message; taxonResults.append(node);
}
function addTaxonResult(taxon, actionText, action) {
  const row = document.createElement("div"); row.className = "taxon-result";
  const label = document.createElement("div");
  const name = document.createElement("span"); name.className = "taxon-result-name"; name.textContent = taxon.name;
  const rank = document.createElement("span"); rank.className = "taxon-result-rank"; rank.textContent = [taxon.common_name, taxon.rank, taxon.matched_term && "Coincidencia: " + taxon.matched_term].filter(Boolean).join(" · ");
  label.append(name, rank);
  const button = document.createElement("button"); button.type = "button"; button.className = "button button-quiet"; button.textContent = actionText;
  button.addEventListener("click", async () => {
    if (button.disabled) return;
    const originalText = button.textContent;
    button.disabled = true;
    button.textContent = originalText.includes("Agregar") ? "Recuperando datos…" : "Abriendo…";
    row.setAttribute("aria-busy", "true");
    try {
      await action();
      button.textContent = "Listo";
    } catch (error) {
      button.disabled = false;
      button.textContent = originalText;
      row.removeAttribute("aria-busy");
      showMessage(error.message || "No se pudo agregar la especie.", true);
    }
  });
  row.append(label, button); taxonResults.append(row);
}
async function accessLocalTaxon(categoryId, recordId) {
  categoryView.collapsed = categoryView.collapsed.filter((id) => id !== categoryId); categoryView.stacksHidden = false;
  collapsedRecords.delete(recordId); render(); await saveCategoryView();
  const column = document.querySelector('.category-column[data-category="' + CSS.escape(categoryId) + '"]');
  const recordCard = column?.querySelector('.entry-card[data-record-id="' + CSS.escape(recordId) + '"]');
  if (recordCard) { recordCard.open = true; recordCard.scrollIntoView({ behavior: "smooth", block: "center" }); recordCard.classList.add("taxon-highlight"); setTimeout(() => recordCard.classList.remove("taxon-highlight"), 1800); }
  taxonResults.hidden = true;
}
function openSpeciesPage(categoryId, recordId) {
  taxonResults.hidden = true;
  location.hash = "species/" + encodeURIComponent(categoryId) + "/" + encodeURIComponent(recordId);
}
function dataSection(title, contents) {
  const section = document.createElement("section"); section.className = "species-section";
  const heading = document.createElement("h2"); heading.textContent = title; section.append(heading);
  if (contents instanceof Node) section.append(contents); else { const text = document.createElement("p"); text.textContent = contents || "Sin datos disponibles."; section.append(text); }
  return section;
}
function renderSpeciesPage(categoryId, recordId) {
  const page = document.getElementById("species-page"); page.replaceChildren();
  const category = categories.find((item) => item.id === categoryId);
  const record = datasets.get(categoryId)?.items.find((item) => item.id === recordId);
  if (!category || !record) {
    const back = document.createElement("a"); back.href = "#"; back.className = "text-button"; back.textContent = "← Volver a la colección"; page.append(back, dataSection("Registro no encontrado", "No se encontró este registro en la colección local.")); return;
  }
  const nameField = category.fields.find((field) => field.type === "name");
  const taxonomyField = category.fields.find((field) => field.type === "taxonomy");
  const names = nameField && Array.isArray(record[nameField.id]) ? record[nameField.id] : [];
  const detail = record.inaturalist || {};
  const title = document.createElement("h1"); title.textContent = names[0] || record[taxonomyField?.id]?.species || "Especie";
  const back = document.createElement("a"); back.href = "#"; back.className = "text-button"; back.textContent = "← Volver a la colección";
  const source = document.createElement("a"); source.href = detail.source_url || detail.url || "https://www.inaturalist.org/taxa/" + record.inaturalist_id; source.target = "_blank"; source.rel = "noreferrer"; source.textContent = "Ver taxón en iNaturalist";
  const intro = document.createElement("header"); intro.className = "species-heading"; intro.append(back, title, source); page.append(intro);
  page.append(dataSection("Nombres", names.length ? names.join(" · ") : "Sin nombres disponibles."));
  const taxonomyBox = document.createElement("div");
  const taxonomyRenderer = FIELD_TYPES.taxonomy;
  taxonomyRenderer.render(record[taxonomyField?.id] || detail.taxonomy || {}, taxonomyBox);
  const rank = document.createElement("p"); rank.textContent = "Rango: " + (detail.rank || "sin dato"); taxonomyBox.append(rank);
  page.append(dataSection("Taxonomía", taxonomyBox));
  const statuses = Array.isArray(detail.conservation_statuses) ? detail.conservation_statuses : [];
  const statusText = statuses.map((item) => [item.status_name || item.status, item.authority, typeof item.place === "object" ? item.place?.name : item.place].filter(Boolean).join(" · ")).filter(Boolean).join("\n");
  page.append(dataSection("Estado de conservación", statusText || "Sin estado de conservación registrado."));
  const observations = Array.isArray(detail.observations) ? detail.observations : [];
  const photos = [...(detail.photos || []), ...observations.flatMap((observation) => observation.photos || [])];
  const gallery = document.createElement("div"); gallery.className = "species-gallery";
  [...new Map(photos.filter((photo) => photo.url).map((photo) => [photo.url, photo])).values()].forEach((photo) => {
    const figure = document.createElement("figure"); const link = document.createElement("a"); link.href = photo.url; link.target = "_blank"; link.rel = "noreferrer";
    const image = document.createElement("img"); image.src = photo.url; image.loading = "lazy"; image.decoding = "async"; image.alt = "Fotografía de " + title.textContent; link.append(image); figure.append(link);
    const caption = document.createElement("figcaption"); caption.textContent = [photo.attribution, photo.license].filter(Boolean).join(" · ") || "iNaturalist"; figure.append(caption); gallery.append(figure);
  });
  page.append(dataSection("Imágenes", gallery.childElementCount ? gallery : "No hay imágenes en iNaturalist."));
  const datedCounts = new Map((detail.seasonality || []).map((item) => [item.day, item.count]));
  const season = document.createElement("div"); season.className = "seasonality-grid";
  const monthNames = ["enero","febrero","marzo","abril","mayo","junio","julio","agosto","septiembre","octubre","noviembre","diciembre"];
  for (let month = 1; month <= 12; month++) {
    const block = document.createElement("section"); const heading = document.createElement("h3"); heading.textContent = monthNames[month - 1]; block.append(heading);
    const days = document.createElement("p");
    const found = [...datedCounts.entries()].filter(([key]) => Number(key.slice(0, 2)) === month).map(([key, count]) => key.slice(3) + " (" + count + ")");
    days.textContent = found.length ? found.join(" · ") : "Sin registros"; block.append(days); season.append(block);
  }
  page.append(dataSection("Días del año con observaciones", season));
  const mapSection = document.createElement("section"); mapSection.className = "species-section";
  const mapTitle = document.createElement("h2"); mapTitle.textContent = "Avistamientos en el mapa"; mapSection.append(mapTitle);
  const map = document.createElement("div"); map.id = "species-observation-map"; map.className = "species-map"; mapSection.append(map);
  const count = document.createElement("p"); count.textContent = observations.length + " observaciones con fechas recuperadas" + (detail.observations_truncated ? " (iNaturalist informó más; se guardó el máximo disponible por consulta)." : "."); mapSection.append(count);
  const observationList = document.createElement("ul"); observationList.className = "observation-list";
  observations.forEach((observation) => {
    const item = document.createElement("li");
    const link = document.createElement("a"); link.href = observation.url; link.target = "_blank"; link.rel = "noreferrer"; link.textContent = observation.observed_on || "Observación";
    const annotations = (observation.annotations || []).map((annotation) => [annotation.attribute, annotation.value].filter(Boolean).join(": ")).filter(Boolean);
    item.append(link); if (annotations.length) { const note = document.createElement("span"); note.textContent = " · " + annotations.join("; "); item.append(note); }
    observationList.append(item);
  });
  mapSection.append(observationList); page.append(mapSection);
  if (window.L && observations.some((item) => Number.isFinite(item.latitude) && Number.isFinite(item.longitude))) {
    const points = observations.filter((item) => Number.isFinite(item.latitude) && Number.isFinite(item.longitude));
    const mapView = L.map(map, { scrollWheelZoom: false }).setView([points[0].latitude, points[0].longitude], 4);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>' }).addTo(mapView);
    const markers = L.markerClusterGroup ? L.markerClusterGroup() : L.layerGroup();
    points.forEach((point) => {
      const annotations = (point.annotations || []).map((annotation) => [annotation.attribute, annotation.value].filter(Boolean).join(": ")).filter(Boolean).join("; ");
      const popup = document.createElement("div"); const link = document.createElement("a"); link.href = point.url; link.target = "_blank"; link.rel = "noreferrer"; link.textContent = point.observed_on || "Observación"; popup.append(link);
      if (annotations) { const text = document.createElement("p"); text.textContent = annotations; popup.append(text); }
      markers.addLayer(L.marker([point.latitude, point.longitude]).bindPopup(popup));
    });
    mapView.addLayer(markers); if (points.length > 1) mapView.fitBounds(markers.getBounds().pad(0.1));
  } else map.textContent = "No hay coordenadas públicas para mostrar en el mapa.";
}
window.addEventListener("hashchange", render);
async function populateExactTaxon(name) {
  if (!name) return;
  if (formTaxonName.toLocaleLowerCase() === name.toLocaleLowerCase() && formTaxonRecord) return formTaxonRecord;
  if (formTaxonName.toLocaleLowerCase() === name.toLocaleLowerCase() && formTaxonPending) return formTaxonPending;
  const field = matchingTaxonomyField(); if (!field) return;
  formTaxonName = name;
  formTaxonPending = (async () => { try {
    const taxa = await searchTaxa(name);
    const match = taxa.find((taxon) => taxon.rank === "species" && [taxon.name, taxon.common_name].filter(Boolean).some((candidate) => candidate.toLocaleLowerCase() === name.toLocaleLowerCase()));
    if (!match) return;
    const inputs = form.querySelectorAll('.taxonomy-inputs[data-field-id="' + CSS.escape(field.id) + '"] [data-taxonomy-rank]');
    inputs.forEach((input) => { if (match.taxonomy[input.dataset.taxonomyRank]) input.value = match.taxonomy[input.dataset.taxonomyRank]; });
    const imported = await importTaxon(match, { keepSearch: true, categoryId: activeCategoryId, quiet: true });
    formTaxonRecord = imported?.record || null;
    const fullTaxonomy = formTaxonRecord?.[field.id] || match.taxonomy;
    inputs.forEach((input) => { if (fullTaxonomy?.[input.dataset.taxonomyRank]) input.value = fullTaxonomy[input.dataset.taxonomyRank]; });
    showMessage("Datos de " + match.name + " completados desde iNaturalist.");
    return formTaxonRecord;
  } catch (error) { showMessage(error.message, true); }
  finally { formTaxonPending = null; } })();
  return formTaxonPending;
}
const taxonSearch = document.getElementById("taxon-search");
const taxonResults = document.getElementById("taxon-results");
taxonSearch.addEventListener("input", () => {
  clearTimeout(taxonSearchTimer);
  const query = taxonSearch.value.trim();
  if (query.length < 2) { taxonResults.hidden = true; return; }
  taxonSearchTimer = setTimeout(async () => {
    try {
      taxonResults.replaceChildren();
      const localMatches = findLocalTaxa(query);
      const exactLocalMatches = findExactLocalTaxa(query);
      if (taxonSearch.value.trim() !== query) return;
      if (exactLocalMatches.length) {
        showTaxonMessage("Encontrada en la colección local:");
        exactLocalMatches.slice(0, 6).forEach(({ category, record, name }) => addTaxonResult({ name, rank: category.title }, "Acceder", () => accessLocalTaxon(category.id, record.id)));
      } else {
        const taxa = await searchTaxa(query);
        if (taxonSearch.value.trim() !== query) return;
        const exact = taxa.filter((taxon) => [taxon.name, taxon.common_name].filter(Boolean).some((name) => name.toLocaleLowerCase() === query.toLocaleLowerCase()));
        const exactSpecies = exact.find((taxon) => taxon.rank === "species");
        if (exactSpecies) {
          const imported = await importTaxon(exactSpecies, { keepSearch: true });
          if (taxonSearch.value.trim() !== query) return;
          showTaxonMessage("No estaba en la colección. Se agregó desde iNaturalist; podés abrirla ahora:");
          addTaxonResult(exactSpecies, "Acceder ahora", () => openSpeciesPage(imported.category.id, imported.record.id));
        } else if (exact.length) {
          showTaxonMessage("No está en la colección local. Podés agregarlo para verlo en la aplicación:");
          addTaxonResult(exact[0], "Agregar a la colección local", async () => {
            const imported = await importTaxon(exact[0], { keepSearch: true });
            openSpeciesPage(imported.category.id, imported.record.id);
          });
        } else if (taxa.length) {
          showTaxonMessage("No está en la colección local. Encontramos estos grupos y especies en iNaturalist:");
          localMatches.slice(0, 3).forEach(({ category, record, name }) => addTaxonResult({ name, rank: category.title }, "Acceder", () => accessLocalTaxon(category.id, record.id)));
          taxa.forEach((taxon) => {
            addTaxonResult(taxon, "Agregar a la colección local", async () => {
              const imported = await importTaxon(taxon, { keepSearch: true });
              openSpeciesPage(imported.category.id, imported.record.id);
            });
          });
        } else if (localMatches.length) {
          showTaxonMessage("No hay una coincidencia exacta en iNaturalist. Coincidencias locales:");
          localMatches.slice(0, 6).forEach(({ category, record, name }) => addTaxonResult({ name, rank: category.title }, "Acceder", () => accessLocalTaxon(category.id, record.id)));
        } else showTaxonMessage("No se encontraron especies en la colección ni en iNaturalist.");
      }
      taxonResults.hidden = false;
    } catch (error) { taxonResults.replaceChildren(); const empty = document.createElement("p"); empty.className = "taxon-result-rank"; empty.textContent = error.message; taxonResults.append(empty); taxonResults.hidden = false; }
  }, 300);
});
async function importTaxon(taxon, options = {}) {
  if (taxon.rank !== "species") throw new Error("Solo se pueden agregar especies con taxonomía completa.");
  const kingdom = String(taxon.taxonomy?.kingdom || "").toLocaleLowerCase();
  const iconic = String(taxon.iconic_taxon_name || "").toLocaleLowerCase();
  const preferredCategoryId = kingdom === "animalia" || iconic === "animalia" || iconic === "mammalia" ? "fauna"
    : kingdom === "fungi" || iconic === "fungi" ? "mushrooms" : "plants";
  const category = categories.find((item) => item.id === options.categoryId) || categories.find((item) => item.id === preferredCategoryId) || categories.find((item) => (item.fields || []).some((field) => field.type === "taxonomy"));
  if (!category) { showMessage("Creá una categoría con campos de nombres y taxonomía antes de importar.", true); return; }
  const nameField = (category.fields || []).find((field) => field.type === "name");
  const taxonomyField = (category.fields || []).find((field) => field.type === "taxonomy");
  if (!nameField || !taxonomyField) { showMessage("La categoría de destino necesita campos de nombres y taxonomía.", true); return; }
  const response = await request("/api/taxa/import", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ taxon_id: taxon.id, category_id: options.categoryId || undefined }) });
  const data = datasets.get(response.category.id);
  if (!data) throw new Error("No se encontró la categoría local para guardar la especie.");
  const index = data.items.findIndex((item) => item.id === response.record.id);
  if (index < 0) data.items.unshift(response.record); else data.items[index] = response.record;
  const duplicate = index >= 0;
  const record = response.record;
  categoryView.collapsed = categoryView.collapsed.filter((id) => id !== category.id); categoryView.stacksHidden = false;
  render(); await saveCategoryView();
  if (!options.keepSearch) { taxonSearch.value = ""; taxonResults.hidden = true; }
  if (!options.quiet) showMessage(duplicate ? "Datos de iNaturalist actualizados en " + response.category.title + "." : "Especie y observaciones agregadas a " + response.category.title + ".");
  return { category: response.category, record };
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
  formTaxonName = ""; formTaxonRecord = null; formTaxonPending = null;
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
    const nameField = (category.fields || []).find((field) => field.type === "name");
    const nameInput = nameField && form.querySelector('[data-field-id="' + CSS.escape(nameField.id) + '"]');
    if (nameInput) await populateExactTaxon(nameInput.value.split("\n")[0].trim());
    const existing = data.items.find((item) => item.id === editingId) || formTaxonRecord; const item = { id: editingId || formTaxonRecord?.id || createRecordId() };
    if (existing?.inaturalist) item.inaturalist = existing.inaturalist;
    if (existing?.inaturalist_id) item.inaturalist_id = existing.inaturalist_id;
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
    const taxonomyFields = (category.fields || []).filter((field) => field.type === "taxonomy");
    if (taxonomyFields.length && !taxonomyFields.some((field) => String(item[field.id]?.species || "").trim())) throw new Error("Completá la especie en Taxonomía. Podés escribir el nombre científico para completar los rangos desde iNaturalist.");
    data.items = editingId || formTaxonRecord ? data.items.map((current) => current.id === item.id ? item : current) : [item, ...data.items];
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
