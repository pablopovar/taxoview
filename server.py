#!/usr/bin/env python3
"""Small local file-backed server for the Hunters & Gatherers prototype."""
from __future__ import annotations

import json
import mimetypes
import os
import urllib.parse
import urllib.request
import time
import threading
from pathlib import Path
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse, unquote, parse_qs
from uuid import uuid4

ROOT = Path(__file__).resolve().parent
DATA = ROOT / "data"
IMAGES = DATA / "images"
VIDEOS = DATA / "videos"
CATEGORIES_FILE = DATA / "categories.json"
CATEGORY_VIEW_FILE = DATA / "category-view.json"
INAT_TAXONOMY_FILE = DATA / "inaturalist" / "cordoba-taxonomy.json"
# The user intentionally binds this app to their private VPN interface.
# Direct Python runs keep the original private VPN binding; Compose overrides this inside the container.
HOST, PORT = os.environ.get("HOST", "192.168.2.1"), int(os.environ.get("PORT", "8765"))
MAX_JSON, MAX_IMAGE, MAX_VIDEO = 64 * 1024 * 1024, 12 * 1024 * 1024, 100 * 1024 * 1024

DEFAULT_FIELDS = [
    {"id": "name", "type": "name", "label": "Nombres"},
    {"id": "location", "type": "location", "label": "Ubicaciones"},
    {"id": "pictures", "type": "pictures", "label": "Imágenes"},
    {"id": "description", "type": "description", "label": "Descripción"},
    {"id": "taxonomy", "type": "taxonomy", "label": "Taxonomía"},
    {"id": "interaction", "type": "interaction", "label": "Perfil de interacción"},
]
FIELD_TYPE_LABELS = {
    "name": "Nombres",
    "location": "Ubicación",
    "pictures": "Imágenes",
    "description": "Descripción",
    "coordinates": "Coordenadas",
    "videos": "Videos",
    "taxonomy": "Taxonomía",
    "interaction": "Perfil de interacción",
}
DEFAULT_CATEGORIES = [
    {"id": "mushrooms", "title": "Hongos", "file": "mushrooms.json", "fields": DEFAULT_FIELDS + [{"id": "coordinates", "type": "coordinates", "label": "Coordenadas"}]},
    {"id": "herbs-and-teas", "title": "Hierbas y tés", "file": "herbs-and-teas.json", "fields": DEFAULT_FIELDS},
    {"id": "plants", "title": "Plantas", "file": "plants.json", "fields": DEFAULT_FIELDS},
]

def read_json(path: Path, fallback):
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return fallback

def write_json(path: Path, value):
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    os.replace(tmp, path)

def categories():
    value = read_json(CATEGORIES_FILE, DEFAULT_CATEGORIES)
    return value if isinstance(value, list) else DEFAULT_CATEGORIES

def category_by_id(category_id: str):
    for category in categories():
        if category.get("id") == category_id:
            return category
    return None

def dataset_path(category):
    filename = Path(category.get("file", "")).name
    if not filename.endswith(".json"):
        raise ValueError("El archivo de datos de la categoría debe terminar en .json.")
    return DATA / filename

def ensure_files():
    DATA.mkdir(exist_ok=True)
    IMAGES.mkdir(exist_ok=True)
    VIDEOS.mkdir(exist_ok=True)
    if not CATEGORIES_FILE.exists():
        write_json(CATEGORIES_FILE, DEFAULT_CATEGORIES)
    for category in categories():
        path = dataset_path(category)
        if not path.exists():
            write_json(path, {
                "category": category["title"],
                "fields": category.get("fields", DEFAULT_FIELDS),
                "items": [],
            })
    if not CATEGORY_VIEW_FILE.exists():
        write_json(CATEGORY_VIEW_FILE, {
            "order": [category["id"] for category in categories()],
            "collapsed": [],
            "stacksHidden": False,
        })

_cached_taxa_by_id = None

def cached_taxa_by_id():
    global _cached_taxa_by_id
    if _cached_taxa_by_id is None:
        cache = read_json(INAT_TAXONOMY_FILE, {})
        _cached_taxa_by_id = {
            item.get("id"): item for item in cache.get("taxa", [])
            if isinstance(item, dict) and item.get("id") is not None
        } if isinstance(cache, dict) else {}
    return _cached_taxa_by_id

def taxon_payload(taxon):
    ranks = {"kingdom": "kingdom", "phylum": "phylum", "class": "class", "order": "order", "family": "family", "genus": "genus", "species": "species"}
    taxonomy = {}
    cached = cached_taxa_by_id()
    ancestors = [cached[taxon_id] for taxon_id in taxon.get("ancestor_ids", []) if taxon_id in cached]
    ancestors.extend(taxon.get("ancestors") or [])
    for ancestor in ancestors + [taxon]:
        key = ranks.get(ancestor.get("rank"))
        if key and ancestor.get("name"):
            taxonomy[key] = ancestor["name"]
    names = [taxon.get("preferred_common_name"), taxon.get("name")]
    return {
        "id": taxon.get("id"), "name": taxon.get("name", ""),
        "common_name": taxon.get("preferred_common_name"), "rank": taxon.get("rank"),
        "matched_term": taxon.get("matched_term"),
        "taxonomy": taxonomy,
        "iconic_taxon_id": taxon.get("iconic_taxon_id"),
        "iconic_taxon_name": taxon.get("iconic_taxon_name"),
        "names": list(dict.fromkeys(name for name in names if name)),
        "url": "https://www.inaturalist.org/taxa/" + str(taxon.get("id")),
    }

_inat_request_lock = threading.Lock()
_inat_next_request = 0.0

def inat_get(path, params=None):
    global _inat_next_request
    query = urllib.parse.urlencode(params or {})
    url = "https://api.inaturalist.org/v1/" + path + ("?" + query if query else "")
    request = urllib.request.Request(url, headers={"User-Agent": "HuntersGatherersPrototype/0.5 (on-demand species lookup)"})
    with _inat_request_lock:
        delay = _inat_next_request - time.monotonic()
        if delay > 0:
            time.sleep(delay)
        try:
            with urllib.request.urlopen(request, timeout=30) as response:
                return json.loads(response.read().decode("utf-8"))
        finally:
            _inat_next_request = time.monotonic() + 1

def import_inat_taxon(taxon_id):
    detail = inat_get("taxa/" + str(int(taxon_id)), {"locale": "es"})
    results = detail.get("results", []) if isinstance(detail, dict) else []
    if not results:
        raise ValueError("iNaturalist no devolvió ese taxón.")
    taxon = results[0]
    if taxon.get("rank") != "species":
        raise ValueError("Solo se pueden agregar taxones de rango especie.")
    ancestors = taxon.get("ancestors") or []
    if not ancestors and taxon.get("ancestor_ids"):
        try:
            ancestor_result = inat_get("taxa", {"id": ",".join(map(str, taxon["ancestor_ids"])), "per_page": 200, "locale": "es"})
            ancestors = ancestor_result.get("results", [])
        except (OSError, ValueError, json.JSONDecodeError):
            ancestors = []
    taxon["ancestors"] = ancestors
    taxon_view = taxon_payload(taxon)

    taxon_names = taxon.get("taxon_names") or []
    if not taxon_names:
        try:
            name_result = inat_get("taxa/" + str(taxon["id"]) + "/names", {"per_page": 500, "locale": "es"})
            taxon_names = name_result.get("results", [])
        except (OSError, ValueError, json.JSONDecodeError):
            taxon_names = []
    names = []
    for name in taxon_names:
        if isinstance(name, dict):
            value = name.get("name")
            if value:
                names.append(value)
    names = list(dict.fromkeys([taxon_view.get("common_name"), taxon.get("name"), *names]))
    names = [name for name in names if name]

    photos = []
    for photo in taxon.get("taxon_photos") or []:
        photo = photo.get("photo", photo) if isinstance(photo, dict) else {}
        if photo.get("url"):
            photos.append({"url": photo["url"], "attribution": photo.get("attribution"), "license": photo.get("license_code") or photo.get("license")})
    if not photos and isinstance(taxon.get("default_photo"), dict) and taxon["default_photo"].get("url"):
        photo = taxon["default_photo"]
        photos.append({"url": photo["url"], "attribution": photo.get("attribution"), "license": photo.get("license_code") or photo.get("license")})

    statuses = taxon.get("conservation_statuses") or []
    if not statuses:
        try:
            status_result = inat_get("taxa/" + str(taxon["id"]) + "/conservation_statuses", {"per_page": 100})
            statuses = status_result.get("results", [])
        except (OSError, ValueError, json.JSONDecodeError):
            statuses = []
    public_statuses = [{key: status.get(key) for key in ("status_name", "status", "authority", "place", "geoprivacy", "iucn", "source") if status.get(key)} for status in statuses if isinstance(status, dict)]

    observations = []
    seasonality = {}
    total = None
    for page in range(1, 51):
        page_data = inat_get("observations", {"taxon_id": taxon["id"], "per_page": 200, "page": page, "order_by": "observed_on", "order": "desc", "locale": "es"})
        rows = page_data.get("results", [])
        total = page_data.get("total_results", total)
        if not rows:
            break
        for observation in rows:
            observed = observation.get("observed_on")
            if observed:
                try:
                    month_day = time.strptime(observed[:10], "%Y-%m-%d")
                    key = time.strftime("%m-%d", month_day)
                    seasonality[key] = seasonality.get(key, 0) + 1
                except ValueError:
                    pass
            coords = observation.get("location")
            latitude = longitude = None
            if coords:
                try:
                    latitude, longitude = [float(part) for part in coords.split(",", 1)]
                except (AttributeError, ValueError):
                    pass
            annotations = []
            for annotation in observation.get("annotations") or []:
                attribute = annotation.get("controlled_attribute") or {}
                value = annotation.get("controlled_value") or {}
                if attribute.get("name") or value.get("name"):
                    annotations.append({"attribute": attribute.get("name"), "value": value.get("name")})
            observation_photos = []
            for item in observation.get("photos") or []:
                photo = item.get("photo", item) if isinstance(item, dict) else {}
                if photo.get("url"):
                    observation_photos.append({"url": photo["url"], "attribution": photo.get("attribution"), "license": photo.get("license_code") or photo.get("license")})
            observations.append({"id": observation.get("id"), "observed_on": observed, "latitude": latitude, "longitude": longitude,
                                 "annotations": annotations, "photos": observation_photos, "url": observation.get("uri") or ("https://www.inaturalist.org/observations/" + str(observation.get("id")))})
        if len(rows) < 200 or len(observations) >= 10000:
            break
    return {
        **taxon_view,
        "names": names,
        "photos": photos,
        "conservation_statuses": public_statuses,
        "observations": observations,
        "seasonality": [{"day": key, "count": count} for key, count in sorted(seasonality.items(), key=lambda item: (item[0][0:2], item[0][3:]))],
        "observations_total": total,
        "observations_retrieved": len(observations),
        "observations_truncated": bool(total and total > len(observations)),
        "source_url": "https://www.inaturalist.org/taxa/" + str(taxon["id"]),
    }

class Handler(BaseHTTPRequestHandler):
    server_version = "HuntersGatherersPrototype/0.2"

    def reply_json(self, value, status=200):
        body = json.dumps(value, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def read_body(self, limit):
        length = int(self.headers.get("Content-Length", "0"))
        if length < 0 or length > limit:
            raise ValueError("Request is too large.")
        return self.rfile.read(length)

    def do_GET(self):
        path = unquote(urlparse(self.path).path)
        if path == "/api/taxa/search":
            query = parse_qs(urlparse(self.path).query).get("q", [""])[0].strip()
            if len(query) < 2:
                self.reply_json([])
                return
            try:
                params = urllib.parse.urlencode({"q": query, "per_page": 50, "sources": "taxa", "locale": "es"})
                request = urllib.request.Request(
                    "https://api.inaturalist.org/v1/search?" + params,
                    headers={"User-Agent": "HuntersGatherersPrototype/0.4 (species lookup)"},
                )
                with urllib.request.urlopen(request, timeout=12) as response:
                    payload = json.loads(response.read().decode("utf-8"))
                results = payload.get("results", []) if isinstance(payload, dict) else payload
                all_taxa = []
                for result in results:
                    if not isinstance(result, dict) or result.get("type") != "Taxon" or not isinstance(result.get("record"), dict):
                        continue
                    taxon = dict(result["record"])
                    taxon["matched_term"] = ", ".join(result.get("matches", []))
                    all_taxa.append(taxon_payload(taxon))
                preferred_group = next((taxon.get("iconic_taxon_id") for taxon in all_taxa if taxon.get("rank") in {"order", "family", "genus"} and taxon.get("iconic_taxon_id")), None)
                taxa = [taxon for taxon in all_taxa if taxon.get("rank") == "species" and (preferred_group is None or taxon.get("iconic_taxon_id") == preferred_group)]
                self.reply_json(taxa)
            except (OSError, ValueError, json.JSONDecodeError) as exc:
                self.reply_json({"error": "No se pudo consultar iNaturalist: " + str(exc)}, 502)
            return
        if path == "/api/categories":
            self.reply_json(categories())
            return
        if path == "/api/category-view":
            self.reply_json(read_json(CATEGORY_VIEW_FILE, {"order": [], "collapsed": []}))
            return
        if path.startswith("/api/datasets/"):
            category = category_by_id(path.removeprefix("/api/datasets/"))
            if not category:
                self.reply_json({"error": "Categoría desconocida."}, 404)
                return
            self.reply_json(read_json(dataset_path(category), {
                "category": category["title"],
                "fields": category.get("fields", DEFAULT_FIELDS),
                "items": [],
            }))
            return
        if path.startswith("/media/"):
            name = Path(path.removeprefix("/media/")).name
            file_path = (IMAGES / name).resolve()
            if file_path.parent != IMAGES.resolve() or not file_path.is_file():
                self.send_error(404)
                return
            body = file_path.read_bytes()
            self.send_response(200)
            self.send_header("Content-Type", mimetypes.guess_type(file_path.name)[0] or "application/octet-stream")
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "no-cache")
            self.end_headers()
            self.wfile.write(body)
            return
        if path.startswith("/video/"):
            name = Path(path.removeprefix("/video/")).name
            file_path = (VIDEOS / name).resolve()
            if file_path.parent != VIDEOS.resolve() or not file_path.is_file():
                self.send_error(404)
                return
            body = file_path.read_bytes()
            self.send_response(200)
            self.send_header("Content-Type", mimetypes.guess_type(file_path.name)[0] or "application/octet-stream")
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "no-cache")
            self.end_headers()
            self.wfile.write(body)
            return
        self.serve_static(path)

    def do_POST(self):
        path = urlparse(self.path).path
        try:
            if path == "/api/taxa/import":
                value = json.loads(self.read_body(32 * 1024).decode("utf-8"))
                try:
                    imported = import_inat_taxon(value.get("taxon_id"))
                except (OSError, ValueError, json.JSONDecodeError, KeyError, TypeError) as exc:
                    status = 400 if isinstance(exc, ValueError) and str(exc).startswith("Solo se pueden agregar") else 502
                    self.reply_json({"error": "No se pudo recuperar la especie desde iNaturalist: " + str(exc)}, status)
                    return
                kingdom = str(imported.get("taxonomy", {}).get("kingdom", "")).lower()
                iconic = str(imported.get("iconic_taxon_name", "")).lower()
                preferred = "fauna" if kingdom == "animalia" or iconic in {"animalia", "mammalia"} else "mushrooms" if kingdom == "fungi" or iconic == "fungi" else "plants"
                category = category_by_id(value.get("category_id")) if isinstance(value, dict) and value.get("category_id") else None
                category = category or category_by_id(preferred) or next((item for item in categories() if any(field.get("type") == "taxonomy" for field in item.get("fields", []))), None)
                if not category:
                    self.reply_json({"error": "No hay una categoría con taxonomía disponible."}, 400)
                    return
                data = read_json(dataset_path(category), {"category": category["title"], "fields": category.get("fields", DEFAULT_FIELDS), "items": []})
                fields = category.get("fields", DEFAULT_FIELDS)
                name_field = next((field["id"] for field in fields if field.get("type") == "name"), None)
                taxonomy_field = next((field["id"] for field in fields if field.get("type") == "taxonomy"), None)
                if not name_field or not taxonomy_field:
                    self.reply_json({"error": "La categoría necesita campos de nombres y taxonomía."}, 400)
                    return
                record = next((item for item in data.get("items", []) if item.get("inaturalist_id") == imported["id"]), None)
                if record is None:
                    record = {"id": str(uuid4()), "inaturalist_id": imported["id"], name_field: imported["names"], taxonomy_field: imported["taxonomy"], "inaturalist": imported}
                    data["items"] = [record, *data.get("items", [])]
                    write_json(dataset_path(category), data)
                else:
                    record[name_field] = imported["names"]
                    record[taxonomy_field] = imported["taxonomy"]
                    record["inaturalist"] = imported
                    write_json(dataset_path(category), data)
                self.reply_json({"category": category, "record": record}, 201)
                return
            if path == "/api/categories":
                value = json.loads(self.read_body(32 * 1024).decode("utf-8"))
                title = str(value.get("title", "")).strip() if isinstance(value, dict) else ""
                raw_fields = value.get("fields", []) if isinstance(value, dict) else []
                if not title or len(title) > 60:
                    self.reply_json({"error": "Ingresá un nombre de hasta 60 caracteres."}, 400)
                    return
                if not isinstance(raw_fields, list) or not raw_fields:
                    self.reply_json({"error": "Agregá al menos un campo."}, 400)
                    return
                fields = []
                used_ids = set()
                for index, field in enumerate(raw_fields, 1):
                    if not isinstance(field, dict) or field.get("type") not in FIELD_TYPE_LABELS:
                        self.reply_json({"error": "Uno de los tipos de campo no está disponible."}, 400)
                        return
                    label = str(field.get("label", "")).strip()
                    if not label or len(label) > 60:
                        self.reply_json({"error": "Cada campo necesita un nombre de hasta 60 caracteres."}, 400)
                        return
                    base = field["type"]
                    field_id = base
                    suffix = 2
                    while field_id in used_ids:
                        field_id = f"{base}-{suffix}"
                        suffix += 1
                    used_ids.add(field_id)
                    fields.append({"id": field_id, "type": base, "label": label})
                base_id = "-".join("".join(c.lower() if c.isalnum() else "-" for c in title).split())
                base_id = "-".join(part for part in base_id.split("-") if part) or "categoria"
                known_ids = {category["id"] for category in categories()}
                category_id = base_id
                suffix = 2
                while category_id in known_ids:
                    category_id = f"{base_id}-{suffix}"
                    suffix += 1
                category = {"id": category_id, "title": title, "file": category_id + ".json", "fields": fields}
                write_json(dataset_path(category), {"category": title, "fields": fields, "items": []})
                updated = categories() + [category]
                write_json(CATEGORIES_FILE, updated)
                self.reply_json(category, 201)
                return
            if path.startswith("/api/datasets/"):
                category = category_by_id(path.removeprefix("/api/datasets/"))
                if not category:
                    self.reply_json({"error": "Categoría desconocida."}, 404)
                    return
                value = json.loads(self.read_body(MAX_JSON).decode("utf-8"))
                if not isinstance(value, dict) or not isinstance(value.get("items"), list):
                    self.reply_json({"error": "El conjunto de datos debe incluir una lista de registros."}, 400)
                    return
                write_json(dataset_path(category), {
                    "category": category["title"],
                    "fields": category.get("fields", DEFAULT_FIELDS),
                    "items": value["items"],
                })
                self.reply_json({"ok": True})
                return
            if path == "/api/category-view":
                value = json.loads(self.read_body(32 * 1024).decode("utf-8"))
                if not isinstance(value, dict):
                    self.reply_json({"error": "La configuración de las categorías debe ser un objeto."}, 400)
                    return
                known = {category["id"] for category in categories()}
                order = list(dict.fromkeys(x for x in value.get("order", []) if x in known))
                order.extend(category["id"] for category in categories() if category["id"] not in order)
                collapsed = list(dict.fromkeys(x for x in value.get("collapsed", []) if x in known))
                write_json(CATEGORY_VIEW_FILE, {
                    "order": order,
                    "collapsed": collapsed,
                    "stacksHidden": value.get("stacksHidden") is True,
                })
                self.reply_json({"ok": True})
                return
            if path == "/api/images":
                content_type = self.headers.get("Content-Type", "").split(";", 1)[0].strip()
                if not content_type.startswith("image/"):
                    self.reply_json({"error": "Seleccioná un archivo de imagen."}, 415)
                    return
                body = self.read_body(MAX_IMAGE)
                if not body:
                    self.reply_json({"error": "El archivo de imagen está vacío."}, 400)
                    return
                ext = mimetypes.guess_extension(content_type) or ".img"
                name = uuid4().hex + ext
                (IMAGES / name).write_bytes(body)
                self.reply_json({"url": "/media/" + name})
                return
            if path == "/api/videos":
                content_type = self.headers.get("Content-Type", "").split(";", 1)[0].strip()
                if not content_type.startswith("video/"):
                    self.reply_json({"error": "Seleccioná un archivo de video."}, 415)
                    return
                body = self.read_body(MAX_VIDEO)
                if not body:
                    self.reply_json({"error": "El archivo de video está vacío."}, 400)
                    return
                ext = mimetypes.guess_extension(content_type) or ".vid"
                name = uuid4().hex + ext
                (VIDEOS / name).write_bytes(body)
                self.reply_json({"url": "/video/" + name})
                return
            self.send_error(404)
        except (ValueError, UnicodeDecodeError, json.JSONDecodeError) as exc:
            self.reply_json({"error": str(exc)}, 400)

    def serve_static(self, url_path):
        relative = url_path.lstrip("/") or "index.html"
        candidate = (ROOT / relative).resolve()
        if ROOT.resolve() not in candidate.parents and candidate != ROOT.resolve():
            self.send_error(403)
            return
        if not candidate.is_file():
            self.send_error(404)
            return
        body = candidate.read_bytes()
        self.send_response(200)
        self.send_header("Content-Type", mimetypes.guess_type(candidate.name)[0] or "application/octet-stream")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, fmt, *args):
        print("%s - %s" % (self.address_string(), fmt % args))

if __name__ == "__main__":
    ensure_files()
    print(f"Cazadores y recolectores disponible en http://{HOST}:{PORT}")
    print("Datos por categoría: " + ", ".join(str(dataset_path(category)) for category in categories()))
    ThreadingHTTPServer((HOST, PORT), Handler).serve_forever()
