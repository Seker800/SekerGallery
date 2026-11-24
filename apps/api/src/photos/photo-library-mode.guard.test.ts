import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

const PHOTO_MODE = "@SetMetadata(LIBRARY_MODE, 'PHOTO')";
const EXPECTED_FILES = [
  'photo-agent.controller.ts',
  'photo-library.module.ts',
  'photo-management.controller.ts',
  'photo-statistics.controller.ts',
];

function violations(files: Array<{ name: string; source: string }>): string[] {
  const found: string[] = [];
  for (const { name, source } of files) {
    if (!source.includes('AccessAuthGuard') && !source.includes('BrowserPrincipalGuard')) continue;
    const controllers = source.match(/@Controller\(/g)?.length ?? 0;
    const declared = source.split(PHOTO_MODE).length - 1;
    if (controllers > declared) found.push(name);
  }
  return found;
}

test('every photo asset controller declares PHOTO mode before using the auth guard', () => {
  const files = readdirSync(__dirname)
    .filter((name) => name.endsWith('.controller.ts') || name === 'photo-library.module.ts')
    .map((name) => ({ name, source: readFileSync(join(__dirname, name), 'utf8') }));
  const names = new Set(files.map(({ name }) => name));
  assert.deepEqual(
    EXPECTED_FILES.filter((name) => !names.has(name)),
    [],
    'The guarded controller set changed; update this gate deliberately.',
  );
  assert.deepEqual(
    violations(files),
    [],
    'A PHOTO controller without @SetMetadata would fall back to no private grant.',
  );
});

test('the gate fails a controller that omits PHOTO mode', () => {
  assert.deepEqual(
    violations([
      {
        name: 'bad.controller.ts',
        source: '@Controller("photos/bad") @UseGuards(AccessAuthGuard) class Bad {}',
      },
    ]),
    ['bad.controller.ts'],
  );
});
