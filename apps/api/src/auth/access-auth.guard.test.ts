import assert from 'node:assert/strict';
import test from 'node:test';
import { AccessAuthGuard } from './access-auth.guard';
import { ACCESS_COOKIE_NAME } from './auth.constants';
import { LIBRARY_MODE } from '../eagle/library-mode';

function context(controller: object) {
  const request = { method: 'GET', headers: {}, cookies: { [ACCESS_COOKIE_NAME]: 'token' } };
  return {
    request,
    value: {
      switchToHttp: () => ({ getRequest: () => request }),
      getClass: () => controller,
    },
  };
}

function guard(grants: Array<string>) {
  return new AccessAuthGuard(
    { verifyAccessToken: async () => ({ sub: 'owner' }) } as never,
    {} as never,
    {
      readGrant: async (_owner: string, _request: unknown, mode: string) => {
        grants.push(mode);
        return null;
      },
    } as never,
    { canActivate: () => true } as never,
  );
}

test('unknown controllers fail closed instead of inheriting material private access', async () => {
  class UnknownController {}
  const grants: string[] = [];
  const { request, value } = context(UnknownController);
  assert.equal(await guard(grants).canActivate(value as never), true);
  assert.equal(grants.length, 0);
  assert.equal((request as { user?: { canViewPrivate?: boolean } }).user?.canViewPrivate, false);
});

test('declared controllers read the grant for their own library mode', async () => {
  class MaterialController {}
  Reflect.defineMetadata(LIBRARY_MODE, 'MATERIAL', MaterialController);
  const materialGrants: string[] = [];
  const material = context(MaterialController);
  await guard(materialGrants).canActivate(material.value as never);
  assert.deepEqual(materialGrants, ['MATERIAL']);

  class PhotoController {}
  Reflect.defineMetadata(LIBRARY_MODE, 'PHOTO', PhotoController);
  const photoGrants: string[] = [];
  const photo = context(PhotoController);
  await guard(photoGrants).canActivate(photo.value as never);
  assert.deepEqual(photoGrants, ['PHOTO']);
});
