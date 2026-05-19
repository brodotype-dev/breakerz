#!/usr/bin/env node
/**
 * Sync a whitelist of secrets from .env.local into every
 * .claude/settings.local.json under the repo (main + worktrees).
 *
 * Usage (from anywhere inside the repo or any worktree):
 *   node scripts/sync-claude-env.mjs
 *
 * Why this exists
 * ───────────────
 * The Claude Code Mac app reads env values from .claude/settings.local.json
 * at app launch and uses them for MCP server child-process env. We sync those
 * values from .env.local (which itself comes from `vercel env pull`) so there
 * is exactly one source of truth.
 *
 * When to run
 * ───────────
 *   1. After `vercel env pull .env.local` (key rotation in Vercel)
 *   2. After manually editing .env.local
 *   3. After adding a new worktree (creates a new settings.local.json)
 *
 * Then: Cmd+Q the Claude Code Mac app and relaunch so child MCP processes
 * pick up the new env at next spawn.
 *
 * Idempotent. Safe to re-run.
 */

import { readFile, writeFile } from 'node:fs/promises';
import { existsSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { execSync } from 'node:child_process';

// Keys to propagate into Claude Code's env block.
// Only include keys that an MCP server (or any Claude-Code-launched child
// process) actually needs. Adding too many = more secrets exposed to child
// processes for no reason; adding too few = MCP servers fail on auth.
const KEY_WHITELIST = [
  'ANTHROPIC_API_KEY',
  'CARDHEDGER_API_KEY',
  'RESEND_API_KEY',
];

// Resolve the MAIN repo root even when run from a worktree.
// `git rev-parse --git-common-dir` returns the shared .git dir (the main repo's),
// so its parent is always the main working tree root.
let repoRoot;
try {
  const commonDir = execSync('git rev-parse --git-common-dir', { encoding: 'utf8' }).trim();
  repoRoot = dirname(resolve(commonDir));
} catch {
  console.error('Not inside a git repo. Run from the BreakIQ repo or one of its worktrees.');
  process.exit(1);
}

const envLocalPath = join(repoRoot, '.env.local');
if (!existsSync(envLocalPath)) {
  console.error(`Missing ${envLocalPath}`);
  console.error(`Pull it first:  cd ${repoRoot} && vercel env pull .env.local`);
  process.exit(1);
}

// Minimal .env parser — KEY="VALUE" or KEY=VALUE, optional surrounding quotes.
const envText = await readFile(envLocalPath, 'utf8');
const env = {};
for (const line of envText.split('\n')) {
  const m = line.match(/^([A-Z_][A-Z0-9_]*)\s*=\s*"?([^"\n]*)"?\s*$/);
  if (m) env[m[1]] = m[2];
}

const newValues = {};
for (const key of KEY_WHITELIST) {
  if (env[key]) newValues[key] = env[key];
  else console.warn(`! .env.local is missing ${key} — skipping`);
}

// Discover every .claude/settings.local.json:
//   - main repo:  <root>/.claude/settings.local.json
//   - worktrees:  <root>/.claude/worktrees/<name>/.claude/settings.local.json
const targets = [];
const mainSettings = join(repoRoot, '.claude', 'settings.local.json');
if (existsSync(mainSettings)) targets.push(mainSettings);

const worktreesDir = join(repoRoot, '.claude', 'worktrees');
if (existsSync(worktreesDir)) {
  for (const sub of readdirSync(worktreesDir)) {
    const wsettings = join(worktreesDir, sub, '.claude', 'settings.local.json');
    if (existsSync(wsettings)) targets.push(wsettings);
  }
}

if (targets.length === 0) {
  console.error(`No .claude/settings.local.json files found under ${repoRoot}`);
  process.exit(1);
}

let totalChanged = 0;
for (const target of targets) {
  const json = JSON.parse(await readFile(target, 'utf8'));
  json.env = json.env ?? {};
  let changed = 0;
  for (const [k, v] of Object.entries(newValues)) {
    if (json.env[k] !== v) {
      json.env[k] = v;
      changed++;
    }
  }
  const rel = target.replace(repoRoot + '/', '');
  if (changed > 0) {
    await writeFile(target, JSON.stringify(json, null, 2) + '\n', 'utf8');
    console.log(`✓ ${rel} — updated ${changed} key${changed === 1 ? '' : 's'}`);
    totalChanged += changed;
  } else {
    console.log(`= ${rel} — already in sync`);
  }
}

const keyCount = Object.keys(newValues).length;
console.log(`\nSynced ${keyCount} key${keyCount === 1 ? '' : 's'} across ${targets.length} settings file${targets.length === 1 ? '' : 's'}.`);
if (totalChanged > 0) {
  console.log('Cmd+Q + relaunch Claude Code Mac app to pick up new values.');
}
