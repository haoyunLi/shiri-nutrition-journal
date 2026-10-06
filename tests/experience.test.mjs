import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import * as model from '../public/model.js';
import { prepareImport } from '../public/import.js';
import { requestJSON } from '../public/network.js';

const date = '2026-10-06';
const photo = '/api/photos/00000000-0000-4000-8000-000000000001';
const bytes = 'data:image/jpeg;base64,/9j/';
function sample() { const state = model.demoState(date); state.meals[0].photo = photo; return state; }

test('photo backup reimport skips identical records without uploading or mutating originals', async () => {
  const current = sample(), incoming = structuredClone(current);
  incoming.meals[0].photo = bytes;
  const before = JSON.stringify(current);
  const result = await prepareImport(current, incoming, async path => { assert.equal(path, photo); return bytes; });
  assert.deepEqual(result.report, { added: 0, updated: 0, skipped: 9 });
  assert.equal(result.state.meals[0].photo, photo);
  assert.equal(JSON.stringify(current), before);
  incoming.meals[0].photo = 'data:image/jpeg;base64,/9j/AA==';
  await assert.rejects(prepareImport(current, incoming, async () => bytes), /相同更新时间/);
});

test('older imported photos stay skipped, new photo is deferred until confirmed import', async () => {
  const current = sample(), incoming = structuredClone(current);
  incoming.meals[0].updatedAt = '2025-01-01T00:00:00Z'; incoming.meals[0].photo = bytes;
  let reads = 0;
  const result = await prepareImport(current, incoming, async () => { reads++; return bytes; });
  assert.equal(reads, 0); assert.equal(result.state.meals[0].photo, photo);
  incoming.meals[0].updatedAt = '2026-10-06T12:00:00Z';
  const newer = await prepareImport(current, incoming, async () => { throw Error('should not read'); });
  assert.equal(newer.report.updated, 1); assert.equal(newer.state.meals[0].photo, bytes);
});

test('completeness preserves recent manual correction against older or legacy chat/import status', () => {
  const current = sample(); current.completeness[date] = 'partial'; current.completenessUpdatedAt = { [date]: '2026-10-06T12:00:00.000Z' };
  const payload = { version: 1, timezone: current.timezone, meals: [], weights: [], completeness: { [date]: 'complete' } };
  assert.equal(model.mergeRecords(current, payload).state.completeness[date], 'partial');
  payload.completenessUpdatedAt = { [date]: '2026-10-06T11:00:00Z' };
  assert.equal(model.mergeRecords(current, payload).state.completeness[date], 'partial');
  payload.completenessUpdatedAt[date] = '2026-10-06T13:00:00Z';
  assert.equal(model.mergeRecords(current, payload).state.completeness[date], 'complete');
  payload.completenessUpdatedAt[date] = '2026-10-06T12:00:00Z';
  assert.throws(() => model.mergeRecords(current, payload), /相同更新时间/);
});

test('local dates handle Chicago midnight, DST and leap day without fabricated weight samples', () => {
  assert.equal(model.dateKey('2026-10-07T02:00:00Z', 'America/Chicago'), '2026-10-06');
  assert.equal(model.dateKey('2026-11-01T06:30:00Z', 'America/Chicago'), '2026-11-01');
  assert.equal(model.shiftDate('2024-02-28', 1), '2024-02-29');
  assert.equal(model.validDate('2026-02-29'), false);
  assert.equal(model.movingAverage([{ date: '2026-10-01', kg: 70 }, { date, kg: 72 }], date), 71);
  assert.equal(model.movingAverage([], date), null);
});

test('formula is withheld with missing inputs; remaining range is target minus upper/lower estimate', () => {
  assert.equal(model.energy(model.EMPTY_PROFILE), null);
  assert.deepEqual(model.energy({ age: 30, sex: 'male', heightCm: 175, weightKg: 70, activity: 'sedentary' }), { ree: 1649, maintenance: 1979 });
  assert.deepEqual(model.remaining(2000, { kcal: 1000, low: 800, high: 1300 }), { point: 1000, low: 700, high: 1200 });
  assert.equal(model.budgetFor([{ effectiveDate: '2026-10-07', updatedAt: '2026-10-06T00:00:00Z', targetKcal: 2000 }], date), null);
});

test('network errors and expired HTML sign-in response provide useful feedback', async () => {
  await assert.rejects(requestJSON('/test', {}, async () => { throw new Error('offline'); }), /输入仍保留/);
  await assert.rejects(requestJSON('/test', {}, async () => new Response('<html>', { status: 401 })), /重新登录/);
  await assert.rejects(requestJSON('/test', {}, async () => new Response(JSON.stringify({ error: 'revision conflict' }), { status: 409 })), error => error.status === 409);
});

const appSource = (await readFile(new URL('../public/app.js', import.meta.url), 'utf8')).replace(/^import .*?;\n/gm, '').replace(/start\(\);\s*$/, '');
function appHarness() {
  const form = { disabled: false, dataset: {}, value: 'unsaved synthetic portion' };
  const main = { setAttribute() {} }, status = { textContent: '' }, notice = { textContent: '', setAttribute() {}, scrollIntoView() {} };
  const ctx = vm.createContext({ ...model, console, AbortSignal, Date, Intl, structuredClone, window: { addEventListener() {}, scrollTo() {} }, confirm: () => false,
    document: { querySelector: key => ({ '#operation-notice': notice, main, '#connection-status': status }[key]), querySelectorAll: () => [form] }, requestJSON: async () => { const error = new Error('conflict'); error.status = 409; throw error; } });
  vm.runInContext(appSource, ctx);
  vm.runInContext(`state=demoState('${date}');selected='${date}';editing='demo-breakfast';dirty=true;render=()=>{throw new Error('must not destroy draft on failed save')};`, ctx);
  return { ctx, form, notice };
}

test('failed save preserves current form, selected record and dirty flag; all controls unlock', async () => {
  const { ctx, form, notice } = appHarness();
  assert.equal(await vm.runInContext('persist(state,"saved")', ctx), false);
  assert.equal(form.value, 'unsaved synthetic portion'); assert.equal(form.disabled, false);
  assert.equal(vm.runInContext('editing', ctx), 'demo-breakfast'); assert.equal(vm.runInContext('dirty', ctx), true);
  assert.match(notice.textContent, /输入已保留/);
});

test('photo upload lock and save lock restore controls; cancelled navigation preserves draft', () => {
  const { ctx, form } = appHarness();
  vm.runInContext('lock(true);lock(true);lock(false);lock(false)', ctx); assert.equal(form.disabled, false);
  vm.runInContext('navigate(()=>{editing=null})', ctx); assert.equal(vm.runInContext('editing', ctx), 'demo-breakfast');
});

test('empty intake with a target is not displayed as zero or remaining; charts expose missing dates', () => {
  const { ctx } = appHarness();
  vm.runInContext(`state.profile={age:30,sex:'male',heightCm:175,weightKg:70,activity:'sedentary',targetKcal:2000};state.budgets=[{effectiveDate:'${date}',updatedAt:'2026-10-06T00:00:00Z',targetKcal:2000}];state.meals=[]`, ctx);
  const html = vm.runInContext('summary()', ctx);
  assert.match(html, /等待餐食记录/); assert.doesNotMatch(html, /与目标相差/);
  const graph = vm.runInContext(`chart([{date:'${date}',kg:70}], '${date}')`, ctx);
  assert.match(graph, /<table>/); assert.match(graph, /未记录/); assert.match(graph, /1\/7/);
});

test('server and browser models use identical validation/calculation code', async () => {
  assert.equal(await readFile(new URL('../public/model.js', import.meta.url), 'utf8'), await readFile(new URL('../lib/journal/model.js', import.meta.url), 'utf8'));
});
