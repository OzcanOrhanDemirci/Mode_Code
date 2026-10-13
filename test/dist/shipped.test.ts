// SPDX-License-Identifier: Apache-2.0
// What the package ships (package.json "files"), read as a stranger would read it after `npm install`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, relative } from 'node:path';
import { scanSecrets } from '../../src/core/secrets/scan.js';
import { built, ROOT } from '../helpers/proc.js';

function shipped(): string[] {
  const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as { files: string[] };
  const out: string[] = [join(ROOT, 'package.json')];
  const walk = (p: string) => {
    if (statSync(p).isDirectory()) for (const e of readdirSync(p)) walk(join(p, e));
    else out.push(p);
  };
  for (const f of pkg.files) walk(join(ROOT, f));
  return out;
}

const rel = (p: string) => relative(ROOT, p).replace(/\\/g, '/');

test('nothing the package ships looks like a secret: a sample assembled in the source stays assembled in the bundle', (t) => {
  if (!built()) return t.skip('needs the build: npm run build');
  const found = shipped().flatMap((p) =>
    scanSecrets(readFileSync(p, 'utf8'))
      .filter((f) => f.confidence === 'high')
      .map((f) => `${rel(p)}: ${f.kind} ${f.masked}`),
  );
  assert.deepEqual(found, []);
});

test('nothing the package ships names the folder it was built in or the home folder of the machine that built it', (t) => {
  if (!built()) return t.skip('needs the build: npm run build');
  const spellings = (p: string) => {
    const fwd = p.replace(/\\/g, '/');
    return [fwd, fwd.replace(/\//g, '\\'), fwd.replace(/\//g, '\\\\'), fwd.replace(/^([A-Za-z]):/, (_, d: string) => `/${d.toLowerCase()}`)].map((s) =>
      s.toLowerCase(),
    );
  };
  const needles = [...spellings(ROOT), ...spellings(homedir())].filter((s) => s.length > 8);
  const found: string[] = [];
  for (const p of shipped()) {
    const text = readFileSync(p, 'utf8').toLowerCase();
    for (const n of needles) if (text.includes(n)) found.push(`${rel(p)}: ${n}`);
  }
  assert.deepEqual(found, []);
});
