#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function run(command, args, label) {
  console.log(`\n==> ${label}`);
  const result = spawnSync(command, args, {
    cwd: root,
    stdio: 'inherit',
    shell: false,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${label} failed with exit code ${result.status}`);
  }
}

function findPython() {
  for (const candidate of ['python3', 'python']) {
    const result = spawnSync(candidate, ['--version'], { stdio: 'ignore' });
    if (!result.error && result.status === 0) return candidate;
  }
  throw new Error('Python 3 is required for repository verification.');
}

function collectPythonFiles(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (name === '__pycache__' || name.startsWith('.')) continue;
    const path = join(dir, name);
    const stat = statSync(path);
    if (stat.isDirectory()) collectPythonFiles(path, out);
    else if (name.endsWith('.py')) out.push(path);
  }
  return out;
}

try {
  const python = findPython();
  const pythonFiles = collectPythonFiles(join(root, 'scripts'));
  for (const rootScript of ['grinder.py', 'indexer.py', 'pareidolia.py', 'curator.py', 'jules.py', '3d_deconstructor.py', 'repair_and_index.py']) {
    const path = join(root, rootScript);
    try {
      if (statSync(path).isFile()) pythonFiles.push(path);
    } catch {
      // Optional/alternate pipeline entrypoint not present in every checkout.
    }
  }

  run(python, ['-m', 'py_compile', ...pythonFiles], 'Python syntax check');
  // Tests that need only the standard library, Pillow and jsonschema.
  run(python, ['-m', 'unittest',
    'scripts/test_integrate_painting_bakes.py',
    'scripts/test_check_no_shrink.py',
    'scripts/test_validate_output.py',
  ], 'Integration builder, manifest guard and output validator unit tests');
  // Tests that import numpy and OpenCV (the baker and the hinge-graph matcher, both
  // stubbed: no model runs). deploy.yml installs scripts/verification-requirements.txt
  // first. A contributor without them gets a loud skip locally; CI must not skip.
  const heavy = spawnSync(python, ['-c', 'import cv2, numpy, PIL'], { stdio: 'ignore' });
  if (heavy.status === 0) {
    run(python, ['-m', 'unittest',
      'scripts/test_pareidolia_incremental.py',
      'scripts/test_theater_baker_guards.py',
    ], 'Hinge graph and baker unit tests');
  } else if (process.env.CI) {
    throw new Error('numpy, opencv and Pillow are required for the baker and hinge-graph tests; install scripts/verification-requirements.txt.');
  } else {
    console.log('\n==> Hinge graph and baker unit tests: SKIPPED (numpy/opencv/Pillow not installed; '
      + 'pip install -r scripts/verification-requirements.txt). CI does not skip them.');
  }
  run(process.execPath, ['scripts/verify-tokens.mjs'], 'Design token sync (web, Android, manifests)');
  run(process.execPath, ['--test', 'scripts/test-ship-filter.mjs'], 'Ship filter unit tests');
  run(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['run', 'verify-assets'], 'Asset/legacy graph verification');
  run(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['run', 'build'], 'Production Vite build');
  console.log('\nRepository verification passed.');
} catch (error) {
  console.error(`\nRepository verification failed: ${error.message}`);
  process.exit(1);
}
