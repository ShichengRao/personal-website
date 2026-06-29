import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const expectedEntries = ["content", "public"];

test('repository smoke check has expected entry points', () => {
  assert.ok(existsSync(join(root, 'package.json')), 'package.json should exist');
  assert.ok(
    expectedEntries.some((entry) => existsSync(join(root, entry))),
    `one of ${expectedEntries.join(', ')} should exist`
  );
});
