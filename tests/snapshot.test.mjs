import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import ts from 'typescript';
import * as model from '../public/model.js';
class JournalError extends Error { constructor(status, message) { super(message); this.status = status; } }
const photoSource = ts.transpileModule(await readFile(new URL('../lib/journal/photo.ts', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText.replace(/^import .*?;\n/gm, '').replace(/^export /gm, '');
const storeSource = ts.transpileModule(await readFile(new URL('../lib/journal/store.ts', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText.replace(/^import .*?;\n/gm, '').replace(/^export /gm, '');

function harness(snapshot, existingPhoto = null) {
  const state = model.demoState('2026-10-06');
  let mutations = 0;
  const DB = { prepare(sql) { return { bind() { return this; }, async first() {
    if (sql.includes('FROM journals')) return { state: JSON.stringify(state), revision: 3 };
    if (sql.includes('FROM photos')) return existingPhoto;
    return null;
  }, async run() { mutations++; return {}; } }; }, async batch() { mutations++; return []; } };
  const PHOTOS = { async put() { mutations++; }, async delete() { mutations++; }, async get() { return { arrayBuffer: async () => new Uint8Array([255, 216, 255, 0]).buffer }; } };
  const ctx = vm.createContext({ ...model, JournalError, ownerIdentity() {}, chatSnapshot: snapshot, env: { DB, PHOTOS }, Uint8Array, atob, Date, JSON });
  vm.runInContext(photoSource + '\n' + storeSource, ctx);
  return { ctx, state, mutations: () => mutations };
}

test('conflicting chat snapshot keeps the stored journal available without photo writes', async () => {
  const current = model.demoState('2026-10-06');
  const snapshot = { batchId: 'synthetic-batch', payload: { version: 1, timezone: current.timezone, meals: [{ ...current.meals[0], kcal: 350 }], weights: [], completeness: {} }, photos: [] };
  const fixture = harness(snapshot);
  const result = await vm.runInContext('loadJournal("synthetic-owner")', fixture.ctx);
  assert.equal(result.revision, 3); assert.match(result.syncWarning, /暂未合并/);
  assert.equal(JSON.stringify(result.state.meals), JSON.stringify(fixture.state.meals));
  assert.equal(fixture.mutations(), 0);
});

test('reused photo ID with changed bytes fails before overwriting existing private object', async () => {
  const current = model.demoState('2026-10-06'), id = '00000000-0000-4000-8000-000000000001';
  const snapshot = { batchId: 'synthetic-batch', payload: { version: 1, timezone: current.timezone, meals: [{ ...current.meals[0], updatedAt: '2026-10-06T15:00:00Z', photo: `/api/photos/${id}` }], weights: [], completeness: {} }, photos: [{ id, mime: 'image/jpeg', base64: '/9j/AQ==' }] };
  const fixture = harness(snapshot, { owner_id: 'synthetic-owner', object_key: 'synthetic-owner/photo', mime: 'image/jpeg' });
  const result = await vm.runInContext('loadJournal("synthetic-owner")', fixture.ctx);
  assert.match(result.syncWarning, /照片内容不同/); assert.equal(fixture.mutations(), 0);
});

test('photo signatures and size limits reject mismatched or oversized files', () => {
  const fixture = harness({});
  assert.throws(() => vm.runInContext(`validatePhotoBytes(new Uint8Array([137,80,78]),'image/png')`, fixture.ctx), /内容与格式不符/);
  assert.throws(() => vm.runInContext(`validatePhotoBytes(new Uint8Array(3145729),'image/jpeg')`, fixture.ctx), /最多 3 MB/);
  vm.runInContext(`validatePhotoBytes(new Uint8Array([255,216,255]),'image/jpeg')`, fixture.ctx);
});
