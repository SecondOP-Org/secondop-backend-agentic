#!/usr/bin/env node

/**
 * Release automation for the SecondOp "software factory".
 *
 * Implements the mechanical parts of docs/RELEASE_VERSIONING.md:
 *   - resolve the next product version (SemVer bump or explicit --version),
 *   - generate a CHANGELOG.md section from Conventional-Commit history since the
 *     last release tag,
 *   - print the build-metadata block that /version consumes at runtime,
 *   - optionally create an annotated git tag `v<version>` locally.
 *
 * Human gates (AGENTS.md): this script never pushes tags/branches, never
 * deploys, never changes production config, and never rotates secrets. Tagging
 * is off by default; `--tag` only creates the tag locally for a human to push.
 *
 * Usage:
 *   node scripts/release.mjs --bump minor                 # preview
 *   node scripts/release.mjs --version 0.2.0 --write      # write CHANGELOG
 *   node scripts/release.mjs --bump patch --write --tag   # + local tag
 *   node scripts/release.mjs --print-metadata             # build metadata only
 */

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const repoRoot = path.resolve(path.dirname(__filename), '..');
const changelogPath = path.join(repoRoot, 'CHANGELOG.md');

const SECTIONS = [
  ['feat', 'Features'],
  ['fix', 'Fixes'],
  ['perf', 'Performance'],
  ['refactor', 'Refactors'],
  ['docs', 'Docs'],
  ['test', 'Tests'],
  ['chore', 'Chores'],
];

function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.printMetadata) {
    printMetadata();
    return;
  }

  const lastTag = tryGit(['describe', '--tags', '--abbrev=0']);
  const current = lastTag ? lastTag.replace(/^v/, '') : readPackageVersion();
  const next = args.version || bump(current, args.bump);

  const range = lastTag ? `${lastTag}..HEAD` : 'HEAD';
  const commits = collectCommits(range);
  const section = renderSection(next, commits);

  console.log(`Current: ${current}   →   Next: ${next}   (${lastTag ? `since ${lastTag}` : 'initial'})`);
  console.log(`Commits since last release: ${commits.length}`);

  if (!args.write) {
    console.log('\n--- CHANGELOG preview ---\n');
    console.log(section);
    console.log('(preview only; pass --write to update CHANGELOG.md)');
    return;
  }

  writeChangelog(section);
  console.log(`\nUpdated ${path.relative(repoRoot, changelogPath)} for ${next}.`);

  if (args.tag) {
    const tag = `v${next}`;
    if (tryGit(['rev-parse', '--verify', '--quiet', tag])) {
      console.log(`Tag ${tag} already exists; not recreating.`);
    } else {
      execFileSync('git', ['tag', '-a', tag, '-m', `Release ${next}`], { cwd: repoRoot });
      console.log(`Created local tag ${tag}. Push requires explicit human approval:`);
      console.log(`  git push origin ${tag}`);
    }
  }

  console.log('\nSet at deploy time so /version reports this release:');
  console.log(`  SECONDOP_RELEASE_VERSION=${next}`);
}

const FIELD_SEP = String.fromCharCode(31); // git %x1f unit separator

function collectCommits(range) {
  const raw = tryGit(['log', range, '--no-merges', `--pretty=format:%h${FIELD_SEP}%s`]);
  if (!raw) return [];
  return raw
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const [sha, subject = ''] = line.split(FIELD_SEP);
      const match = subject.match(/^(\w+)(?:\(([^)]+)\))?(!)?:\s*(.+)$/);
      const type = match ? match[1].toLowerCase() : 'other';
      const scope = match && match[2] ? match[2] : null;
      const breaking = Boolean(match && match[3]) || /BREAKING CHANGE/.test(subject);
      const description = match ? match[4] : subject;
      return { sha, type, scope, breaking, description };
    });
}

function renderSection(version, commits) {
  const date = new Date().toISOString().slice(0, 10);
  const lines = [`## ${version} — ${date}`, ''];

  const breaking = commits.filter((c) => c.breaking);
  if (breaking.length > 0) {
    lines.push('### ⚠ Breaking changes', '');
    for (const c of breaking) lines.push(formatLine(c));
    lines.push('');
  }

  for (const [type, heading] of SECTIONS) {
    const group = commits.filter((c) => c.type === type && !c.breaking);
    if (group.length === 0) continue;
    lines.push(`### ${heading}`, '');
    for (const c of group) lines.push(formatLine(c));
    lines.push('');
  }

  const other = commits.filter((c) => !SECTIONS.some(([t]) => t === c.type) && !c.breaking);
  if (other.length > 0) {
    lines.push('### Other', '');
    for (const c of other) lines.push(formatLine(c));
    lines.push('');
  }

  if (commits.length === 0) {
    lines.push('_No commits since the last release._', '');
  }

  return lines.join('\n').trimEnd();
}

function formatLine(commit) {
  const scope = commit.scope ? `**${commit.scope}:** ` : '';
  return `- ${scope}${commit.description} (${commit.sha})`;
}

function writeChangelog(section) {
  const header = '# Changelog\n\nAll notable changes to SecondOp backend. Product version per docs/RELEASE_VERSIONING.md.\n';
  if (!existsSync(changelogPath)) {
    writeFileSync(changelogPath, `${header}\n${section}\n`);
    return;
  }
  const existing = readFileSync(changelogPath, 'utf8');
  // Insert a released section above the first *versioned* heading, but below an
  // `## Unreleased` block if one is present.
  const headings = [...existing.matchAll(/^## (.+)$/gm)];
  const firstVersioned = headings.find((m) => !/^unreleased$/i.test(m[1].trim()));
  const insertAt = firstVersioned ? firstVersioned.index : -1;
  if (insertAt === -1) {
    writeFileSync(changelogPath, `${existing.trimEnd()}\n\n${section}\n`);
  } else {
    const head = existing.slice(0, insertAt).trimEnd();
    const rest = existing.slice(insertAt).trimStart();
    writeFileSync(changelogPath, `${head}\n\n${section}\n\n${rest}`);
  }
}

function printMetadata() {
  const version = process.env.SECONDOP_RELEASE_VERSION || readPackageVersion();
  const sha = tryGit(['rev-parse', 'HEAD']) || 'unknown';
  const meta = {
    SECONDOP_RELEASE_VERSION: version,
    BACKEND_GIT_SHA: sha,
    BACKEND_BUILD_TIME: new Date().toISOString(),
    BACKEND_PACKAGE_VERSION: readPackageVersion(),
  };
  // Emit as `KEY=VALUE` lines so CI can append to $GITHUB_ENV.
  for (const [key, value] of Object.entries(meta)) {
    console.log(`${key}=${value}`);
  }
}

function bump(version, kind) {
  const clean = version.replace(/^v/, '').split('-')[0].split('+')[0];
  const parts = clean.split('.').map((n) => Number(n) || 0);
  while (parts.length < 3) parts.push(0);
  let [major, minor, patch] = parts;
  if (kind === 'major') { major += 1; minor = 0; patch = 0; }
  else if (kind === 'minor') { minor += 1; patch = 0; }
  else { patch += 1; }
  return `${major}.${minor}.${patch}`;
}

function readPackageVersion() {
  try {
    const pkg = JSON.parse(readFileSync(path.join(repoRoot, 'package.json'), 'utf8'));
    return typeof pkg.version === 'string' ? pkg.version : '0.0.0';
  } catch {
    return '0.0.0';
  }
}

function tryGit(gitArgs) {
  try {
    return execFileSync('git', gitArgs, { cwd: repoRoot, encoding: 'utf8', maxBuffer: 20 * 1024 * 1024 }).trim();
  } catch {
    return null;
  }
}

function parseArgs(argv) {
  const parsed = { bump: 'patch', version: null, write: false, tag: false, printMetadata: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = argv[i + 1];
    if (arg === '--bump' && next) {
      if (!['major', 'minor', 'patch'].includes(next)) throw new Error(`--bump must be major|minor|patch`);
      parsed.bump = next; i += 1;
    } else if (arg === '--version' && next) { parsed.version = next.replace(/^v/, ''); i += 1; }
    else if (arg === '--write') { parsed.write = true; }
    else if (arg === '--tag') { parsed.tag = true; }
    else if (arg === '--print-metadata') { parsed.printMetadata = true; }
    else if (arg === '--help' || arg === '-h') { printHelp(); process.exit(0); }
    else { throw new Error(`Unknown or incomplete argument: ${arg}`); }
  }
  return parsed;
}

function printHelp() {
  console.log(`Usage: npm run factory:release -- [options]

Generates a CHANGELOG section from git history and resolves the next product
version. Never pushes, deploys, or changes production config.

Options:
  --bump major|minor|patch   SemVer bump from the last tag (default: patch).
  --version X.Y.Z            Explicit product version (overrides --bump).
  --write                   Write the section into CHANGELOG.md.
  --tag                     Also create a local annotated tag v<version>.
  --print-metadata          Print KEY=VALUE build metadata for /version, then exit.`);
}

main();
