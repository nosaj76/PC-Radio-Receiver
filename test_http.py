import http.client
import json
from pathlib import Path
import tempfile
import threading
import unittest
from unittest.mock import patch

import server


class HttpTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.radio = server.Radio(Path(self.directory.name) / 'settings.json')
        self.radio_patch = patch.object(server, 'radio', self.radio)
        self.radio_patch.start()
        self.httpd = server.ThreadingHTTPServer(('127.0.0.1', 0), server.Handler)
        self.httpd.daemon_threads = True
        self.thread = threading.Thread(target=self.httpd.serve_forever, daemon=True)
        self.thread.start()

    def tearDown(self):
        self.httpd.shutdown()
        self.httpd.server_close()
        self.thread.join(timeout=2)
        self.radio_patch.stop()
        self.directory.cleanup()

    def request(self, method, path, data=None, headers=None):
        connection = http.client.HTTPConnection('127.0.0.1', self.httpd.server_port, timeout=3)
        request_headers = {'Host': '127.0.0.1:8877', 'Content-Type': 'application/json',
                           'X-Radio-Token': server.TOKEN, 'Origin': 'http://127.0.0.1:8877'}
        request_headers.update(headers or {})
        try:
            connection.request(method, path, body=None if data is None else json.dumps(data), headers=request_headers)
            response = connection.getresponse()
            return response.status, response.read()
        finally:
            connection.close()

    def test_assets_and_token_injection(self):
        for path in ('/', '/app.js', '/radio-utils.js', '/audio-worklet.js', '/style.css'):
            with self.subTest(path=path):
                status, body = self.request('GET', path)
                self.assertEqual(status, 200)
                self.assertTrue(body)
                if path == '/':
                    self.assertNotIn(b'__TOKEN__', body)
                    self.assertIn(b'/radio-utils.js', body)

    def test_tune_persists_and_reports_center(self):
        status, body = self.request('POST', '/api/tune', {'frequency': 145_512_500, 'mode': 'NFM'})
        self.assertEqual(status, 200)
        state = json.loads(body)
        self.assertEqual(state['frequency'], 145_512_500)
        self.assertEqual(state['spectrum_center_frequency'], 145_640_500)
        self.assertEqual(json.loads(self.radio.settings_path.read_text())['frequency'], 145_512_500)

    def test_disk_failure_returns_json_and_preserves_state(self):
        before = self.radio.config.copy()
        with patch.object(self.radio, 'save_settings', side_effect=OSError('simulated disk full')):
            status, body = self.request('POST', '/api/tune', {'frequency': 100_100_000})
        self.assertEqual(status, 500)
        self.assertIn('simulated disk full', json.loads(body)['error'])
        self.assertEqual(self.radio.config, before)

    def test_nonobject_tune_returns_bad_request(self):
        status, body = self.request('POST', '/api/tune', [])
        self.assertEqual(status, 400)
        self.assertIn('object', json.loads(body)['error'])

    def test_control_requests_require_token(self):
        status, _ = self.request('POST', '/api/tune', {}, {'X-Radio-Token': 'incorrect'})
        self.assertEqual(status, 403)

    def test_unexpected_origin_is_rejected(self):
        status, _ = self.request('POST', '/api/tune', {}, {'Origin': 'https://example.invalid'})
        self.assertEqual(status, 403)

    def test_unexpected_host_is_rejected(self):
        status, _ = self.request('GET', '/api/state', headers={'Host': 'example.invalid'})
        self.assertEqual(status, 403)


if __name__ == '__main__':
    unittest.main()
