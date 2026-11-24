import assert from 'node:assert/strict';
import test from 'node:test';
import {
  MediaInspectionBudget,
  inspectionConcurrency,
  uploadInspectionTransferConcurrency,
} from './media-inspection-budget';

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

test('inspection budget bounds per-owner work, queue depth and releases after failure', async () => {
  const budget = new MediaInspectionBudget({ transferConcurrency: 1, decodeConcurrency: 1 });
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let running = 0;
  const execute = (owner: string, fail = false) =>
    budget.run(owner, async (gates) => {
      await gates.transfer(async () => {
        running++;
        assert.equal(running, 1);
        try {
          await gate;
          if (fail) throw new Error('decode failed');
        } finally {
          running--;
        }
      });
      return owner;
    });
  const first = execute('owner-1', true).catch((error) => error.message);
  const rest = [execute('owner-1'), execute('owner-1'), execute('owner-1'), execute('owner-2')];
  await assert.rejects(execute('owner-1'), /繁忙/);
  release();
  assert.equal(await first, 'decode failed');
  assert.deepEqual(await Promise.all(rest), ['owner-1', 'owner-1', 'owner-1', 'owner-2']);
  assert.equal(await execute('owner-1'), 'owner-1');
});

test('transfer slots overlap while decode stays serialized', async () => {
  const budget = new MediaInspectionBudget({ transferConcurrency: 2, decodeConcurrency: 1 });
  let transfers = 0;
  let maxTransfers = 0;
  let decodes = 0;
  let maxDecodes = 0;
  const execute = (owner: string) =>
    budget.run(owner, async (gates) => {
      await gates.transfer(async () => {
        transfers++;
        maxTransfers = Math.max(maxTransfers, transfers);
        await delay(10);
        transfers--;
      });
      await gates.decode(async () => {
        decodes++;
        maxDecodes = Math.max(maxDecodes, decodes);
        await delay(5);
        decodes--;
      });
    });
  const jobs: Promise<void>[] = [];
  for (let index = 0; index < 5; index++) jobs.push(execute(`owner-${index}`));
  await Promise.all(jobs);
  assert.equal(maxTransfers, 2);
  assert.equal(maxDecodes, 1);
  assert.equal(transfers, 0);
  assert.equal(decodes, 0);
});

test('a full wait queue rejects with the existing busy response', async () => {
  const budget = new MediaInspectionBudget({ transferConcurrency: 1, decodeConcurrency: 1 });
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const running = budget.run('owner-running', async (gates) => {
    await gates.transfer(() => gate);
  });
  const waiting: Promise<void>[] = [];
  for (let index = 0; index < 32; index++)
    waiting.push(
      budget.run(`owner-${index}`, async (gates) => {
        await gates.transfer(async () => undefined);
      }),
    );
  await delay(5);
  await assert.rejects(
    budget.run('owner-overflow', async (gates) => {
      await gates.transfer(async () => undefined);
    }),
    /繁忙/,
  );
  release();
  await running;
  await Promise.all(waiting);
});

test('inspection concurrency overrides are range-checked and fall back to defaults', () => {
  assert.equal(inspectionConcurrency('transfer', '4'), 4);
  assert.equal(inspectionConcurrency('transfer', '1'), 1);
  assert.equal(inspectionConcurrency('transfer', '8'), 8);
  assert.equal(inspectionConcurrency('transfer', '9'), 2);
  assert.equal(inspectionConcurrency('transfer', '0'), 2);
  assert.equal(inspectionConcurrency('transfer', '2.5'), 2);
  assert.equal(inspectionConcurrency('transfer', undefined), 2);
  assert.equal(inspectionConcurrency('decode', '2'), 2);
  assert.equal(inspectionConcurrency('decode', '3'), 1);
  assert.equal(uploadInspectionTransferConcurrency('3'), 3);
  assert.equal(uploadInspectionTransferConcurrency('17'), 2);
});
