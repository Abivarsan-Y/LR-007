import { decodeTerrain } from './terrain.mjs';

/** Adapt B's v1 JSON for visual inspection. Does not assert ENU or scientific validity. */
export function adaptTerrainJson(data) {
  if (!data || data.schema_version !== '1.0') throw new Error('Unsupported B terrain version');
  const { grid, observer, coordinates, heights } = data;
  const width = grid?.cols, height = grid?.rows;
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 2 || height < 2 || width * height > 1_000_000) {
    throw new Error('Invalid terrain grid dimensions');
  }
  if (!Array.isArray(heights) || heights.length !== width * height ||
      heights.some(v => v !== null && (typeof v !== 'number' || !Number.isFinite(v) || Math.abs(v) > 100000))) {
    throw new Error('Expected one finite height or null per grid sample');
  }
  const spacingX = grid.physical_width_m / (width - 1);
  const spacingZ = grid.physical_height_m / (height - 1);
  if (!Number.isFinite(spacingX) || !Number.isFinite(spacingZ) || spacingX <= 0 || spacingZ <= 0 ||
      !Number.isFinite(grid.step_m) || grid.step_m <= 0 ||
      Math.abs(grid.step_m - (spacingX + spacingZ) / 2) > 1e-4) {
    throw new Error('Grid spacing and extent disagree');
  }
  if (!Number.isInteger(observer?.grid_x) || !Number.isInteger(observer?.grid_y) ||
      observer.grid_x < 0 || observer.grid_x >= width || observer.grid_y < 0 || observer.grid_y >= height) {
    throw new Error('Observer must lie inside the terrain grid');
  }
  if (!Number.isFinite(coordinates?.lat_deg) || Math.abs(coordinates.lat_deg) > 90 ||
      !Number.isFinite(coordinates?.lon_deg) || Math.abs(coordinates.lon_deg) > 360 ||
      !Number.isFinite(coordinates?.elevation_m)) throw new Error('Invalid nominal site coordinates');
  const observerElevation = heights[observer.grid_y * width + observer.grid_x];
  const displayOrigin = observerElevation ?? heights.find(v => v !== null);
  if (displayOrigin === undefined) throw new Error('Terrain has no valid heights');
  const bytes = new ArrayBuffer(width * height * 4);
  const view = new DataView(bytes);
  heights.forEach((value, i) => view.setFloat32(i * 4, value ?? NaN, true));
  const mesh = decodeTerrain(bytes, {
    width, height, spacing_m: spacingX, coordinates: { elevation_m: displayOrigin },
    encoding: 'float32_le', layout: 'row_major_north_to_south_west_to_east',
    height_reference: 'metres_above_reference_sphere', nodata_encoding: 'nan',
    scene_axes: '+X east, +Y up, -Z north',
  });
  // Internal mesh coordinates only. Grid axes are not relabeled as verified local ENU.
  for (let i = 0; i < width * height; i++) {
    mesh.positions[i * 3] = (i % width - observer.grid_x) * spacingX;
    mesh.positions[i * 3 + 1] = heights[i] === null ? 0 : heights[i] - displayOrigin;
    mesh.positions[i * 3 + 2] = (Math.floor(i / width) - observer.grid_y) * spacingZ;
  }
  mesh.groundY = observerElevation === null ? null : 0;
  mesh.span = Math.max(grid.physical_width_m, grid.physical_height_m);
  return {
    mesh,
    diagnostics: {
      siteId: data.site_id, sourceTag: data.data_source ?? 'not supplied',
      nominalElevationM: coordinates.elevation_m, gridObserverElevationM: observerElevation,
      displayOriginM: displayOrigin,
      normalizedLongitudeDeg: ((coordinates.lon_deg + 180) % 360 + 360) % 360 - 180,
      orientationVerified: false,
      warnings: [
        'Terrain frame, orientation and height reference are unverified. Celestial overlays are hidden.',
        'Display heights are relative to the grid observer; source site metadata is preserved.',
        ...(observerElevation !== null && Math.abs(observerElevation - coordinates.elevation_m) > 1
          ? ['Nominal site elevation differs from the sampled observer height; resolve before ephemeris integration.'] : []),
      ],
    },
  };
}
