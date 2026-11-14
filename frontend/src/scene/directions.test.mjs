import test from 'node:test';
import assert from 'node:assert/strict';
import { azElToSceneDirection } from './directions.mjs';

for (const [name, az, el, expected] of [
  ['north', 0, 0, [0, 0, -1]], ['east', 90, 0, [1, 0, 0]],
  ['south', 180, 0, [0, 0, 1]], ['west', 270, 0, [-1, 0, 0]],
  ['zenith', 0, 90, [0, 1, 0]], ['nadir', 0, -90, [0, -1, 0]],
]) {
  test(name, () => {
    const direction = Object.values(azElToSceneDirection(az, el));
    direction.forEach((value, i) => assert.ok(Math.abs(value - expected[i]) < 1e-12));
  });
}
test('oblique direction is a unit vector', () => {
  const { x, y, z } = azElToSceneDirection(217, -3.5);
  assert.ok(Math.abs(Math.hypot(x, y, z) - 1) < 1e-12);
});
test('invalid input is rejected', () => {
  for (const [az, el] of [[NaN, 0], [0, Infinity], [-1, 0], [360, 0], [0, 91]]) {
    assert.throws(() => azElToSceneDirection(az, el), RangeError);
  }
});
