#!/usr/bin/env bash
set -e
systemctl --user start nooelec-radio.service
if command -v firefox >/dev/null 2>&1; then
  firefox --new-window http://127.0.0.1:8877
else
  xdg-open http://127.0.0.1:8877
fi
