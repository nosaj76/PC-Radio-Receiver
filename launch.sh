#!/usr/bin/env bash
set -euo pipefail

project_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
browser_args=(--open-browser)
case "${1:-}" in
  --no-browser) browser_args=(); shift ;;
  --help|-h)
    printf '%s\n' 'Usage: launch.sh [--no-browser]' \
      'Run the receiver directly; no installed service is required.' \
      'Set NOOELEC_PYTHON to select a Python interpreter.'
    exit 0 ;;
  '') ;;
  *) printf 'Unknown option: %s\n' "$1" >&2; exit 2 ;;
esac
if (($#)); then printf 'Unexpected argument: %s\n' "$1" >&2; exit 2; fi

if [[ -n "${NOOELEC_PYTHON:-}" ]]; then
  radio_python=$NOOELEC_PYTHON
elif [[ -x "$project_dir/.venv/bin/python" ]]; then
  radio_python="$project_dir/.venv/bin/python"
else
  radio_python=python3
fi
export OPENBLAS_NUM_THREADS=${OPENBLAS_NUM_THREADS:-1}
exec "$radio_python" "$project_dir/server.py" "${browser_args[@]}"
