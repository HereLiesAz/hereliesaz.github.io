# Installation & Setup Guide

This guide will walk you through setting up the "Infinite Void" environment. The project consists of two parts:
1.  **Backend (Python)**: For processing source images (`public/assets/`) into the paper-theater gallery data (`public/data/theater/`) and the legacy stroke-grinder data. See `docs/WORKFLOW.md` for the actual current pipeline — there is no `assets/raw/` staging directory in this repo; scripts read directly from `public/assets/`.
2.  **Frontend (Node.js)**: For running the web application.

## Prerequisites

-   **Python 3.8+**: [Download](https://www.python.org/downloads/)
-   **Node.js 20+**: [Download](https://nodejs.org/) — CI (`deploy.yml`) runs Node 20.
-   **Git**: [Download](https://git-scm.com/)

---

## 1. Python Environment (The Data Pipeline)

The Python scripts are located in the `scripts/` directory. They require several scientific computing libraries (PyTorch, OpenCV, etc.).

### Step 1.1: Create a Virtual Environment

It is highly recommended to use a virtual environment to avoid conflicts.

~~~bash
# Windows
python -m venv venv
venv\Scripts\activate

# macOS/Linux
python3 -m venv venv
source venv/bin/activate
~~~

### Step 1.2: Install Dependencies

There are two Python requirement files, for two different jobs:

| File | What it is for | Contents |
| --- | --- | --- |
| `scripts/requirements.txt` | Running the art pipelines (`theater_baker.py`, `grinder.py`, `curator.py`, …) | The full ML stack: numpy, OpenCV, Pillow/pillow-heif, scipy, `torch`/`torchvision`, `transformers`, `timm`, Segment Anything (pinned git commit), `gradio_client`/`huggingface_hub`, `imagehash` |
| `scripts/verification-requirements.txt` | What `npm run verify` and `deploy.yml` need: the unit tests, `validate_output.py` and `validate_integrated_records.py` | `jsonschema`, `Pillow`, `numpy`, `opencv-python-headless` (pinned) |

The root `requirements.txt` is only a pointer (`-r scripts/requirements.txt`) for tools that look for a requirements file at the repo root.

~~~bash
pip install -r scripts/requirements.txt
~~~

**About PyTorch.** `scripts/requirements.txt` lists `torch`/`torchvision` without a version or index, so pip installs whatever PyPI's default wheel is for your platform — on Linux that is the large CUDA-enabled build, on macOS/Windows a CPU (or MPS) build. If you want a specific variant (CPU-only, or a particular CUDA version), install it from [pytorch.org](https://pytorch.org/get-started/locally/) *before* running the line above; pip will then keep it.

Which scripts actually need what:

- `theater_baker.py` (the production bake) needs numpy/OpenCV/Pillow/pillow-heif and `gradio_client` (the photorealize stage calls a hosted FLUX.1-Kontext Space). Depth runs **locally** via `transformers` + `torch` (Depth-Anything-V2) when they are installed; if they aren't, or the model fails to load, it falls back to the hosted Depth-Anything-V2 Space, then to synthetic depth. So torch is optional for it, but strongly recommended (no Space quota).
- `grinder.py`, `bootstrap.py`, `curator.py`, `3d_deconstructor.py` need `torch` and Segment Anything. SAM is installed from a pinned git commit, so **Git must be on your PATH**. `grinder.py` and `bootstrap.py` download the `sam_vit_b_01ec64.pth` checkpoint (~375 MB) into the working directory on first run; it is git-ignored.
- `curator.py` and `shard_prep/graph_builder.py` additionally use `transformers` (DINOv2 embeddings); `shard_prep/depth.py` uses `torch`.
- `deduplicate.py` needs `imagehash`.

### Step 1.2b: Tokens

- **`HF_TOKEN`** (Hugging Face) is required for the photorealize stage of `theater_baker.py` (it calls hosted FLUX.1-Kontext and, as a fallback, depth Spaces; the token also buys ZeroGPU quota). Put it in `.env.local` at the repo root, or in the central workflow's secrets. Without it the baker warns and the photorealize stage fails. **Use a dedicated fine-grained token with the least access that works (inference calls only, no write access to any repository).** gradio_client sends the token as a bearer header to the Space it calls, and those Spaces are owned by other people, so treat the token as one you may have to rotate.
- **GitHub token for the admin apps**: a fine-grained personal access token limited to `HereLiesAz/hereliesaz.github.io` with Contents and Actions read/write. The admin warns when a token can reach more than that repository.

### Step 1.3: Verify Installation

Run the theater baker's `--help` to check the core imports (opencv-python,
numpy, Pillow, pillow-heif) resolve without touching any real data:

~~~bash
python scripts/theater_baker.py --help
~~~

If that prints the usage text without an `ImportError`/`ModuleNotFoundError`,
you are ready. (Don't use `scripts/deduplicate.py` for this check — it's a
destructive script that deletes files under `public/assets/` on a real
run; see `docs/WORKFLOW.md`.)

---

## 2. Frontend Environment (The Application)

The frontend is a React application powered by Vite and Three.js.

### Step 2.1: Install Node Modules

Navigate to the project root and install the dependencies defined in `package.json`.

~~~bash
npm install
# OR
yarn install
# OR
pnpm install
~~~

### Step 2.2: Run Development Server

Start the local development server.

~~~bash
npm run dev
~~~

The application should now be accessible at `http://localhost:3000` (the port is set in `vite.config.js`).

---

## Troubleshooting

### "Missing module 'segment_anything'"
Segment Anything is installed from a pinned git commit in `scripts/requirements.txt`. Ensure Git is installed and on your PATH, then re-run `pip install -r scripts/requirements.txt`.

### "CUDA out of memory"
If running `grinder.py` on a GPU with limited VRAM (<6GB), you might crash.
**Fix**: Edit `scripts/grinder.py` and change the device fallback to CPU, or reduce the `MIN_RESOLUTION` and batch size.

### "Vite: command not found"
Ensure you ran `npm install` and that `node_modules/.bin` is in your path (npm handles this automatically when using `npm run`).
