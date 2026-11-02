import assert from 'node:assert/strict';
import { test } from 'node:test';
import { compareList, compareRun, flatten, type Ran, type Row } from '../../scripts/test-inventory.ts';

const row = (title: string, skipped = false): Row => ({ file: 'a.spec.ts', title, project: 'max', skipped });
const ran = (title: string, status = 'expected', attempts = 1): Ran => ({ file: 'a.spec.ts', title, project: 'max', status, attempts });

test('a removed or renamed test fails the list check, and a new test does not', () => {
  assert.deepEqual(compareList([row('one')], [ran('one'), ran('new')]), []);
  assert.equal(compareList([row('one')], [ran('renamed')]).length, 1);
});

test('a test on a different project counts as removed', () => {
  assert.equal(compareList([row('one')], [{ ...ran('one'), project: 'se' }]).length, 1);
});

test('a clean run passes, including its expected skips and any new tests', () => {
  assert.deepEqual(compareRun([row('one'), row('two', true)], [ran('one'), ran('two', 'skipped'), ran('new')]), []);
});

test('a test that a stage filter dropped fails the run check', () => {
  assert.match(compareRun([row('one')], [])[0], /ran 0 times/);
});

test('a test run twice by overlapping stages fails the run check', () => {
  assert.match(compareRun([row('one')], [ran('one'), ran('one')])[0], /ran 2 times/);
});

test('a new skip fails, and so does a test that stopped being skipped', () => {
  assert.match(compareRun([row('one')], [ran('one', 'skipped')])[0], /newly skipped/);
  assert.match(compareRun([row('one', true)], [ran('one')])[0], /should have been skipped/);
});

test('a failure, a flaky pass or a retried pass fails the run check', () => {
  assert.match(compareRun([row('one')], [ran('one', 'unexpected')])[0], /unexpected/);
  assert.match(compareRun([row('one')], [ran('one', 'flaky', 2)])[0], /flaky/);
  assert.match(compareRun([row('one')], [ran('one', 'expected', 2)])[0], /needed a retry/);
});

test('titles keep their describe blocks, so repeated titles stay apart', () => {
  const report = { suites: [{ file: 'a.spec.ts', title: 'a.spec.ts', suites: ['plain', 'insets'].map((title) => ({ title, specs: [{ title: 'Pip', tests: [{ projectName: 'max', status: 'expected', results: [{}] }] }] })) }] };
  assert.deepEqual(flatten(report).map((r) => r.title), ['plain › Pip', 'insets › Pip']);
});
