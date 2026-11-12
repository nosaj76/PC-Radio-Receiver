#!/usr/bin/env bash
set -euo pipefail

use_system_python=false
install_service=false
for argument in "$@"; do
  case "$argument" in
    --system-python) use_system_python=true ;;
    --service) install_service=true ;;
    --help|-h)
      printf '%s\n' 'Usage: install.sh [--system-python] [--service]' \
        'Install into your user account; no sudo or hardware access is used.' \
        'Default: create a virtual environment and install requirements with pip.' \
        '--system-python: use already-installed NumPy and SciPy instead.' \
        '--service: also install and reload the optional user service; do not start or enable it.'
      exit 0 ;;
    *) printf 'Unknown option: %s\n' "$argument" >&2; exit 2 ;;
  esac
done

source_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
data_home=${XDG_DATA_HOME:-$HOME/.local/share}
config_home=${XDG_CONFIG_HOME:-$HOME/.config}
app_dir="$data_home/nooelec-radio"
bin_dir="$HOME/.local/bin"

command -v python3 >/dev/null || { printf 'Install Python 3.10 or newer first.\n' >&2; exit 1; }
python3 -c 'import sys; sys.exit(0 if sys.version_info >= (3, 10) else "Python 3.10 or newer is required.")'
if "$use_system_python"; then
  python3 -c 'import numpy, scipy' || { printf 'Install NumPy and SciPy, then retry.\n' >&2; exit 1; }
fi
if "$install_service"; then
  command -v systemctl >/dev/null || { printf 'systemctl is required only for --service.\n' >&2; exit 1; }
fi

install -d "$app_dir" "$bin_dir" "$data_home/applications"
if [[ "$source_dir" != "$(cd -- "$app_dir" && pwd)" ]]; then
  for file in server.py index.html style.css app.js radio-utils.js audio-worklet.js settings.json requirements.txt LICENSE README.md; do
    install -m 644 "$source_dir/$file" "$app_dir/$file"
  done
  install -m 755 "$source_dir/launch.sh" "$app_dir/launch.sh"
fi
if ! "$use_system_python"; then
  python3 -m venv "$app_dir/.venv"
  "$app_dir/.venv/bin/python" -m pip install -r "$app_dir/requirements.txt"
fi

# Bash's %q quotes installation paths, including spaces, for the tiny wrapper.
if "$use_system_python"; then
  printf '#!/usr/bin/env bash\nexport NOOELEC_PYTHON=%q\nexec %q "$@"\n' "$(command -v python3)" "$app_dir/launch.sh" > "$bin_dir/nooelec-radio"
else
  printf '#!/usr/bin/env bash\nexec %q "$@"\n' "$app_dir/launch.sh" > "$bin_dir/nooelec-radio"
fi
chmod 755 "$bin_dir/nooelec-radio"
python3 - "$bin_dir/nooelec-radio" "$data_home/applications/nooelec-radio.desktop" <<'PY'
from pathlib import Path
import sys
command = sys.argv[1].replace('\\', '\\\\').replace('"', '\\"').replace('`', '\\`').replace('$', '\\$')
Path(sys.argv[2]).write_text(
    '[Desktop Entry]\nType=Application\nName=Nooelec Radio\n'
    'Comment=Local RTL-SDR receiver\n'
    f'Exec="{command}"\nTerminal=false\nCategories=AudioVideo;Audio;\n',
    encoding='utf-8',
)
PY

if "$install_service"; then
  install -d "$config_home/systemd/user"
  install -m 644 "$source_dir/packaging/nooelec-radio.service" "$config_home/systemd/user/nooelec-radio.service"
  systemctl --user daemon-reload
  printf '%s\n' 'Optional service installed. Start it with: systemctl --user start nooelec-radio.service'
fi
printf 'Installed. Run: %s\n' "$bin_dir/nooelec-radio"
printf '%s\n' 'Install rtl-sdr and configure your receiver USB permissions before live reception.'
