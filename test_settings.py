import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import Mock, patch

from server import DEFAULT_CONFIG, Radio, TUNING_OFFSET, settings_path


class SettingsTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.path = Path(self.directory.name) / 'settings.json'

    def test_missing_file_uses_defaults_without_writing(self):
        radio = Radio(self.path)
        self.assertEqual(radio.config, DEFAULT_CONFIG)
        self.assertFalse(self.path.exists())

    def test_partial_files_merge_with_defaults(self):
        for saved in ({}, {'frequency': 145_512_500}, {'mode': 'NFM', 'gain': 19.7}):
            with self.subTest(saved=saved):
                self.path.write_text(json.dumps(saved))
                radio = Radio(self.path)
                self.assertEqual(radio.config, {**DEFAULT_CONFIG, **saved})
                self.assertEqual(radio.settings_warning, '')

    def test_invalid_saved_settings_fall_back_with_diagnostic(self):
        for saved in ('[]', 'null', '{bad', '{"frequency":true}',
                      '{"mode":"invalid"}', json.dumps({'frequency': 10 ** 1000})):
            with self.subTest(saved=saved[:50]):
                self.path.write_text(saved)
                radio = Radio(self.path)
                self.assertEqual(radio.config, DEFAULT_CONFIG)
                self.assertIn('using defaults', radio.settings_warning)
                self.assertIn(radio.settings_warning, radio.snapshot()['logs'])

    def test_validator_rejects_missing_keys_consistently(self):
        for data in ({}, [], {'frequency': 99_500_000}):
            with self.subTest(data=data), self.assertRaises(ValueError):
                Radio.validate(data)

    def test_failed_save_preserves_live_state_and_retry_retunes(self):
        radio = Radio(self.path)
        radio.status = 'receiving'
        radio.start = Mock()
        before = radio.config.copy()
        with patch.object(Path, 'replace', side_effect=PermissionError('simulated read-only settings')):
            with self.assertRaises(OSError):
                radio.update({'frequency': 100_100_000})
        self.assertEqual(radio.config, before)
        radio.start.assert_not_called()
        self.assertFalse(self.path.exists())
        self.assertEqual(list(self.path.parent.glob('.settings-*.tmp')), [])
        radio.update({'frequency': 100_100_000})
        radio.start.assert_called_once_with()
        self.assertEqual(radio.config['frequency'], 100_100_000)
        self.assertEqual(json.loads(self.path.read_text()), radio.config)

    def test_squelch_persists_without_restarting(self):
        radio = Radio(self.path)
        radio.status = 'receiving'
        radio.start = Mock()
        radio.update({'squelch': -80})
        radio.start.assert_not_called()
        self.assertEqual(json.loads(self.path.read_text())['squelch'], -80)

    def test_spectrum_metadata_reports_actual_tuner_center(self):
        radio = Radio(self.path)
        snapshot = radio.snapshot()
        self.assertEqual(snapshot['spectrum_center_frequency'], snapshot['frequency'] + TUNING_OFFSET)

    def test_user_configuration_location_and_explicit_override(self):
        with patch.dict('os.environ', {'XDG_CONFIG_HOME': self.directory.name, 'NOOELEC_SETTINGS_FILE': ''}):
            self.assertEqual(settings_path(), Path(self.directory.name) / 'nooelec-radio' / 'settings.json')
        with patch.dict('os.environ', {'NOOELEC_SETTINGS_FILE': str(self.path)}):
            self.assertEqual(settings_path(), self.path)


if __name__ == '__main__':
    unittest.main()
