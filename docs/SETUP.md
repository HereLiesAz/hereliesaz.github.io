# Installation & Setup Guide

This guide will walk you through setting up the "Infinite Void" environment. The project consists of two parts:
1.  **Backend (Python)**: For processing source images (`public/assets/`) into the paper-theater gallery data (`public/data/theater/`) and the legacy stroke-grinder data. See `docs/WORKFLOW.md` for the actual current pipeline — there is no `assets/raw/` staging directory in this repo; scripts read directly from `public/assets/`.
2.  **Frontend (Node.js)**: For running the web application.

## Prerequisites

-   **Python 3.8+**: [Download](https://www.python.org/downloads/)
-   **Node.js 20+**: [Download](https://nodejs.org/) — CI runs Node 20
    (`deploy.yml`) and Node 22 (`deploy-sftp.yml`); either works locally.
-   **Git**: [Download](https://git-scm.com/)

---

## 1. Python Environment (The Data Pipeline)

The Python scripts are located in the `scripts/` directory. They require several scientific computing libraries (PyTorch, OpenCV, etc.).

### Step 1.1: Create a Virtual Environment

It is highly recommended to use a virtual environment to avoid conflicts.

```bash
# Windows
python -m venv venv
venv\Scripts\activate

# macOS/Linux
python3 -m venv venv
source venv/bin/activate
```

### Step 1.2: Install Dependencies

**Note on PyTorch**: `scripts/requirements.txt` includes `torch` for CPU by default. If you have an NVIDIA GPU, you should install the CUDA version of PyTorch *before* running the requirements file to enable hardware acceleration (which significantly speeds up the `grinder.py` process, and the local Depth-Anything-V2 pass in `theater_baker.py`). See [pytorch.org](https://pytorch.org/get-started/locally/) for specific commands.

```bash
# Standard install (CPU or pre-configured GPU)
# NOTE: scripts/requirements.txt, not the root requirements.txt — every
# real workflow (theater_bake.yml, process_art.yml, bootstrap.yml)
# installs from this one; the root-level file is a separate, incomplete
# list and won't get you torch/transformers/segment_anything/opencv.
pip install -r scripts/requirements.txt
```

### Step 1.3: Verify Installation

Run the theater baker's `--help` to check the core imports (opencv-python,
numpy, Pillow, pillow-heif) resolve without touching any real data:

```bash
python scripts/theater_baker.py --help
```

If that prints the usage text without an `ImportError`/`ModuleNotFoundError`,
you are ready. (Don't use `scripts/deduplicate.py` for this check — it's a
destructive script that deletes files under `public/assets/` on a real
run; see `docs/WORKFLOW.md`.)

---

## 2. Frontend Environment (The Application)

The frontend is a React application powered by Vite and Three.js.

### Step 2.1: Install Node Modules

Navigate to the project root and install the dependencies defined in `package.json`.

```bash
npm install
# OR
yarn install
# OR
pnpm install
```

### Step 2.2: Run Development Server

Start the local development server.

```bash
npm run dev
```

The application should now be accessible at `http://localhost:5173`.

---

## Troubleshooting

### "Missing module 'segment_anything'"
The Segment Anything Model (SAM) is installed via Git in `requirements.txt`. Ensure you have Git installed and available in your PATH.

### "CUDA out of memory"
If running `grinder.py` on a GPU with limited VRAM (<6GB), you might crash.
**Fix**: Edit `scripts/grinder.py` and change the device fallback to CPU, or reduce the `MIN_RESOLUTION` and batch size.

### "Vite: command not found"
Ensure you ran `npm install` and that `node_modules/.bin` is in your path (npm handles this automatically when using `npm run`).
