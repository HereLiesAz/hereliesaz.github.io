#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { readdirSync, readFileSync, statSync } from 'node:fs';
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

function verifyCapacitorConfig() {
  const config = JSON.parse(readFileSync(join(root, 'capacitor.config.json'), 'utf8'));
  if (config.webDir !== 'dist') {
    throw new Error(`capacitor.config.json webDir must be "dist" for this Vite build; got ${JSON.stringify(config.webDir)}`);
  }
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

  verifyCapacitorConfig();
  run(python, ['-m', 'py_compile', ...pythonFiles], 'Python syntax check');
  run(python, ['-m', 'unittest', 'scripts/test_integrate_painting_bakes.py'], 'Integration builder unit tests');
  run(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['run', 'verify-assets'], 'Asset/legacy graph verification');
  run(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['run', 'build'], 'Production Vite build');
  console.log('\nRepository verification passed.');
} catch (error) {
  console.error(`\nRepository verification failed: ${error.message}`);
  process.exit(1);
}
