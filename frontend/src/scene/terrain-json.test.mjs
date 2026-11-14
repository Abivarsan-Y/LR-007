import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { adaptTerrainJson } from './terrain-json.mjs';
const original = JSON.parse(await readFile(new URL('../../../data/processed/site01_connecting_ridge.json', import.meta.url)));

test('B grid adapts without mutating source metadata or claiming verified orientation', () => {
  const before = JSON.stringify(original);
  const { mesh, diagnostics } = adaptTerrainJson(original);
  assert.equal(mesh.positions.length, 64 * 64 * 3);
  assert.equal(mesh.indices.length, 63 * 63 * 6);
  const index = original.observer.grid_y * 64 + original.observer.grid_x;
  assert.deepEqual(Array.from(mesh.positions.slice(index * 3, index * 3 + 3)), [0, 0, 0]);
  assert.equal(diagnostics.nominalElevationM, 1850);
  assert.equal(diagnostics.gridObserverElevationM, original.heights[index]);
  assert.equal(diagnostics.normalizedLongitudeDeg, -138);
  assert.equal(diagnostics.orientationVerified, false);
  assert.equal(JSON.stringify(original), before);
});
test('all four exported site files can be inspected', async () => {
  for (const name of ['site01_connecting_ridge', 'site04_shackleton_rim', 'site07_malapert_mountain', 'site09_haworth_floor']) {
    const data = JSON.parse(await readFile(new URL(`../../../data/processed/${name}.json`, import.meta.url)));
    assert.ok(adaptTerrainJson(data).mesh.indices.length > 0);
  }
});
test('null heights leave holes and a missing observer hides the marker', () => {
  const data = structuredClone(original);
  const i = data.observer.grid_y * data.grid.cols + data.observer.grid_x;
  data.heights[i] = null;
  const { mesh } = adaptTerrainJson(data);
  assert.equal(mesh.groundY, null);
  assert.equal(mesh.missingVertices, 1);
  assert.ok(!mesh.indices.includes(i));
});
test('bad heights, dimensions, observer or spacing are rejected', () => {
  for (const alter of [
    d => d.heights.pop(), d => { d.heights[0] = Infinity; },
    d => { d.grid.cols = 0; }, d => { d.observer.grid_x = 999; },
    d => { d.grid.step_m = 1; }, d => { d.schema_version = 'unknown'; },
  ]) {
    const data = structuredClone(original); alter(data);
    assert.throws(() => adaptTerrainJson(data));
  }
});
