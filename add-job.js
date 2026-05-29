#!/usr/bin/env node
/**
 * Backward-compatible wrapper.
 *
 * Old usage still works:
 *   node add-job.js --company "Acme" --role "IT Director"
 *
 * New preferred usage:
 *   node tracker.js add --company "Acme" --role "IT Director"
 */

import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const trackerPath = path.join(__dirname, 'tracker.js');
const result = spawnSync(process.execPath, [trackerPath, 'add', ...process.argv.slice(2)], {
  stdio: 'inherit',
});
process.exit(result.status ?? 1);
