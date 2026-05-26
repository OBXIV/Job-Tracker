#!/usr/bin/env node
/**
 * add-job.js — Append a new entry to the Job Pipeline Firebase database
 *
 * Usage:
 *   node add-job.js --company "Acme Corp" --role "IT Director" \
 *                   --applied 2026-05-26 --stage Applied \
 *                   --contact "Jane Smith" --notes "Applied via LinkedIn"
 *
 * Reads Firebase config from index.html (same directory as this script).
 * Uses the Firebase Realtime Database REST API — no SDK required.
 *
 * Valid stages:
 *   Applied | HM-Outreach | Phone-Screen | Interview |
 *   Final-Round | Offer | Rejected | Withdrawn
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// ── Locate index.html ──────────────────────────────────────────────────────────
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const HTML_PATH = path.join(__dirname, 'index.html');

// ── Parse Firebase config out of index.html ───────────────────────────────────
function readFirebaseConfig(htmlPath) {
  if (!fs.existsSync(htmlPath)) {
    die(`index.html not found at: ${htmlPath}\nMake sure add-job.js lives in the same folder as index.html.`);
  }

  const html = fs.readFileSync(htmlPath, 'utf8');

  // Match: const FIREBASE_CONFIG = { ... };
  const match = html.match(/const FIREBASE_CONFIG\s*=\s*(\{[\s\S]*?\});/);
  if (!match) {
    die('Could not find FIREBASE_CONFIG in index.html.\nMake sure the config is baked into the file.');
  }

  try {
    // eslint-disable-next-line no-eval
    return JSON.parse(match[1]);
  } catch {
    die('Found FIREBASE_CONFIG in index.html but could not parse it as JSON.');
  }
}

// ── Parse CLI arguments ────────────────────────────────────────────────────────
function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--')) {
      const key = argv[i].slice(2);
      const val = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true;
      args[key] = val;
    }
  }
  return args;
}

// ── Validate stage ─────────────────────────────────────────────────────────────
const VALID_STAGES = [
  'Applied', 'HM-Outreach', 'Phone-Screen', 'Interview',
  'Final-Round', 'Offer', 'Rejected', 'Withdrawn',
];

function validateStage(stage) {
  if (!stage) return 'Applied'; // default
  const match = VALID_STAGES.find(s => s.toLowerCase() === stage.toLowerCase());
  if (!match) {
    die(
      `Invalid stage: "${stage}"\nValid stages: ${VALID_STAGES.join(' | ')}`
    );
  }
  return match;
}

// ── Today's date as YYYY-MM-DD ─────────────────────────────────────────────────
function today() {
  return new Date().toISOString().slice(0, 10);
}

// ── Helpers ────────────────────────────────────────────────────────────────────
function die(msg) {
  console.error(`\n❌  ${msg}\n`);
  process.exit(1);
}

// ── Main ───────────────────────────────────────────────────────────────────────
async function main() {
  const args = parseArgs(process.argv.slice(2));

  // Require --company at minimum
  if (!args.company) {
    die('--company is required.\n\nUsage:\n  node add-job.js --company "Acme" --role "IT Director" [--applied YYYY-MM-DD] [--stage Applied] [--contact "Name"] [--notes "..."]');
  }

  // Read config from index.html
  const config = readFirebaseConfig(HTML_PATH);
  const dbURL = (config.databaseURL || '').replace(/\/$/, '');
  if (!dbURL) die('databaseURL not found in FIREBASE_CONFIG.');

  const endpoint = `${dbURL}/pipeline.json`;

  // ── 1. Fetch current pipeline ──────────────────────────────────────────────
  console.log(`\n🔍  Reading pipeline from Firebase…`);
  let pipeline;
  try {
    const res = await fetch(endpoint);
    if (!res.ok) {
      const body = await res.text();
      die(`GET ${endpoint} failed (${res.status}):\n${body}\n\nIf you see "Permission denied", update your Firebase Realtime Database rules to allow writes.`);
    }
    const json = await res.json();
    // Firebase may return an object {"0":{...},"1":{...}} instead of a true array
    pipeline = Array.isArray(json)
      ? json
      : (json && typeof json === 'object' ? Object.values(json) : []);
  } catch (err) {
    die(`Network error reading pipeline: ${err.message}`);
  }

  // ── 2. Build the new entry ─────────────────────────────────────────────────
  const maxId = pipeline.length > 0
    ? Math.max(...pipeline.map(d => Number(d.id) || 0))
    : 0;
  const newId = maxId + 1;

  const entry = {
    id:        newId,
    company:   args.company  || '',
    role:      args.role     || '',
    applied:   args.applied  || today(),
    stage:     validateStage(args.stage),
    hmContact: args.contact  || '',
    notes:     args.notes    || '',
  };

  console.log(`\n📋  New entry (id: ${newId}):`);
  console.table(entry);

  // ── 3. Append and write back ───────────────────────────────────────────────
  pipeline.push(entry);

  console.log(`\n💾  Writing ${pipeline.length} entries back to Firebase…`);
  try {
    const res = await fetch(endpoint, {
      method:  'PUT',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(pipeline),
    });
    if (!res.ok) {
      const body = await res.text();
      die(`PUT ${endpoint} failed (${res.status}):\n${body}`);
    }
  } catch (err) {
    die(`Network error writing pipeline: ${err.message}`);
  }

  console.log(`\n✅  Done! "${entry.company} — ${entry.role}" added as entry #${newId}.\n`);
}

main();
