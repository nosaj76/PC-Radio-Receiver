import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest


ROOT = Path(__file__).resolve().parent


class LauncherTests(unittest.TestCase):
    def run_launcher(self, arguments):
        with tempfile.TemporaryDirectory(prefix='radio launch ') as directory:
            interpreter = Path(directory) / 'fake interpreter'
            interpreter.write_text('#!/usr/bin/env python3\nimport json, sys\nprint(json.dumps(sys.argv[1:]))\n')
            interpreter.chmod(0o755)
            environment = dict(os.environ, NOOELEC_PYTHON=str(interpreter))
            result = subprocess.run([str(ROOT / 'launch.sh'), *arguments], cwd=directory,
                                    env=environment, check=True, capture_output=True, text=True)
            return json.loads(result.stdout)

    def test_direct_launcher_handles_other_working_directory_and_spaced_interpreter(self):
        self.assertEqual(self.run_launcher(['--no-browser']), [str(ROOT / 'server.py')])

    def test_default_launcher_requests_browser_without_starting_a_service(self):
        self.assertEqual(self.run_launcher([]), [str(ROOT / 'server.py'), '--open-browser'])

    def test_installer_help_is_available_without_installation(self):
        result = subprocess.run([str(ROOT / 'install.sh'), '--help'], check=True,
                                capture_output=True, text=True)
        self.assertIn('--system-python', result.stdout)
        self.assertIn('--service', result.stdout)


if __name__ == '__main__':
    unittest.main()
