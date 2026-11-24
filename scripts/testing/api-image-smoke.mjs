import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { assertSafeRuntimeTarget } from '../../packages/config/dist/index.js';

const image = process.argv[2];
assert.match(image ?? '', /^sekereagle\/api:[a-zA-Z0-9_.-]+$/, 'Pass an explicit local API image');
const prefix = `sekereagle-api-image-${randomUUID()}`;
const containers = [];
let networkCreated = false;
const password = randomBytes(24).toString('hex');
const accessKey = randomBytes(16).toString('hex');
const secretKey = randomBytes(32).toString('hex');
const tokenKey = randomBytes(32).toString('hex');
const readerCheck = process.argv.includes('--reader-check');
const readerToken = randomBytes(32).toString('hex');
const env = {
  ...(readerCheck
    ? { EAGLE_READER_URL: 'http://library-reader:3001', EAGLE_READER_TOKEN: readerToken }
    : {}),
  DATABASE_URL: `postgresql://sekereagle_test:${password}@postgres:5432/sekereagle_test`,
  S3_ENDPOINT: 'http://minio:9000',
  S3_PUBLIC_ENDPOINT: 'http://localhost:8180',
  S3_BUCKET: 'sekereagle-test',
  S3_REGION: 'us-east-1',
  S3_ACCESS_KEY_ID: accessKey,
  S3_SECRET_ACCESS_KEY: secretKey,
  JWT_ACCESS_SECRET: tokenKey,
  ACCESS_TOKEN_TTL_SECONDS: '900',
  REFRESH_TOKEN_TTL_SECONDS: '2592000',
  CANONICAL_ORIGIN: 'http://localhost:8180',
  BROWSER_TRUSTED_ORIGINS: 'http://localhost:8180',
  PORT: '3000',
  MLX_EMBEDDING_URL: 'http://127.0.0.1:1',
  MLX_EMBEDDING_TOKEN: tokenKey,
  EAGLE_BACKGROUND_PROCESSING_ENABLED: 'false',
};
assertSafeRuntimeTarget({
  databaseUrl: env.DATABASE_URL,
  s3Endpoint: env.S3_ENDPOINT,
  s3Bucket: env.S3_BUCKET,
});
const envArgs = Object.entries(env).flatMap(([key, value]) => ['--env', `${key}=${value}`]);
function run(args, timeout = 120000) {
  const result = spawnSync('docker', args, { encoding: 'utf8', timeout });
  if (result.status !== 0) {
    let diagnostic = `${result.stdout ?? ''}${result.stderr ?? ''}`;
    for (const value of [password, accessKey, secretKey, tokenKey, readerToken])
      diagnostic = diagnostic.replaceAll(value, '[test value]');
    throw new Error(`API image smoke: docker ${args[0]} failed: ${diagnostic.slice(-12000)}`);
  }
  return result.stdout.trim();
}
async function fetchWithTimeout(url, options = {}, timeoutMs = 5000) {
  const controller = new globalThis.AbortController();
  const abortTimer = globalThis.setTimeout(() => controller.abort(), timeoutMs);
  let guardTimer;
  const guard = new Promise((_, reject) => {
    guardTimer = globalThis.setTimeout(
      () => reject(new Error(`HTTP timeout: ${url}`)),
      timeoutMs + 1000,
    );
  });
  try {
    return await Promise.race([fetch(url, { ...options, signal: controller.signal }), guard]);
  } finally {
    globalThis.clearTimeout(abortTimer);
    globalThis.clearTimeout(guardTimer);
  }
}
async function waitFor(check, name, attempts = 120) {
  for (let i = 0; i < attempts; i++) {
    if (await check()) return;
    await delay(500);
  }
  throw new Error(`API image smoke: ${name} timed out`);
}
// Every compiled directory the image runs must come from this workspace build.
// Release images are assembled by replacing dist directories in place; a package
// left on an older build imports fine but exposes undefined exports at call time.
const runtimeArtifactDirectories = [
  'apps/api/dist',
  'packages/config/dist',
  'packages/eagle-filter-core/dist',
  'packages/library-core/dist',
  'packages/library-persistence/dist',
  'packages/media-core/dist',
  'packages/photo-render-core/dist',
  'packages/vector-core/dist',
];
function localArtifactManifest() {
  const manifest = new Map();
  for (const directory of runtimeArtifactDirectories) {
    const walk = (current) => {
      for (const entry of readdirSync(current, { withFileTypes: true })) {
        const path = join(current, entry.name);
        if (entry.isDirectory()) walk(path);
        else
          manifest.set(
            `${directory}/${relative(directory, path)}`,
            createHash('sha256').update(readFileSync(path)).digest('hex'),
          );
      }
    };
    walk(directory);
  }
  return manifest;
}
function assertCompiledArtifactsMatch() {
  const local = localArtifactManifest();
  const imageScript = `const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const root='/sekereagle',out={};
const walk=(base,current)=>{for(const entry of fs.readdirSync(current,{withFileTypes:true})){
const full=path.join(current,entry.name);
if(entry.isDirectory())walk(base,full);
else out[base+'/'+path.relative(path.join(root,base),full)]=crypto.createHash('sha256').update(fs.readFileSync(full)).digest('hex');}};
for(const base of process.argv.slice(1))walk(base,path.join(root,base));
console.log(JSON.stringify(out));`;
  const remote = new Map(
    Object.entries(
      JSON.parse(
        run([
          'run',
          '--rm',
          '--pull',
          'never',
          image,
          'node',
          '-e',
          imageScript,
          ...runtimeArtifactDirectories,
        ]),
      ),
    ),
  );
  const missing = [...local.keys()].filter((key) => !remote.has(key));
  const mismatched = [...local.keys()].filter(
    (key) => remote.has(key) && remote.get(key) !== local.get(key),
  );
  const extra = [...remote.keys()].filter((key) => !local.has(key));
  if (missing.length || mismatched.length || extra.length)
    throw new Error(
      'API image smoke: compiled artifacts differ from the workspace build ' +
        `(missing ${missing.length}, mismatched ${mismatched.length}, extra ${extra.length}: ` +
        `${[...missing, ...mismatched, ...extra].slice(0, 10).join(', ')}). ` +
        'Run npm run build, then replace every runtime dist directory in the image wholesale.',
    );
}
try {
  run(['image', 'inspect', image]);
  assertCompiledArtifactsMatch();
  run(['network', 'create', prefix]);
  networkCreated = true;
  const pg = `${prefix}-postgres`;
  containers.push(pg);
  run([
    'run',
    '--detach',
    '--rm',
    '--name',
    pg,
    '--network',
    prefix,
    '--network-alias',
    'postgres',
    '--publish',
    '127.0.0.1::5432',
    '--tmpfs',
    '/var/lib/postgresql/data:rw',
    '--env',
    'POSTGRES_USER=sekereagle_test',
    '--env',
    'POSTGRES_DB=sekereagle_test',
    '--env',
    `POSTGRES_PASSWORD=${password}`,
    'pgvector/pgvector:0.8.6-pg16',
  ]);
  await waitFor(
    () =>
      spawnSync(
        'docker',
        ['exec', pg, 'pg_isready', '-U', 'sekereagle_test', '-d', 'sekereagle_test'],
        { stdio: 'ignore', timeout: 3000 },
      ).status === 0,
    'isolated database',
  );
  const minio = `${prefix}-minio`;
  containers.push(minio);
  run([
    'run',
    '--detach',
    '--rm',
    '--name',
    minio,
    '--network',
    prefix,
    '--network-alias',
    'minio',
    '--publish',
    '127.0.0.1::9000',
    '--tmpfs',
    '/data:rw,uid=1000,gid=1000',
    '--env',
    `MINIO_ROOT_USER=${accessKey}`,
    '--env',
    `MINIO_ROOT_PASSWORD=${secretKey}`,
    'minio/minio:RELEASE.2025-04-22T22-12-26Z',
    'server',
    '/data',
  ]);
  const setup = `${prefix}-setup`;
  containers.push(setup);
  run([
    'run',
    '--rm',
    '--pull',
    'never',
    '--name',
    setup,
    '--network',
    prefix,
    ...envArgs,
    image,
    'sh',
    '-c',
    'node scripts/assert-safe-target.mjs && npm run db:migrate:deploy',
  ]);
  const bucketSetup = `${prefix}-bucket`;
  containers.push(bucketSetup);
  run([
    'run',
    '--rm',
    '--pull',
    'never',
    '--name',
    bucketSetup,
    '--network',
    prefix,
    '--workdir',
    '/sekereagle/apps/api',
    ...envArgs,
    image,
    'node',
    '-e',
    `const {S3Client,CreateBucketCommand}=require('@aws-sdk/client-s3');const s=new S3Client({endpoint:process.env.S3_ENDPOINT,region:process.env.S3_REGION,forcePathStyle:true,credentials:{accessKeyId:process.env.S3_ACCESS_KEY_ID,secretAccessKey:process.env.S3_SECRET_ACCESS_KEY}});s.send(new CreateBucketCommand({Bucket:process.env.S3_BUCKET})).finally(()=>s.destroy());`,
  ]);
  if (readerCheck) {
    const reader = `${prefix}-reader`;
    containers.push(reader);
    run([
      'run',
      '--detach',
      '--pull',
      'never',
      '--name',
      reader,
      '--network',
      prefix,
      '--network-alias',
      'library-reader',
      '--memory',
      '1g',
      '--env',
      `DATABASE_URL=${env.DATABASE_URL}`,
      '--env',
      `EAGLE_READER_TOKEN=${readerToken}`,
      '--env',
      'EAGLE_READER_HOST=0.0.0.0',
      '--env',
      'NODE_OPTIONS=--max-old-space-size=640',
      image,
      'node',
      'apps/api/dist/library-reader.js',
    ]);
    const probe = `const assert=require('node:assert/strict');(async()=>{
      const url='http://127.0.0.1:3001';
      assert.equal((await fetch(url+'/health')).status,401);
      const response=await fetch(url+'/query',{method:'POST',headers:{authorization:'Bearer '+process.env.EAGLE_READER_TOKEN,'content-type':'application/json'},body:JSON.stringify({scope:{ownerId:'isolated-image-reader',libraryMode:'MATERIAL'},where:{},action:'count'})});
      assert.equal(response.status,200);const result=await response.json();assert.equal(result.count,0);assert.match(result.revision,/^\\d+$/);
    })().catch(()=>process.exit(1))`;
    const ready = () =>
      spawnSync('docker', ['exec', reader, 'node', '-e', probe], { stdio: 'ignore', timeout: 5000 })
        .status === 0;
    await waitFor(ready, 'independent reader without API or storage secrets');
    run(['restart', '--time', '70', reader]);
    await waitFor(ready, 'reader reconstructs after restart');
  }
  const api = `${prefix}-api`;
  containers.push(api);
  run([
    'run',
    '--detach',
    '--pull',
    'never',
    '--name',
    api,
    '--network',
    prefix,
    '--publish',
    '127.0.0.1::3000',
    ...envArgs,
    image,
  ]);
  const port = run(['port', api, '3000']).split(':').at(-1);
  assert.match(port, /^\d+$/);
  const origin = `http://127.0.0.1:${port}`;
  await waitFor(async () => {
    try {
      return (await fetchWithTimeout(`${origin}/api/health/ready`, {}, 2000)).status === 200;
    } catch {
      return false;
    }
  }, 'final image readiness');
  for (const path of [
    '/api/library/changes',
    '/api/eagle/vector/progress',
    '/api/photos/vector/progress',
    '/api/eagle/vector/host',
    '/api/photos/vector/host',
    '/api/photos/photography/people/summary',
    '/api/photos/photography/people/review',
  ])
    assert.equal((await fetchWithTimeout(`${origin}${path}`)).status, 401);
  const smokeEmail = `image-smoke-${randomUUID()}@example.test`;
  const smokePassword = randomBytes(18).toString('hex');
  run([
    'run',
    '--rm',
    '--pull',
    'never',
    '--network',
    prefix,
    ...envArgs,
    '--env',
    `SEED_EMAIL=${smokeEmail}`,
    '--env',
    `SEED_PASSWORD=${smokePassword}`,
    image,
    'node',
    '-e',
    "const bcrypt=require('bcrypt');const {PrismaClient}=require('@prisma/client');const {createPrismaAdapter}=require('@sekereagle/library-persistence');const d=new PrismaClient({adapter:createPrismaAdapter()});d.user.create({data:{email:process.env.SEED_EMAIL,passwordHash:bcrypt.hashSync(process.env.SEED_PASSWORD,10),role:'USER'}}).finally(()=>d.$disconnect()).catch(()=>process.exit(1))",
  ]);
  const browserOrigin = 'http://localhost:8180';
  const login = await fetchWithTimeout(`${origin}/api/auth/login`, {
    method: 'POST',
    headers: { origin: browserOrigin, 'content-type': 'application/json' },
    body: JSON.stringify({ email: smokeEmail, password: smokePassword }),
  });
  assert.equal(login.status, 201);
  const cookie = (
    typeof login.headers.getSetCookie === 'function'
      ? login.headers.getSetCookie()
      : [login.headers.get('set-cookie') ?? '']
  )
    .map((value) => value.split(';', 1)[0])
    .filter(Boolean)
    .join('; ');
  assert.match(cookie, /sekereagle_access=/);
  const manualTags = await fetchWithTimeout(`${origin}/api/eagle/manual-tags`, {
    headers: { cookie },
  });
  assert.equal(manualTags.status, 200, 'authenticated manual tag list');
  assert.ok(Array.isArray(await manualTags.json()));
  const photoTags = await fetchWithTimeout(`${origin}/api/photos/manual-tags`, {
    headers: { cookie },
  });
  assert.equal(photoTags.status, 200, 'authenticated photo manual tag list');
  const created = await fetchWithTimeout(`${origin}/api/eagle/manual-tags`, {
    method: 'POST',
    headers: { cookie, origin: browserOrigin, 'content-type': 'application/json' },
    body: JSON.stringify({ name: '收藏' }),
  });
  assert.equal(created.status, 201, 'tag creation with system key');
  assert.equal((await created.json()).systemKey, 'FAVORITE');
  const afterCreate = await fetchWithTimeout(`${origin}/api/eagle/manual-tags`, {
    headers: { cookie },
  });
  assert.equal(afterCreate.status, 200);
  assert.ok((await afterCreate.json()).some((tag) => tag.systemKey === 'FAVORITE'));
  if (process.argv.includes('--request-frequency-check')) {
    const pgPort = run(['port', pg, '5432']).split(':').at(-1);
    const fixture = spawnSync(process.execPath, ['scripts/testing/request-frequency.test.mjs'], {
      encoding: 'utf8',
      timeout: 90000,
      env: {
        ...process.env,
        ...env,
        DATABASE_URL: `postgresql://sekereagle_test:${password}@127.0.0.1:${pgPort}/sekereagle_test`,
        S3_ENDPOINT: 'http://127.0.0.1:9000',
        REQUEST_FREQUENCY_TEST_ORIGIN: origin,
      },
    });
    let output = `${fixture.stdout ?? ''}${fixture.stderr ?? ''}`;
    for (const value of [password, accessKey, secretKey, tokenKey, readerToken])
      output = output.replaceAll(value, '[test value]');
    process.stdout.write(output);
    assert.equal(fixture.status, 0, 'Request-frequency HTTP regression failed');
  }
  const operations = `${prefix}-operations`;
  containers.push(operations);
  const executorEnv = Object.entries(env)
    .filter(([key]) => key === 'DATABASE_URL' || key.startsWith('S3_'))
    .flatMap(([key, value]) => ['--env', `${key}=${value}`]);
  run([
    'run',
    '--detach',
    '--pull',
    'never',
    '--name',
    operations,
    '--network',
    prefix,
    ...executorEnv,
    image,
    'node',
    'apps/api/dist/asset-operation-executor.js',
  ]);
  await waitFor(
    () =>
      spawnSync(
        'docker',
        [
          'exec',
          operations,
          'node',
          '-e',
          "process.kill(Number(require('node:fs').readFileSync('/tmp/sekereagle-asset-operations-ready','utf8')),0)",
        ],
        { stdio: 'ignore', timeout: 3000 },
      ).status === 0,
    'independent operation executor in final image',
  );
  run(['stop', '--time', '90', operations]);
  assert.equal(run(['inspect', '--format', '{{.State.ExitCode}}', operations]), '0');
  const shareRenderer = `${prefix}-share-renderer`;
  containers.push(shareRenderer);
  run([
    'run',
    '--detach',
    '--pull',
    'never',
    '--name',
    shareRenderer,
    '--network',
    prefix,
    ...executorEnv,
    image,
    'node',
    'apps/api/dist/library-share-renderer.js',
  ]);
  await waitFor(
    () =>
      spawnSync(
        'docker',
        [
          'exec',
          shareRenderer,
          'node',
          '-e',
          "process.kill(Number(require('node:fs').readFileSync('/tmp/sekereagle-share-renderer-ready','utf8')),0)",
        ],
        { stdio: 'ignore', timeout: 3000 },
      ).status === 0,
    'independent share renderer in final image',
  );
  run(['stop', '--time', '90', shareRenderer]);
  assert.equal(run(['inspect', '--format', '{{.State.ExitCode}}', shareRenderer]), '0');
  if (process.argv.includes('--storage-check')) {
    // Run the real-storage fixture without an API scheduler racing its explicit ticks.
    run(['stop', api]);
    const pgPort = run(['port', pg, '5432']).split(':').at(-1);
    const minioPort = run(['port', minio, '9000']).split(':').at(-1);
    assert.match(pgPort, /^\d+$/);
    assert.match(minioPort, /^\d+$/);
    const fixture = spawnSync(process.execPath, ['scripts/testing/asset-operation-storage.mjs'], {
      encoding: 'utf8',
      timeout: 90000,
      env: {
        ...process.env,
        ...env,
        DATABASE_URL: `postgresql://sekereagle_test:${password}@127.0.0.1:${pgPort}/sekereagle_test`,
        S3_ENDPOINT: `http://127.0.0.1:${minioPort}`,
      },
    });
    let output = `${fixture.stdout ?? ''}${fixture.stderr ?? ''}`;
    for (const value of [password, accessKey, secretKey, tokenKey, readerToken])
      output = output.replaceAll(value, '[test value]');
    process.stdout.write(output);
    assert.equal(fixture.status, 0, 'Real-storage fixture failed');
  }
  process.stdout.write(
    JSON.stringify({
      image,
      compiledArtifactsMatch: true,
      isolatedFinalImageBoot: true,
      migrations: true,
      readiness: 200,
      unauthenticatedPeople: 401,
      authenticatedManualTags: true,
      independentExecutorWithoutApiSecrets: true,
      executorGracefulExit: 0,
      ...(readerCheck
        ? { independentReaderWithoutApiOrStorageSecrets: true, readerRestart: true }
        : {}),
    }) + '\n',
  );
} catch (error) {
  const last = containers.at(-1);
  if (last?.endsWith('-api')) {
    const logs = spawnSync('docker', ['logs', '--tail', '80', last], {
      encoding: 'utf8',
      timeout: 5000,
    });
    let diagnostic = `${logs.stdout ?? ''}${logs.stderr ?? ''}`;
    for (const value of [password, accessKey, secretKey, tokenKey, readerToken])
      diagnostic = diagnostic.replaceAll(value, '[test value]');
    process.stderr.write(diagnostic);
  }
  throw error;
} finally {
  for (const name of containers.reverse())
    spawnSync('docker', ['rm', '--force', name], { stdio: 'ignore', timeout: 30000 });
  if (networkCreated)
    spawnSync('docker', ['network', 'rm', prefix], { stdio: 'ignore', timeout: 30000 });
}
