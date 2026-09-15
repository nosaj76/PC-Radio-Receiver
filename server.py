#!/usr/bin/env python3
"""Local RTL-SDR receiver: live IQ spectrum and WFM/NFM/AM audio."""
import atexit
import json
import math
import os
from pathlib import Path
import queue
import secrets
import signal
import subprocess
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse

import numpy as np
from scipy import signal as dsp

ROOT = Path(__file__).resolve().parent
RATE = 1_024_000
AUDIO_RATE = 32_000
BLOCK = 65_536
TOKEN = secrets.token_urlsafe(32)


class Demodulator:
    def __init__(self, mode):
        self.mode = mode
        self.mixer = np.exp(2j * np.pi * 128_000 / RATE * np.arange(BLOCK)).astype(np.complex64)
        self.rf = dsp.butter(8, 100_000 if mode == 'WFM' else (8_000 if mode == 'NFM' else 5_000), fs=RATE, output='sos')
        self.rfzi = np.zeros((len(self.rf), 2), dtype=complex)
        self.af = dsp.butter(6, 14_000 if mode == 'WFM' else 4_000, fs=256_000, output='sos')
        self.afzi = np.zeros((len(self.af), 2))
        self.dc = dsp.butter(2, 60, btype='highpass', fs=AUDIO_RATE, output='sos')
        self.dczi = np.zeros((len(self.dc), 2))
        self.dezi = np.zeros(1)
        self.previous = 1 + 0j
        self.am_level = 0.1
        self.window = np.hanning(2048)

    def process(self, raw):
        a = (np.frombuffer(raw, dtype=np.uint8).astype(np.float32) - 127.5) / 128
        iq = (a[::2] + 1j * a[1::2]) * self.mixer
        chunks = iq.reshape(-1, 2048)
        fft = np.fft.fftshift(np.fft.fft(chunks[::4] * self.window, axis=1), axes=1)
        power = np.mean(np.abs(fft / self.window.sum()) ** 2, axis=0)
        spectrum = 10 * np.log10(np.maximum(power, 1e-12))
        filtered, self.rfzi = dsp.sosfilt(self.rf, iq, zi=self.rfzi)
        base = filtered[::4]
        level = float(10 * np.log10(max(np.mean(np.abs(base) ** 2), 1e-12)))
        if self.mode == 'AM':
            envelope = np.abs(base)
            self.am_level = 0.9 * self.am_level + 0.1 * max(float(np.mean(envelope)), 0.001)
            demod = (envelope - self.am_level) / self.am_level * 0.35
        else:
            previous = np.concatenate(([self.previous], base[:-1]))
            demod = np.angle(base * np.conj(previous)) * (256_000 / (2 * np.pi * (75_000 if self.mode == 'WFM' else 5_000)))
            self.previous = base[-1]
        audio, self.afzi = dsp.sosfilt(self.af, demod, zi=self.afzi)
        audio = audio[::8]
        if self.mode == 'WFM':
            alpha = math.exp(-1 / (AUDIO_RATE * 75e-6))
            audio, self.dezi = dsp.lfilter([1 - alpha], [1, -alpha], audio, zi=self.dezi)
        audio, self.dczi = dsp.sosfilt(self.dc, audio, zi=self.dczi)
        return spectrum, level, np.clip(audio * 0.7, -1, 1).astype('<f4')


class Radio:
    def __init__(self):
        self.lock = threading.RLock()
        self.control_lock = threading.Lock()
        self.config = dict(frequency=99_500_000, mode='WFM', gain=0, squelch=-100)
        try:
            saved = json.loads((ROOT / 'settings.json').read_text())
            self.config = self.validate(saved)
        except (OSError, ValueError, TypeError):
            pass
        self.process = None
        self.worker = None
        self.generation = 0
        self.status = 'stopped'
        self.wanted = False
        self.error = ''
        self.logs = []
        self.level = -120
        self.spectrum = None
        self.sequence = 0
        self.sample_time = 0
        self.clients = set()

    @staticmethod
    def validate(data):
        if not isinstance(data, dict):
            raise ValueError('Settings must be an object.')
        out = {}
        limits = {'frequency': (24_000_000, 1_750_000_000), 'gain': (0, 50), 'squelch': (-120, 0)}
        for name, (lo, hi) in limits.items():
            value = data[name]
            if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value) or not lo <= value <= hi:
                raise ValueError(f'{name} must be between {lo} and {hi}.')
            out[name] = int(value) if name == 'frequency' else value
        if data.get('mode') not in ('WFM', 'NFM', 'AM'):
            raise ValueError('Choose WFM, NFM, or AM.')
        out['mode'] = data['mode']
        return out

    def snapshot(self):
        with self.lock:
            return dict(**self.config, status=self.status, error=self.error, level=round(self.level, 1),
                        spectrum=self.spectrum, sequence=self.sequence, sample_time=self.sample_time,
                        sample_rate=RATE, audio_rate=AUDIO_RATE, logs=self.logs[-8:])

    def stop(self):
        with self.lock:
            self.generation += 1
            proc, worker = self.process, self.worker
            self.process = None
            self.status = 'stopped'
            self.wanted = False
            self.spectrum = None
            self.level = -120
        if proc and proc.poll() is None:
            proc.terminate()
            try:
                proc.wait(timeout=2)
            except subprocess.TimeoutExpired:
                proc.kill()
                proc.wait(timeout=2)
        if worker and worker is not threading.current_thread():
            worker.join(timeout=3)

    def start(self):
        self.stop()
        with self.lock:
            cfg = self.config.copy()
            self.status, self.error, self.logs = 'starting', '', []
            self.wanted = True
            generation = self.generation
            try:
                proc = subprocess.Popen(['rtl_sdr', '-f', str(cfg['frequency'] + 128_000), '-s', str(RATE),
                                         '-g', str(cfg['gain']), '-b', str(BLOCK * 2), '-'], stdout=subprocess.PIPE, stderr=subprocess.PIPE)
            except OSError as exc:
                self.status, self.error = 'error', str(exc)
                return
            self.process = proc
            self.worker = threading.Thread(target=self.receive, args=(proc, generation, cfg), daemon=True)
            self.worker.start()

    def receive(self, proc, generation, cfg):
        def read_errors():
            for line in proc.stderr:
                message = line.decode(errors='replace').strip()
                with self.lock:
                    if generation == self.generation:
                        self.logs.append(message)
                        self.logs = self.logs[-24:]
        err_thread = threading.Thread(target=read_errors, daemon=True)
        err_thread.start()
        try:
            demod = Demodulator(cfg['mode'])
            while generation == self.generation:
                raw = proc.stdout.read(BLOCK * 2)
                if len(raw) != BLOCK * 2:
                    break
                spectrum, level, audio = demod.process(raw)
                with self.lock:
                    if generation != self.generation:
                        break
                    self.status = 'receiving'
                    self.error = ''
                    self.spectrum = np.round(spectrum, 1).tolist()
                    self.level = level
                    self.sequence += 1
                    self.sample_time = time.time()
                    squelch = self.config['squelch']
                    clients = list(self.clients)
                if level < squelch:
                    audio.fill(0)
                packet = audio.tobytes()
                for client in clients:
                    if client.full():
                        try:
                            client.get_nowait()
                        except queue.Empty:
                            pass
                    try:
                        client.put_nowait(packet)
                    except queue.Full:
                        pass
            err_thread.join(timeout=0.5)
            with self.lock:
                if generation == self.generation:
                    self.status = 'error'
                    self.spectrum = None
                    logs = '\n'.join(self.logs)
                    if 'usb_open error -3' in logs:
                        self.error = 'Ubuntu is denying USB access. Finish the “Nooelec — Enable Receiver” terminal, then press Start receiver.'
                    elif 'claimed' in logs or 'kernel driver' in logs or 'error -6' in logs:
                        self.error = 'The receiver is busy. Close other SDR apps and finish the driver setup, then start again.'
                    elif 'No supported devices' in logs:
                        self.error = 'Receiver disconnected. Connect your Nooelec USB receiver and start again.'
                    else:
                        self.error = 'Receiver stopped unexpectedly. Check the receiver log below.'
        except Exception as exc:
            with self.lock:
                if generation == self.generation:
                    self.status, self.error = 'error', str(exc)
            if proc.poll() is None:
                proc.terminate()
        finally:
            proc.stdout.close()
            if proc.poll() is not None:
                proc.stderr.close()

    def reconnect_monitor(self):
        while True:
            time.sleep(3)
            with self.control_lock:
                with self.lock:
                    retry = self.wanted and self.status == 'error'
                if not retry:
                    continue
                for usb in Path('/sys/bus/usb/devices').glob('*'):
                    try:
                        if (usb / 'idVendor').read_text().strip() != '0bda' or (usb / 'idProduct').read_text().strip() != '2838':
                            continue
                        bus = int((usb / 'busnum').read_text())
                        device = int((usb / 'devnum').read_text())
                        if os.access(f'/dev/bus/usb/{bus:03d}/{device:03d}', os.R_OK | os.W_OK):
                            self.start()
                            break
                    except (OSError, ValueError):
                        continue

    def update(self, data):
        new = self.validate({**self.config, **data})
        restart = any(new[k] != self.config[k] for k in ('frequency', 'mode', 'gain'))
        with self.lock:
            active = self.status in ('receiving', 'starting')
            self.config = new
        tmp = ROOT / 'settings.json.tmp'
        tmp.write_text(json.dumps(new, indent=2))
        tmp.replace(ROOT / 'settings.json')
        if restart and active:
            self.start()


radio = Radio()


class Handler(BaseHTTPRequestHandler):
    protocol_version = 'HTTP/1.1'

    def log_message(self, fmt, *args):
        if args and str(args[0]).startswith('POST'):
            super().log_message(fmt, *args)

    def allowed_host(self):
        return self.headers.get('Host') in ('127.0.0.1:8877', 'localhost:8877')

    def send(self, data, content_type='application/json', status=200):
        if isinstance(data, dict):
            data = json.dumps(data, allow_nan=False).encode()
        self.send_response(status)
        self.send_header('Content-Type', content_type)
        self.send_header('Content-Length', str(len(data)))
        self.send_header('Cache-Control', 'no-store')
        self.send_header('X-Content-Type-Options', 'nosniff')
        self.send_header('X-Frame-Options', 'DENY')
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        if not self.allowed_host():
            return self.send({'error': 'Invalid host'}, status=403)
        path = urlparse(self.path).path
        if path == '/api/state':
            return self.send(radio.snapshot())
        if path == '/api/audio':
            if self.headers.get('X-Radio-Token') != TOKEN:
                return self.send({'error': 'Invalid token'}, status=403)
            return self.audio()
        names = {'/': ('index.html', 'text/html; charset=utf-8'), '/app.js': ('app.js', 'text/javascript'),
                 '/style.css': ('style.css', 'text/css'), '/audio-worklet.js': ('audio-worklet.js', 'text/javascript')}
        if path not in names:
            return self.send({'error': 'Not found'}, status=404)
        name, mime = names[path]
        content = (ROOT / name).read_bytes()
        if name == 'index.html':
            content = content.replace(b'__TOKEN__', TOKEN.encode())
        self.send(content, mime)

    def do_POST(self):
        if not self.allowed_host() or self.headers.get('X-Radio-Token') != TOKEN:
            return self.send({'error': 'Invalid token'}, status=403)
        if self.headers.get('Origin') not in (None, 'http://127.0.0.1:8877', 'http://localhost:8877'):
            return self.send({'error': 'Invalid origin'}, status=403)
        try:
            length = int(self.headers.get('Content-Length', 0))
            if not 0 <= length <= 4096:
                raise ValueError('Request too large.')
            data = json.loads(self.rfile.read(length) or b'{}')
            path = urlparse(self.path).path
            with radio.control_lock:
                if path == '/api/start':
                    radio.start()
                elif path == '/api/stop':
                    radio.stop()
                elif path == '/api/tune':
                    radio.update(data)
                else:
                    return self.send({'error': 'Not found'}, status=404)
            self.send(radio.snapshot())
        except (ValueError, KeyError, TypeError) as exc:
            self.send({'error': str(exc)}, status=400)

    def audio(self):
        client = queue.Queue(maxsize=8)
        with radio.lock:
            radio.clients.add(client)
        try:
            self.send_response(200)
            self.send_header('Content-Type', 'application/octet-stream')
            self.send_header('Transfer-Encoding', 'chunked')
            self.send_header('Cache-Control', 'no-store')
            self.end_headers()
            while True:
                try:
                    packet = client.get(timeout=0.5)
                except queue.Empty:
                    packet = bytes(2048 * 4)
                self.wfile.write(f'{len(packet):x}\r\n'.encode() + packet + b'\r\n')
                self.wfile.flush()
        except (BrokenPipeError, ConnectionResetError, OSError):
            pass
        finally:
            with radio.lock:
                radio.clients.discard(client)


if __name__ == '__main__':
    server = ThreadingHTTPServer(('127.0.0.1', 8877), Handler)
    server.daemon_threads = True
    atexit.register(radio.stop)
    def shutdown(*_):
        threading.Thread(target=server.shutdown, daemon=True).start()
    signal.signal(signal.SIGTERM, shutdown)
    signal.signal(signal.SIGINT, shutdown)
    radio.start()
    threading.Thread(target=radio.reconnect_monitor, daemon=True).start()
    print('Nooelec Radio is running at http://127.0.0.1:8877', flush=True)
    try:
        server.serve_forever()
    finally:
        radio.stop()
        server.server_close()
