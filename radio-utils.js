'use strict';

// Keep tuning in integer hertz. Formatted MHz is presentation only.
const RadioTuning = Object.freeze({
  clampFrequency(hz) {
    if (!Number.isFinite(hz)) throw new TypeError('Frequency must be finite.');
    return Math.round(Math.max(24e6, Math.min(1750e6, hz)));
  },
  formatFrequency(hz) {
    const [whole, decimal] = (hz / 1e6).toFixed(6).split('.');
    return whole + '.' + decimal.replace(/0+$/, '').padEnd(3, '0');
  },
  stepFrequency(hz, step, direction) {
    return this.clampFrequency(hz + step * direction);
  },
  spectrumCenter(state) {
    return state.spectrum_center_frequency;
  },
  frequencyAt(state, fraction) {
    return this.spectrumCenter(state) + (fraction - 0.5) * state.sample_rate;
  },
  frequencyFraction(state, hz) {
    return 0.5 + (hz - this.spectrumCenter(state)) / state.sample_rate;
  },
});

if (typeof module !== 'undefined' && module.exports) module.exports = RadioTuning;
