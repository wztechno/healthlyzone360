#!/usr/bin/env python3
"""Sources one openly licensed photograph for every record in the image inventory.

Reads ``apps/universal/assets/images/image-inventory.json`` (built by
``scripts/build-image-inventory.php``), finds a Wikimedia Commons photograph for
each record, verifies its licence against a closed allowlist, downloads it,
crops and encodes it to the project's WebP conventions, and records provenance.

## The rules this implements, and why each one is here

**No substitution, ever.** A record either gets a photograph of *that thing* or
it is blocked and reported. The bug this work exists to fix was exactly a
"nearest visual family" mapping — a poached egg standing in for fried chicken —
so an approximate match is a defect, not a fallback.

**No reuse.** Two hard gates: the Commons file title, and the SHA-256 of the
downloaded original. A third signal, dHash, flags visually similar pairs for a
human to look at but never auto-rejects, because a fixed perceptual threshold
both rejects genuinely different photographs (two white powders on white
grounds) and misses heavily edited copies.

**Unknown licences are rejected, not guessed.** The Commons API response is the
verification, and enough of it is persisted (`api_url`, `fetched_at`, Commons'
own `sha1`) to re-run the check later in one request.

**Nothing ships unreviewed.** Automated relevance is not relevance. The pipeline
stages contact sheets of the final crops; a human verdict is recorded per record
and the coverage gate fails without it.

**Re-running is safe.** ``provenance.json`` is the lock file: a record with an
entry, its files on disk and matching output hashes is skipped entirely, so a
re-run never re-picks and never re-downloads. Replacement is transactional —
``--repick`` stages into a temp directory and swaps only once the replacement is
known good, so a failed repick leaves the working image untouched.

Usage:
    python scripts/source_images.py [--limit N] [--only REF,REF] [--kind KIND]
    python scripts/source_images.py --repick REF[,REF]
    python scripts/source_images.py --report [--json]
    python scripts/source_images.py --contact-sheets
    python scripts/source_images.py --self-test
"""

from __future__ import annotations

import argparse
import hashlib
import html
import io
import json
import os
import random
import re
import sys
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass, field
from html.parser import HTMLParser
from pathlib import Path
from typing import Any

from PIL import Image, ImageDraw, ImageOps

if hasattr(sys.stdout, "reconfigure"):  # Windows consoles default to cp1252
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")

ROOT = Path(__file__).resolve().parent.parent
IMAGES = ROOT / "apps" / "universal" / "assets" / "images"
INVENTORY = IMAGES / "image-inventory.json"
OVERRIDES = IMAGES / "source-overrides.json"
PROVENANCE = IMAGES / "provenance.json"
CREDITS = IMAGES / "CREDITS.md"
CACHE = ROOT / "scratchpad" / "image-sourcing"
REVIEW = CACHE / "review"

API = "https://commons.wikimedia.org/w/api.php"
WIKIDATA = "https://www.wikidata.org/w/api.php"
UA = (
    "Healthy360-image-sourcing/1.0 "
    "(+https://github.com/healthy360/Healthy360; incuvate.ai@gmail.com) "
    "Python-urllib"
)
MIN_INTERVAL = 1.2
MAX_ATTEMPTS = 6

# Openverse — the Creative Commons search engine, indexing Flickr, rawpixel,
# StockSnap and Nappy among others. It is where the search widens once
# Commons has been exhausted for a record. Wikimedia is deliberately left out
# of the sources: Commons is searched directly already, and an Openverse copy
# of a Commons file would arrive as different bytes and slip past the
# duplicate gates.
OPENVERSE = "https://api.openverse.org/v1/images/"
OPENVERSE_SOURCES = "flickr,rawpixel,stocksnap,nappy"
OPENVERSE_INTERVAL = 3.2  # 20 requests a minute, anonymous
OPENVERSE_DAILY_RESERVE = 5  # stop with this many of the 200 a day still left

# The library a photograph was published through, as credits name it. It is
# stored per image so a credit can never say "via Wikimedia Commons" about a
# photograph that came from Flickr — which would be a false attribution, not a
# cosmetic slip.
PROVIDER_NAMES = {
    "wikimedia": "Wikimedia Commons",
    "flickr": "Flickr",
    "rawpixel": "rawpixel",
    "stocksnap": "StockSnap",
    "nappy": "Nappy",
    "unsplash": "Unsplash",
}


class OpenverseQuotaLow(RuntimeError):
    """The anonymous daily quota is nearly spent; resume tomorrow from the cache."""

# Commons `extmetadata.License`, lowercased -> (rank, attribution_required).
# Rank 0 is preferred. Anything absent from this table is rejected: unknown is
# not a licence, and guessing one is how an unlicensed file ships.
LICENCE_POLICY: dict[str, tuple[int, bool]] = {
    "cc0": (0, False),
    "pd": (0, False),
    "pd-old": (0, False),
    "pd-old-100": (0, False),
    "pd-old-100-expired": (0, False),
    "pd-old-70": (0, False),
    "pd-old-70-1923": (0, False),
    "pd-us": (0, False),
    "pd-usgov": (0, False),
    "pd-self": (0, False),
    "pd-art": (0, False),
    "cc-by-4.0": (1, True),
    "cc-by-3.0": (1, True),
    "cc-by-2.5": (1, True),
    "cc-by-2.0": (1, True),
    "cc-by-sa-4.0": (2, True),
    "cc-by-sa-3.0": (2, True),
    "cc-by-sa-2.5": (2, True),
    "cc-by-sa-2.0": (2, True),
}

LICENCE_URL = {
    "cc0": "https://creativecommons.org/publicdomain/zero/1.0/",
    "cc-by": "https://creativecommons.org/licenses/by/{v}/",
    "cc-by-sa": "https://creativecommons.org/licenses/by-sa/{v}/",
}

# variant -> (width, height, byte ceiling)
VARIANT_SPEC: dict[str, tuple[int, int, int]] = {
    "thumb": (256, 256, 18_000),
    "card": (640, 360, 60_000),
    "detail": (1280, 720, 120_000),
}

# Wikidata English descriptions that mark a culinary sense, and a botanical one.
# The culinary sense wins: `Artichokes as food` shows the vegetable, while the
# taxon category shows the plant in flower.
CULINARY_SENSE = {
    "food", "foodstuff", "fruit", "vegetable", "herb", "spice", "dish", "cheese",
    "meat", "edible", "condiment", "sauce", "oil", "nut", "seed", "grain", "cereal",
    "legume", "dairy", "beverage", "drink", "dessert", "bread", "fish", "seafood",
    "confection", "ingredient", "flour", "pasta", "sweetener", "cut",
}
TAXON_SENSE = {"species", "genus", "cultivar", "plant", "variety", "subspecies", "taxon"}

# What a bare category name means to an image search. Without this, "Sage"
# returns portraits of people and "Turmeric" returns temple photography.
CATEGORY_HINT = {
    "vegetable": "vegetable fresh",
    "fruit": "fruit fresh",
    "herb-spice": "spice",
    "dairy": "dairy",
    "fish-seafood": "seafood raw",
    "meat-egg": "raw meat",
    "nut-seed": "nuts",
    "grain-starch": "grain",
    "legume": "dried legume",
    "oil-fat-stock": "cooking oil",
    "condiment-sweetener": "condiment",
    "baking-starch": "baking ingredient",
    "desserts": "dessert",
    "packaging-disposables": "disposable packaging",
    "sauce": "sauce bowl",
    "dressings": "salad dressing",
    "meal": "dish plated",
    "dressing": "salad dressing",
}


# Commons holds a great deal of non-photographic media that passes every other
# gate — botanical plates, engravings, museum scans, product labels, maps. The
# brief asks for photographs, so the medium is filtered on the file title, which
# is where Commons reliably states it.
NOT_A_PHOTOGRAPH = re.compile(
    r"\b(engraving|illustration|illustrated|drawing|drawn|painting|painted|sketch|"
    r"lithograph|woodcut|etching|print|plate|diagram|chart|map|logo|poster|stamp|"
    r"coin|banknote|heraldry|coat of arms|escudo|icon|clipart|vector|svg|"
    r"cathedral|church|monument|statue|portrait of|postcard|advertisement|"
    r"botanical|herbarium|specimen|manuscript|codex|fresco|mosaic|"
    r"encyclopedia|encyclopaedia|museum|archive|archives|library|photo from)\b",
    re.IGNORECASE,
)

# A year before 1990 in the title means an archival scan, not food photography.
# This is what separates "Cerebos baking powder 1895" and "At Pier 12, Brooklyn,
# N.Y. S.S. Atlanta" from the modern photographs beside them in the same
# category and under the same licence.
HISTORICAL = re.compile(r"\b(1[0-9]{3}|19[0-8][0-9])\b")


class _Strip(HTMLParser):
    """Commons `Artist`/`Credit` are HTML with nested markup; a regex is not enough."""

    def __init__(self) -> None:
        super().__init__()
        self.parts: list[str] = []

    def handle_data(self, data: str) -> None:
        self.parts.append(data)


def strip_html(value: str | None) -> str:
    if not value:
        return ""
    parser = _Strip()
    parser.feed(value)
    text = html.unescape("".join(parser.parts))
    return re.sub(r"\s+", " ", text).strip()[:160]


def licence_url_for(licence: str) -> str:
    if licence.startswith("pd"):
        return "https://en.wikipedia.org/wiki/Public_domain"
    if licence == "cc0":
        return LICENCE_URL["cc0"]
    match = re.fullmatch(r"(cc-by-sa|cc-by)-([0-9.]+)", licence)
    if match:
        return LICENCE_URL[match.group(1)].format(v=match.group(2))
    return ""


def read_json(path: Path, default: Any = None) -> Any:
    if not path.is_file():
        return default
    return json.loads(path.read_text(encoding="utf-8"))


def write_json_atomic(path: Path, payload: Any) -> None:
    """Write via temp-then-rename so an interrupted run never truncates the lock file."""
    path.parent.mkdir(parents=True, exist_ok=True)
    text = json.dumps(payload, indent=2, ensure_ascii=False) + "\n"
    handle, tmp = tempfile.mkstemp(dir=str(path.parent), suffix=".tmp")
    try:
        # An explicit LF: text mode on Windows would write CRLF, and every
        # regeneration there would then rewrite the whole file as a diff.
        with os.fdopen(handle, "w", encoding="utf-8", newline="\n") as stream:
            stream.write(text)
        os.replace(tmp, path)
    except BaseException:
        Path(tmp).unlink(missing_ok=True)
        raise


# --------------------------------------------------------------------------
# Commons client
# --------------------------------------------------------------------------


class Commons:
    """Throttled, cached, backing-off Commons client.

    Wikimedia blocks anonymous User-Agents outright and rate-limits bursts with
    HTTP 429, so a 400-record run needs all three of a descriptive UA, a serial
    throttle and exponential backoff. Responses are cached on disk so a run that
    dies at record 300 resumes without re-querying the first 299.
    """

    def __init__(self, *, offline: bool = False, interval: float = MIN_INTERVAL) -> None:
        self.offline = offline
        self.interval = interval
        self.last_call = 0.0
        self.last_headers: dict[str, str] = {}
        (CACHE / "search").mkdir(parents=True, exist_ok=True)
        (CACHE / "originals").mkdir(parents=True, exist_ok=True)
        (CACHE / "openverse").mkdir(parents=True, exist_ok=True)

    def _throttle(self) -> None:
        wait = self.interval - (time.monotonic() - self.last_call)
        if wait > 0:
            time.sleep(wait)
        self.last_call = time.monotonic()

    def _fetch(self, url: str) -> bytes:
        for attempt in range(MAX_ATTEMPTS):
            self._throttle()
            try:
                request = urllib.request.Request(url, headers={"User-Agent": UA})
                with urllib.request.urlopen(request, timeout=60) as response:
                    self.last_headers = {k.lower(): v for k, v in response.headers.items()}
                    return response.read()
            except urllib.error.HTTPError as error:
                if error.code in (429, 500, 502, 503, 504) and attempt < MAX_ATTEMPTS - 1:
                    time.sleep(min(60, 2**attempt) + random.uniform(0, 1))
                    continue
                raise
            except (urllib.error.URLError, TimeoutError):
                if attempt < MAX_ATTEMPTS - 1:
                    time.sleep(min(60, 2**attempt) + random.uniform(0, 1))
                    continue
                raise
        raise RuntimeError("unreachable")

    def _openverse_get(self, url: str) -> dict[str, Any]:
        """One Openverse API call, cached forever, stopping before the daily quota runs out.

        Anonymous access allows 20 requests a minute and 200 a day. The minute
        limit is the throttle this instance was built with; the day limit is read
        back from the response headers, and the run stops with a resumable error
        while a few calls are still left rather than discovering the limit as a
        wall of 429s halfway through a record.
        """
        cached = CACHE / "openverse" / f"{hashlib.sha1(url.encode()).hexdigest()}.json"
        if cached.is_file():
            return json.loads(cached.read_text(encoding="utf-8"))
        if self.offline:
            return {}

        payload = json.loads(self._fetch(url).decode("utf-8"))
        cached.write_text(json.dumps(payload), encoding="utf-8")

        left = self.last_headers.get("x-ratelimit-available-anon_sustained")
        if left is not None and left.isdigit() and int(left) < OPENVERSE_DAILY_RESERVE:
            raise OpenverseQuotaLow(f"only {left} anonymous Openverse requests left today")
        return payload

    def openverse_search(self, query: str) -> tuple[dict[str, Any], str]:
        params = {
            "q": query,
            # Commercial use and modification both allowed: this is what keeps
            # NC and ND out, before the allowlist ever sees them.
            "license_type": "commercial,modification",
            "source": OPENVERSE_SOURCES,
            "page_size": "20",
        }
        url = OPENVERSE + "?" + urllib.parse.urlencode(params)
        return self._openverse_get(url), url

    def openverse_image(self, image_id: str) -> tuple[dict[str, Any], str]:
        """One image's full record, for a hand-pinned `openverse:<id>` override."""
        url = f"{OPENVERSE}{urllib.parse.quote(image_id)}/"
        return {"results": [self._openverse_get(url)]}, url

    def search(self, query: str, *, limit: int = 25) -> tuple[dict[str, Any], str]:
        params = {
            "action": "query",
            "generator": "search",
            "gsrsearch": f"filetype:bitmap {query}",
            "gsrnamespace": "6",
            "gsrlimit": str(limit),
            "prop": "imageinfo",
            "iiprop": "url|size|mime|extmetadata|sha1",
            "iiurlwidth": "1600",
            "format": "json",
            "formatversion": "2",
        }
        url = API + "?" + urllib.parse.urlencode(params)
        key = hashlib.sha1(url.encode()).hexdigest()
        cached = CACHE / "search" / f"{key}.json"

        if cached.is_file():
            return json.loads(cached.read_text(encoding="utf-8")), url
        if self.offline:
            return {}, url

        payload = json.loads(self._fetch(url).decode("utf-8"))
        cached.write_text(json.dumps(payload), encoding="utf-8")
        return payload, url

    def _cached_get(self, params: dict[str, str], *, base: str = API) -> tuple[dict[str, Any], str]:
        url = base + "?" + urllib.parse.urlencode({**params, "format": "json", "formatversion": "2"})
        cached = CACHE / "search" / f"{hashlib.sha1(url.encode()).hexdigest()}.json"

        if cached.is_file():
            return json.loads(cached.read_text(encoding="utf-8")), url
        if self.offline:
            return {}, url

        payload = json.loads(self._fetch(url).decode("utf-8"))
        cached.write_text(json.dumps(payload), encoding="utf-8")
        return payload, url

    def category_files(self, category: str, *, limit: int = 40) -> tuple[dict[str, Any], str]:
        """Files held by a Commons category.

        This is the precise path and the default one. Commons' full-text search
        ranks on description prose, so `Apricot` returns a photograph of oranges
        whose caption mentions apricots; a category is a human statement that the
        file depicts the subject. Measured on the first trial batch, full-text
        search was right about two times in eight.
        """
        return self._cached_get(
            {
                "action": "query",
                "generator": "categorymembers",
                "gcmtitle": f"Category:{category}",
                "gcmtype": "file",
                "gcmlimit": str(limit),
                "prop": "imageinfo",
                "iiprop": "url|size|mime|extmetadata|sha1",
                "iiurlwidth": "1600",
            }
        )

    def wikidata_category(self, name: str) -> str | None:
        """The Commons category for the *culinary* sense of a name, via Wikidata.

        This is the primary resolver because plain category titles are riddled
        with homonyms: `Category:Basil` is the saint and the cathedral, not the
        herb, and `Allspice` is also a rose cultivar. Wikidata holds one item per
        sense with an English description, so the food sense can be picked
        deliberately — basil resolves to `Ocimum basilicum`, artichoke to
        `Artichokes as food` — and its `P373` names the Commons category.
        """
        searches = [name]
        if name.lower().endswith("es") and len(name) > 4:
            searches.append(name[:-2])
        if name.lower().endswith("s") and len(name) > 3:
            searches.append(name[:-1])

        hits: list[str] = []
        for term in searches:
            found, _ = self._cached_get(
                {
                    "action": "wbsearchentities",
                    "search": term,
                    "language": "en",
                    "uselang": "en",
                    "type": "item",
                    "limit": "7",
                },
                base=WIKIDATA,
            )
            for hit in found.get("search", []):
                if hit["id"] not in hits:
                    hits.append(hit["id"])

        if not hits:
            return None

        entities, _ = self._cached_get(
            {
                "action": "wbgetentities",
                "ids": "|".join(hits),
                "props": "claims|descriptions|labels",
                "languages": "en",
            },
            base=WIKIDATA,
        )

        best: tuple[int, int, str] | None = None
        for order, qid in enumerate(hits):
            entity = entities.get("entities", {}).get(qid, {})
            description = (entity.get("descriptions", {}).get("en", {}) or {}).get("value", "").lower()
            label = (entity.get("labels", {}).get("en", {}) or {}).get("value", "")

            claims = entity.get("claims", {}).get("P373", [])
            category = next(
                (c["mainsnak"]["datavalue"]["value"] for c in claims if c.get("mainsnak", {}).get("datavalue")),
                None,
            )
            if not category:
                continue

            words = set(re.findall(r"[a-z]+", description))
            if words & CULINARY_SENSE:
                score = 2
            elif words & TAXON_SENSE:
                score = 1
            else:
                continue

            # The item must still be the thing asked for; without this a search
            # for "Sage" happily returns a person described as a herbalist.
            if relevance(label, name) == 0 and relevance(category, name) == 0:
                continue

            if best is None or (score, -order) > (best[0], -best[1]):
                best = (score, order, category)

        return best[2] if best else None

    def categories_exist(self, titles: list[str]) -> set[str]:
        """Which of these category titles actually exist, in one request."""
        if not titles:
            return set()

        payload, _ = self._cached_get(
            {"action": "query", "titles": "|".join(f"Category:{t}" for t in titles[:50])}
        )
        return {
            page["title"][len("Category:") :]
            for page in payload.get("query", {}).get("pages", [])
            if not page.get("missing")
        }

    def find_category(self, term: str) -> str | None:
        """The best-matching Commons category for a subject, or None."""
        payload, _ = self._cached_get(
            {
                "action": "query",
                "list": "search",
                "srsearch": term,
                "srnamespace": "14",
                "srlimit": "5",
            }
        )
        results = payload.get("query", {}).get("search", [])
        return results[0]["title"][len("Category:") :] if results else None

    def titles(self, title: str) -> tuple[dict[str, Any], str]:
        """Fetch one exact File: title, for a hand-pinned override."""
        params = {
            "action": "query",
            "titles": title,
            "prop": "imageinfo",
            "iiprop": "url|size|mime|extmetadata|sha1",
            "iiurlwidth": "1600",
            "format": "json",
            "formatversion": "2",
        }
        url = API + "?" + urllib.parse.urlencode(params)
        key = hashlib.sha1(url.encode()).hexdigest()
        cached = CACHE / "search" / f"{key}.json"

        if cached.is_file():
            return json.loads(cached.read_text(encoding="utf-8")), url
        if self.offline:
            return {}, url

        payload = json.loads(self._fetch(url).decode("utf-8"))
        cached.write_text(json.dumps(payload), encoding="utf-8")
        return payload, url

    def download(self, url: str, sha1: str) -> bytes:
        cached = CACHE / "originals" / f"{sha1}.bin"
        if cached.is_file():
            return cached.read_bytes()
        if self.offline:
            raise RuntimeError("offline: original not cached")
        data = self._fetch(url)
        cached.write_bytes(data)
        return data


# --------------------------------------------------------------------------
# Candidates
# --------------------------------------------------------------------------


@dataclass
class Candidate:
    title: str
    rank: int
    licence: str
    licence_short: str
    attribution_required: bool
    creator: str
    credit: str
    usage_terms: str
    description_url: str
    thumb_url: str
    commons_sha1: str
    width: int
    height: int
    api_url: str
    provider: str = "wikimedia"
    # What the photograph is called where it was published. For a Commons file
    # the unique title already is that; an Openverse id is not, and the
    # relevance ranking and the photograph filter have to read the real title.
    label: str = ""
    licence_url: str = ""

    @property
    def name(self) -> str:
        return self.label or self.title


# Openverse licence codes onto this pipeline's. PDM — the Public Domain Mark,
# for works already out of copyright — is public domain; NC and ND are excluded
# by the search itself and would fall through to None here regardless.
OPENVERSE_LICENCE = {"cc0": "cc0", "pdm": "pd"}


def openverse_licence(result: dict[str, Any]) -> str | None:
    code, version = result.get("license") or "", result.get("license_version") or ""
    if code in OPENVERSE_LICENCE:
        return OPENVERSE_LICENCE[code]
    if code in ("by", "by-sa") and version:
        return f"cc-{code}-{version}"
    return None


def licence_short_name(licence: str) -> str:
    if licence == "cc0":
        return "CC0 1.0"
    if licence.startswith("pd"):
        return "Public domain"
    match = re.fullmatch(r"cc-(by-sa|by)-([0-9.]+)", licence)
    return f"CC {match.group(1).upper()} {match.group(2)}" if match else licence


def candidates_from_openverse(payload: dict[str, Any], api_url: str) -> list[Candidate]:
    """The same gates as a Commons response, applied to an Openverse one.

    Openverse's licence field is a claim relayed from the original publisher,
    so it is only where a candidate starts: the allowlist applies exactly as it
    does to Commons, and a chosen photograph is checked again on its own page
    before it is downloaded (see `verify_at_source`).
    """
    out: list[Candidate] = []

    for result in payload.get("results", []):
        if not result or result.get("mature"):
            continue

        title = result.get("title") or ""
        if NOT_A_PHOTOGRAPH.search(title) or HISTORICAL.search(title):
            continue

        licence = openverse_licence(result)
        policy = LICENCE_POLICY.get(licence or "")
        if policy is None:
            continue

        rank, attribution_required = policy
        creator = (result.get("creator") or "").strip()[:160]
        if attribution_required and not creator:
            continue

        width, height = int(result.get("width") or 0), int(result.get("height") or 0)
        # Size is unknown for some sources; only a size that is known to be too
        # small rules a photograph out.
        if width and height and min(width, height) < 400:
            continue

        provider = result.get("source") or result.get("provider") or "openverse"
        out.append(
            Candidate(
                title=f"openverse:{result['id']}",
                rank=rank,
                licence=licence or "",
                licence_short=licence_short_name(licence or ""),
                attribution_required=attribution_required,
                creator=creator,
                credit=PROVIDER_NAMES.get(provider, provider),
                usage_terms=licence_short_name(licence or ""),
                description_url=result.get("foreign_landing_url") or "",
                thumb_url=result.get("url") or "",
                commons_sha1="",
                width=width,
                height=height,
                api_url=api_url,
                provider=provider,
                label=title,
                licence_url=result.get("license_url") or "",
            )
        )

    return out


def expected_deed(licence: str) -> str:
    """The Creative Commons deed path a source page must link for this licence."""
    if licence == "cc0":
        return "creativecommons.org/publicdomain/zero/1.0"
    if licence.startswith("pd"):
        return "creativecommons.org/publicdomain/mark/1.0"
    match = re.fullmatch(r"cc-(by-sa|by)-([0-9.]+)", licence)
    return f"creativecommons.org/licenses/{match.group(1)}/{match.group(2)}" if match else ""


def verify_at_source(commons: "Commons", candidate: Candidate) -> tuple[dict[str, Any] | None, str]:
    """Confirm the licence on the photograph's own page, not on Openverse's copy of it.

    Openverse records a licence when it indexes a photograph; the photographer
    can have changed it since. A Creative Commons licence already granted cannot
    be withdrawn, but the brief asks for each licence to be verified at its
    source, and the source is the publisher's page. So the page is fetched and
    must link the deed the licence claims — `licenses/by/2.0`, `publicdomain/
    zero/1.0` — or, for CC0 publishers that name it without linking the deed,
    say "CC0" in words. Anything else is refused, and the page's own evidence
    is recorded beside the image.

    Returns the evidence, or None with the reason — and the two failures are
    kept apart on purpose. "The page states a different licence" and "the page
    could not be read" (rawpixel answers scripts with a 403 and a bot check)
    call for different next steps, and a report that merged them would send
    someone looking for a licence change that never happened.
    """
    try:
        page = commons._fetch(candidate.description_url).decode("utf-8", "replace")
    except Exception as error:  # noqa: BLE001 — a page that cannot be read cannot verify anything
        return None, f"source page could not be read ({str(error)[:60]}), so the licence Openverse reports is unconfirmed"

    deeds = sorted(set(re.findall(r"creativecommons\.org/(?:licenses|publicdomain)/[a-z\-]+/[0-9.]+", page)))
    wanted = expected_deed(candidate.licence)
    if wanted and wanted in deeds:
        evidence = wanted
    elif candidate.licence == "cc0" and re.search(r"\bCC0\b", page):
        evidence = "CC0 (named on the page)"
    else:
        found = ", ".join(deeds[:3]) or "no licence deed"
        return None, f"source page shows {found}, not the {candidate.licence_short} Openverse reports"

    return {
        "url": candidate.description_url,
        "checked_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "evidence": evidence,
        "deeds_on_page": deeds[:5],
    }, ""


def candidates_from(payload: dict[str, Any], api_url: str) -> list[Candidate]:
    """Licence-filter a search response into ranked, usable candidates."""
    out: list[Candidate] = []

    for page in payload.get("query", {}).get("pages", []):
        info = (page.get("imageinfo") or [{}])[0]
        meta = info.get("extmetadata", {})

        if info.get("mime") not in ("image/jpeg", "image/png"):
            continue

        if NOT_A_PHOTOGRAPH.search(page["title"]) or HISTORICAL.search(page["title"]):
            continue

        licence = str(meta.get("License", {}).get("value", "")).strip().lower()
        policy = LICENCE_POLICY.get(licence)
        if policy is None:
            continue

        # Trademark and personality-rights markers. Directly relevant to the
        # packaging rows, where a search returns branded objects.
        if strip_html(meta.get("Restrictions", {}).get("value")):
            continue

        rank, attribution_required = policy
        creator = strip_html(meta.get("Artist", {}).get("value"))

        # An unattributable file under a licence that demands attribution
        # cannot be complied with, so it is not usable at any price.
        if attribution_required and not creator:
            continue

        width, height = int(info.get("width", 0)), int(info.get("height", 0))
        if min(width, height) < 400:
            continue

        out.append(
            Candidate(
                title=page["title"],
                rank=rank,
                licence=licence,
                licence_short=strip_html(meta.get("LicenseShortName", {}).get("value")),
                attribution_required=attribution_required,
                creator=creator,
                credit=strip_html(meta.get("Credit", {}).get("value")),
                usage_terms=strip_html(meta.get("UsageTerms", {}).get("value")),
                description_url=info.get("descriptionurl", ""),
                thumb_url=info.get("thumburl") or info.get("url", ""),
                commons_sha1=info.get("sha1", ""),
                width=width,
                height=height,
                api_url=api_url,
            )
        )

    return out


STOPWORDS = {
    "the", "and", "of", "fresh", "raw", "whole", "dried", "green", "red", "white",
    "baby", "small", "large", "medium", "mini", "frozen", "black", "yellow",
}


def relevance(title: str, name: str) -> int:
    """How many significant words of the record name appear in the file title.

    Sorting by this ahead of licence rank is deliberate: the brief asks for
    relevant images first and openly licensed images second, and a public-domain
    photograph of the wrong subject fails the brief in the way that matters.
    """
    words = {w for w in re.findall(r"[a-z]+", name.lower()) if len(w) > 2 and w not in STOPWORDS}
    lowered = title.lower()
    return sum(1 for word in words if word in lowered or word.rstrip("s") in lowered)


def category_candidates(name: str) -> list[str]:
    """Category titles worth trying for a record name, best first.

    These names are catalogue-inverted — `Apple Green` is a kind of apple, not a
    kind of green — so the head noun is usually the first word. Every candidate
    is then gated on `relevance`, which is what stops `Apple Green` resolving to
    `Category:Green` and `Baby Okra` to `Category:Baby`: the qualifier words are
    stopwords, so a category named only after one scores zero and is dropped.
    """
    base, alt = split_parenthetical(name)
    base = re.sub(r"\s+", " ", _PACK_NOISE.sub(" ", invert_commas(base))).strip(" ,-")
    words = base.split()

    ordered: list[str] = [base, base + "s", base + "es"]
    if alt:
        ordered += [alt, alt + "s"]
    if len(words) > 1:
        ordered += [words[0], words[0] + "s", words[-1], words[-1] + "s"]

    out: list[str] = []
    for candidate in ordered:
        candidate = candidate.strip()
        if not candidate or relevance(candidate, name) == 0:
            continue

        # Commons capitalises a category like a sentence, not a title: the spice
        # lives at `Category:Black pepper`, and `Category:Black Pepper` does not
        # exist. Both forms are offered because a proper noun ("Brussels sprouts")
        # keeps its capital in the middle, so neither rule alone finds everything.
        title_case = candidate[:1].upper() + candidate[1:]
        sentence_case = candidate[:1].upper() + candidate[1:].lower()
        for form in (title_case, sentence_case):
            if form not in out:
                out.append(form)
    return out


def rank_candidates(options: list[Candidate], name: str) -> list[Candidate]:
    return sorted(
        options,
        key=lambda c: (-relevance(c.name, name), c.rank, -min(c.width, c.height)),
    )


# --------------------------------------------------------------------------
# Search terms
# --------------------------------------------------------------------------

_PACK_NOISE = re.compile(
    r"\b(\d+\s*(cm|mm|cc|ml|l|g|kg|oz|ply|pcs|pc)|\d+\s*[-–]\s*\d+\s*g?|x\d+|"
    r"packaging line|per pack|bulk)\b",
    re.IGNORECASE,
)


def split_parenthetical(name: str) -> tuple[str, str]:
    match = re.match(r"^(.*?)\s*\(([^)]+)\)\s*$", name)
    if match:
        return match.group(1).strip(), match.group(2).strip()
    return name.strip(), ""


def invert_commas(name: str) -> str:
    """`Mustard, Dijon` reads as `Dijon mustard` to a search engine."""
    if name.count(",") == 1:
        head, tail = (part.strip() for part in name.split(","))
        if head and tail and len(tail.split()) <= 3:
            return f"{tail} {head}"
    return name


def search_terms(record: dict[str, Any], override: dict[str, Any] | None) -> list[str]:
    if override and override.get("query"):
        queries = override["query"]
        return [queries] if isinstance(queries, str) else list(queries)

    base, alt = split_parenthetical(record["name_en"])
    base = _PACK_NOISE.sub(" ", invert_commas(base))
    base = re.sub(r"\s+", " ", base).strip(" ,-")
    hint = CATEGORY_HINT.get(record.get("category") or "", "")

    terms = [f"{base} {hint}".strip(), base]
    if alt:
        terms.insert(1, f"{alt} {hint}".strip())
    return [t for i, t in enumerate(terms) if t and t not in terms[:i]]


# --------------------------------------------------------------------------
# Imaging
# --------------------------------------------------------------------------


def dhash(image: Image.Image, size: int = 8) -> str:
    grey = image.convert("L").resize((size + 1, size), Image.LANCZOS)
    pixels = list(grey.getdata())
    bits = 0
    for row in range(size):
        for col in range(size):
            left = pixels[row * (size + 1) + col]
            right = pixels[row * (size + 1) + col + 1]
            bits = (bits << 1) | int(left < right)
    return f"{bits:016x}"


def hamming(a: str, b: str) -> int:
    return bin(int(a, 16) ^ int(b, 16)).count("1")


def load_original(data: bytes) -> Image.Image:
    image = Image.open(io.BytesIO(data))
    image.load()
    # Commons JPEGs carry orientation; without this the carrots come out sideways.
    image = ImageOps.exif_transpose(image)
    # CMYK JPEGs and palette PNGs both occur on Commons.
    return image.convert("RGB")


def encode_variant(image: Image.Image, variant: str) -> tuple[bytes, int]:
    """Cover-crop to the variant's frame, then step quality down to the ceiling.

    `ImageOps.fit` preserves aspect and crops the overflow, so nothing is ever
    squashed. The vertical centre is nudged up because photographic subjects sit
    above the middle more often than below it.
    """
    width, height, ceiling = VARIANT_SPEC[variant]
    fitted = ImageOps.fit(image, (width, height), Image.LANCZOS, centering=(0.5, 0.42))

    # Noisy subjects (star anise, poppy seeds, crushed herbs) resist compression,
    # so the floor is low enough that the ceiling is reachable rather than
    # advisory. Anything still over is recorded as over-ceiling and reported.
    for quality in range(82, 33, -4):
        buffer = io.BytesIO()
        fitted.save(buffer, "WEBP", quality=quality, method=6)
        if buffer.tell() <= ceiling:
            return buffer.getvalue(), quality

    return buffer.getvalue(), 34


# --------------------------------------------------------------------------
# Provenance
# --------------------------------------------------------------------------


def empty_provenance() -> dict[str, Any]:
    return {
        "_comment": (
            "AUTOGENERATED by scripts/source_images.py — do not edit by hand. Machine-readable "
            "provenance for every photograph under apps/universal/assets/images/. Keyed by "
            "'<family>/<base>'; one entry covers all variants derived from that one source. "
            "CREDITS.md is generated from this file. To change a choice, edit "
            "source-overrides.json and re-run with --repick <ref>."
        ),
        "generated_by": "scripts/source_images.py",
        "licence_policy": {
            "allowed": sorted(LICENCE_POLICY),
            "legacy": ["unsplash"],
            "note": (
                "New images must carry a licence from `allowed`, preferring public domain and "
                "CC0. The 100 files imported before this policy are Unsplash License; that "
                "licence permits commercial use and requires no attribution, so they are "
                "grandfathered with `legacy: true` and keep their recorded credit. `legacy` is "
                "closed — it never applies to a new image."
            ),
        },
        "images": {},
        "blocked": [],
    }


def remember_refusal(provenance: dict[str, Any], ref: str, source_title: str) -> None:
    """Keep every photograph a human refused for a record, for the life of the record.

    A refusal lived only on the entry it refused, and `--repick` replaces that
    entry — so the second replacement forgot the first refusal and could land
    straight back on it. The ranking is deterministic, which makes that likely
    rather than possible: the file that ranked first on pass one ranks first
    again the moment the pass-two pick is claimed instead. Per record, not
    global, because a photograph refused as "anise" may be exactly right for
    "star anise".
    """
    refused = provenance.setdefault("refused", {})
    titles = refused.setdefault(ref, [])
    if source_title and source_title not in titles:
        titles.append(source_title)


def record_key(record: dict[str, Any]) -> str:
    return f"{record['family']}/{record['slug']}"


def variant_paths(record: dict[str, Any]) -> dict[str, Path]:
    return {
        variant: IMAGES / record["family"] / f"{record['slug']}.{variant}.webp"
        for variant in record["variants"]
    }


def sha256_of(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def entry_is_current(entry: dict[str, Any], record: dict[str, Any]) -> bool:
    """A record is done only if every output file exists AND still hashes as recorded.

    Checking existence alone would trust a truncated download or a hand-edited
    file; the hash is what makes a resume a real check.
    """
    for variant, path in variant_paths(record).items():
        recorded = entry.get("outputs", {}).get(variant, {}).get("sha256")
        if not recorded or not path.is_file():
            return False
        if sha256_of(path.read_bytes()) != recorded:
            return False
    return True


# --------------------------------------------------------------------------
# The run
# --------------------------------------------------------------------------


@dataclass
class Run:
    inventory: list[dict[str, Any]]
    overrides: dict[str, dict[str, Any]]
    provenance: dict[str, Any]
    commons: Commons
    # A second client for Openverse, on its own slower throttle: its anonymous
    # limit is 20 a minute where Commons tolerates one every 1.2 seconds.
    openverse: Commons = field(default_factory=lambda: Commons(interval=OPENVERSE_INTERVAL))
    claimed_titles: set[str] = field(default_factory=set)
    claimed_hashes: dict[str, str] = field(default_factory=dict)
    # Refused for the record being resolved right now, and only for it.
    excluded: set[str] = field(default_factory=set)

    def reload_claims(self) -> None:
        self.claimed_titles.clear()
        self.claimed_hashes.clear()
        for key, entry in self.provenance["images"].items():
            if entry.get("source_title"):
                self.claimed_titles.add(entry["source_title"])
            if entry.get("content_sha256"):
                self.claimed_hashes[entry["content_sha256"]] = key

    def block(self, record: dict[str, Any], reason: str, tried: list[str], note: str = "") -> None:
        self.provenance["blocked"] = [
            b for b in self.provenance["blocked"] if b["record_ref"] != record["ref"]
        ]
        self.provenance["blocked"].append(
            {
                "record_ref": record["ref"],
                "kind": record["kind"],
                "name_en": record["name_en"],
                "slug": record["slug"],
                "reason": reason,
                "queries_tried": tried,
                "note": note,
            }
        )

    def resolve(self, record: dict[str, Any]) -> str:
        """Source, convert and record one record. Returns a short status word."""
        override = self.overrides.get(record["ref"])
        terms = search_terms(record, override)
        tried: list[str] = []
        chosen: Candidate | None = None
        seen_total = 0
        seen_free = 0
        taken = 0
        off_subject = 0

        pinned = (override or {}).get("pin")
        if pinned:
            tried.append(f"pin:{pinned}")
            try:
                if pinned.startswith("openverse:"):
                    payload, api_url = self.openverse.openverse_image(pinned[len("openverse:"):])
                    options = candidates_from_openverse(payload, api_url)
                else:
                    payload, api_url = self.commons.titles(pinned)
                    options = candidates_from(payload, api_url)
            except OpenverseQuotaLow:
                raise
            except Exception as error:  # noqa: BLE001
                self.block(record, "transient", tried, str(error)[:120])
                return "transient"
            if not options:
                # A typo in a hand-written pin must be loud, not silently
                # fall through to whatever a search happens to return.
                self.block(record, "pin_not_found", tried, "pinned title missing or not usable")
                return "blocked"
            chosen = options[0]
            if chosen.title in self.claimed_titles:
                # A pin is a human choice, but not a licence to reuse: two records
                # pinning one file would ship the same photograph twice.
                self.block(record, "pin_already_used", tried, "another record already uses this file")
                return "blocked"
            terms = []

        # A human's query outranks every automatic route. An override that names
        # only a `query` is a person saying "search for exactly this", usually
        # because the automatic category is the wrong one — `Beef chuck roll`
        # resolves, by itself, to files about bread rolls. Letting the automatic
        # category run first made every query-only override a silent no-op.
        human_query = bool((override or {}).get("query")) and not (override or {}).get("category")

        # Otherwise categories first, full-text search only as a fallback. A
        # Commons category is a human statement that the file depicts the
        # subject; full-text search ranks on description prose and was right
        # twice in eight on the first trial batch.
        if chosen is None and not human_query:
            base, _ = split_parenthetical(record["name_en"])
            base = re.sub(r"\s+", " ", _PACK_NOISE.sub(" ", invert_commas(base))).strip(" ,-")
            # A human override may name one category or several. Several is the
            # common case once a record has been reviewed and rejected: the person
            # curating it knows the subject but not which of Commons' spellings —
            # `Salmon (food)`, `Salmon as food`, `Raw salmon` — actually holds
            # the photographs, and pooling them costs nothing.
            wanted_override = (override or {}).get("category")
            if isinstance(wanted_override, str):
                wanted_override = [wanted_override]

            # Several categories, not one. A Commons category can exist and hold
            # nothing — `Category:Chives` is empty because the photographs are
            # filed under the binomial `Allium schoenoprasum` — so stopping at
            # the first name that resolves sends a perfectly ordinary herb to
            # the search fallback and then to the blocked list.
            categories: list[str] = list(wanted_override or [])
            if not categories:
                try:
                    # The cleaned base, not the raw name. `Beef, minced` asked of
                    # Wikidata as written finds the animal and lands on a category
                    # of cooked beef dishes; asked as `minced Beef` it finds minced
                    # meat. Catalogue-inverted names are the rule in this data, not
                    # the exception, so this one substitution moves a whole class of
                    # records.
                    guess = self.commons.wikidata_category(base)
                    if guess:
                        categories.append(guess)

                    wanted = category_candidates(record["name_en"])
                    live = self.commons.categories_exist(wanted)
                    exact = [c for c in wanted if c in live and c not in categories]

                    # Exact titles lead. `Category:Cabbage` is cabbage; the Wikidata
                    # sense lookup is the one that can wander off to an insect.
                    categories = exact + categories

                    # Fuzzy lookup last, and only if what it returns names the subject.
                    if not categories:
                        fuzzy = self.commons.find_category(base)
                        if fuzzy and relevance(fuzzy, record["name_en"]) > 0:
                            categories.append(fuzzy)
                except Exception as error:  # noqa: BLE001
                    self.block(record, "transient", tried, str(error)[:120])
                    return "transient"

            # Every category's files are pooled and ranked *together*, rather than
            # taking the first category that yields anything. Wikidata and the
            # exact-title lookup each resolve some names the other cannot, and each
            # gets some wrong: `Cabbage` finds the cabbage looper moth, `Black
            # Pepper` finds peppercorn sauce. Pooling lets the ranking arbitrate —
            # files from `Category:Cabbage` name cabbage and score on relevance,
            # files named `Trichoplusia ni` score zero — so a bad category costs
            # nothing as long as a good one is also in the list.
            pooled: list[Candidate] = []
            for candidate_category in categories[:4]:
                tried.append(f"category:{candidate_category}")
                try:
                    payload, api_url = self.commons.category_files(candidate_category)
                except Exception as error:  # noqa: BLE001
                    self.block(record, "transient", tried, str(error)[:120])
                    return "transient"

                pages = payload.get("query", {}).get("pages", [])
                seen_total += len(pages)
                options = candidates_from(payload, api_url)
                seen_free += len(options)
                pooled += [o for o in options if o.title not in {p.title for p in pooled}]

            for option in rank_candidates(pooled, record["name_en"]):
                if option.title in self.claimed_titles or option.title in self.excluded:
                    taken += 1
                    continue
                chosen = option
                break

        if chosen is None:
            for term in terms:
                tried.append(term)
                try:
                    payload, api_url = self.commons.search(term)
                except Exception as error:  # noqa: BLE001 — a transient fault is data
                    self.block(record, "transient", tried, str(error)[:120])
                    return "transient"

                pages = payload.get("query", {}).get("pages", [])
                seen_total += len(pages)
                options = candidates_from(payload, api_url)
                seen_free += len(options)

                # A search hit must actually name the subject; without this the
                # fallback reintroduces exactly the mismatches categories fixed.
                # "The subject" includes the words of a human-written query: that
                # query exists because the record's own name does not search well
                # (`Keshek` is spelled `kishk` everywhere else), so judging hits
                # against the name alone would reject the very files it found.
                has_human_query = bool((override or {}).get("query"))
                subject = f"{record['name_en']} {term}" if has_human_query else record["name_en"]
                for option in rank_candidates(options, subject):
                    if option.title in self.claimed_titles or option.title in self.excluded:
                        taken += 1
                        continue
                    if relevance(option.name, subject) == 0:
                        off_subject += 1
                        continue
                    chosen = option
                    break
                if chosen:
                    break

        if chosen is None:
            # The reason has to name the actual cause, because it is what tells a
            # human whether to write an override query, widen the licence policy,
            # or accept that the record has no photograph. "All candidates
            # claimed" reported for a record whose candidates were off-subject
            # sends someone looking for a collision that never happened.
            if seen_total == 0:
                reason = "no_results"
            elif seen_free == 0:
                reason = "no_acceptable_licence"
            elif off_subject and not taken:
                reason = "no_relevant_candidate"
            else:
                reason = "all_candidates_claimed"

            self.block(
                record,
                reason,
                tried,
                f"{seen_total} seen, {seen_free} usable, {taken} already taken, "
                f"{off_subject} off-subject",
            )
            return "blocked"

        # Commons is its own source: its API response is the file page's licence.
        # Anything reached through Openverse is checked on the publisher's page
        # before a byte of it is downloaded.
        at_source: dict[str, Any] | None = None
        if chosen.provider != "wikimedia":
            at_source, failure = verify_at_source(self.commons, chosen)
            if at_source is None:
                self.block(
                    record,
                    "licence_unverified_at_source",
                    tried,
                    f"{chosen.description_url}: {failure}",
                )
                return "blocked"

        try:
            data = self.commons.download(chosen.thumb_url, chosen.commons_sha1 or sha256_of(chosen.title.encode()))
            image = load_original(data)
        except Exception as error:  # noqa: BLE001
            self.block(record, "download_failed", tried, str(error)[:120])
            return "blocked"

        content_hash = sha256_of(data)
        if content_hash in self.claimed_hashes:
            self.block(
                record,
                "duplicate_bytes",
                tried,
                f"same photograph as {self.claimed_hashes[content_hash]}",
            )
            return "blocked"

        # Stage every variant before touching the tree: a half-written record is
        # worse than an unwritten one.
        staged: dict[str, tuple[bytes, int]] = {}
        for variant in record["variants"]:
            staged[variant] = encode_variant(image, variant)

        outputs: dict[str, Any] = {}
        for variant, (payload_bytes, quality) in staged.items():
            path = variant_paths(record)[variant]
            path.parent.mkdir(parents=True, exist_ok=True)
            handle, tmp = tempfile.mkstemp(dir=str(path.parent), suffix=".tmp")
            with os.fdopen(handle, "wb") as stream:
                stream.write(payload_bytes)
            os.replace(tmp, path)
            width, height, _ = VARIANT_SPEC[variant]
            outputs[variant] = {
                "file": f"{record['family']}/{record['slug']}.{variant}.webp",
                "sha256": sha256_of(payload_bytes),
                "bytes": len(payload_bytes),
                "width": width,
                "height": height,
                "quality": quality,
            }

        # Openverse hands back the exact deed (Public Domain Mark, a specific CC
        # version); Commons gives a code this pipeline turns into one.
        licence_link = chosen.licence_url or licence_url_for(chosen.licence)
        modifications = "cropped and resized; re-encoded as WebP"

        verified: dict[str, Any] = {
            "api_url": chosen.api_url,
            "fetched_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            "commons_sha1": chosen.commons_sha1,
        }
        if at_source is not None:
            verified["at_source"] = at_source

        self.provenance["images"][record_key(record)] = {
            "record_ref": record["ref"],
            "record_kind": record["kind"],
            "record_name_en": record["name_en"],
            "provider": chosen.provider,
            "source_title": chosen.title,
            "source_label": chosen.name,
            "source_url": chosen.description_url,
            "creator": chosen.creator,
            "credit": chosen.credit,
            "licence": chosen.licence,
            "licence_short_name": chosen.licence_short,
            "licence_url": licence_link,
            "usage_terms": chosen.usage_terms,
            "attribution_required": chosen.attribution_required,
            "modifications": modifications,
            "content_sha256": content_hash,
            "dhash": dhash(image),
            "outputs": outputs,
            "transform": {
                "fit": "cover",
                "centering": [0.5, 0.42],
                "resample": "LANCZOS",
                "encoder": f"Pillow {Image.__version__} WEBP method=6",
            },
            "verified": verified,
            "review": {"verdict": "pending"},
        }

        self.provenance["blocked"] = [
            b for b in self.provenance["blocked"] if b["record_ref"] != record["ref"]
        ]
        self.claimed_titles.add(chosen.title)
        self.claimed_hashes[content_hash] = record_key(record)
        return "resolved"


def select(inventory: list[dict[str, Any]], args: argparse.Namespace) -> list[dict[str, Any]]:
    records = inventory
    if args.kind:
        kinds = set(args.kind.split(","))
        records = [r for r in records if r["kind"] in kinds]
    if args.only:
        refs = set(args.only.split(","))
        records = [r for r in records if r["ref"] in refs]
    return records


LEGACY_ROW = re.compile(
    r"^\|\s*`(?P<file>[^`]+)`\s*\|\s*(?P<creator>[^|]*?)\s*\|\s*"
    r"\[(?P<host>[^\]]*)\]\((?P<url>[^)]*)\)\s*\|\s*(?P<licence>[^|]*?)\s*\|"
)


def backfill_legacy(provenance: dict[str, Any]) -> int:
    """Move the hand-written CREDITS.md table into provenance, once.

    Without this the first generated CREDITS.md would silently delete a hundred
    existing attributions, and the licence allowlist would reject a hundred files
    that were sourced under a different, perfectly valid policy. So the old rows
    become real provenance entries marked `legacy`, and the allowlist admits the
    Unsplash License only where that flag is set — grandfathering the files that
    predate the policy without letting the exception reach a new one.
    """
    if not CREDITS.is_file():
        return 0

    grouped: dict[str, dict[str, Any]] = {}

    for line in CREDITS.read_text(encoding="utf-8").splitlines():
        match = LEGACY_ROW.match(line)
        if not match:
            continue

        relative = match.group("file")
        if not relative.endswith(".webp"):
            continue

        base, _, variant = relative[: -len(".webp")].rpartition(".")
        key = base or relative[: -len(".webp")]
        entry = grouped.setdefault(
            key,
            {
                "record_ref": None,
                "record_kind": "legacy",
                "record_name_en": key.split("/")[-1].replace("-", " "),
                "source_title": relative,
                "source_url": match.group("url"),
                "creator": match.group("creator"),
                "credit": match.group("host"),
                "licence": "unsplash",
                "licence_short_name": match.group("licence"),
                "licence_url": "https://unsplash.com/license",
                "usage_terms": match.group("licence"),
                # The Unsplash License grants commercial use and asks for no
                # attribution; the credit below is kept because provenance should
                # outlive the policy that happened to be in force when it was made.
                "attribution_required": False,
                "modifications": "resized; re-encoded as WebP",
                "legacy": True,
                "outputs": {},
                "review": {"verdict": "accepted", "note": "pre-existing, reviewed in the 2026-09 audit"},
            },
        )

        path = IMAGES / relative
        if path.is_file():
            data = path.read_bytes()
            with Image.open(io.BytesIO(data)) as image:
                width, height = image.size
            entry["outputs"][variant] = {
                "file": relative,
                "sha256": sha256_of(data),
                "bytes": len(data),
                "width": width,
                "height": height,
                "quality": None,
            }

    added = 0
    for key, entry in grouped.items():
        if key in provenance["images"]:
            continue
        provenance["images"][key] = entry
        added += 1

    return added


def render_credits(provenance: dict[str, Any]) -> str:
    """CREDITS.md, generated — the convention survives, the hand-maintenance does not."""
    rows: list[tuple[str, str, str, str]] = []
    obliged = 0

    for entry in provenance["images"].values():
        for output in entry["outputs"].values():
            rows.append(
                (
                    output["file"],
                    entry["creator"] or "—",
                    f"[{PROVIDER_NAMES.get(entry.get('provider', ''), entry['credit'] or 'source')}]({entry['source_url']})"
                    if entry["source_url"]
                    else "—",
                    entry["licence_short_name"] or entry["licence"],
                )
            )
        if entry["attribution_required"]:
            obliged += 1

    rows.sort()
    widths = [max(len(row[column]) for row in rows) if rows else 8 for column in range(4)]
    header = ("File", "Creator", "Source", "Licence")
    widths = [max(widths[i], len(header[i])) for i in range(4)]

    def line(cells: tuple[str, str, str, str]) -> str:
        return "| " + " | ".join(cell.ljust(widths[i]) for i, cell in enumerate(cells)) + " |"

    total_bytes = sum(
        output["bytes"] for entry in provenance["images"].values() for output in entry["outputs"].values()
    )
    sources = {entry["source_url"] for entry in provenance["images"].values() if entry["source_url"]}

    return "\n".join(
        [
            "<!-- AUTOGENERATED from provenance.json by scripts/source_images.py — do not edit by hand. -->",
            "",
            "# Image credits",
            "",
            "Every photograph under `apps/universal/assets/images/` is openly licensed, downloaded and",
            "bundled locally, and served from the app itself — the product makes no external image",
            "requests.",
            "",
            "The photographs decorate **synthetic** fixture data. Meals, recipes, kitchens, subscription",
            "plans and dietitian profiles remain labelled _synthetic prototype data_ on screen; these are",
            "stock photographs chosen to match each record, **not** photographs of real Healthy360",
            "products, premises or staff. Every file has been cropped to a fixed frame and re-encoded as",
            "WebP, which the credits below state because CC BY and CC BY-SA require it.",
            "",
            "Two policies are in force, and the difference is deliberate:",
            "",
            "* **New images** come from Wikimedia Commons and, where Commons had nothing correct, from",
            "  Flickr, rawpixel and StockSnap through [Openverse](https://openverse.org), all under one",
            "  closed allowlist — public domain and CC0 preferred, CC BY and CC BY-SA accepted. A licence",
            "  reported by Openverse is re-checked on the photograph's own page before it is used. Where",
            "  a licence requires attribution the app shows it beside the image, not only here.",
            "* **Legacy images** are the hundred files sourced before that policy, under the",
            "  [Unsplash License](https://unsplash.com/license), which permits commercial use and requires",
            "  no attribution. They are grandfathered and keep the credit recorded for them. The",
            "  allowlist admits that licence only for files already marked `legacy`, so the exception",
            "  cannot spread to a new one.",
            "",
            "CC BY-SA applies share-alike to derivative works **of the photograph**; a cropped copy stays",
            "CC BY-SA, which is what its credit declares. It places no condition on the application code.",
            "",
            f"**{len(rows)} files** ({len(sources)} distinct sources, {obliged} obliging a visible",
            f"credit), {total_bytes / 1024 / 1024:.2f} MiB total.",
            "",
            line(header),
            "| " + " | ".join("-" * widths[i] for i in range(4)) + " |",
            *[line(row) for row in rows],
            "",
        ]
    )


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--limit", type=int, default=0)
    parser.add_argument("--only", default="")
    parser.add_argument("--kind", default="")
    parser.add_argument("--repick", default="")
    parser.add_argument("--report", action="store_true")
    parser.add_argument("--json", action="store_true")
    parser.add_argument("--contact-sheets", action="store_true")
    parser.add_argument("--similar", action="store_true")
    parser.add_argument("--backfill-legacy", action="store_true")
    parser.add_argument("--write-credits", action="store_true")
    parser.add_argument("--accept", default="")
    parser.add_argument("--reject", default="")
    parser.add_argument("--accept-sheet", default="")
    parser.add_argument("--block", default="")
    parser.add_argument("--candidate-sheets", default="")
    parser.add_argument("--library", default="commons", choices=["commons", "openverse"])
    parser.add_argument("--pin", default="")
    parser.add_argument("--reason", default="no_honest_photograph")
    parser.add_argument("--note", default="")
    parser.add_argument("--self-test", action="store_true")
    parser.add_argument("--offline", action="store_true")
    args = parser.parse_args()

    if args.self_test:
        return self_test()

    inventory_doc = read_json(INVENTORY)
    if inventory_doc is None:
        print("missing image-inventory.json — run: php scripts/build-image-inventory.php", file=sys.stderr)
        return 1
    inventory: list[dict[str, Any]] = inventory_doc["records"]

    provenance = read_json(PROVENANCE) or empty_provenance()
    override_doc = read_json(OVERRIDES) or {"items": []}
    overrides = {item["ref"]: item for item in override_doc.get("items", [])}

    if args.backfill_legacy:
        added = backfill_legacy(provenance)
        write_json_atomic(PROVENANCE, provenance)
        print(f"backfilled {added} legacy entries from CREDITS.md")
        return 0

    if args.write_credits:
        CREDITS.write_text(render_credits(provenance), encoding="utf-8", newline="\n")
        print(f"wrote CREDITS.md from {len(provenance['images'])} provenance entries")
        return 0

    if args.accept_sheet:
        # Accepts everything on a reviewed sheet that has not already been
        # rejected. Reviewing happens a sheet at a time and recording it should
        # too — spelling out twenty-odd refs per sheet is the kind of friction
        # that quietly turns into accepting in bulk without looking.
        sheets = read_json(REVIEW / "sheets.json") or {}
        refs: list[str] = []
        for number in args.accept_sheet.split(","):
            key = f"{int(number):03d}"
            if key not in sheets:
                print(f"no sheet {key} — run --contact-sheets first", file=sys.stderr)
                return 1
            refs += sheets[key]

        by_ref = {r["ref"]: record_key(r) for r in inventory}
        accepted = 0
        for ref in refs:
            entry = provenance["images"].get(by_ref.get(ref, ""))
            if entry is None or entry.get("review", {}).get("verdict") == "rejected":
                continue
            entry["review"] = {
                "verdict": "accepted",
                "reviewed_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                "note": args.note or f"reviewed on contact sheet {args.accept_sheet}",
            }
            accepted += 1

        write_json_atomic(PROVENANCE, provenance)
        print(f"accepted {accepted} of {len(refs)} on sheet(s) {args.accept_sheet}")
        return 0

    if args.accept or args.reject:
        # Verdicts are recorded in bulk because review happens in bulk: a contact
        # sheet carries twenty-four crops, and the answer to it is two lists.
        by_ref = {r["ref"]: record_key(r) for r in inventory}
        changed = 0
        for refs, verdict in ((args.accept, "accepted"), (args.reject, "rejected")):
            for ref in [r for r in refs.split(",") if r]:
                entry = provenance["images"].get(by_ref.get(ref, ""))
                if entry is None:
                    print(f"  no image for {ref}", file=sys.stderr)
                    continue
                entry["review"] = {
                    "verdict": verdict,
                    "reviewed_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                    "note": args.note,
                }
                if verdict == "rejected":
                    remember_refusal(provenance, ref, entry["source_title"])
                changed += 1
        write_json_atomic(PROVENANCE, provenance)
        print(f"recorded {changed} verdicts")
        return 0

    if args.report:
        return report(inventory, provenance, as_json=args.json)

    if args.contact_sheets:
        return contact_sheets(inventory, provenance)

    if args.similar:
        return similar_pairs(provenance)

    if args.pin:
        return pin_candidates(args.pin, override_doc)

    run = Run(inventory, overrides, provenance, Commons(offline=args.offline))
    run.openverse = Commons(offline=args.offline, interval=OPENVERSE_INTERVAL)
    run.reload_claims()

    if args.candidate_sheets:
        wanted = args.candidate_sheets.split(",")
        if wanted == ["blocked"]:
            # Everything still without a photograph, except the records a human
            # decided have no honest one — a grid for those would only offer the
            # substitutes that decision refused.
            wanted = [b["record_ref"] for b in provenance["blocked"]
                      if b.get("reason") != "no_honest_photograph"]
        chosen = set(wanted)
        return candidate_sheets(run, [r for r in inventory if r["ref"] in chosen], library=args.library)

    if args.repick:
        refs = args.repick.split(",")
        if refs == ["rejected"]:
            refs = [e["record_ref"] for e in provenance["images"].values()
                    if e.get("review", {}).get("verdict") == "rejected"]
            # A human decided these have no honest photograph. Re-running search on
            # them would only rediscover the substitute that decision refused.
            refs += [b["record_ref"] for b in provenance["blocked"]
                     if b.get("reason") != "no_honest_photograph"]
        wanted = set(refs)
        records = [r for r in inventory if r["ref"] in wanted]
        print(f"re-sourcing {len(records)} records")

        for index, record in enumerate(records, 1):
            key = record_key(record)
            previous = provenance["images"].pop(key, None)
            if previous and previous.get("review", {}).get("verdict") == "rejected":
                remember_refusal(provenance, record["ref"], previous.get("source_title", ""))

            # Every photograph ever refused for this record, not just the latest.
            run.excluded = set(provenance.get("refused", {}).get(record["ref"], []))
            status = run.resolve(record)
            run.excluded = set()

            if status != "resolved" and previous is not None:
                if previous.get("review", {}).get("verdict") == "rejected":
                    # A refused photograph must not ship just because nothing
                    # better was found. Its files go; the record stays blocked.
                    for output in previous.get("outputs", {}).values():
                        (IMAGES / output["file"]).unlink(missing_ok=True)
                else:
                    # A working, accepted image survives a failed replacement.
                    # The new attempt only ever touched a temp file, so putting
                    # the entry back is the whole of the rollback.
                    provenance["images"][key] = previous
                    provenance["blocked"] = [
                        b for b in provenance["blocked"] if b["record_ref"] != record["ref"]
                    ]
                    status = "kept"

            print(f"  [{index:>4}/{len(records)}] {status:10s} {record['ref']:28s} {record['name_en'][:40]}")
            # After every record, as the main loop does: a run of this length
            # dies to a 429 storm sometimes, and it must not take the work with it.
            write_json_atomic(PROVENANCE, provenance)
        return 0

    if args.block:
        # A human decision that no honest photograph exists — a marinade, a
        # mid-preparation stage — recorded as such rather than left to look like
        # a search that has not been run yet.
        by_ref = {r["ref"]: r for r in inventory}
        targets = [r for r in args.block.split(",") if r]
        if targets == ["rejected"]:
            targets = [e["record_ref"] for e in provenance["images"].values()
                       if e.get("review", {}).get("verdict") == "rejected"]
        for ref in targets:
            record = by_ref.get(ref)
            if record is None:
                print(f"  unknown ref {ref}", file=sys.stderr)
                continue
            entry = provenance["images"].pop(record_key(record), None)
            for output in (entry or {}).get("outputs", {}).values():
                (IMAGES / output["file"]).unlink(missing_ok=True)
            run.block(record, args.reason, [], args.note)
            print(f"  blocked    {ref}")
        write_json_atomic(PROVENANCE, provenance)
        return 0

    todo = []
    for record in select(inventory, args):
        entry = provenance["images"].get(record_key(record))
        if entry and entry_is_current(entry, record):
            continue
        todo.append(record)

    if args.limit:
        todo = todo[: args.limit]

    print(f"sourcing {len(todo)} of {len(inventory)} records")
    counts = {"resolved": 0, "blocked": 0, "transient": 0}

    for index, record in enumerate(todo, 1):
        status = run.resolve(record)
        counts[status] = counts.get(status, 0) + 1
        print(f"  [{index:>4}/{len(todo)}] {status:10s} {record['ref']:24s} {record['name_en'][:44]}")
        # Written after every record: a 429 storm at record 200 must lose nothing.
        write_json_atomic(PROVENANCE, provenance)

    print(f"\n{counts}")
    return 0


def report(inventory: list[dict[str, Any]], provenance: dict[str, Any], *, as_json: bool) -> int:
    images = provenance.get("images", {})
    blocked = {b["record_ref"]: b for b in provenance.get("blocked", [])}

    imaged, pending_review, rejected, missing = [], [], [], []
    for record in inventory:
        entry = images.get(record_key(record))
        if entry is None:
            if record["ref"] not in blocked:
                missing.append(record)
            continue
        verdict = entry.get("review", {}).get("verdict")
        if verdict == "accepted":
            imaged.append(record)
        elif verdict == "rejected":
            rejected.append(record)
        else:
            pending_review.append(record)

    if as_json:
        print(
            json.dumps(
                {
                    "total": len(inventory),
                    "accepted": len(imaged),
                    "pending_review": len(pending_review),
                    "rejected": len(rejected),
                    "blocked": len(blocked),
                    "unaccounted": [r["ref"] for r in missing],
                },
                indent=2,
            )
        )
    else:
        print(f"Image sourcing — {len(inventory)} records")
        print(f"  accepted        {len(imaged):>5}")
        print(f"  pending review  {len(pending_review):>5}")
        print(f"  rejected        {len(rejected):>5}   (reviewed and refused; re-source with --repick)")
        print(f"  blocked         {len(blocked):>5}")
        print(f"  unaccounted     {len(missing):>5}")
        if blocked:
            print(f"\nBLOCKERS ({len(blocked)})")
            for entry in list(blocked.values())[:40]:
                print(f"  {entry['record_ref']:24s} {entry['name_en'][:38]:40s} {entry['reason']}")
        if missing:
            print(f"\nUNACCOUNTED ({len(missing)}) — neither imaged nor blocked")
            for record in missing[:40]:
                print(f"  {record['ref']:24s} {record['name_en'][:38]}")

    return 0 if not (missing or pending_review or rejected or blocked) else 1


# Words that mark a photograph of a dish rather than of an ingredient. For an
# ingredient record they push a candidate down the grid, never out of it: the
# ranking that chose one photo per round was undone precisely by titles like
# "Caramelized onion tarts" and "Chocolate chip cookies", which name the
# ingredient and show something made from it.
DISH_WORDS = re.compile(
    r"\b(salad|soup|sandwich|burger|pizza|cake|tart|tarts|cookie|cookies|pie|bun|toast|stew|"
    r"dish|plate|platter|meal|dinner|lunch|breakfast|recipe|served|dessert|pastry|"
    r"cannolo|cannoli|wrap|taco|pasta|noodle|restaurant|menu)\b",
    re.IGNORECASE,
)

GRID_SIZE = 12
OPENVERSE_GRID_SIZE = 18


def gather_openverse(run: "Run", record: dict[str, Any], override: dict[str, Any] | None) -> list[Candidate]:
    """Up to eighteen Openverse candidates for a record Commons could not serve.

    Two searches at most — the curated query and the name itself — because the
    anonymous quota is 200 calls a day and a grid for every blocked record has to
    fit inside one. Commons candidates are left out on purpose: these records
    have already had a Commons grid reviewed with nothing correct in it, so
    showing those files again would only spend cells.
    """
    override = override or {}
    base, _ = split_parenthetical(record["name_en"])
    base = re.sub(r"\s+", " ", _PACK_NOISE.sub(" ", invert_commas(base))).strip(" ,-")

    refused = set(run.provenance.get("refused", {}).get(record["ref"], []))
    pool: dict[str, Candidate] = {}
    for query in dict.fromkeys(q for q in (override.get("query"), base) if q):
        payload, url = run.openverse.openverse_search(query)
        for option in candidates_from_openverse(payload, url):
            pool.setdefault(option.title, option)

    usable = [o for o in pool.values() if o.title not in refused and o.title not in run.claimed_titles]
    subject = f"{record['name_en']} {override.get('query', '')}"
    is_ingredient = record["kind"] == "ingredient"

    def order(option: Candidate) -> tuple[int, int, int]:
        dishy = 1 if is_ingredient and DISH_WORDS.search(option.name) else 0
        return (dishy, -relevance(option.name, subject), option.rank)

    return sorted(usable, key=order)[:OPENVERSE_GRID_SIZE]


def gather_candidates(run: "Run", record: dict[str, Any], override: dict[str, Any] | None) -> list[Candidate]:
    """A wide pool for one record, for a human to choose from.

    The sourcing passes showed one photograph per record per round, so four
    rounds meant three or four files looked at out of the dozens Commons holds
    for an ordinary food — and when the ranking's first choice was a dish, the
    right photograph further down was never seen. This pools every route the
    pipeline knows (curated categories, spent categories, exact-title and
    Wikidata categories, the human query and the name itself) and lets a person
    pick, with everything already refused for this record and everything another
    record already uses taken out first.
    """
    override = override or {}
    base, _ = split_parenthetical(record["name_en"])
    base = re.sub(r"\s+", " ", _PACK_NOISE.sub(" ", invert_commas(base))).strip(" ,-")

    categories: list[str] = []
    for key in ("category", "exhausted_categories"):
        value = override.get(key) or []
        categories += [value] if isinstance(value, str) else list(value)
    try:
        wanted = category_candidates(record["name_en"])
        live = run.commons.categories_exist(wanted)
        categories += [c for c in wanted if c in live]
        guess = run.commons.wikidata_category(base)
        if guess:
            categories.append(guess)
    except Exception:  # noqa: BLE001 — a grid with fewer sources is still a grid
        pass

    queries = [q for q in (override.get("query"), base, f"{base} {CATEGORY_HINT.get(record.get('category') or '', '')}".strip()) if q]

    refused = set(run.provenance.get("refused", {}).get(record["ref"], []))
    pool: dict[str, Candidate] = {}

    for category in dict.fromkeys(categories):
        try:
            payload, url = run.commons.category_files(category)
        except Exception:  # noqa: BLE001
            continue
        for option in candidates_from(payload, url):
            pool.setdefault(option.title, option)

    for query in dict.fromkeys(queries):
        try:
            payload, url = run.commons.search(query)
        except Exception:  # noqa: BLE001
            continue
        for option in candidates_from(payload, url):
            pool.setdefault(option.title, option)

    usable = [o for o in pool.values() if o.title not in refused and o.title not in run.claimed_titles]
    subject = f"{record['name_en']} {override.get('query', '')}"
    is_ingredient = record["kind"] == "ingredient"

    def order(option: Candidate) -> tuple[int, int, int, int]:
        dishy = 1 if is_ingredient and DISH_WORDS.search(option.name) else 0
        return (dishy, -relevance(option.name, subject), option.rank, -min(option.width, option.height))

    return sorted(usable, key=order)[:GRID_SIZE]


def grid_thumbnail(run: "Run", option: Candidate) -> Image.Image | None:
    """A small copy for the grid — never the full original, which is only fetched once picked."""
    small = option.thumb_url.replace("/1600px-", "/240px-")
    # Flickr serves every size from its own CDN by suffix (_n is 320px), which
    # also keeps grid thumbnails out of the Openverse daily quota entirely.
    if "staticflickr.com" in small:
        small = re.sub(r"_[a-z]\.(jpg|png)$", r"_n.\1", small)
    cached = CACHE / "grid" / f"{hashlib.sha1(small.encode()).hexdigest()}.bin"
    cached.parent.mkdir(parents=True, exist_ok=True)
    try:
        if not cached.is_file():
            cached.write_bytes(run.commons._fetch(small))
        return load_original(cached.read_bytes())
    except Exception:  # noqa: BLE001 — an unfetchable cell renders blank, it does not end the sheet
        return None


def candidate_sheets(run: "Run", targets: list[dict[str, Any]], *, library: str = "commons") -> int:
    """Numbered candidate grids, three records to a sheet.

    `library` picks the pool: Commons (twelve cells) or Openverse (eighteen),
    the second being where the search widens for records Commons has failed.
    """
    REVIEW.mkdir(parents=True, exist_ok=True)
    for stale in REVIEW.glob("candidates-*.png"):
        stale.unlink()

    size = OPENVERSE_GRID_SIZE if library == "openverse" else GRID_SIZE
    index: dict[str, list[str]] = {}
    cols, cell, pad, head, label = 6, 150, 6, 22, 14
    per_sheet = 3
    block_h = head + -(-size // cols) * (cell + label + pad)
    sheets = 0

    for start in range(0, len(targets), per_sheet):
        chunk = targets[start : start + per_sheet]
        sheet = Image.new("RGB", (cols * (cell + pad) + pad, per_sheet * block_h + pad), (245, 244, 238))
        draw = ImageDraw.Draw(sheet)

        for slot, record in enumerate(chunk):
            override = run.overrides.get(record["ref"])
            try:
                options = (gather_openverse(run, record, override) if library == "openverse"
                           else gather_candidates(run, record, override))
            except OpenverseQuotaLow as reason:
                # Everything fetched so far is cached; tomorrow's run picks up here.
                write_json_atomic(REVIEW / "candidates.json", index)
                print(f"stopped: {reason}. Re-run the same command tomorrow to continue.")
                return 1
            index[record["ref"]] = [o.title for o in options]
            top = pad + slot * block_h
            draw.text((pad, top + 4), f"{record['ref']}  {record['name_en']}  ({len(options)} candidates)", fill=(23, 26, 23))

            for number, option in enumerate(options, 1):
                col, row = (number - 1) % cols, (number - 1) // cols
                x = pad + col * (cell + pad)
                y = top + head + row * (cell + label + pad)
                thumb = grid_thumbnail(run, option)
                if thumb is not None:
                    sheet.paste(ImageOps.fit(thumb, (cell, cell), Image.LANCZOS), (x, y))
                draw.rectangle((x, y, x + 22, y + 16), fill=(23, 26, 23))
                draw.text((x + 4, y + 2), str(number), fill=(255, 255, 255))
                draw.text((x, y + cell + 1), option.licence[:14], fill=(92, 97, 89))

        sheets += 1
        sheet.save(REVIEW / f"candidates-{sheets:03d}.png")
        write_json_atomic(REVIEW / "candidates.json", index)
        print(f"  sheet {sheets:03d}: " + ", ".join(r["ref"] for r in chunk))

    print(f"wrote {sheets} candidate sheets for {len(targets)} records to {REVIEW}")
    return 0


def pin_candidates(spec: str, overrides_doc: dict[str, Any]) -> int:
    """Record picks from the candidate grids as pins — `REF:N` is cell N on that record's grid."""
    grids = read_json(REVIEW / "candidates.json") or {}
    by_ref = {item["ref"]: item for item in overrides_doc["items"]}
    pinned = 0
    for pick in [p for p in spec.split(",") if p]:
        ref, _, number = pick.partition(":")
        titles = grids.get(ref, [])
        if not number.isdigit() or not 1 <= int(number) <= len(titles):
            print(f"  {pick}: no such cell", file=sys.stderr)
            continue
        entry = by_ref.setdefault(ref, {"ref": ref})
        entry["pin"] = titles[int(number) - 1]
        entry["note"] = (entry.get("note", "") + " Pinned from the candidate grid after the ranked passes "
                         "had only ever shown one photograph per round.").strip()
        pinned += 1

    overrides_doc["items"] = sorted(by_ref.values(), key=lambda item: item["ref"])
    OVERRIDES.write_text(json.dumps(overrides_doc, indent=4, ensure_ascii=False) + "\n", encoding="utf-8", newline="\n")
    print(f"pinned {pinned} record(s)")
    return 0


def similar_pairs(provenance: dict[str, Any], threshold: int = 6) -> int:
    """List visually similar pairs for a human to look at — never a gate.

    Exact reuse is already refused by the hard gates (same Commons file, same
    downloaded bytes). What they cannot see is the same *photograph* arriving
    twice through different uploads, or a recolour/crop of one, which the brief
    forbids as a "superficial variant". dHash is a cheap signal for that — and a
    noisy one: two photographs of white powder on a white ground hash alike and
    are genuinely different images. So this prints candidates for review and
    exits 0; the decision stays with whoever reads it.
    """
    entries = [
        (key, entry["dhash"])
        for key, entry in provenance["images"].items()
        if entry.get("dhash") and entry.get("review", {}).get("verdict") != "rejected"
    ]
    found = 0
    for i, (left, left_hash) in enumerate(entries):
        for right, right_hash in entries[i + 1 :]:
            distance = hamming(left_hash, right_hash)
            if distance <= threshold:
                found += 1
                print(f"  {distance:>2}  {left:44s} {right}")
    print(f"{found} pair(s) within dHash distance {threshold} — review, do not auto-reject")
    return 0


def contact_sheets(inventory: list[dict[str, Any]], provenance: dict[str, Any]) -> int:
    """Tile the final crops into reviewable sheets.

    Relevance is the one property no automated gate establishes — a file can pass
    licence, uniqueness and search-rank checks and still show the wrong plant. So
    the crops that will actually ship are tiled with their record names, 24 to a
    sheet, for a human to scan and reject.
    """
    REVIEW.mkdir(parents=True, exist_ok=True)
    for stale in REVIEW.glob("sheet-*.png"):
        stale.unlink()

    cells: list[tuple[str, str, Path]] = []
    index: dict[str, list[str]] = {}
    for record in inventory:
        entry = provenance["images"].get(record_key(record))
        if entry is None:
            continue
        # Only what is still waiting for a verdict. A second pass over the
        # replacements should not make anyone re-read the hundred-odd images
        # that were already accepted — that is how attention runs out before
        # the review does.
        if entry.get("review", {}).get("verdict") in ("accepted", "rejected"):
            continue
        variant = "thumb" if "thumb" in record["variants"] else "card"
        path = variant_paths(record)[variant]
        if path.is_file():
            cells.append((record["ref"], f"{record['ref']} {record['name_en']}", path))

    cols, rows, cell, pad, label = 6, 4, 180, 8, 26
    per_sheet = cols * rows
    sheets = 0

    for start in range(0, len(cells), per_sheet):
        chunk = cells[start : start + per_sheet]
        width = cols * (cell + pad) + pad
        height = rows * (cell + label + pad) + pad
        sheet = Image.new("RGB", (width, height), (245, 244, 238))
        draw = ImageDraw.Draw(sheet)

        for position, (_, caption, path) in enumerate(chunk):
            col, row = position % cols, position // cols
            x = pad + col * (cell + pad)
            y = pad + row * (cell + label + pad)
            with Image.open(path) as image:
                sheet.paste(ImageOps.fit(image.convert("RGB"), (cell, cell), Image.LANCZOS), (x, y))
            draw.text((x, y + cell + 4), caption[:34], fill=(23, 26, 23))
            draw.text((x, y + cell + 14), caption[34:68], fill=(92, 97, 89))

        sheets += 1
        sheet.save(REVIEW / f"sheet-{sheets:03d}.png")
        index[f"{sheets:03d}"] = [ref for ref, _, _ in chunk]

    # What was on each sheet, so a verdict can name the sheet rather than
    # twenty-four refs. Reviewing happens a sheet at a time; recording it should
    # too, or the friction pushes the work towards accepting in bulk unseen.
    write_json_atomic(REVIEW / "sheets.json", index)

    print(f"wrote {sheets} contact sheets covering {len(cells)} images to {REVIEW}")
    return 0


def self_test() -> int:
    """Assertions over the pure parts — no network, no files."""
    assert split_parenthetical("Corn starch (cornflour)") == ("Corn starch", "cornflour")
    assert invert_commas("Mustard, Dijon") == "Dijon Mustard"
    assert invert_commas("Salt") == "Salt"

    assert strip_html('<a href="#">Jane <b>Doe</b></a>') == "Jane Doe"
    assert strip_html(None) == ""

    assert LICENCE_POLICY["cc0"] == (0, False)
    assert LICENCE_POLICY["cc-by-sa-4.0"] == (2, True)
    assert "cc-by-nc-4.0" not in LICENCE_POLICY
    assert "unsplash" not in LICENCE_POLICY, "legacy licence must never be usable for a new image"

    assert licence_url_for("cc-by-sa-4.0") == "https://creativecommons.org/licenses/by-sa/4.0/"
    assert licence_url_for("cc-by-2.0") == "https://creativecommons.org/licenses/by/2.0/"

    red = Image.new("RGB", (1200, 800), (200, 30, 30))
    for variant, (width, height, ceiling) in VARIANT_SPEC.items():
        data, quality = encode_variant(red, variant)
        with Image.open(io.BytesIO(data)) as out:
            assert out.size == (width, height), f"{variant} {out.size}"
        assert len(data) <= ceiling, f"{variant} {len(data)} > {ceiling}"
        assert 50 <= quality <= 82

    # A cover-crop of a wide source must not squash: a circle stays a circle.
    wide = Image.new("RGB", (1600, 400), (255, 255, 255))
    ImageDraw.Draw(wide).ellipse((700, 100, 900, 300), fill=(0, 0, 0))
    fitted = ImageOps.fit(wide, (256, 256), Image.LANCZOS, centering=(0.5, 0.42))
    assert fitted.size == (256, 256)

    assert relevance("File:Almond 1.JPG", "Almonds") == 1
    assert relevance("File:Orange tray.jpg", "Apricot") == 0
    assert relevance("File:Akawi Cheese.jpg", "Akkawi cheese") == 1, "matches on the shared word"
    ranked = rank_candidates(
        [
            Candidate("File:Wrong.jpg", 0, "cc0", "CC0", False, "", "", "", "", "", "", 900, 900, ""),
            Candidate("File:Apricot.jpg", 2, "cc-by-sa-4.0", "", True, "A", "", "", "", "", "", 900, 900, ""),
        ],
        "Apricot",
    )
    assert ranked[0].title == "File:Apricot.jpg", "relevance must outrank licence preference"

    assert NOT_A_PHOTOGRAPH.search("File:Artichoke botanical plate.jpg")
    assert NOT_A_PHOTOGRAPH.search("File:Saint Basil's Cathedral.jpg")
    assert not NOT_A_PHOTOGRAPH.search("File:Fresh apricots in a bowl.jpg")
    assert NOT_A_PHOTOGRAPH.search("File:Artichoke heads from The Encyclopedia of Food.jpg")
    assert HISTORICAL.search("File:Cerebos baking powder 1895.jpg")
    assert not HISTORICAL.search("File:Beef February2007.jpg"), "a modern photo keeps its year"
    assert not HISTORICAL.search("File:Apricots 2 - Farmer's Market.jpg")

    assert category_candidates("Apple Green")[0] == "Apple Green"
    assert "Green" not in category_candidates("Apple Green"), "a colour is not a subject"
    assert "Baby" not in category_candidates("Baby Okra"), "a size is not a subject"
    assert "Okra" in category_candidates("Baby Okra")
    assert "Apples" in category_candidates("Apple Red")

    assert hamming("0000000000000000", "0000000000000001") == 1
    assert hamming("ffffffffffffffff", "ffffffffffffffff") == 0
    noise = Image.effect_noise((64, 64), 40).convert("RGB")
    assert dhash(noise) != dhash(red)

    # Openverse licences map onto the same allowlist, and nothing else gets in.
    assert openverse_licence({"license": "cc0", "license_version": "1.0"}) == "cc0"
    assert openverse_licence({"license": "pdm", "license_version": "1.0"}) == "pd"
    assert openverse_licence({"license": "by", "license_version": "2.0"}) == "cc-by-2.0"
    assert openverse_licence({"license": "by-sa", "license_version": "4.0"}) == "cc-by-sa-4.0"
    assert openverse_licence({"license": "by-nc", "license_version": "2.0"}) is None
    assert openverse_licence({"license": "by-nd", "license_version": "4.0"}) is None
    assert expected_deed("cc-by-2.0") == "creativecommons.org/licenses/by/2.0"
    assert expected_deed("cc-by-sa-3.0") == "creativecommons.org/licenses/by-sa/3.0"
    assert expected_deed("cc0") == "creativecommons.org/publicdomain/zero/1.0"
    assert licence_short_name("cc-by-sa-2.0") == "CC BY-SA 2.0"

    ov = candidates_from_openverse(
        {"results": [
            {"id": "a1", "title": "Condensed milk", "license": "by", "license_version": "2.0",
             "creator": "R", "source": "flickr", "foreign_landing_url": "https://flickr/x",
             "url": "https://live.staticflickr.com/1/2_b.jpg", "width": 1024, "height": 768},
            {"id": "a2", "title": "Milk", "license": "by-nc", "license_version": "2.0",
             "creator": "R", "source": "flickr", "width": 1024, "height": 768},
            {"id": "a3", "title": "Milk", "license": "by", "license_version": "2.0",
             "creator": "", "source": "flickr", "width": 1024, "height": 768},
            {"id": "a4", "title": "Milk carton 1932", "license": "cc0", "license_version": "1.0",
             "creator": "", "source": "rawpixel", "width": 1024, "height": 768},
        ]},
        "api",
    )
    assert [c.title for c in ov] == ["openverse:a1"], "NC, unattributable and archival results are refused"
    assert ov[0].provider == "flickr" and ov[0].name == "Condensed milk"
    assert ov[0].credit == "Flickr", "a credit names the library the photo came through"

    # The private workbook must never reach a committed file.
    banned = {"lines", "totals", "yield", "cost_labels", "waste_percent", "unit_cost"}
    sample = empty_provenance()
    sample["images"]["dishes/x"] = {"record_ref": "RCP-x", "outputs": {}}
    assert not (banned & set(json.dumps(sample).split('"'))), "provenance carries a workbook key"

    print("self-test OK")
    return 0


if __name__ == "__main__":
    sys.exit(main())
