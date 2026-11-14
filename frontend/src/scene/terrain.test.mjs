import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { decodeTerrain, verifyTerrainChecksum } from './terrain.mjs';
const metadata = JSON.parse(await readFile(new URL('../../../data/fixtures/mock_terrain.json', import.meta.url)));
const raw = await readFile(new URL('../../../data/fixtures/mock_height_grid.bin', import.meta.url));
const buffer = raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength);

test('real fixture bytes match checksum and expected mesh budget', async () => {
  await verifyTerrainChecksum(buffer, metadata.sha256);
  const mesh = decodeTerrain(buffer, metadata);
  assert.equal(mesh.positions.length, 64 * 64 * 3);
  assert.equal(mesh.indices.length, 63 * 63 * 6);
  assert.equal(mesh.span, 1260);
  assert.equal(mesh.missingVertices, 0);
  assert.ok(mesh.groundY < -9);
});
test('northwest sample is west and north; triangles face up', () => {
  const mesh = decodeTerrain(buffer, metadata);
  assert.equal(mesh.positions[0], -630);
  assert.equal(mesh.positions[2], -630);
  const [a, b, c] = mesh.indices;
  const p = i => Array.from(mesh.positions.slice(i * 3, i * 3 + 3));
  const [pa, pb, pc] = [a, b, c].map(p);
  const normalY = (pb[2] - pa[2]) * (pc[0] - pa[0]) - (pb[0] - pa[0]) * (pc[2] - pa[2]);
  assert.ok(normalY > 0);
});
test('nodata removes adjoining faces instead of inventing terrain', () => {
  const altered = buffer.slice(0);
  new DataView(altered).setFloat32(0, NaN, true);
  const mesh = decodeTerrain(altered, metadata);
  assert.equal(mesh.missingVertices, 1);
  assert.ok(!mesh.indices.includes(0));
  assert.equal(mesh.indices.length, 63 * 63 * 6 - 3);
});
test('missing centre suppresses lander ground position', () => {
  const altered = buffer.slice(0);
  new DataView(altered).setFloat32((31 * 64 + 31) * 4, NaN, true);
  assert.equal(decodeTerrain(altered, metadata).groundY, null);
});
test('corrupt bytes and layout are rejected', async () => {
  await assert.rejects(verifyTerrainChecksum(buffer, '0'.repeat(64)), /checksum mismatch/);
  assert.throws(() => decodeTerrain(buffer.slice(4), metadata), /byte count/);
  assert.throws(() => decodeTerrain(buffer, { ...metadata, encoding: 'float32_be' }), /layout/);
  const altered = buffer.slice(0);
  new DataView(altered).setFloat32(0, Infinity, true);
  assert.throws(() => decodeTerrain(altered, metadata), /Infinite/);
});
