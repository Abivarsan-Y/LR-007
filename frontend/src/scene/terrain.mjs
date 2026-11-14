/** Pure terrain decoding. No React, network, or scientific visibility computation. */
export function decodeTerrain(buffer, metadata) {
  const { width, height, spacing_m: spacing, coordinates } = metadata;
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 2 || height < 2 ||
      width * height > 1_000_000 || !Number.isFinite(spacing) || spacing <= 0 ||
      !Number.isFinite(coordinates?.elevation_m)) {
    throw new Error('Invalid terrain dimensions, spacing, or origin elevation');
  }
  if (metadata.encoding !== 'float32_le' ||
      metadata.layout !== 'row_major_north_to_south_west_to_east' ||
      metadata.height_reference !== 'metres_above_reference_sphere' ||
      metadata.nodata_encoding !== 'nan' ||
      metadata.scene_axes !== '+X east, +Y up, -Z north') {
    throw new Error('Unsupported terrain layout or encoding');
  }
  if (!(buffer instanceof ArrayBuffer) || buffer.byteLength !== width * height * 4) {
    throw new Error('Terrain byte count does not match metadata');
  }
  const view = new DataView(buffer);
  const positions = new Float32Array(width * height * 3);
  const valid = new Uint8Array(width * height);
  for (let row = 0; row < height; row++) {
    for (let col = 0; col < width; col++) {
      const i = row * width + col;
      const elevation = view.getFloat32(i * 4, true);
      if (!Number.isFinite(elevation) && !Number.isNaN(elevation)) {
        throw new Error('Infinite terrain height is not supported');
      }
      valid[i] = Number.isFinite(elevation) ? 1 : 0;
      positions[i * 3] = (col - (width - 1) / 2) * spacing;
      // Nodata vertices are placeholders only: every adjoining triangle is omitted.
      positions[i * 3 + 1] = valid[i] ? elevation - coordinates.elevation_m : 0;
      positions[i * 3 + 2] = (row - (height - 1) / 2) * spacing;
    }
  }
  const indices = [];
  for (let row = 0; row < height - 1; row++) {
    for (let col = 0; col < width - 1; col++) {
      const a = row * width + col, b = a + 1, c = a + width, d = c + 1;
      for (const triangle of [[a, c, b], [b, c, d]]) {
        if (triangle.every(i => valid[i])) indices.push(...triangle);
      }
    }
  }
  if (indices.length === 0) throw new Error('Terrain has no renderable triangles');
  // Bilinear centre height is used only to place the illustrative lander marker.
  const cx = (width - 1) / 2, cy = (height - 1) / 2;
  const centres = [Math.floor(cy) * width + Math.floor(cx), Math.floor(cy) * width + Math.ceil(cx),
    Math.ceil(cy) * width + Math.floor(cx), Math.ceil(cy) * width + Math.ceil(cx)];
  const groundY = centres.every(i => valid[i])
    ? centres.reduce((sum, i) => sum + positions[i * 3 + 1], 0) / 4 : null;
  return { positions, indices: new Uint32Array(indices), groundY,
    span: Math.max((width - 1) * spacing, (height - 1) * spacing),
    missingVertices: valid.reduce((count, v) => count + (1 - v), 0) };
}

export async function verifyTerrainChecksum(buffer, expectedHash) {
  if (!/^[a-f0-9]{64}$/.test(expectedHash)) throw new Error('Invalid terrain checksum');
  const digest = await globalThis.crypto.subtle.digest('SHA-256', buffer);
  const actual = Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('');
  if (actual !== expectedHash) throw new Error('Terrain checksum mismatch');
}
