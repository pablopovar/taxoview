#!/usr/bin/env python3
"""Small local file-backed server for the Hunters & Gatherers prototype."""
from __future__ import annotations

import json
import mimetypes
import os
from pathlib import Path
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse, unquote
from uuid import uuid4

ROOT = Path(__file__).resolve().parent
DATA = ROOT / "data"
IMAGES = DATA / "images"
VIDEOS = DATA / "videos"
CATEGORIES_FILE = DATA / "categories.json"
CATEGORY_VIEW_FILE = DATA / "category-view.json"
# The user intentionally binds this app to their private VPN interface.
HOST, PORT = "192.168.2.1", 8765
MAX_JSON, MAX_IMAGE, MAX_VIDEO = 8 * 1024 * 1024, 12 * 1024 * 1024, 100 * 1024 * 1024

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
