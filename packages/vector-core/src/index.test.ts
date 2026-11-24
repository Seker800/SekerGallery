import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  EAGLE_EMBEDDING_DIMENSIONS,
  EAGLE_EMBEDDING_IDENTITY,
  EAGLE_EMBEDDING_MODEL,
  EAGLE_EMBEDDING_REVISION,
  blendPrototype,
  meanPrototype,
  sphericalKMeans,
} from './index';

test('embedding identity and both Python services share one model contract', () => {
  assert.deepEqual(EAGLE_EMBEDDING_IDENTITY, {
    id: 'qwen3-vl-embedding-2b-1024-v1',
    model: EAGLE_EMBEDDING_MODEL,
    revision: EAGLE_EMBEDDING_REVISION,
    dimensions: EAGLE_EMBEDDING_DIMENSIONS,
    normalized: true,
    instructionVersion: 'image-retrieval-v1',
    preprocessingVersion: 'preview-webp-v1',
  });
  for (const path of [
    '../../services/mlx-embedding/sekereagle_mlx/app.py',
    '../../services/cuda-embedding/sekereagle_cuda/app.py',
  ]) {
    const source = readFileSync(path, 'utf8');
    assert.ok(source.includes(EAGLE_EMBEDDING_MODEL), `${path} model`);
    assert.ok(source.includes(EAGLE_EMBEDDING_REVISION), `${path} revision`);
    assert.ok(source.includes(String(EAGLE_EMBEDDING_DIMENSIONS)), `${path} dimensions`);
  }
});

test('face prototype blending and averaging stay normalized', () => {
  const blended = blendPrototype([1, 0], [0, 1], 0.2);
  assert.ok(Math.abs(blended[0]! - 0.8 / Math.hypot(0.8, 0.2)) < 1e-12);
  assert.ok(Math.abs(blended[1]! - 0.2 / Math.hypot(0.8, 0.2)) < 1e-12);
  const mean = meanPrototype(
    [
      [1, 0],
      [0, 1],
    ],
    2,
  );
  assert.ok(Math.abs(mean[0]! - Math.SQRT1_2) < 1e-12);
  assert.ok(Math.abs(mean[1]! - Math.SQRT1_2) < 1e-12);
  assert.deepEqual(meanPrototype([]), []);
  assert.deepEqual(blendPrototype([], [1, 0], 0.2), [1, 0]);
});

test('mini-batch spherical k-means separates stable visual modes deterministically', () => {
  const input = [
    [1, 0],
    [0.99, 0.01],
    [0, 1],
    [0.01, 0.99],
  ];
  const first = sphericalKMeans(input, { minimumRelativeImprovement: 0.5, batchSize: 2 });
  const second = sphericalKMeans(input, { minimumRelativeImprovement: 0.5, batchSize: 2 });
  assert.equal(first.centers.length, 2);
  assert.deepEqual(first, second);
});

test('robust center recomputation trims a small far-away tail', () => {
  const input = [...Array.from({ length: 19 }, () => [1, 0]), [0, 1]];
  const result = sphericalKMeans(input, {
    maxK: 1,
    batchSize: 5,
    outlierTrimFraction: 0.05,
  });
  assert.ok(result.centers[0]![0]! > 0.999);
  assert.ok(Math.abs(result.centers[0]![1]!) < 0.001);
});
