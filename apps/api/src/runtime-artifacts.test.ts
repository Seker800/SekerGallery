import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { assertCompiledWorkspaceExports, missingWorkspaceExports } from './runtime-artifacts';

async function fixture(exported: string, accessed: string): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'runtime-artifacts-'));
  const pkg = join(root, 'node_modules', '@sekereagle', 'fixture');
  await mkdir(pkg, { recursive: true });
  await writeFile(join(pkg, 'package.json'), JSON.stringify({ name: '@sekereagle/fixture' }));
  await writeFile(join(pkg, 'index.js'), `exports.${exported} = () => 'ok';\n`);
  const dist = join(root, 'dist');
  await mkdir(dist, { recursive: true });
  await writeFile(
    join(dist, 'main.js'),
    `const fixture_1 = require("@sekereagle/fixture");\nfixture_1.${accessed}();\n`,
  );
  await writeFile(
    join(dist, 'ignored.test.js'),
    `const fixture_1 = require("@sekereagle/fixture");\nfixture_1.neverExported();\n`,
  );
  return root;
}

void test('missing workspace exports fail at startup', async () => {
  const root = await fixture('present', 'present');
  try {
    await writeFile(
      join(root, 'dist', 'main.js'),
      `const fixture_1 = require("@sekereagle/fixture");\nfixture_1.present();\nfixture_1.removed();\n`,
    );
    assert.deepEqual(missingWorkspaceExports(join(root, 'dist')), ['@sekereagle/fixture removed']);
    assert.throws(
      () => assertCompiledWorkspaceExports(join(root, 'dist')),
      /@sekereagle\/fixture removed/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

void test('matching workspace exports and test files pass', async () => {
  const root = await fixture('present', 'present');
  try {
    assert.deepEqual(missingWorkspaceExports(join(root, 'dist')), []);
    assert.doesNotThrow(() => assertCompiledWorkspaceExports(join(root, 'dist')));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
