#!/usr/bin/env python3
"""
Scrape Final Fantasy Tactics Advance (FFTA) reference material from the
Final Fantasy Fandom wiki into readable Markdown + raw wikitext.

Source wiki : https://finalfantasy.fandom.com/wiki/Final_Fantasy_Tactics_Advance
API endpoint: https://finalfantasy.fandom.com/api.php

Why a custom scraper?
  * Fandom sits behind Cloudflare; a browser User-Agent on the MediaWiki API
    is required (plain page loads return a JS challenge).
  * Wikitext is saved verbatim (authoritative source of truth, preserves
    tables/formulas), and rendered HTML is converted to Markdown for reading.

Outputs (relative to repo root):
  docs/wiki/pages/<slug>.md     readable Markdown rendering
  docs/wiki/raw/<slug>.wiki     original wikitext
  docs/wiki/INDEX.md            grouped index of everything scraped
  docs/wiki/_meta.json          machine readable manifest (titles, urls, sizes)

Usage:
  python scripts/scrape_ffta_wiki.py                # full scrape
  python scripts/scrape_ffta_wiki.py --group jobs   # one group only
  python scripts/scrape_ffta_wiki.py --list         # list planned pages
  python scripts/scrape_ffta_wiki.py --force        # ignore cache, refetch
"""

from __future__ import annotations

import argparse
import concurrent.futures as futures
import json
import os
import re
import sys
import time
import urllib.parse
import urllib.request
from dataclasses import dataclass, field
from pathlib import Path
from typing import Iterable

from bs4 import BeautifulSoup, NavigableString, Tag

# --------------------------------------------------------------------------- #
# Configuration
# --------------------------------------------------------------------------- #

API = "https://finalfantasy.fandom.com/api.php"
WIKI_BASE = "https://finalfantasy.fandom.com/wiki/"
UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/120.0 Safari/537.36"
)

REPO_ROOT = Path(__file__).resolve().parents[1]
OUT_ROOT = REPO_ROOT / "docs" / "wiki"
PAGES_DIR = OUT_ROOT / "pages"
RAW_DIR = OUT_ROOT / "raw"
CACHE_DIR = OUT_ROOT / ".cache"

MAX_WORKERS = 4
RETRIES = 4

# --------------------------------------------------------------------------- #
# Page selection
#   Each group has a human label and a list of page titles. Titles that begin
#   with "@category:" are resolved at runtime to every namespace-0 member of
#   that category (sub-categories are followed one level deep).
# --------------------------------------------------------------------------- #

GROUPS: "dict[str, list[str]]" = {
    "Core": [
        "@category:Final Fantasy Tactics Advance",
        "Ivalice (Tactics Advance)",
        "Final Fantasy Tactics",
        "Final Fantasy Tactics A2",
        "Clan",
        "Final Fantasy Tactics Advance clans",
        "Clan Titles",
        "Gran Grimoire",
        "Crystal (term)",
        "Jagd",
        "Monster Bank",
        "Multiplayer",
        "World map",
        "Pub",
        "Shop",
    ],
    "Gameplay": [
        "@category:Gameplay in Final Fantasy Tactics Advance",
        "Judge (Tactics Advance)",
        "Judge (term)",
        "Law system (Tactics Advance)",
        "Judge Points",
        "Red Card (Tactics Advance)",
        "Yellow Card",
        "Justice (term)",
        "Fortune (Tactics Advance)",
        "Menu (Tactics Advance)",
        "Final Fantasy Tactics stats",
        "Stats",
        "Move (stat)",
        "Stat growth",
        "Experience points",
        "Ability Points",
        "Level",
        "Speed (stat)",
        "Attack Power",
        "Attack (command)",
        "Fixed damage",
        "Magic (command)",
        "Magic Power",
        "Magic Defense (stat)",
        "Defense (stat)",
        "MP (stat)",
        "Half MP",
        "Battle system",
        "Charge time",
        "Knocked Out",
        "Game Over (term)",
        "Status effect",
        "Final Fantasy Tactics Advance enemies",
        "Missions (Tactics Advance)",
    ],
    "Status effects": [
        "@category:Status effects in Final Fantasy Tactics Advance",
    ],
    "Elements": [
        "Final Fantasy Tactics Advance elements",
        "@category:Elements in Final Fantasy Tactics Advance",
        "Element (term)",
    ],
    "Jobs": [
        "@category:Jobs in Final Fantasy Tactics Advance",
    ],
    "Abilities": [
        "Final Fantasy Tactics Advance abilities",
        "Final Fantasy Tactics Advance action abilities",
        "Final Fantasy Tactics Advance reaction abilities",
        "Final Fantasy Tactics Advance support abilities",
        "Final Fantasy Tactics Advance enemy abilities",
        "Combo (Tactics Advance)",
        "Reaction ability",
        "Support ability",
        "Ability",
        "@category:Reaction abilities in Final Fantasy Tactics Advance",
        "@category:Support abilities in Final Fantasy Tactics Advance",
        "@category:Combo abilities in Final Fantasy Tactics Advance",
    ],
    "Magic": [
        "@category:Magic in Final Fantasy Tactics Advance",
    ],
    "Equipment": [
        "Final Fantasy Tactics Advance weapons",
        "Final Fantasy Tactics Advance armor",
        "Final Fantasy Tactics Advance accessories",
        "Final Fantasy Tactics Advance mission items",
        "Equipment abilities",
        "@category:Accessories in Final Fantasy Tactics Advance",
    ],
    "Items": [
        "Final Fantasy Tactics Advance items",
        "@category:Items in Final Fantasy Tactics Advance",
    ],
    "Totema": [
        "@category:Totema in Final Fantasy Tactics Advance",
    ],
    "Races": [
        "Human",
        "Hume",
        "Moogle",
        "Nu mou",
        "Bangaa",
        "Viera",
    ],
    "Characters": [
        "@category:Characters in Final Fantasy Tactics Advance",
    ],
    "Enemies": [
        "@category:Enemies in Final Fantasy Tactics Advance",
    ],
    "Locations": [
        "@category:Locations in Final Fantasy Tactics Advance",
        "Ivalice",
    ],
}

SKIP_TITLE_PATTERNS = [
    re.compile(r"^Final Fantasy Tactics Advance .* images$", re.I),
]

# --------------------------------------------------------------------------- #
# HTTP helpers
# --------------------------------------------------------------------------- #


@dataclass
class Page:
    title: str
    group: str
    wikitext: str = ""
    markdown: str = ""
    url: str = ""
    redirect: str | None = None
    error: str | None = None


def api_get(params: dict, *, tries: int = RETRIES) -> dict:
    """GET the MediaWiki API with a browser UA and simple retry/backoff."""
    params = {**params, "format": "json", "formatversion": "2"}
    url = API + "?" + urllib.parse.urlencode(params)
    last = None
    for attempt in range(tries):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": UA})
            with urllib.request.urlopen(req, timeout=45) as resp:
                return json.loads(resp.read().decode("utf-8"))
        except Exception as exc:  # noqa: BLE001 - network layer, report verbatim
            last = exc
            time.sleep(1.5 * (attempt + 1))
    raise RuntimeError(f"API request failed after {tries} tries: {url}\n{last}")


def category_members(category: str, *, depth: int = 0) -> list[str]:
    """Return namespace-0 titles in a category.

    depth=0 -> direct members only.
    depth=1 -> also follow sub-categories one level deep.
    """
    if category.lower().startswith("category:"):
        category = category[len("category:") :]
    titles: list[str] = []
    seen_cats: set[str] = set()

    def walk(cat: str, remaining: int) -> None:
        if cat in seen_cats:
            return
        seen_cats.add(cat)
        cont: str | None = None
        while True:
            params = {
                "action": "query",
                "list": "categorymembers",
                "cmtitle": f"Category:{cat}",
                "cmlimit": "500",
                "cmtype": "page|subcat",
            }
            if cont:
                params["cmcontinue"] = cont
            data = api_get(params)
            for m in data.get("query", {}).get("categorymembers", []):
                t = m["title"]
                if t.startswith("Category:"):
                    if remaining > 0 and not SKIP_ANY.search(t):
                        walk(t[len("Category:") :], remaining - 1)
                elif not any(p.search(t) for p in SKIP_TITLE_PATTERNS):
                    titles.append(t)
            cont = data.get("continue", {}).get("cmcontinue")
            if not cont:
                break

    SKIP_ANY = re.compile(
        r"images|templates|wallpapers|music media|screenshots|artwork|"
        r"concept art|section needed|product|walkthrough|merchandise",
        re.I,
    )
    walk(category, depth)
    return titles


def fetch_page(title: str) -> Page:
    """Fetch wikitext + rendered HTML for a single page."""
    page = Page(title=title, group="")
    page.url = WIKI_BASE + urllib.parse.quote(title.replace(" ", "_"))
    data = api_get(
        {
            "action": "parse",
            "page": title,
            "prop": "wikitext|text",
            "disableeditsection": "1",
            "disabletoc": "1",
            "redirects": "1",
        }
    )
    if "error" in data:
        page.error = data["error"].get("info", "unknown error")
        return page
    parse = data["parse"]
    page.title = parse.get("title", title)
    page.redirect = title if page.title != title else None

    def slot(value: object) -> str:
        # formatversion=2 returns a plain string; older responses nest it
        # under "*". Support both.
        if isinstance(value, str):
            return value
        if isinstance(value, dict):
            return value.get("*", "")
        return ""

    page.wikitext = slot(parse.get("wikitext"))
    html = slot(parse.get("text"))
    page.markdown = html_to_markdown(html)
    # Point at the resolved (non-redirect) page.
    page.url = WIKI_BASE + urllib.parse.quote(page.title.replace(" ", "_"))
    return page


# --------------------------------------------------------------------------- #
# HTML -> Markdown
# --------------------------------------------------------------------------- #

DROP_SELECTORS = [
    "script",
    "style",
    "sup.reference",
    "sup.noprint",
    ".navbox",
    ".toc",
    ".mw-editsection",
    ".info-icon",
    ".noprint",
    ".metadata",
    ".reference",
    ".mw-collapsible-toggle",
    ".plainlinks",
    ".magnify",
    "[role=navigation]",
    ".portable-infobox .pi-image-collection",
]


def _clean_soup(soup: BeautifulSoup) -> None:
    for sel in DROP_SELECTORS:
        for el in soup.select(sel):
            el.decompose()


def _inline(node: Tag | NavigableString) -> str:
    """Render inline content of a node to a single-ish line of Markdown."""
    if isinstance(node, NavigableString):
        return re.sub(r"[ \t\r\f\v]+", " ", str(node))
    if not isinstance(node, Tag):
        return ""
    name = node.name.lower()
    if name == "br":
        return "\n"
    if _is_math(node):
        return _math(node)
    if name in ("b", "strong"):
        inner = _children_inline(node).strip()
        return f"**{inner}**" if inner else ""
    if name in ("i", "em", "var", "cite"):
        inner = _children_inline(node).strip()
        return f"*{inner}*" if inner else ""
    if name == "code":
        return f"`{_children_inline(node).strip()}`"
    if name == "a":
        text = _children_inline(node).strip()
        return text
    if name == "img":
        alt = (node.get("alt") or node.get("data-image-name") or "").strip()
        return f"![{alt}]" if alt else ""
    if name == "sup":
        return ""
    if name in ("span", "small", "sub", "abbr", "u", "s", "font", "time"):
        return _children_inline(node)
    return _children_inline(node)


def _children_inline(node: Tag) -> str:
    return "".join(_inline(c) for c in node.children)


def _is_math(node: Tag) -> bool:
    classes = node.get("class") or []
    return node.name.lower() == "math" or "mwe-math-element" in classes


def _math(node: Tag) -> str:
    """Render a MathML block using its embedded LaTeX annotation."""
    ann = node.find("annotation", attrs={"encoding": "application/x-tex"})
    tex = (ann.get_text() if ann else "") or node.get_text(" ")
    tex = re.sub(r"\s+", " ", tex).strip()
    # Fandom wraps annotations in a displaystyle macro; drop it.
    if tex.startswith("{\\displaystyle ") and tex.endswith("}"):
        tex = tex[len("{\\displaystyle ") : -1].strip()
    return f"`{tex}`" if tex else ""


def _cell_text(cell: Tag) -> str:
    text = _block_children(cell).strip()
    text = re.sub(r"\s*\n+\s*", "<br>", text)
    text = text.replace("|", "\\|").replace("<br>**", "<br>**")
    return text


def _block_children(node: Tag) -> str:
    return "".join(_block(c) for c in node.children)


def _render_table(table: Tag) -> str:
    rows = table.find_all("tr", recursive=False)
    if not rows:
        rows = table.find_all("tr")
    rendered: list[list[str]] = []
    header_flags: list[bool] = []
    for tr in rows:
        cells = tr.find_all(["th", "td"], recursive=False)
        if not cells:
            cells = tr.find_all(["th", "td"])
        if not cells:
            continue
        rendered.append([_cell_text(c) for c in cells])
        header_flags.append(all(c.name == "th" for c in cells))
    if not rendered:
        return ""
    width = max(len(r) for r in rendered)
    rendered = [r + [""] * (width - len(r)) for r in rendered]
    lines = []
    # Use the first row as header (common for wiki tables).
    lines.append("| " + " | ".join(rendered[0]) + " |")
    lines.append("| " + " | ".join(["---"] * width) + " |")
    for r in rendered[1:]:
        lines.append("| " + " | ".join(r) + " |")
    return "\n".join(lines) + "\n\n"


def _is_own_line(el: Tag) -> bool:
    return el.name.lower() in {
        "p",
        "div",
        "table",
        "ul",
        "ol",
        "li",
        "h1",
        "h2",
        "h3",
        "h4",
        "h5",
        "h6",
        "blockquote",
        "figure",
        "dl",
        "dt",
        "dd",
        "pre",
        "hr",
        "center",
        "section",
    }


def _block(node: Tag | NavigableString) -> str:
    if isinstance(node, NavigableString):
        txt = re.sub(r"[ \t\r\f\v]+", " ", str(node))
        return txt
    if not isinstance(node, Tag):
        return ""
    name = node.name.lower()

    if name in ("script", "style"):
        return ""
    if _is_math(node):
        return _math(node)
    if name == "br":
        return "\n"
    if name in ("h1", "h2", "h3", "h4", "h5", "h6"):
        level = int(name[1])
        text = _children_inline(node).strip()
        return f"\n{'#' * level} {text}\n\n" if text else ""
    if name == "hr":
        return "\n---\n\n"
    if name in ("p", "section"):
        text = _block_children(node).strip()
        return f"{text}\n\n" if text else ""
    if name == "blockquote":
        text = _block_children(node).strip()
        return "\n".join(f"> {ln}" for ln in text.splitlines()) + "\n\n"
    if name == "figure":
        cap = node.find("figcaption")
        if cap:
            text = _block_children(cap).strip()
            return f"\n*{text}*\n\n" if text else ""
        return ""
    if name == "pre":
        return "```\n" + node.get_text() + "\n```\n\n"
    if name == "table":
        return "\n" + _render_table(node)
    if name in ("ul", "ol"):
        out = []
        ordered = name == "ol"
        for i, li in enumerate(node.find_all("li", recursive=False), 1):
            text = _block_children(li).strip()
            marker = f"{i}." if ordered else "-"
            text = text.replace("\n", "\n  ")
            out.append(f"{marker} {text}")
        return "\n".join(out) + "\n\n"
    if name in ("dl",):
        return _block_children(node).strip() + "\n\n"
    if name == "dt":
        return f"**{_children_inline(node).strip()}**\n"
    if name == "dd":
        return f"  {_block_children(node).strip()}\n"
    if name == "li":
        return _block_children(node)
    if name in ("div", "center", "span"):
        # A div is block content; a span is inline.
        if name == "span":
            return _inline(node)
        inner = _block_children(node)
        return inner + ("\n" if not inner.endswith("\n") else "")
    # default: treat as block container
    return _block_children(node)


def html_to_markdown(html: str) -> str:
    soup = BeautifulSoup(html, "html.parser")
    _clean_soup(soup)
    root = soup.select_one(".mw-parser-output") or soup
    md = _block_children(root)
    # Normalise whitespace.
    md = re.sub(r"[ \t]+\n", "\n", md)
    md = re.sub(r"\n{3,}", "\n\n", md)
    return md.strip() + "\n"


# --------------------------------------------------------------------------- #
# Writing
# --------------------------------------------------------------------------- #


def slugify(title: str) -> str:
    slug = title.replace("/", " - ")
    slug = re.sub(r'[<>:"\\|?*]', "", slug)
    slug = slug.strip().replace(" ", "_")
    return slug or "page"


def planned_pages(only_group: str | None) -> list[tuple[str, str]]:
    """Return ordered (group, title) pairs, de-duplicated."""
    seen: set[str] = set()
    out: list[tuple[str, str]] = []
    for group, entries in GROUPS.items():
        if only_group and group.lower() != only_group.lower():
            continue
        for entry in entries:
            if entry.startswith("@category"):
                depth = 1 if entry.startswith("@category+") else 0
                cat = entry.split(":", 1)[1]
                try:
                    members = category_members(cat, depth=depth)
                except Exception as exc:  # noqa: BLE001
                    print(f"  !! could not list category {cat}: {exc}", file=sys.stderr)
                    continue
                for title in members:
                    if title not in seen:
                        seen.add(title)
                        out.append((group, title))
            else:
                if entry not in seen:
                    seen.add(entry)
                    out.append((group, entry))
    return out


def write_outputs(pages: list[Page], planned: list[tuple[str, str]]) -> None:
    PAGES_DIR.mkdir(parents=True, exist_ok=True)
    RAW_DIR.mkdir(parents=True, exist_ok=True)

    # Many category members are redirects onto a single aggregate page (e.g.
    # every status effect redirects to "Final Fantasy Tactics Advance
    # statuses"). Collapse those onto one file and record the aliases.
    unique: "dict[str, Page]" = {}
    aliases: "dict[str, list[str]]" = {}
    errors: list[Page] = []
    for page in pages:
        if page.error:
            errors.append(page)
            continue
        slug = slugify(page.title)
        if slug not in unique:
            unique[slug] = page
            aliases[slug] = []
        if page.redirect and page.redirect not in aliases[slug]:
            aliases[slug].append(page.redirect)

    manifest = []
    for slug, page in unique.items():
        group = page.group or "Misc"
        alias_list = sorted(aliases.get(slug, []))
        alias_note = (
            "> Redirect aliases: " + ", ".join(alias_list) + "\n"
            if alias_list
            else ""
        )
        (PAGES_DIR / f"{slug}.md").write_text(
            f"# {page.title}\n\n"
            f"> Source: {page.url}\n"
            f"> Group: {group}\n"
            f"{alias_note}\n"
            f"{page.markdown}",
            encoding="utf-8",
        )
        (RAW_DIR / f"{slug}.wiki").write_text(page.wikitext, encoding="utf-8")
        manifest.append(
            {
                "title": page.title,
                "slug": slug,
                "group": group,
                "url": page.url,
                "aliases": alias_list,
                "wikitext_chars": len(page.wikitext),
                "markdown_chars": len(page.markdown),
                "status": "ok",
            }
        )
    for page in errors:
        manifest.append(
            {
                "title": page.title,
                "slug": slugify(page.title),
                "group": page.group or "Misc",
                "url": page.url,
                "aliases": [],
                "wikitext_chars": 0,
                "markdown_chars": 0,
                "status": f"ERROR: {page.error}",
            }
        )

    (OUT_ROOT / "_meta.json").write_text(
        json.dumps(manifest, indent=2, ensure_ascii=False), encoding="utf-8"
    )

    # GROUPED INDEX
    lines = [
        "# FFTA Wiki Scrape - Index",
        "",
        "Auto-generated by `scripts/scrape_ffta_wiki.py`.",
        "",
        f"- Source pages: **{len(unique)}** (from {len(planned)} planned titles)",
        f"- Source: <{WIKI_BASE}Final_Fantasy_Tactics_Advance>",
        "- Rendered pages: `docs/wiki/pages/`  |  Raw wikitext: `docs/wiki/raw/`",
        "",
        "> Narrative, names and game data are **© Square Enix**. Wiki text is from",
        "> the Final Fantasy Wiki on Fandom, licensed **CC BY-SA**. This mirror is",
        "> kept for study/reference only and must not be shipped as game content.",
        "",
        "Re-generate with: `python scripts/scrape_ffta_wiki.py` (see `agents.md`).",
        "",
    ]
    by_group: dict[str, list[dict]] = {}
    for m in manifest:
        if m["status"] != "ok":
            continue
        by_group.setdefault(m["group"], []).append(m)
    for group in [g for g in GROUPS if g in by_group] + [
        g for g in by_group if g not in GROUPS
    ]:
        items = sorted(by_group[group], key=lambda m: m["title"].lower())
        lines.append(f"## {group} ({len(items)})")
        lines.append("")
        for m in items:
            alias = (
                f"  _(+{len(m['aliases'])} aliases)_" if m["aliases"] else ""
            )
            lines.append(f"- [{m['title']}](pages/{m['slug']}.md){alias}")
        lines.append("")
    (OUT_ROOT / "INDEX.md").write_text("\n".join(lines), encoding="utf-8")


# --------------------------------------------------------------------------- #
# Main
# --------------------------------------------------------------------------- #


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--group", help="only scrape this group (e.g. Jobs)")
    ap.add_argument("--list", action="store_true", help="list planned pages and exit")
    ap.add_argument("--force", action="store_true", help="ignore disk cache")
    args = ap.parse_args()

    print("Resolving page list ...")
    planned = planned_pages(args.group)
    print(f"Planned {len(planned)} pages.")

    if args.list:
        for group, title in planned:
            print(f"[{group}] {title}")
        return 0

    CACHE_DIR.mkdir(parents=True, exist_ok=True)

    def load_or_fetch(group_title: tuple[str, str]) -> Page:
        group, title = group_title
        cache_file = CACHE_DIR / f"{slugify(title)}.json"
        if cache_file.exists() and not args.force:
            try:
                d = json.loads(cache_file.read_text(encoding="utf-8"))
                return Page(**d)
            except Exception:  # noqa: BLE001
                pass
        try:
            page = fetch_page(title)
        except Exception as exc:  # noqa: BLE001
            page = Page(title=title, group=group, error=str(exc))
            page.url = WIKI_BASE + urllib.parse.quote(title.replace(" ", "_"))
        page.group = group
        cache_file.write_text(
            json.dumps(page.__dict__, ensure_ascii=False), encoding="utf-8"
        )
        return page

    pages: list[Page] = []
    done = 0
    with futures.ThreadPoolExecutor(max_workers=MAX_WORKERS) as pool:
        for page in pool.map(load_or_fetch, planned):
            pages.append(page)
            done += 1
            flag = "ERR" if page.error else "ok "
            print(f"  [{done}/{len(planned)}] {flag} {page.title}", flush=True)

    write_outputs(pages, planned)
    errors = [p for p in pages if p.error]
    print(f"\nDone. {len(pages) - len(errors)}/{len(pages)} pages scraped.")
    print(f"Index: {OUT_ROOT / 'INDEX.md'}")
    if errors:
        print("Errors:", file=sys.stderr)
        for p in errors:
            print(f"  - {p.title}: {p.error}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
