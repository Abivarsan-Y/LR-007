import copy
import json
import unittest
from jsonschema import ValidationError
from scripts.validate_fixtures import ROOT, FIXTURES, validate_document


def fixture(kind):
    return json.loads((ROOT / 'data/fixtures' / FIXTURES[kind]).read_text())


class ContractTests(unittest.TestCase):
    def test_all_examples(self):
        for kind in FIXTURES:
            with self.subTest(kind=kind):
                validate_document(kind, fixture(kind))

    def test_invalid_coordinate_rejected(self):
        data = fixture('site')
        data['coordinates']['latitude_deg'] = -91
        with self.assertRaises(ValidationError):
            validate_document('site', data)

    def test_timestamp_requires_utc(self):
        data = fixture('analysis')
        data['start_utc'] = '2026-11-14T00:00:00+05:30'
        with self.assertRaises(ValidationError):
            validate_document('analysis', data)

    def test_unknown_is_not_visible(self):
        data = fixture('analysis')
        data['samples'][0]['sun']['horizon_deg'] = None
        with self.assertRaises(ValueError):
            validate_document('analysis', data)

    def test_time_alignment_rejected(self):
        data = fixture('analysis')
        data['samples'][1]['met_hours'] = 1.5
        with self.assertRaises(ValueError):
            validate_document('analysis', data)

    def test_reversed_diff_interval_rejected(self):
        data = fixture('diff')
        data['diagnostic_intervals'][0]['end_met_hours'] = 0
        with self.assertRaises(ValueError):
            validate_document('diff', data)

    def test_corrupt_terrain_hash_rejected(self):
        data = fixture('terrain')
        data['sha256'] = '0' * 64
        with self.assertRaises(ValueError):
            validate_document('terrain', data)

    def test_real_data_requires_provenance(self):
        data = fixture('site')
        data['provenance']['data_kind'] = 'cached_real'
        with self.assertRaises(ValueError):
            validate_document('site', data)


if __name__ == '__main__':
    unittest.main()
