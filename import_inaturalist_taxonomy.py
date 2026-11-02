#!/usr/bin/env python3
"""Retrieve iNaturalist taxa reported from Córdoba Province and cache their tree."""
from __future__ import annotations

import json
import time
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlencode
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parent
OUTPUT = ROOT / "data" / "inaturalist" / "cordoba-taxonomy.json"
API = "https://api.inaturalist.org/v1"
PLACE_ID = 10438
PER_PAGE = 500
USER_AGENT = "HuntersGatherersPrototype/0.3 (local taxonomy import)"
MIN_REQUEST_INTERVAL = 1.05
last_request_at = 0.0


def get_json(path: str, params: dict | None = None) -> dict:
    global last_request_at
    wait = MIN_REQUEST_INTERVAL - (time.monotonic() - last_request_at)
    if wait > 0:
        time.sleep(wait)
    url = API + path
    if params:
        url += "?" + urlencode(params)
    request = Request(url, headers={"User-Agent": USER_AGENT, "Accept": "application/json"})
    with urlopen(request, timeout=45) as response:
        result = json.load(response)
    last_request_at = time.monotonic()
    return result


def compact_taxon(taxon: dict) -> dict:
    keys = (
        "id", "parent_id", "rank", "rank_level", "name", "preferred_common_name",
        "ancestry", "is_active", "observations_count", "iconic_taxon_id", "iconic_taxon_name",
    )
    return {key: taxon[key] for key in keys if key in taxon}


def main() -> None:
    place_data = get_json(f"/places/{PLACE_ID}")
    place_results = place_data.get("results", [])
    if not place_results or place_results[0].get("id") != PLACE_ID:
        raise RuntimeError(f"Could not verify iNaturalist place {PLACE_ID}.")
    place = place_results[0]

    first_page = get_json("/observations/species_counts", {
        "place_id": PLACE_ID, "per_page": PER_PAGE, "page": 1, "locale": "es",
    })
    total = first_page.get("total_results")
    if not isinstance(total, int):
        raise RuntimeError("iNaturalist did not return a species-count total.")
    pages = (total + PER_PAGE - 1) // PER_PAGE
    if pages > 20:
        raise RuntimeError(f"Unexpected result size ({total}); refusing an unbounded import.")

    counts = []
    taxa = {}
    page_data = first_page
    for page in range(1, pages + 1):
        if page > 1:
            page_data = get_json("/observations/species_counts", {
                "place_id": PLACE_ID, "per_page": PER_PAGE, "page": page, "locale": "es",
            })
        for result in page_data.get("results", []):
            taxon = result.get("taxon") or {}
            if "id" not in taxon:
                continue
            taxa[taxon["id"]] = compact_taxon(taxon)
            counts.append({"taxon_id": taxon["id"], "observations_count": result.get("count", 0)})
        print(f"Fetched species page {page}/{pages} ({len(counts)}/{total})", flush=True)

    ancestor_ids = set()
    for taxon in taxa.values():
        ancestor_ids.update(int(value) for value in (taxon.get("ancestry") or "").split("/") if value)
    missing_ids = sorted(ancestor_ids - set(taxa))
    # The taxa endpoint rejects batches above 25 IDs with HTTP 422.
    batch_size = 25
    for start in range(0, len(missing_ids), batch_size):
        batch = missing_ids[start:start + batch_size]
        data = get_json("/taxa/" + ",".join(map(str, batch)), {"locale": "es"})
        for taxon in data.get("results", []):
            taxa[taxon["id"]] = compact_taxon(taxon)
        print(f"Fetched ancestor taxa {min(start + batch_size, len(missing_ids))}/{len(missing_ids)}", flush=True)

    document = {
        "source": "iNaturalist API v1",
        "retrieved_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "place": {
            "id": place["id"], "name": place.get("name"), "display_name": place.get("display_name"),
            "place_type": place.get("place_type"), "admin_level": place.get("admin_level"),
            "ancestor_place_ids": place.get("ancestor_place_ids", []),
        },
        "query": {
            "endpoint": "/observations/species_counts",
            "place_id": PLACE_ID,
            "meaning": "Taxa with iNaturalist observations associated with this place, not a complete biological inventory.",
            "species_taxa_returned": len(counts),
            "ancestor_taxa_added": len(taxa) - len(counts),
        },
        "species_observations": counts,
        "taxa": sorted(taxa.values(), key=lambda taxon: (taxon.get("rank_level", 999), taxon.get("name", "").casefold(), taxon["id"])),
    }
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT.write_text(json.dumps(document, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"Saved {len(counts)} species taxa and {len(taxa)} total taxa to {OUTPUT}")


if __name__ == "__main__":
    main()
