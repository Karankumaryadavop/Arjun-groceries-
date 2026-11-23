import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { formatFileSize } from './documentStorage';

describe('formatFileSize', () => {
  it('formats zero or invalid bytes gracefully', () => {
    assert.equal(formatFileSize(0), '0 KB');
    assert.equal(formatFileSize(-100), '0 KB');
  });

  it('formats kilobytes correctly', () => {
    assert.equal(formatFileSize(1024), '1 KB');
    assert.equal(formatFileSize(150 * 1024), '150 KB');
    assert.equal(formatFileSize(500 * 1024), '500 KB');
  });

  it('formats megabytes correctly with decimal precision', () => {
    assert.equal(formatFileSize(1024 * 1024), '1.0 MB');
    assert.equal(formatFileSize(2.5 * 1024 * 1024), '2.5 MB');
    assert.equal(formatFileSize(15.2 * 1024 * 1024), '15.2 MB');
  });
});
