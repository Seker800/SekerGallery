import assert from 'node:assert/strict';
import test from 'node:test';
import { dhash64, hashDistance64 } from './perceptual-hash';

function grid(fill: (y: number, x: number) => number) {
  return Uint8Array.from({ length: 72 }, (_, index) => fill(Math.floor(index / 9), index % 9));
}

test('dhash keeps the existing bit order and 16-hex format', () => {
  assert.equal(dhash64(grid(() => 0)), '0000000000000000');
  assert.equal(dhash64(grid((_y, x) => 8 - x)), 'ffffffffffffffff');
  assert.equal(dhash64(grid((y, x) => (y === 0 ? 8 - x : 0))), 'ff00000000000000');
  assert.throws(() => dhash64(new Uint8Array(71)), /DHASH_INPUT_TOO_SHORT/);
});

test('hamming distance rejects malformed hashes instead of scoring them', () => {
  assert.equal(hashDistance64('0000000000000000', '0000000000000000'), 0);
  assert.equal(hashDistance64('0000000000000000', 'ffffffffffffffff'), 64);
  assert.equal(hashDistance64('8000000000000000', '0000000000000000'), 1);
  assert.equal(hashDistance64('short', '0000000000000000'), 65);
  assert.equal(hashDistance64('0000000000000000', 'zzzzzzzzzzzzzzzz'), 65);
});
