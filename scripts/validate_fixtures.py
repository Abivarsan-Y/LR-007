"""Validate shared fixture schemas and cross-field integration invariants."""
import hashlib
import json
import math
import struct
from datetime import datetime
from pathlib import Path

from jsonschema import Draft202012Validator, FormatChecker

ROOT = Path(__file__).resolve().parents[1]
FIXTURES = {'site': 'mock_site.json', 'analysis': 'mock_analysis.json',
            'diff': 'mock_diff.json', 'recommend': 'mock_recommend.json',
            'terrain': 'mock_terrain.json'}


def require(condition, message):
    if not condition:
        raise ValueError(message)


def validate_document(kind, data, root=ROOT):
    schema = json.loads((root / f'contracts/{kind}.schema.json').read_text())
    Draft202012Validator.check_schema(schema)
    Draft202012Validator(schema, format_checker=FormatChecker()).validate(data)
    provenance = data['provenance']
    require(provenance['data_kind'] == 'synthetic' or provenance['sources'],
            'Real data must identify its sources')
    if kind == 'site':
        bounds = data['dem_bounds']
        require(bounds['south_deg'] <= bounds['north_deg'], 'Inverted latitude bounds')
    elif kind == 'analysis':
        start, end = (datetime.fromisoformat(data[k].replace('Z', '+00:00'))
                      for k in ('start_utc', 'end_utc'))
        duration = (end-start).total_seconds()/3600
        require(duration > 0, 'Analysis duration must be positive')
        samples = data['samples']
        require(samples[0]['met_hours'] == 0 and
                math.isclose(samples[-1]['met_hours'], duration),
                'Samples must cover the full mission including both endpoints')
        previous = -1
        for sample in samples:
            met = sample['met_hours']
            instant = datetime.fromisoformat(sample['utc'].replace('Z', '+00:00'))
            require(previous < met <= duration, 'Sample times must increase strictly')
            require(math.isclose((instant-start).total_seconds()/3600, met, abs_tol=1e-8),
                    'UTC and mission elapsed time disagree')
            previous = met
            for name in ('sun', 'earth'):
                body = sample[name]
                require(body['azimuth_deg'] < 360, 'Use azimuth in [0,360)')
                if body['horizon_deg'] is None:
                    require(body['visible'] is None, 'Unknown horizon requires unknown visibility')
                    if name == 'sun':
                        require(body['illumination_fraction'] is None,
                                'Unknown horizon requires unknown illumination')
        for key, value in data['metrics'].items():
            if key.endswith('_hours') and value is not None:
                require(value <= duration, f'{key} exceeds mission duration')
        for point in data['horizon']:
            require(point['azimuth_deg'] < 360, 'Use horizon azimuth in [0,360)')
            require((point['coverage'] == 'unknown') == (point['elevation_deg'] is None),
                    'Horizon coverage and elevation disagree')
    elif kind == 'diff':
        for interval in data['diagnostic_intervals']:
            require(0 <= interval['start_met_hours'] < interval['end_met_hours'] <= data['duration_hours'],
                    'Diff interval must be ordered and inside the mission')
    elif kind == 'recommend':
        for candidate in data['candidates']:
            require(candidate['distance_m'] <= data['search_radius_m'],
                    'Candidate outside search radius')
    elif kind == 'terrain':
        asset = (root / data['asset_path']).resolve()
        require(asset.is_relative_to(root.resolve()), 'Terrain path must remain inside repository')
        raw = asset.read_bytes()
        require(len(raw) == data['width'] * data['height'] * 4, 'Terrain byte count mismatch')
        require(hashlib.sha256(raw).hexdigest() == data['sha256'], 'Terrain checksum mismatch')
        require(all(not math.isinf(v[0]) for v in struct.iter_unpack('<f', raw)),
                'Terrain cannot contain infinite heights')


def main():
    for kind, name in FIXTURES.items():
        data = json.loads((ROOT / 'data/fixtures' / name).read_text())
        require(data['provenance']['data_kind'] == 'synthetic', 'Development fixtures must be synthetic')
        validate_document(kind, data)
        print(f'PASS {kind}: {name}')
    print('All draft contract fixtures validated. No scientific predictions were tested.')


if __name__ == '__main__':
    main()
