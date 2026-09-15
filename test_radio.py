import unittest
import numpy as np
from server import Demodulator, Radio, RATE, BLOCK


class RadioTests(unittest.TestCase):
    def synthetic(self, mode):
        n = np.arange(BLOCK * 8)
        t = n / RATE
        tone = np.sin(2 * np.pi * 1000 * t)
        carrier = -128000
        if mode == 'AM':
            iq = 0.55 * (1 + 0.5 * tone) * np.exp(2j * np.pi * carrier * t)
        else:
            deviation = 35000 if mode == 'WFM' else 2500
            phase = 2 * np.pi * carrier * t + 2 * np.pi * deviation * np.cumsum(tone) / RATE
            iq = 0.7 * np.exp(1j * phase)
        raw = np.empty(len(iq) * 2, dtype=np.uint8)
        raw[::2] = np.clip(iq.real * 128 + 127.5, 0, 255)
        raw[1::2] = np.clip(iq.imag * 128 + 127.5, 0, 255)
        demod = Demodulator(mode)
        output = []
        for block in raw.reshape(-1, BLOCK * 2):
            spectrum, level, audio = demod.process(block.tobytes())
            output.append(audio)
            self.assertEqual(len(audio), 2048)
            self.assertTrue(np.all(np.isfinite(spectrum)))
        audio = np.concatenate(output)[4096:]
        spectrum = abs(np.fft.rfft(audio * np.hanning(len(audio))))
        peak = np.fft.rfftfreq(len(audio), 1 / 32000)[np.argmax(spectrum)]
        self.assertAlmostEqual(peak, 1000, delta=5)
        self.assertGreater(np.std(audio), 0.015)
        self.assertLess(np.max(np.abs(np.diff(audio))), .2)

    def test_wfm_tone(self): self.synthetic('WFM')
    def test_nfm_tone(self): self.synthetic('NFM')
    def test_am_tone(self): self.synthetic('AM')

    def test_invalid_settings(self):
        base = dict(frequency=99500000, mode='WFM', gain=0, squelch=-100)
        for patch in [dict(frequency=float('nan')), dict(frequency=0), dict(mode='bad'), dict(gain=99), dict(squelch=True)]:
            with self.assertRaises(ValueError): Radio.validate({**base, **patch})

    def test_silence_is_finite(self):
        for mode in ['WFM', 'NFM', 'AM']:
            _, _, audio = Demodulator(mode).process(bytes([128,128]) * BLOCK)
            self.assertTrue(np.all(np.isfinite(audio)))

if __name__ == '__main__': unittest.main()
