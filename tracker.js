#!/usr/bin/env node
/**
 * tracker.js - Firebase Admin CLI for Job Pipeline Tracker
 *
 * Commands:
 *   node tracker.js add --company "Acme" --role "IT Director" --notes "..."
 *   node tracker.js update --id 106 --stage "Phone Screen" --note "AI phone screen 5/28"
 *   node tracker.js update --company "Apex Systems" --stage "Phone Screen" --note "..."
 *   node tracker.js reject --company "Langham Hall" --note "Rejected via email 5/29"
 *   node tracker.js search --query "ninja"
 *   node tracker.js list --stage Applied --limit 10
 *
 * Auth:
 *   Uses Firebase Admin SDK. Put your service account JSON at:
 *     ./service-account.json
 *   Or set:
 *     GOOGLE_APPLICATION_CREDENTIALS=/path/to/service-account.json
 */

import admin from 'firebase-admin';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const HTML_PATH = path.join(__dirname, 'index.html');
const DEFAULT_SERVICE_ACCOUNT_PATH = path.join(__dirname, 'service-account.json');
const PIPELINE_PATH = 'pipeline';

function die(msg) {
  console.error('\n❌  ' + msg + '\n');
  process.exit(1);
}

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (!token.startsWith('--')) {
      args._.push(token);
      continue;
    }

    const raw = token.slice(2);
    if (raw.includes('=')) {
      const eq = raw.indexOf('=');
      args[raw.slice(0, eq)] = raw.slice(eq + 1);
      continue;
    }

    const next = argv[i + 1];
    args[raw] = next && !next.startsWith('--') ? argv[++i] : true;
  }
  return args;
}

function readFirebaseConfig() {
  if (!fs.existsSync(HTML_PATH)) {
    die('index.html not found next to tracker.js. Run this from the Job-Tracker repo.');
  }

  const html = fs.readFileSync(HTML_PATH, 'utf8');
  const match = html.match(/const FIREBASE_CONFIG\s*=\s*(\{[\s\S]*?\});/);
  if (!match) die('Could not find baked FIREBASE_CONFIG in index.html.');

  try {
    return JSON.parse(match[1]);
  } catch {
    die('Found FIREBASE_CONFIG in index.html, but it was not valid JSON.');
  }
}

function resolveServiceAccountPath() {
  if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    return process.env.GOOGLE_APPLICATION_CREDENTIALS;
  }
  if (fs.existsSync(DEFAULT_SERVICE_ACCOUNT_PATH)) {
    return DEFAULT_SERVICE_ACCOUNT_PATH;
  }
  return null;
}

function initFirebase() {
  const config = readFirebaseConfig();
  const databaseURL = config.databaseURL;
  if (!databaseURL) die('databaseURL missing from FIREBASE_CONFIG.');

  const serviceAccountPath = resolveServiceAccountPath();
  if (!serviceAccountPath) {
    die(
      'Firebase service account not found.\n\n' +
      'Create one in Firebase Console:\n' +
      '  Project settings → Service accounts → Generate new private key\n\n' +
      'Save it as:\n' +
      '  ' + DEFAULT_SERVICE_ACCOUNT_PATH + '\n\n' +
      'That file is ignored by Git and must stay private.'
    );
  }
  if (!fs.existsSync(serviceAccountPath)) {
    die('Service account file does not exist: ' + serviceAccountPath);
  }

  const serviceAccount = JSON.parse(fs.readFileSync(serviceAccountPath, 'utf8'));
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    databaseURL,
  });
}

async function readPipeline() {
  const snap = await admin.database().ref(PIPELINE_PATH).get();
  const raw = snap.val();
  const rows = Array.isArray(raw)
    ? raw
    : (raw && typeof raw === 'object' ? Object.values(raw) : []);
  return rows
    .filter(Boolean)
    .sort((a, b) => (Number(b.id) || 0) - (Number(a.id) || 0));
}

async function writePipeline(rows) {
  await admin.database().ref(PIPELINE_PATH).set(rows);
}

const VALID_STAGES = [
  'Applied',
  'HM Outreach',
  'Phone Screen',
  'Interview',
  'Final Round',
  'Offer',
  'Rejected',
  'Withdrawn',
];

function normalizeStage(stage) {
  if (!stage) return 'Applied';
  const cleaned = String(stage).trim().replace(/[-_]+/g, ' ').replace(/\s+/g, ' ');
  const match = VALID_STAGES.find(s => s.toLowerCase() === cleaned.toLowerCase());
  if (!match) die('Invalid stage: "' + stage + '"\nValid stages: ' + VALID_STAGES.join(' | '));
  return match;
}

function today() {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return yyyy + '-' + mm + '-' + dd;
}

function includesText(value, query) {
  return String(value || '').toLowerCase().includes(String(query || '').toLowerCase());
}

function formatRow(row) {
  const bits = [
    '#' + row.id,
    row.company || '(no company)',
    '—',
    row.role || '(no role)',
    '[' + (row.stage || 'Unknown') + ']',
  ];
  if (row.applied) bits.push(row.applied);
  if (row.hmContact) bits.push('contact: ' + row.hmContact);
  if (row.notes) bits.push('notes: ' + row.notes);
  return bits.join(' ');
}

function findMatches(rows, args) {
  if (args.id) {
    const id = Number(args.id);
    return rows.filter(row => Number(row.id) === id);
  }

  const company = args.company || args.query || args.q;
  if (!company) die('Provide --id, --company, or --query to find an entry.');

  const matches = rows.filter(row => (
    includesText(row.company, company) ||
    includesText(row.role, company) ||
    includesText(row.notes, company) ||
    includesText(row.hmContact, company)
  ));

  if (args.role) {
    return matches.filter(row => includesText(row.role, args.role));
  }
  return matches;
}

function chooseOne(matches, args) {
  if (matches.length === 0) die('No matching entries found.');
  if (matches.length === 1) return matches[0];

  const exactCompany = args.company
    ? matches.filter(row => String(row.company || '').toLowerCase() === String(args.company).toLowerCase())
    : [];
  if (exactCompany.length === 1) return exactCompany[0];

  console.log('\nMultiple matches found. Re-run with --id using one of these:\n');
  for (const row of matches.slice(0, 12)) console.log('  ' + formatRow(row));
  if (matches.length > 12) console.log('  ... ' + (matches.length - 12) + ' more');
  process.exit(2);
}

function appendNote(row, note) {
  if (!note) return;
  const existing = String(row.notes || '');
  row.notes = existing.includes(note) ? existing : (existing ? existing + ' · ' + note : note);
}

async function cmdAdd(args) {
  if (!args.company) die('--company is required.');
  if (!args.role) die('--role is required.');

  const rows = await readPipeline();
  const maxId = rows.length > 0 ? Math.max(...rows.map(row => Number(row.id) || 0)) : 0;
  const entry = {
    id: maxId + 1,
    company: String(args.company || '').trim(),
    role: String(args.role || '').trim(),
    applied: String(args.applied || today()).trim(),
    stage: normalizeStage(args.stage),
    hmContact: String(args.contact || args.hmContact || '').trim(),
    notes: String(args.notes || args.note || '').trim(),
  };

  rows.unshift(entry);
  await writePipeline(rows);
  console.log('✅ Added #' + entry.id + ': ' + entry.company + ' — ' + entry.role);
}

async function cmdUpdate(args) {
  const rows = await readPipeline();
  const entry = chooseOne(findMatches(rows, args), args);

  if (args.company && args.setCompany) entry.company = String(args.setCompany).trim();
  if (args.role) entry.role = String(args.role).trim();
  if (args.applied) entry.applied = String(args.applied).trim();
  if (args.stage) entry.stage = normalizeStage(args.stage);
  if (args.contact !== undefined) entry.hmContact = args.contact === true ? '' : String(args.contact).trim();
  if (args.notes !== undefined) entry.notes = args.notes === true ? '' : String(args.notes).trim();
  appendNote(entry, args.note);

  await writePipeline(rows);
  console.log('✅ Updated #' + entry.id + ': ' + entry.company + ' — ' + entry.stage);
  if (entry.notes) console.log('Notes: ' + entry.notes);
}

async function cmdReject(args) {
  const rows = await readPipeline();
  const entry = chooseOne(findMatches(rows, args), args);
  entry.stage = 'Rejected';
  appendNote(entry, args.note || ('Rejected via email ' + shortDate()));
  await writePipeline(rows);
  console.log('✅ Rejected #' + entry.id + ': ' + entry.company + ' — ' + entry.role);
  if (entry.notes) console.log('Notes: ' + entry.notes);
}

function shortDate() {
  const d = new Date();
  return String(d.getMonth() + 1) + '/' + String(d.getDate());
}

async function cmdSearch(args) {
  const rows = await readPipeline();
  const query = args.query || args.q || args.company || args.role || args.notes;
  if (!query) die('Provide --query, --company, --role, or --notes.');
  const matches = rows.filter(row => (
    includesText(row.company, query) ||
    includesText(row.role, query) ||
    includesText(row.notes, query) ||
    includesText(row.hmContact, query)
  ));

  if (matches.length === 0) {
    console.log('No matches.');
    return;
  }
  for (const row of matches) console.log(formatRow(row));
}

async function cmdList(args) {
  let rows = await readPipeline();
  if (args.stage) {
    const stage = normalizeStage(args.stage);
    rows = rows.filter(row => row.stage === stage);
  }
  const limit = Number(args.limit || 20);
  for (const row of rows.slice(0, limit)) console.log(formatRow(row));
  console.log('\nShowing ' + Math.min(limit, rows.length) + ' of ' + rows.length + ' entries.');
}

function usage() {
  console.log([
    '',
    'Usage:',
    '  node tracker.js add --company \"Acme\" --role \"IT Director\" [--applied YYYY-MM-DD] [--stage Applied] [--contact \"Name\"] [--notes \"...\"]',
    '  node tracker.js update --id 106 --stage \"Phone Screen\" --note \"AI phone screen 5/28\"',
    '  node tracker.js reject --company \"Langham Hall\" --note \"Rejected via email 5/29\"',
    '  node tracker.js search --query \"ninja\"',
    '  node tracker.js list --stage Applied --limit 10',
    '',
    'Stages:',
    '  ' + VALID_STAGES.join(' | '),
    ''
  ].join('\n'));
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const command = args._[0] || 'help';

  if (['help', '--help', '-h'].includes(command)) {
    usage();
    return;
  }

  initFirebase();

  if (command === 'add') return cmdAdd(args);
  if (command === 'update') return cmdUpdate(args);
  if (command === 'reject') return cmdReject(args);
  if (command === 'search') return cmdSearch(args);
  if (command === 'list') return cmdList(args);

  die('Unknown command: ' + command);
}

main().catch(err => die(err.message || String(err)));
