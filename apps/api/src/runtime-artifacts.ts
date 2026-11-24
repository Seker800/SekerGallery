import { readdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';

const WORKSPACE_REQUIRE =
  /(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*require\("(@sekereagle\/[^"]+)"\)/g;

function compiledFiles(directory: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...compiledFiles(path));
    else if (entry.name.endsWith('.js') && !entry.name.endsWith('.test.js')) files.push(path);
  }
  return files;
}

/** Namespace exports referenced by the compiled JavaScript in this directory. */
export function referencedWorkspaceExports(directory: string): Map<string, Set<string>> {
  const references = new Map<string, Set<string>>();
  for (const file of compiledFiles(directory)) {
    const code = readFileSync(file, 'utf8');
    for (const [, alias, specifier] of code.matchAll(WORKSPACE_REQUIRE)) {
      const names = references.get(specifier!) ?? new Set<string>();
      references.set(specifier!, names);
      for (const access of code.matchAll(new RegExp(`\\b${alias}\\.([A-Za-z_$][\\w$]*)`, 'g')))
        names.add(access[1]!);
    }
  }
  return references;
}

/**
 * Release images replace compiled directories in place, so an older workspace
 * package keeps importing fine while its missing exports are undefined at call
 * time. Fail at start-up instead of serving per-request TypeErrors.
 */
export function missingWorkspaceExports(directory: string): string[] {
  const requireFrom = createRequire(join(resolve(directory), 'runtime-artifacts.js'));
  const missing: string[] = [];
  for (const [specifier, names] of referencedWorkspaceExports(directory)) {
    let loaded: Record<string, unknown>;
    try {
      loaded = requireFrom(specifier) as Record<string, unknown>;
    } catch {
      missing.push(`${specifier}（无法加载）`);
      continue;
    }
    for (const name of names) if (loaded[name] === undefined) missing.push(`${specifier} ${name}`);
  }
  return missing.sort();
}

export function assertCompiledWorkspaceExports(directory = __dirname): void {
  const missing = missingWorkspaceExports(directory);
  if (missing.length)
    throw new Error(`编译产物与共享包版本不一致，请重新构建并整体替换 dist：${missing.join('、')}`);
}
