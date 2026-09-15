# Nooelec Radio

A local browser interface for a Nooelec / RTL-SDR USB receiver. Tune stations,
view a live spectrum and waterfall, and listen to WFM, NFM, or AM audio.
The Python server processes real IQ samples from `rtl_sdr`. The interface uses
plain HTML, CSS, JavaScript, and an AudioWorklet, with no frontend build step or
cloud service.

## Is it complete?

**The core receiver is implemented, but this is not yet a complete portable
release.** Tuning, demodulation, audio streaming, visualization, and presets are
present. Remaining gaps include:

- **Installation:** `launch.sh` depends on a user systemd service installed
  outside the project. The service, desktop entry, and USB setup files are not
  bundled. Direct startup works without the desktop integration.
- **Dependencies:** no dependency manifest, lockfile, or automated installer.
- **Error handling:** an incomplete `settings.json` object such as `{}` causes
  a startup `KeyError`. Settings-file write failures also lack a structured API
  error response.
- **Verification:** no committed browser, HTTP integration, or physical receiver
  tests, and no CI configuration.
- **Distribution:** no license file is included.

Review on September 15, 2026: all five unit tests, both JavaScript syntax checks,
and the shell syntax check passed. A separate hardware-free HTTP smoke check
verified asset serving, token injection, state responses, and selected access
checks. The installed service was inactive; live reception, speaker output, and
USB reconnection were not verified during this review.

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
channel to move it away from the tuner DC spike.

HF direct sampling, SSB, FM stereo, RDS, digital decoding, recording, and scanning
are not implemented. WFM de-emphasis is fixed at 75 µs, with no 50 µs option.

## Software requirements

- Linux with USB access permissions for the receiver. The existing setup targets
  Ubuntu; the launcher and USB reconnect monitor use Linux-specific facilities.
- Python 3 with NumPy and SciPy.
- `rtl_sdr` on the server's `PATH`.
- A browser supporting Web Audio, AudioWorklet, streaming Fetch, and local storage.
- Node.js only for JavaScript syntax checks.

The review environment used Python 3.12.3, NumPy 2.5.1, and SciPy 1.18.0. These
are observed versions, not established minimum supported versions.

## Quick start

On Ubuntu/Debian, install dependencies:

```bash
sudo apt update
sudo apt install python3 python3-numpy python3-scipy rtl-sdr
```

Connect the receiver and antenna, close other SDR applications using the device,
and run from this project directory:

```bash
OPENBLAS_NUM_THREADS=1 python3 server.py
```

Open **<http://127.0.0.1:8877>**. The server automatically attempts to start the
receiver. Run it as your regular user, with write access to the project directory
so it can save settings. If reception fails, expand **Receiver log**.

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

## Existing desktop launcher

The original development machine has a **Nooelec Radio** desktop entry and a
`nooelec-radio.service` user service installed outside this project directory.
When that integration is installed:

```bash
./launch.sh
systemctl --user status nooelec-radio.service
systemctl --user stop nooelec-radio.service
```

The launcher starts the service and opens Firefox, or falls back to `xdg-open`.
It does not install the service. The existing service is disabled at login and
contains an absolute path to the original project directory. On a fresh copy,
use direct startup above. Run one server instance at a time because the port
and receiver are shared resources.

## Settings and presets

Receiver settings are saved beside `server.py` in `settings.json`:

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

The example shows built-in defaults. The supplied settings file can contain a
different last-used channel and gain. Stop the server before editing it by hand.
If absent, defaults apply and the file is created on a settings change.

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
| Service not found from `launch.sh` | The service is not bundled; use direct startup. |
| Address already in use | Check for an existing server or user service on port 8877. |
| Startup `KeyError` after editing settings | Stop the server, back up and remove `settings.json`, then restart with defaults. |

The original machine has `/etc/udev/rules.d/70-nooelec-sdr.rules`, granting
`plugdev`/`uaccess` access for USB ID `0bda:2838`, and
`/etc/modprobe.d/nooelec-sdr.conf`, blacklisting `dvb_usb_rtl28xxu`. These files
are not created by the project. USB setup elsewhere must match the receiver and
OS. An error mentioning “Nooelec — Enable Receiver” refers to an external setup
helper that is not included here.

## Development and verification

From the project directory:

```bash
python3 -m unittest -v test_radio.py
node --check app.js
node --check audio-worklet.js
bash -n launch.sh
```

The unit tests generate synthetic IQ to check 1 kHz audio recovery for all three
modes, output continuity, finite silence output, and selected invalid settings.
They require NumPy and SciPy but no receiver. They do not establish real-world
reception quality or browser playback behavior.

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
| `launch.sh` | Starts the externally installed service and opens the browser. |
| `settings.json` | Last-used receiver settings. |
| `test_radio.py` | Synthetic DSP and settings-validation tests. |

The browser polls `/api/state` and receives little-endian float32 PCM from
`/api/audio`. POST endpoints `/api/start`, `/api/stop`, and `/api/tune` control the
receiver. Audio and control requests carry a per-process token injected into
the page. The server also checks the Host header and control-request Origin.
