#!/usr/bin/env node

/**
 * Sincroniza la versión de package.json → coongro.manifest.json
 * Uso: node scripts/sync-version.cjs
 */

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const pkgPath = path.join(root, 'package.json');
const manifestPath = path.join(root, 'coongro.manifest.json');

const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));

if (manifest.version === pkg.version) {
  console.log(`Version already in sync: ${pkg.version}`);
  process.exit(0);
}

const oldVersion = manifest.version;
manifest.version = pkg.version;

fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n', 'utf-8');
console.log(`Synced version: ${oldVersion} → ${pkg.version}`);
