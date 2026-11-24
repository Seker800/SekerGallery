import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

const PHOTO_MODE = "@SetMetadata(LIBRARY_MODE, 'PHOTO')";

test('every photo asset controller declares PHOTO mode before using the auth guard', () => {
  const violations: string[] = [];
  for (const file of readdirSync(__dirname).filter(
    (name) => name.endsWith('.controller.ts') || name === 'photo-library.module.ts',
  )) {
    const source = readFileSync(join(__dirname, file), 'utf8');
    if (!source.includes('AccessAuthGuard') && !source.includes('BrowserPrincipalGuard')) continue;
    const controllers = source.match(/@Controller\(/g)?.length ?? 0;
    const declared = source.split(PHOTO_MODE).length - 1;
    if (controllers > declared) violations.push(file);
  }
  assert.deepEqual(
    violations,
    [],
    'A PHOTO controller without @SetMetadata would fall back to no private grant.',
  );
});
