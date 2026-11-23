/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { formatByteSize, triggerVerifiedBlobDownload } from './androidDownload.ts';

test('triggerVerifiedBlobDownload verifies non-empty payloads and expectedBytes accurately', () => {
  assert.throws(
    () => triggerVerifiedBlobDownload('', 'empty.json', 'application/json'),
    /empty \(0 bytes\)/
  );

  const sample = JSON.stringify({ store: 'Arjun Groceries', ok: true });
  const expected = new Blob([sample], { type: 'application/json' }).size;

  assert.throws(
    () =>
      triggerVerifiedBlobDownload(sample, 'truncated.json', 'application/json', {
        expectedBytes: expected + 10,
      }),
    /File size verification failed/
  );

  const result = triggerVerifiedBlobDownload(sample, 'valid.json', 'application/json', {
    expectedBytes: expected,
  });
  assert.equal(result.byteSize, expected);
  assert.equal(result.fileName, 'valid.json');
});

test('formatByteSize renders human readable byte sizes', () => {
  assert.equal(formatByteSize(0), '0 B');
  assert.equal(formatByteSize(512), '512 B');
  assert.equal(formatByteSize(2048), '2.0 KB');
  assert.equal(formatByteSize(1024 * 1024 * 2.5), '2.50 MB');
});
