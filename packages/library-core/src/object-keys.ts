const OWNER_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function safeSegment(value: string): boolean {
  return /^[A-Za-z0-9._-]+$/.test(value);
}

function randomId(): string {
  const value = globalThis.crypto?.randomUUID?.();
  if (!value) throw new Error('对象键随机标识不可用');
  return value;
}

export function createAssetObjectKey(ownerId: string, suffix = 'original'): string {
  if (!OWNER_ID_PATTERN.test(ownerId)) throw new Error('ownerId 必须是 UUID');
  const leafName = suffix.split(/[\\/]/).at(-1) ?? '';
  const safeSuffix = leafName
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^[-.]+|[-.]+$/g, '');
  if (!safeSuffix || safeSuffix === '.' || safeSuffix === '..') throw new Error('对象后缀无效');
  return `users/${ownerId}/assets/${randomId()}/${safeSuffix}`;
}

export function mediaOutputPrefix(
  ownerId: string,
  assetId: string,
  kind: 'renditions' | 'pyramids',
  revision: number,
  attemptId: string,
): string {
  if (!safeSegment(ownerId) || !safeSegment(assetId) || !safeSegment(attemptId))
    throw new Error('对象范围无效');
  if (!Number.isSafeInteger(revision) || revision < 0) throw new Error('对象输出范围无效');
  return `users/${ownerId}/assets/${assetId}/${kind}/${revision}/attempts/${attemptId}/`;
}

export function editedCopyKey(ownerId: string, assetId: string, extension: string): string {
  if (!safeSegment(ownerId) || !safeSegment(assetId)) throw new Error('对象范围无效');
  if (!/^(?:png|jpg|webp)$/.test(extension)) throw new Error('对象后缀无效');
  return `users/${ownerId}/assets/${assetId}/original.${extension}`;
}

/** Keys are always owner scoped and may never traverse segments. */
export function assertOwnedObjectKey(ownerId: string, objectKey: string): void {
  if (!safeSegment(ownerId) || !objectKey.startsWith(`users/${ownerId}/`))
    throw new Error('对象不属于当前用户');
  if (
    objectKey.length > 1024 ||
    objectKey.includes('\\') ||
    objectKey.includes('\0') ||
    objectKey.includes('//')
  )
    throw new Error('对象键不安全');
  const segments = objectKey.split('/');
  if (segments.some((segment) => segment === '.' || segment === '..'))
    throw new Error('对象键不安全');
}
