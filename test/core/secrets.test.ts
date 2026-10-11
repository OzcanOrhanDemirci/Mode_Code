// SPDX-License-Identifier: Apache-2.0
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { entropy, maskSecrets, scanSecrets } from '../../src/core/secrets/scan.js';

// Fake tokens are assembled at run time so this file never contains a token-shaped literal
// (secret scanners would rightly flag it).
const rand = (n: number, alphabet = 'aB3dE5fG7hJ9kL2mN4pQ6rS8tU0vW1xY') =>
  Array.from({ length: n }, (_, i) => alphabet[(i * 7 + 3) % alphabet.length]).join('');
const gh = 'ghp' + '_' + rand(36);
const anth = 'sk-' + 'ant-api03-' + rand(90);
const aws = 'AK' + 'IA' + 'ABCDEFGHIJKLMNOP';
const pem = '-----BEGIN ' + 'OPENSSH PRIVATE KEY-----\nb3BlbnNzaC1rZXk\n-----END OPENSSH PRIVATE KEY-----';

test('documented token formats are found with their kind', () => {
  const text = `token ${gh} and key ${anth}\naws ${aws}\n${pem}`;
  const kinds = scanSecrets(text).map((m) => m.kind);
  assert.deepEqual(kinds, ['github-token', 'anthropic-key', 'aws-access-key-id', 'private-key']);
});

test('masked previews never contain the secret', () => {
  for (const m of scanSecrets(`x ${gh} y ${anth}`)) {
    assert.ok(!m.masked.includes(gh.slice(6, 30)));
    assert.match(m.masked, /•••/);
  }
  const masked = maskSecrets(`export GITHUB_TOKEN=${gh}`);
  assert.ok(!masked.includes(gh));
  assert.match(masked, /\[github-token: ghp_•••/);
});

test('credentials inside URLs are found, the rest of the URL is kept', () => {
  const pw = 'S3cr' + 'etPassw0rd';
  const masked = maskSecrets(`DATABASE_URL=postgres://app:${pw}@db.example.com:5432/app`);
  assert.ok(!masked.includes(pw));
  assert.match(masked, /postgres:\/\/app:\[url-credentials: .*\]@db\.example\.com/);
});

test('generic assignments need a value that looks random', () => {
  assert.equal(scanSecrets('password = "changeme123"').length, 0);
  assert.equal(scanSecrets('api_key: ${API_KEY}').length, 0);
  assert.equal(scanSecrets('token = process.env.TOKEN').length, 0);
  assert.equal(scanSecrets(`client_secret = "${rand(24)}"`).length, 1);
});

test('plain text has no findings and entropy behaves', () => {
  assert.deepEqual(scanSecrets('Just a normal sentence about tokens and passwords.'), []);
  assert.equal(entropy('aaaa'), 0);
  assert.ok(entropy(rand(32)) > 3.5);
});
