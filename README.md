# Nooelec Radio

A local browser interface for a Nooelec / RTL-SDR USB receiver. Tune stations,
view a live spectrum and waterfall, and listen to WFM, NFM, or AM audio.
The Python server processes real IQ samples from `rtl_sdr`. The interface uses
plain HTML, CSS, JavaScript, and an AudioWorklet, with no frontend build step or
cloud service.

## Status

**The core receiver is implemented and has hardware-free regression coverage.
Live receiver and browser acceptance testing is still required.** This revision
fixes spectrum frequency mapping, 12.5 kHz tuning accuracy, settings recovery and
transactional saving, and oversized browser audio packets. It also includes a
direct launcher, user-local installer, dependency manifest, optional systemd user
service, and CI configuration.

Qualification on November 12, 2026: **24 Python tests and 9 Node tests pass** in
the local review environment, along with JavaScript and shell syntax checks.
Coverage includes synthetic WFM/NFM/AM IQ, spectrum mapping across the capture
band, HTTP assets and access checks, settings failures and retries, actual UI
handler behavior in a DOM stub, and audio buffering in a worklet stub.

These checks do not establish physical receiver performance, actual browser
rendering/audio behavior, USB reconnection, or installed-service operation. The
new GitHub Actions workflow has been added; a hosted workflow result is not
claimed here. `rtl_sdr`, suitable USB permissions, and antenna setup remain host
requirements. There is no published binary release in this source change.

The project includes an **Apache 2.0 license**; see [LICENSE](LICENSE).

## Hardware requirements

| Hardware | Why it is needed |
| --- | --- |
| **RTL-SDR-compatible USB receiver** | Captures radio signals as IQ samples for the software. It must work with the `rtl_sdr` command; the Nooelec brand name alone is not enough to establish compatibility. |
| **Antenna connected to the receiver** | Receives signals in the band you want to listen to. Its connector must fit the receiver, directly or through an adapter. |
| **Linux computer with a USB port** | Runs the Python signal processing and browser interface. The receiver must sustain the configured 1.024 MS/s sample stream. |
| **Speakers or headphones** | Needed to hear demodulated audio; optional if you only want to view the spectrum. |

The antenna connects to the USB receiver, and the receiver plugs into the
computer. The Python server controls the receiver; the browser displays its
signals and plays the resulting audio. A computer's Wi-Fi adapter, sound card,
or an antenna by itself cannot replace the RTL-SDR receiver in this application.

For a first reception check, use an antenna suitable for broadcast FM and a
known local station between 88 and 108 MHz. Reception depends on antenna
placement, local signal strength, and the receiver's actual tuning coverage.
The software accepts 24–1750 MHz, but that does not guarantee every connected
tuner can receive every frequency in that range.

There is **no measured minimum CPU or RAM specification** yet. The host must
keep up with continuous IQ filtering, FFT calculation, audio processing, and
browser rendering. A GPU is not required by the implementation. Internet access
is not required for normal reception once dependencies are installed.

The reconnect monitor specifically recognizes USB ID `0bda:2838`. Other devices
supported by `rtl_sdr` may work when started manually, but their automatic
reconnection is not implemented by this monitor. The application has no device
selector for choosing among multiple receivers.

## Features and limits

- Live 2,048-bin spectrum and waterfall from a 1.024 MS/s IQ stream.
- WFM mono with 75 µs de-emphasis, NFM, and AM; 32 kHz mono audio output.
- Frequency entry, step buttons, mouse-wheel tuning, click-to-tune spectrum,
  and a tuning slider with FM, air-band, VHF, UHF, and full-range selections.
- Automatic/manual RF gain, signal-level squelch, and browser volume control.
- Named presets with one-click tuning, rename, delete, and pagination.
- Saved receiver settings and receiver diagnostics in the UI.
- Local server at `127.0.0.1:8877`; remote access is not configured.

Spectrum and signal readings are relative **dBFS**, not calibrated dBm. Changing
frequency, mode, or RF gain restarts the stream and briefly interrupts audio;
changing squelch does not. Hardware tuning uses a 128 kHz offset above the selected
channel to move it away from the tuner DC spike. The spectrum uses the actual
hardware center: its displayed span is the selected frequency minus 384 kHz to
plus 640 kHz, with the selected-channel marker at 37.5% of the plot width. Spectrum
labels and click-to-tune use that same physical frequency mapping. Tuning is kept
in integer hertz; frequency fields and presets show up to six MHz decimal places
so 12.5 kHz channels retain their exact frequency.

HF direct sampling, SSB, FM stereo, RDS, digital decoding, recording, and scanning
are not implemented. WFM de-emphasis is fixed at 75 µs, with no 50 µs option.

## Software requirements

- Linux with USB access permissions for the receiver. The existing setup targets
  Ubuntu; the launcher and USB reconnect monitor use Linux-specific facilities.
- Python 3.10 or newer with NumPy and SciPy; dependency ranges are in `requirements.txt`.
- `rtl_sdr` on the server's `PATH`.
- A browser supporting Web Audio, AudioWorklet, streaming Fetch, and local storage.
- Node.js 22 or newer for development tests and JavaScript syntax checks; not needed for reception.

The current local verification used Python 3.12.14, NumPy 2.3.5, and SciPy 1.17.0.
CI is configured for Python 3.10 and 3.12. The dependency file bounds supported
API families; it is not a lockfile, and every version in those ranges has not
been individually qualified.

## Quick start

On Ubuntu/Debian, install dependencies:

```bash
sudo apt update
sudo apt install python3 python3-numpy python3-scipy rtl-sdr
```

Connect the receiver and antenna, close other SDR applications using the device,
and run from this project directory:

```bash
./launch.sh
```

The direct launcher starts the server and opens your default browser. It does
not depend on an installed systemd service. Use `./launch.sh --no-browser` for a
terminal-only start, or `OPENBLAS_NUM_THREADS=1 python3 server.py` directly. If
you create a `.venv` in the project, the launcher uses its Python automatically;
`NOOELEC_PYTHON` can select a different interpreter.

Open **<http://127.0.0.1:8877>** if the browser does not open. The server
automatically attempts to start the receiver. Run it as your regular user.
Settings go into your user configuration directory, so the installed source
can be read-only. If reception fails, expand **Receiver log**.

### Listen and tune

1. Choose **WFM**, enter a known local FM station between 88 and 108 MHz, and
   press Enter or **Tune**. **Set up for FM** selects 99.5 MHz as a starting point;
   it does not search for stations.
2. Press **Start receiver** if the receiver is stopped.
3. Click **Enable audio** and adjust volume. Browser audio requires a user gesture.
4. Start with automatic RF gain and squelch at −100 dBFS. Lower the squelch
   threshold if weak signals are being muted.
5. Click **Save preset** to save the frequency and mode with an optional name.

Use NFM for narrow FM signals or AM for amplitude-modulated signals. Choosing a
band adjusts the slider range and, except for **Full range**, selects a mode.
It does not find active channels automatically.

### Stop

- **Mute audio** stops playback in that browser.
- **Stop receiver** releases the USB receiver while leaving the server running.
- **Ctrl+C** in the server terminal stops the server and receiver.

Closing the browser does not stop the server or release the USB receiver.

## User-local installation and optional service

For a reusable application-menu entry and `~/.local/bin/nooelec-radio` launcher,
run from the source checkout:

```bash
sudo apt install python3-venv rtl-sdr
./install.sh
```

The installer copies the application into
`${XDG_DATA_HOME:-$HOME/.local/share}/nooelec-radio`, creates a Python virtual
environment there, and installs `requirements.txt` using pip. That initial
dependency installation needs access to a Python package index. Normal reception
works offline. The installer itself uses your account, requires no sudo, and
does not change USB permissions or kernel driver configuration.

If NumPy and SciPy are already installed for system Python, avoid the virtual
environment and pip step with:

```bash
./install.sh --system-python
```

Start the installed application from your applications menu or with:

```bash
~/.local/bin/nooelec-radio
```

An optional systemd user service is bundled in `packaging/nooelec-radio.service`.
To install its unit and reload the user manager, add `--service` to either
installer command. This does **not** start the service or enable it at login.
After installation you can explicitly run:

```bash
systemctl --user start nooelec-radio.service
systemctl --user status nooelec-radio.service
systemctl --user stop nooelec-radio.service
```

The service runs without opening a browser; visit <http://127.0.0.1:8877>.
Run one receiver instance at a time. If a service or direct instance is already
running, open that URL rather than starting a second instance. The service
requires a working systemd user session; direct startup remains available on
Linux systems without one.

## Settings and presets

Receiver settings are saved in
`${XDG_CONFIG_HOME:-$HOME/.config}/nooelec-radio/settings.json`. Set
`NOOELEC_SETTINGS_FILE` to override this path. On the first start without a user
settings file, the bundled legacy `settings.json` is read to preserve an existing
checkout's last-used tuning. Later changes are saved to the user location:


```json
{
  "frequency": 99500000,
  "mode": "WFM",
  "gain": 0,
  "squelch": -100
}
```

- `frequency`: Hz, from 24,000,000 to 1,750,000,000.
- `mode`: `WFM`, `NFM`, or `AM`.
- `gain`: 0 means automatic; positive values request manual gain in dB, up to 50.
  Available gain steps depend on the tuner.
- `squelch`: threshold in dBFS, from −120 to 0 in the backend; the UI exposes
  −120 to −10.

The example shows built-in defaults. The bundled legacy file can contain a
different last-used channel and gain. Stop the server before editing settings by
hand. Partial objects merge with defaults; malformed or invalid saved settings
fall back to defaults with a receiver-log diagnostic. A settings file is created
on a successful settings change. Saves use a temporary file and atomic replace.
If saving fails, the control request returns a JSON error and leaves both the
reported configuration and live tuning unchanged; retrying the command remains
effective.

Presets live in browser local storage under `nooelec-bookmarks`, not in the
settings file. They belong to that browser profile and URL origin: `localhost`
and `127.0.0.1` have separate stores. The page currently seeds a 99.3 MHz WFM
preset once per browser storage area. Preset export/sync is not implemented.
Volume resets to 45% on page load. All browser tabs share the receiver's tuning.

## Troubleshooting

| Symptom | What to check |
| --- | --- |
| `rtl_sdr` not found | Install `rtl-sdr` and check the server's `PATH`. |
| No supported devices | Check the USB connection, reconnect the receiver, and press **Start receiver**. |
| USB access denied / error −3 | Check udev permissions and your user's access. Reconnect after applying rule changes. |
| Receiver busy / kernel driver claim | Close other SDR applications and check whether the DVB TV driver claimed the receiver. |
| Live spectrum but no audio | Enable audio, check browser/system volume, choose the correct mode, and lower squelch. |
| Service not found from `systemctl` | Run `./install.sh --service`, or use the direct launcher. |
| Address already in use | Check for an existing server or user service on port 8877. |
| Settings ignored and defaults loaded | Check the receiver log and repair the user settings file while the server is stopped. |
| Settings change reports a save error | Check write access and free space for the user configuration directory; the previous tuning remains active. |

The original machine has `/etc/udev/rules.d/70-nooelec-sdr.rules`, granting
`plugdev`/`uaccess` access for USB ID `0bda:2838`, and
`/etc/modprobe.d/nooelec-sdr.conf`, blacklisting `dvb_usb_rtl28xxu`. These files
are not created by the project. USB setup elsewhere must match the receiver and
OS. The application reports USB access or driver ownership errors but does not
modify privileged host settings automatically.

## Development and verification

From the project directory:

```bash
python3 -m unittest discover -v
node --test tests/*.test.js
node --check app.js
node --check radio-utils.js
node --check audio-worklet.js
bash -n launch.sh install.sh
```

The Python tests require NumPy and SciPy but no receiver. They check 1 kHz audio
recovery for all three modes, continuity, finite silence output, physical spectrum
frequency mapping, startup settings recovery, failed-save retries, and real
loopback HTTP responses. Launcher tests use a fake interpreter and never start a
receiver or browser. Node tests execute the real tuning handlers in a small DOM
stub and the real AudioWorklet processor in a worklet stub, including oversized
packets, buffer wraparound, rapid tuning steps, and exact preset frequencies.
These checks do not establish real-world reception quality, visual layout, or
actual browser audio behavior.

For an end-to-end check, attach a receiver, tune a known station, confirm a
changing spectrum and audible output, exercise mode/gain/squelch controls and
preset persistence, then verify stop/start and USB reconnection.

## Project layout

| File | Purpose |
| --- | --- |
| `server.py` | HTTP server, receiver control, IQ filtering, demodulation, FFT, and audio streaming. |
| `index.html` | Controls, plots, preset dialog, and embedded initial preset. |
| `app.js` | Tuning, state polling, canvas rendering, presets, and browser audio setup. |
| `audio-worklet.js` | Buffered mono audio playback. |
| `style.css` | Interface styling and responsive layout. |
| `radio-utils.js` | Integer-hertz tuning and physical spectrum coordinate helpers. |
| `launch.sh` | Direct startup with an optional browser; does not require a service. |
| `install.sh` | User-local installation, desktop entry, and optional service setup. |
| `packaging/nooelec-radio.service` | Optional systemd user service. |
| `requirements.txt` | Python dependency ranges. |
| `settings.json` | Legacy settings fallback for first startup. |
| `test_*.py` | DSP, settings, HTTP, and launcher tests. |
| `tests/*.test.js` | Tuning-handler and audio-buffer regressions. |
| `.github/workflows/checks.yml` | Hardware-free Python/Node/shell CI checks. |

The browser polls `/api/state` and receives little-endian float32 PCM from
`/api/audio`. POST endpoints `/api/start`, `/api/stop`, and `/api/tune` control the
receiver. Audio and control requests carry a per-process token injected into
the page. The server also checks the Host header and control-request Origin.
