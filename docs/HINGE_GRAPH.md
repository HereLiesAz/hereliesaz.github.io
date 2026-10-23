# Building the hinge graph for the whole corpus

The paper-theater walk moves between paintings along *hinge* edges
(`graph.theater.json`, built by `scripts/pareidolia_index.py`; see
`WORKFLOW.md` step 2). Group bakes leave this step out while
`scripts/hinge_graph.skip` exists, so after a large bake the graph covers only
the paintings it was last built for. Paintings with no node are not reachable
through the walk, and the gallery falls back to a default aspect for them.

This page is the combining pass: build the graph once over every baked painting.

## What it costs

The matcher compares every ordered pair of paintings. For N paintings that is
N × (N − 1) pairs: 159,600 at N = 400.

- Measured on a small sample (6 real paintings, 30 pairs): about 0.6 s of CPU per
  ordered pair. Treat that as an estimate and check it against the first shard.
- 159,600 pairs ≈ **27 CPU-hours**. In one process that is more than a day, and
  more than the 330-minute limit of a CI job.
- Starting from an existing graph helps little here: with 94 paintings already
  covered, 150,858 of the 159,600 pairs are still new (94.5%).

So the work is split. `--shard K/N` computes every N-th source painting, writes
a checkpointed shard file after each painting, and resumes where it stopped if
the session dies. `--jobs J` uses J cores inside a shard. `--merge` combines the
shards once all of them are complete. Edges come out in manifest order, the same
as a single run.

With 12 shards and 2 cores, each shard is roughly 27 / (12 × 2) ≈ 1.1 hours of
wall time. Pick N so one shard fits one session.

## Runbook (a Colab notebook, or any machine)

Each block below is one notebook cell.

Get the code and the baked data. Only `theater/` is needed, not the whole
`art-data` branch (about 2 GB):

~~~bash
git clone --depth 1 https://github.com/HereLiesAz/hereliesaz.github.io.git site
cd site
git clone --depth 1 --branch art-data --filter=blob:none --sparse \
    https://github.com/HereLiesAz/hereliesaz.github.io.git public/data
git -C public/data sparse-checkout set theater
pip install -q -r scripts/verification-requirements.txt
~~~

Run the shards. Every shard must see the same `public/data/theater`, so do not
bake or pull between shards. If a session dies, run the same command again; it
resumes. Save the `graph.theater.shard-*-of-12.json` files somewhere durable
(Drive, a bucket) between sessions:

~~~bash
for k in 0 1 2 3; do
  python3 scripts/pareidolia_index.py --data public/data/theater --shard $k/12 --jobs 2
done
~~~

When every shard 0 through 11 is in `public/data/theater/`, merge. This refuses
missing, incomplete or mismatched shards (different manifest, painting content or
`MATCHER_VERSION`) and deletes the shard files on success. Then validate with the
skip flag removed from your checkout; that makes `validate_output.py` require the
graph to cover the manifest exactly, instead of only reporting the gap:

~~~bash
python3 scripts/pareidolia_index.py --data public/data/theater --merge
rm -f scripts/hinge_graph.skip
python3 scripts/validate_output.py --dir public/data/theater
~~~

Publish `graph.theater.json` to `art-data` (a normal commit on that branch, the
same file path `theater/graph.theater.json`), then delete
`scripts/hinge_graph.skip` from `main` in a pull request. After that the central
bake builds the graph incrementally on every run (only new or changed paintings
are matched). Run a deploy so the site picks the graph up.

## A single machine

A machine with many cores can skip the shards:

~~~bash
python3 scripts/pareidolia_index.py --data public/data/theater --full --jobs 16
~~~

## When to rebuild everything

Use `--full` (or the shard flow) after changing the matcher: its constants,
`best_hinge`, or anything else that changes what an edge means. Also bump
`MATCHER_VERSION` in `pareidolia_index.py` in the same change; a graph from another
version is never carried over, so a forgotten `--full` cannot silently mix old and
new edges.
