#!/usr/bin/env python3
"""
pareidolia_index.py — transition-fulcrum matcher over painting + depth.

"Pareidolia" here is shorthand, NOT face detection: a hinge is a patch
that reads as part of BOTH the previous and the next painting at the
same time — a spot the eye rests on in each composition, structurally
alike enough that one form becomes the other without a visible cut.
During a transition the camera dives into painting A's hinge patch and
pulls out to find that same region already serving as part of painting
B; the viewer never registers the swap. The subject can be anything (a
face, a shape, a mass of colour) — some paintings have no figure at all.

For each ordered pair (A, B) the matcher searches for the patch that is
simultaneously:

  1. SALIENT in A — a feature the eye actually lands on, not flat field.
     Saliency = local contrast + edge energy + colour distinctiveness.
  2. SIMILAR to some region of B — matched on colour (LAB) AND on
     gradient structure (so shapes align, not just palettes), with depth
     as a light third channel.
  3. SALIENT in B at the matched spot — the fulcrum has to be a feature
     in BOTH paintings, or the reveal lands on empty background.

The final score multiplies structural similarity by the mutual saliency
of the two endpoints, so a hinge is only strong when it is a resonant
feature on each side. The best (patch, location) per (A, B) is one edge.

Inputs:   public/data/theater/{id}.painting.webp
          public/data/theater/{id}.depth.png
          public/data/theater/_manifest.json
Output:   public/data/theater/graph.theater.json
  { "schemaVersion": 5,
    "nodes": [{"id", "width", "height"}...],
    "edges": [{"source", "target", "weight",
               "s_uv": [u, v], "t_uv": [u, v], "scale": f}...] }

`s_uv`/`t_uv` are the patch centres in normalised image coordinates
(u right, v down, 0..1); `scale` is the patch edge as a fraction of the
painting's min dimension. The frontend places painting B so its t_uv
point coincides in world space with A's s_uv point, and routes the
camera through it.

Incremental by default: each edge depends only on its own (A, B) pair, so
when a graph.theater.json already exists only pairs that involve a painting
it has not seen (or whose content changed) are computed; every other edge
is carried over unchanged. A painting counts as unchanged when its
dimensions match AND, if the old graph recorded one, its content hash
(painting.webp + depth.png) matches; nodes written by older versions have no
hash and are trusted at equal dimensions. Baking paintings in groups
therefore costs O(new x all) per group instead of O(all^2). The edge SET is
the same as a full run's up to the matcher's numeric noise (two full runs
on unchanged inputs have been seen to differ in a couple of edges, probably
from library versions); edges are written in manifest order either way.
`--full` recomputes every pair. Bump MATCHER_VERSION whenever best_hinge or
its constants change: graphs from another version are never carried over.

Usage:
  python3 scripts/pareidolia_index.py --data public/data/theater/
  python3 scripts/pareidolia_index.py --data public/data/theater/ --full --jobs 4

While scripts/hinge_graph.skip exists a plain run does nothing, so the
Theater Bake workflow can bake paintings in groups without paying for the
graph. --full, --shard and --merge always run.

The all-pairs pass is the slow part (about 0.6 s per ordered pair on a CI
runner, so ~28 h for 400 paintings in one process). Three tools make it fit:

  --jobs N          fork N worker processes, one source painting per task.
  --shard K/N       compute only every N-th source painting, starting at K, and
                    write graph.theater.shard-K-of-N.json. The shard file is
                    checkpointed after every source painting; re-running the
                    same command resumes where it stopped, so a dropped Colab
                    session loses at most one painting's work.
  --merge           once every shard 0..N-1 is complete, combine them with the
                    carried-over edges into graph.theater.json and delete the
                    shard files. Shards from a different manifest, painting
                    content or MATCHER_VERSION are refused.

Every shard must run against the same --data (same manifest, same prior
graph). Then delete scripts/hinge_graph.skip.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import multiprocessing
import os
import sys
from pathlib import Path

import cv2
import numpy as np
from PIL import Image, ImageOps

SKIP_FLAG      = Path(__file__).with_name("hinge_graph.skip")  # present => group bakes skip the graph
MATCHER_VERSION = 1                   # bump when best_hinge or its constants change
WORK_LONG_EDGE = 256                  # matching resolution
PATCH_SCALES   = (0.20, 0.30, 0.42)   # patch edge / min(painting dims)
GRID_STEPS     = 9                    # candidate grid per axis
MIN_SALIENCY   = 0.18                 # skip A-patches below this mean saliency

# ---- acceptance bar (was: none) ---------------------------------------------
#
# CONFIRMED against the live shipped graph.theater.json: best_hinge() only
# rejected a pair when EVERY one of 243 candidates (81 grid positions x 3
# PATCH_SCALES) scored <= 0.0 on cv2.TM_CCOEFF_NORMED — a floor so low it is
# essentially never hit on real photographs. The result was a COMPLETE
# directed graph (1560 edges = 40x39, every node out-degree 39), with
# 1550/1560 edges (99.4%) locked onto the SMALLEST patch scale (0.20) and
# ZERO edges on the largest (0.42).
#
# Root cause, confirmed by instrumenting best_hinge() against the real
# baked images in public/data/theater/: GRID_STEPS is the same (9x9=81) at
# every scale, so every scale gets an equal number of candidate windows —
# but TM_CCOEFF_NORMED's sampling variance under a null (non-)match shrinks
# with window size (fewer pixels -> higher-variance, more easily spurious
# correlation peaks). With 81 roughly-independent draws per scale, the max
# order statistic is pulled up more for small windows than large ones
# PURELY BY CONSTRUCTION, regardless of whether the match is structurally
# real. A `best_hinge_exact` replica against the real 40-painting corpus
# reproduced this exactly: sim>=0.0 (the old floor) -> 90/90 candidate
# pairs on a 10-painting subset "accepted", 100% of winners at scale 0.20.
#
# Fix (both halves, per the audit's "AND/OR"):
#
#  1. SCALE_BIAS_CORRECTION discounts the raw similarity by
#     sqrt(scale / max(PATCH_SCALES)) before it is ranked against other
#     scales or checked against MIN_SIM. The motivation is the
#     TM_CCOEFF_NORMED analogue of a Pearson correlation's standard error,
#     which scales ~1/sqrt(n) in the number of pixels n, i.e. ~1/window-side
#     for a square patch. A full 1/side correction would be LINEAR in
#     scale; the code applies the square root of that ratio, which is a
#     deliberately weaker discount. It puts the scales on a more comparable
#     footing instead of letting the
#     smallest window's inflated variance win by default. Re-running the
#     instrumented replica WITH this correction on the same real data
#     produced a roughly EVEN scale split (21/18/20 across the three
#     scales on one 14-painting sample), instead of 100% on the smallest.
#
#  2. MIN_SIM is an absolute floor on the scale-corrected similarity.
#     Calibrated against the real corpus (not guessed): percentile sweeps
#     of the corrected similarity over instrumented reruns showed
#     MIN_SIM=0.45 keeps roughly the top third of candidate pairs
#     (~32% acceptance on the sampled subset) while rejecting the long
#     tail of near-zero, structurally-arbitrary matches that used to all
#     pass. Because of the scale correction above, this ~0.45 on the
#     adjusted score corresponds to an effective RAW threshold of about
#     0.65 at the smallest scale and about 0.45 at the largest — i.e. a
#     small patch now has to be substantially MORE convincing than a
#     large one to win, which is exactly the correction a spurious-peak
#     bias calls for. This lands within the 0.5-0.6-ish "meaningfully
#     selective" range the audit called out, applied per-scale rather
#     than as one flat number.
#
# Net effect: most (sid, tid) pairs now get NO edge at all (best_hinge()
# returns None) instead of the previous complete graph. The percentages and
# counts quoted above were measured on the corpus as it was at the time;
# they are not reproducible from this repository, so treat them as history,
# not as a specification.
SCALE_BIAS_REF = max(PATCH_SCALES)    # largest scale is the "unbiased" reference
MIN_SIM        = 0.45                 # floor on the scale-corrected similarity

# Similarity is a blend of channels; structure carries real weight so the
# fulcrum's SHAPE lines up, not just its colour.
W_COLOR  = 0.45
W_STRUCT = 0.40
W_DEPTH  = 0.15


def _norm01(x: np.ndarray) -> np.ndarray:
    # Normalise in float64 (via the float() casts). Staying in float32
    # was suggested for efficiency but measurably shifts the match
    # results on this data — near-tie fulcrums flip, and one edge slides
    # off the portrait's face. Precision matters more than the (trivial,
    # 3-painting) perf here.
    mn, mx = float(x.min()), float(x.max())
    return (x - mn) / (mx - mn) if mx - mn > 1e-6 else np.zeros_like(x)


def spectral_residual(gray: np.ndarray) -> np.ndarray:
    """Hou & Zhang spectral-residual saliency — the algorithm behind
    cv2.saliency.StaticSaliencySpectralResidual, reimplemented so it runs
    with only base OpenCV/NumPy (no opencv-contrib). Isolates the
    salient object far better than a linear contrast/edge blend."""
    h, w = gray.shape[:2]
    small = cv2.resize(gray, (64, 64), interpolation=cv2.INTER_AREA).astype(np.float32)
    f = np.fft.fft2(small)
    log_amp = np.log(np.abs(f) + 1e-8)
    phase = np.angle(f)
    residual = log_amp - cv2.blur(log_amp, (3, 3))
    recon = np.fft.ifft2(np.exp(residual + 1j * phase))
    sal = np.abs(recon) ** 2
    sal = cv2.GaussianBlur(sal, (0, 0), sigmaX=2.5)
    sal = cv2.resize(sal, (w, h), interpolation=cv2.INTER_CUBIC)
    return _norm01(sal)


def saliency_map(rgb_s: np.ndarray, lab: np.ndarray) -> np.ndarray:
    """Where the eye lands. Spectral-residual saliency (isolates the
    subject) reinforced by colour distinctiveness, which matters for
    these dark, colour-charged paintings. Returned normalised to 0..1."""
    gray = cv2.cvtColor(rgb_s, cv2.COLOR_RGB2GRAY).astype(np.float32)

    spec = spectral_residual(gray)

    # Colour distinctiveness: distance in LAB from the image's mean colour.
    lab_mean = lab.reshape(-1, 3).mean(axis=0)
    color_dev = _norm01(np.linalg.norm(lab - lab_mean, axis=2))

    sal = 0.65 * spec + 0.35 * color_dev
    sal = cv2.GaussianBlur(sal, (0, 0), sigmaX=2.0)
    return _norm01(sal)


def subject_mask(sal: np.ndarray) -> np.ndarray:
    """Soft mask of the painting's dominant subject: the largest blob of
    high saliency. Paintings with a clear figure (a face, a sign) get a
    tight mask; textural paintings with no single subject get a diffuse
    one — in which case the matcher just leans on general saliency. Pure
    OpenCV; CI-safe."""
    thr = float(np.quantile(sal, 0.80))
    binary = (sal >= thr).astype(np.uint8)
    n, labels, stats, _ = cv2.connectedComponentsWithStats(binary, connectivity=8)
    if n <= 1:
        return _norm01(cv2.GaussianBlur(sal, (0, 0), sigmaX=6.0))
    # Largest component by area, ignoring the background label 0.
    biggest = 1 + int(np.argmax(stats[1:, cv2.CC_STAT_AREA]))
    mask = (labels == biggest).astype(np.float32)
    # Grow + feather so the subject reads as a soft region, not a hard cut.
    k = max(3, int(round(0.04 * max(sal.shape))) | 1)
    mask = cv2.dilate(mask, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (k, k)))
    mask = cv2.GaussianBlur(mask, (0, 0), sigmaX=max(sal.shape) * 0.03)
    # Keep a saliency floor everywhere so a diffuse-subject painting still
    # matches sensibly rather than being forced onto one blob.
    return _norm01(np.maximum(mask, 0.25 * sal))


def window_mean(img: np.ndarray, ps: int) -> np.ndarray:
    """Mean of every ps×ps window, aligned to cv2.matchTemplate output
    indexing (result[y,x] ↔ window with top-left (x,y))."""
    ii = cv2.integral(img.astype(np.float32))
    h, w = img.shape[:2]
    s = (ii[ps:h + 1, ps:w + 1] - ii[0:h - ps + 1, ps:w + 1]
         - ii[ps:h + 1, 0:w - ps + 1] + ii[0:h - ps + 1, 0:w - ps + 1])
    return s / float(ps * ps)


def fingerprint(data_dir: Path, pid: str) -> str:
    """Content hash of a baked painting: changes whenever its pixels or depth do,
    even when the dimensions stay the same (the baker normalises every painting
    to a 768 long edge, so same-aspect photos share dimensions)."""
    digest = hashlib.sha1()
    for suffix in (".painting.webp", ".depth.png"):
        digest.update((data_dir / f"{pid}{suffix}").read_bytes())
    return digest.hexdigest()[:16]


def load_painting(data_dir: Path, pid: str) -> dict:
    # This only ever reads OUR OWN baked outputs (theater_baker.py's
    # {id}.painting.webp / {id}.depth.png), never a raw camera source
    # image directly — theater_baker.py is where EXIF-orientation
    # correction actually matters (see its exif_transpose() calls) and it
    # already bakes those outputs pixel-upright. exif_transpose() here is
    # a defensive no-op belt-and-suspenders: it does nothing unless a
    # baked WEBP/PNG somehow carries an orientation tag (Pillow's
    # Image.fromarray(...).save() does not normally write one).
    rgb = np.array(ImageOps.exif_transpose(Image.open(data_dir / f"{pid}.painting.webp")).convert("RGB"))
    depth = np.array(ImageOps.exif_transpose(Image.open(data_dir / f"{pid}.depth.png"))).astype(np.float32)
    if depth.ndim == 3:
        depth = depth[..., 0]
    h, w = rgb.shape[:2]
    scale = WORK_LONG_EDGE / max(h, w)
    size = (max(1, int(round(w * scale))), max(1, int(round(h * scale))))
    rgb_s = cv2.resize(rgb, size, interpolation=cv2.INTER_AREA)
    depth_s = cv2.resize(depth, size, interpolation=cv2.INTER_AREA)
    depth_s = _norm01(depth_s)
    lab = cv2.cvtColor(rgb_s, cv2.COLOR_RGB2LAB).astype(np.float32)

    # Gradient-magnitude channel for structural matching.
    gray = cv2.cvtColor(rgb_s, cv2.COLOR_RGB2GRAY).astype(np.float32)
    gx = cv2.Sobel(gray, cv2.CV_32F, 1, 0, ksize=3)
    gy = cv2.Sobel(gray, cv2.CV_32F, 0, 1, ksize=3)
    grad = _norm01(np.sqrt(gx * gx + gy * gy)) * 255.0

    sal = saliency_map(rgb_s, lab)
    return {
        "id": pid, "w": w, "h": h,
        "hash": fingerprint(data_dir, pid),
        "lab": lab,
        "grad": grad.astype(np.float32),
        "depth": (depth_s * 255.0).astype(np.float32),
        "sal": sal,
        "subject": subject_mask(sal),
    }


def best_hinge(a: dict, b: dict) -> dict | None:
    """Best shared patch from painting a into painting b: salient in both
    and structurally similar."""
    ah, aw = a["lab"].shape[:2]
    bh, bw = b["lab"].shape[:2]
    best = None

    for frac in PATCH_SCALES:
        ps = int(round(frac * min(ah, aw)))
        if ps < 12 or ps >= bh or ps >= bw:
            continue

        # Scale-bias correction: see the SCALE_BIAS_REF / MIN_SIM block at
        # the top of this file. Discounts smaller patches' similarity so
        # they can't win purely from having higher-variance, more easily
        # spurious correlation peaks over the same 81-candidate grid.
        scale_bias = (frac / SCALE_BIAS_REF) ** 0.5

        # Mean SUBJECT membership of every candidate window in B (aligned
        # to matchTemplate output). The incoming fulcrum should land on
        # B's subject so the reveal resolves onto what the next painting
        # is actually of.
        subj_b_win = window_mean(b["subject"], ps)

        xs = np.linspace(0, aw - ps, GRID_STEPS).astype(int)
        ys = np.linspace(0, ah - ps, GRID_STEPS).astype(int)
        for y in ys:
            for x in xs:
                sal_a = float(a["sal"][y:y + ps, x:x + ps].mean())
                if sal_a < MIN_SALIENCY:
                    continue  # A-patch is flat field — nothing to hinge on
                subj_a = float(a["subject"][y:y + ps, x:x + ps].mean())

                patch_lab = a["lab"][y:y + ps, x:x + ps]
                patch_grd = a["grad"][y:y + ps, x:x + ps]
                patch_dep = a["depth"][y:y + ps, x:x + ps]

                cc = (W_COLOR * cv2.matchTemplate(b["lab"], patch_lab, cv2.TM_CCOEFF_NORMED)
                      + W_STRUCT * cv2.matchTemplate(b["grad"], patch_grd, cv2.TM_CCOEFF_NORMED)
                      + W_DEPTH * cv2.matchTemplate(b["depth"], patch_dep, cv2.TM_CCOEFF_NORMED))
                # TM_CCOEFF_NORMED divides by window variance; a flat
                # template or target window (common in the gradient
                # channel over solid regions) yields NaN/inf. Zero them so
                # minMaxLoc can't lock onto an invalid location.
                np.nan_to_num(cc, copy=False, nan=0.0, posinf=0.0, neginf=0.0)

                # Bias the location search strongly toward B's subject —
                # the fulcrum resolves onto the next painting's subject,
                # not onto incidental background texture.
                weighted = cc * (0.3 + 0.7 * subj_b_win)
                _, _, _, loc = cv2.minMaxLoc(weighted)
                lx, ly = loc
                sim = float(cc[ly, lx])
                # Apply the scale-bias correction BEFORE thresholding and
                # ranking (not just at the end) so a small patch's inflated
                # raw correlation can't even clear MIN_SIM on the strength
                # of its own spurious variance — see the module-top comment.
                sim_adj = sim * scale_bias
                if sim_adj < MIN_SIM:
                    continue  # curated-graph floor: reject weak/spurious matches
                subj_b = float(subj_b_win[ly, lx])

                # Final: structural/colour similarity gated by the mutual
                # SUBJECT membership of the two endpoints — a strong hinge
                # joins A's subject to B's subject.
                score = sim_adj * float(np.sqrt(max(subj_a, 1e-6) * max(subj_b, 1e-6)))

                if best is None or score > best["_score"]:
                    best = {
                        "_score": score,
                        "weight": round(score, 4),
                        "s_uv": [round(float(x + ps / 2) / aw, 4),
                                 round(float(y + ps / 2) / ah, 4)],
                        "t_uv": [round(float(lx + ps / 2) / bw, 4),
                                 round(float(ly + ps / 2) / bh, 4)],
                        "scale": round(frac, 4),
                    }
    if best is not None:
        best.pop("_score", None)
    return best


_PAINTINGS: dict[str, dict] = {}   # shared with forked workers


def read_prior(out: Path) -> tuple[dict[str, tuple], list[dict]]:
    """({id: (width, height, hash|None)}, edges) from a usable previous graph,
    else ({}, []). Anything unreadable, malformed or from another matcher
    version is ignored, which makes the caller recompute every pair."""
    if not out.exists():
        return {}, []
    try:
        prior = json.loads(out.read_text())
    except (OSError, ValueError):
        print(f"[!] {out.name} is unreadable; computing every pair", file=sys.stderr)
        return {}, []
    if not isinstance(prior, dict) or prior.get("schemaVersion") != 5:
        return {}, []
    if prior.get("matcherVersion", 1) != MATCHER_VERSION:
        print(f"[i] {out.name} was built by matcher v{prior.get('matcherVersion')}, "
              f"this is v{MATCHER_VERSION}; computing every pair")
        return {}, []
    try:
        known = {n["id"]: (n["width"], n["height"], n.get("hash")) for n in prior["nodes"]}
        edges = list(prior["edges"])
        for e in edges:
            e["source"], e["target"]  # noqa: B018 - KeyError/TypeError if malformed
    except (KeyError, TypeError, AttributeError):
        print(f"[!] {out.name} is malformed; computing every pair", file=sys.stderr)
        return {}, []
    return known, edges


def unchanged(known: dict[str, tuple], painting: dict) -> bool:
    prev = known.get(painting["id"])
    return (prev is not None and prev[:2] == (painting["w"], painting["h"])
            and (prev[2] is None or prev[2] == painting.get("hash")))


def plan_units(ids: list[str], fresh: set[str]) -> list[tuple[str, list[str]]]:
    """One unit per source painting: the targets whose pair still needs matching."""
    units = []
    for sid in ids:
        tids = [t for t in ids if t != sid and (sid in fresh or t in fresh)]
        if tids:
            units.append((sid, tids))
    return units


def _run_unit(unit: tuple[str, list[str]]) -> tuple[str, list[dict]]:
    sid, tids = unit
    found = []
    for tid in tids:
        hinge = best_hinge(_PAINTINGS[sid], _PAINTINGS[tid])
        if hinge is not None:
            found.append({"source": sid, "target": tid, **hinge})
    return sid, found


def run_units(units: list[tuple[str, list[str]]], jobs: int):
    """Yield (source id, edges) as each unit finishes."""
    if jobs > 1 and "fork" in multiprocessing.get_all_start_methods():
        with multiprocessing.get_context("fork").Pool(jobs) as pool:
            yield from pool.imap_unordered(_run_unit, units)
    else:
        for unit in units:
            yield _run_unit(unit)


def plan_digest(ids: list[str], paintings: dict[str, dict], fresh: set[str]) -> str:
    """Identifies one combining job; shard files only merge with their own."""
    return hashlib.sha1(json.dumps(
        [MATCHER_VERSION, [(pid, paintings[pid].get("hash")) for pid in ids], sorted(fresh)],
        separators=(",", ":")).encode()).hexdigest()[:16]


def shard_path(data: Path, k: int, n: int) -> Path:
    return data / f"graph.theater.shard-{k}-of-{n}.json"


def write_atomic(path: Path, payload: dict) -> None:
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(json.dumps(payload, separators=(",", ":")))
    os.replace(tmp, path)


def log_edge(e: dict) -> None:
    print(f"[+] {e['source'][:24]} -> {e['target'][:24]}  w={e['weight']:.3f} "
          f"s={e['s_uv']} t={e['t_uv']} scale={e['scale']}")


def parse_shard(text: str) -> tuple[int, int]:
    try:
        k, n = (int(x) for x in text.split("/"))
    except ValueError:
        raise argparse.ArgumentTypeError("expected K/N, for example 0/12")
    if not 0 <= k < n:
        raise argparse.ArgumentTypeError("K must satisfy 0 <= K < N")
    return k, n


def main(argv: list[str]) -> int:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--data", type=Path, default=Path("public/data/theater"))
    ap.add_argument("--full", action="store_true",
                    help="recompute every pair, ignoring any existing graph")
    ap.add_argument("--jobs", type=int, default=1,
                    help="worker processes for the pair matching (default 1)")
    ap.add_argument("--shard", type=parse_shard, default=None, metavar="K/N",
                    help="compute only every N-th source painting starting at K and "
                         "write a resumable shard file instead of the graph")
    ap.add_argument("--merge", action="store_true",
                    help="combine completed shard files into graph.theater.json")
    args = ap.parse_args(argv)
    if args.shard and args.merge:
        ap.error("--shard and --merge are separate steps")

    # Group bakes leave the hinge graph out and build it once, over the whole
    # corpus, at the end (the all-pairs match is by far the slowest step).
    # While SKIP_FLAG exists a plain run is a no-op; the explicit combining
    # modes (--full, --shard, --merge) always run.
    if SKIP_FLAG.exists() and not (args.full or args.shard or args.merge):
        print(f"[i] {SKIP_FLAG.name} present: skipping the hinge graph "
              "(run with --full, or --shard/--merge, or delete the file, to build it)")
        return 0

    manifest_path = args.data / "_manifest.json"
    if not manifest_path.exists():
        print(f"[!] no manifest at {manifest_path}", file=sys.stderr)
        return 2
    ids = json.loads(manifest_path.read_text())
    if len(ids) < 2:
        print("[!] need at least 2 baked paintings to build hinges", file=sys.stderr)
        return 1

    paintings = {pid: load_painting(args.data, pid) for pid in ids}
    _PAINTINGS.clear()
    _PAINTINGS.update(paintings)

    nodes = []
    for p in paintings.values():
        node = {"id": p["id"], "width": p["w"], "height": p["h"]}
        if p.get("hash"):
            node["hash"] = p["hash"]
        nodes.append(node)
    out = args.data / "graph.theater.json"

    # Carry over edges from a previous graph for every painting it already
    # knew with the same content; only the rest ("fresh") need matching.
    known, prior_edges = ({}, []) if args.full else read_prior(out)
    fresh = {pid for pid, p in paintings.items() if not unchanged(known, p)}
    carried = [e for e in prior_edges
               if e["source"] in paintings and e["target"] in paintings
               and e["source"] not in fresh and e["target"] not in fresh]
    units = plan_units(ids, fresh)
    digest = plan_digest(ids, paintings, fresh)
    print(f"[i] {len(ids)} paintings, {len(fresh)} new/changed, "
          f"{len(carried)} edges carried over, {sum(len(t) for _, t in units)} pairs to match")

    def finish(computed: list[dict]) -> int:
        order = {pid: i for i, pid in enumerate(ids)}
        edges = sorted(carried + computed, key=lambda e: (order[e["source"]], order[e["target"]]))
        out.write_text(json.dumps(
            {"schemaVersion": 5, "matcherVersion": MATCHER_VERSION, "nodes": nodes, "edges": edges},
            separators=(",", ":")))
        print(f"[m] {len(edges)} edges -> {out}")
        return 0

    if args.merge:
        shards = sorted(args.data.glob("graph.theater.shard-*-of-*.json"))
        if not shards:
            print("[!] no shard files to merge", file=sys.stderr)
            return 1
        counts = {int(p.stem.rsplit("-of-", 1)[1]) for p in shards}
        if len(counts) != 1:
            print(f"[!] shard files disagree on the shard count: {sorted(counts)}", file=sys.stderr)
            return 1
        total = counts.pop()
        problems, computed = [], []
        for k in range(total):
            path = shard_path(args.data, k, total)
            if not path.exists():
                problems.append(f"shard {k}/{total} is missing")
                continue
            try:
                shard = json.loads(path.read_text())
                if shard["plan"] != digest:
                    raise ValueError("was computed for a different manifest, content or matcher")
                wanted = {sid for sid, _ in units[k::total]}
                finished = set(shard["done"]) & wanted
                if finished != wanted or set(shard["done"]) - wanted:
                    raise ValueError(f"is incomplete or mismatched ({len(finished)}/{len(wanted)} paintings)")
                computed.extend(shard["edges"])
            except (OSError, KeyError, TypeError) as exc:
                problems.append(f"{path.name} is unreadable ({type(exc).__name__})")
            except ValueError as exc:
                problems.append(f"{path.name} {exc}")
        if problems:
            for line in problems:
                print(f"[!] {line}", file=sys.stderr)
            return 1
        rc = finish(computed)
        for path in shards:
            path.unlink()
        print(f"[i] merged {total} shard(s); now delete {SKIP_FLAG.name} and commit {out.name}")
        return rc

    if args.shard:
        k, total = args.shard
        mine = units[k::total]
        path = shard_path(args.data, k, total)
        done: set[str] = set()
        edges: list[dict] = []
        if path.exists():
            try:
                saved = json.loads(path.read_text())
                if saved["plan"] == digest:
                    done, edges = set(saved["done"]), list(saved["edges"])
                    print(f"[i] resuming shard {k}/{total}: {len(done)}/{len(mine)} paintings done")
                else:
                    print(f"[!] {path.name} is for a different plan; starting it over", file=sys.stderr)
            except (OSError, ValueError, KeyError, TypeError):
                print(f"[!] {path.name} is unreadable; starting it over", file=sys.stderr)
        todo = [u for u in mine if u[0] not in done]
        for sid, found in run_units(todo, args.jobs):
            for e in found:
                log_edge(e)
            done.add(sid)
            edges.extend(found)
            write_atomic(path, {"matcherVersion": MATCHER_VERSION, "plan": digest,
                                "shard": [k, total], "done": sorted(done), "edges": edges})
        write_atomic(path, {"matcherVersion": MATCHER_VERSION, "plan": digest,
                            "shard": [k, total], "done": sorted(done), "edges": edges})
        print(f"[m] shard {k}/{total}: {len(done)}/{len(mine)} paintings, {len(edges)} edges -> {path.name}")
        return 0

    computed = []
    for _sid, found in run_units(units, args.jobs):
        for e in found:
            log_edge(e)
        computed.extend(found)
    return finish(computed)


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
