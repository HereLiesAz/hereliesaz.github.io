#!/usr/bin/env python3
"""
visual_check.py — headless visual smoke harness.

Spins up Chromium against a Vite dev server on http://localhost:3000,
captures screenshots at several scroll positions, opens the vellum
modal, and writes everything to tools/screenshots/. The screenshots are
inspected by hand (or by Claude in this session) afterwards — this
script just collects evidence, it doesn't grade it.

Prerequisites:
  python -m venv /tmp/pw-venv && /tmp/pw-venv/bin/pip install playwright
  /tmp/pw-venv/bin/playwright install chromium

Usage:
  /tmp/pw-venv/bin/python tools/visual_check.py
"""

from __future__ import annotations

import argparse
import sys
import time
from pathlib import Path

from playwright.sync_api import sync_playwright, Error as PlaywrightError


DEFAULT_URL    = "http://localhost:3000"
DEFAULT_OUTDIR = Path(__file__).resolve().parent / "screenshots"
DEFAULT_VIEW   = (1280, 800)
DEFAULT_DPR    = 2.0


def take_shots(url: str, outdir: Path, view: tuple[int, int], dpr: float) -> int:
    outdir.mkdir(parents=True, exist_ok=True)
    width, height = view

    with sync_playwright() as pw:
        browser = pw.chromium.launch(headless=True)
        ctx = browser.new_context(
            viewport={"width": width, "height": height},
            device_scale_factor=dpr,
        )
        page = ctx.new_page()
        console_lines: list[str] = []
        page.on("console", lambda msg: console_lines.append(f"[{msg.type}] {msg.text}"))
        page.on("pageerror", lambda exc: console_lines.append(f"[pageerror] {exc}"))

        try:
            page.goto(url, wait_until="networkidle", timeout=20_000)
        except PlaywrightError as e:
            print(f"[!] could not load {url}: {e}", file=sys.stderr)
            print("[!] is `npx vite` running on port 3000?", file=sys.stderr)
            return 2

        # Wait for the signature reveal animation to settle and for the
        # first painting to fetch and resolve into geometry.
        page.wait_for_selector(".ink-signature", timeout=8_000)
        time.sleep(2.2)

        # drei's <ScrollControls> wraps the canvas in a div with computed
        # overflow: "hidden auto" (overflowY = auto, overflowX = hidden) and
        # an inner content div whose height is pages * viewport. Match on
        # overflowY rather than the overflow shorthand — the shorthand reads
        # as the compound "hidden auto" so an `overflow === "auto"` check
        # misses it.
        scroll_handle = page.evaluate_handle(
            """() => {
              for (const el of document.querySelectorAll('*')) {
                const cs = getComputedStyle(el);
                if (cs.overflowY === 'auto' && el.scrollHeight > el.clientHeight + 100) {
                  return el;
                }
              }
              return null;
            }"""
        )
        scroll_info = page.evaluate(
            """el => el ? {scrollH: el.scrollHeight, clientH: el.clientHeight, tag: el.tagName} : null""",
            scroll_handle,
        )
        if not scroll_info:
            print("[!] could not find drei scroll element", file=sys.stderr)
            browser.close()
            return 3
        print(f"[*] scroll element: {scroll_info['tag']} clientH={scroll_info['clientH']} scrollH={scroll_info['scrollH']}")

        scroll_targets = [(0.00, "00_at_first_null"),
                          (0.10, "01_leaving_first"),
                          (0.25, "02_mid_first_segment"),
                          (0.50, "03_segment_dip"),
                          (0.75, "04_mid_next_segment"),
                          (0.90, "05_arriving_second")]

        for fraction, name in scroll_targets:
            page.evaluate(
                """([el, frac]) => {
                  if (!el) return;
                  el.scrollTop = (el.scrollHeight - el.clientHeight) * frac;
                }""",
                [scroll_handle, fraction],
            )
            # Let useFrame catch up and the per-frame uniforms settle.
            time.sleep(0.6)
            out = outdir / f"{name}.png"
            page.screenshot(path=str(out), full_page=False)
            print(f"[+] {out.name}")

        # Back to the first null, then open the modal.
        page.evaluate("([el]) => { if (el) el.scrollTop = 0; }", [scroll_handle])
        time.sleep(0.6)
        page.click(".ink-signature")
        time.sleep(0.8)
        out = outdir / "06_modal_open.png"
        page.screenshot(path=str(out), full_page=False)
        print(f"[+] {out.name}")

        # Drop a transcript so we can spot WebGL warnings or shader errors.
        (outdir / "_console.log").write_text("\n".join(console_lines) + "\n")
        print(f"[m] {len(console_lines)} console lines -> _console.log")

        browser.close()
    return 0


def main(argv: list[str]) -> int:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--url",    default=DEFAULT_URL)
    ap.add_argument("--out",    type=Path, default=DEFAULT_OUTDIR)
    ap.add_argument("--width",  type=int, default=DEFAULT_VIEW[0])
    ap.add_argument("--height", type=int, default=DEFAULT_VIEW[1])
    ap.add_argument("--dpr",    type=float, default=DEFAULT_DPR)
    args = ap.parse_args(argv)
    return take_shots(args.url, args.out, (args.width, args.height), args.dpr)


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
