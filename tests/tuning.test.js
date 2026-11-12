'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const tuning = require('../radio-utils.js');

const drawing = new Proxy({}, {get: (_, name) => name === 'createLinearGradient'
  ? () => ({addColorStop() {}})
  : name === 'createImageData' ? (w, h) => ({data: new Uint8ClampedArray(w * h * 4)}) : () => {}});

class Element {
  constructor(id = '') {
    this.id = id; this.value = ''; this.textContent = ''; this.children = []; this.clientHeight = 200;
    this.classList = {toggle() {}, add() {}, remove() {}};
    this.lastChild = {textContent: ''}; this.events = {}; this.options = [];
  }
  getBoundingClientRect() { return {width: 1024, height: 120, left: 0}; }
  getContext() { return drawing; }
  addEventListener(name, listener) { this.events[name] = listener; }
  setAttribute() {}
  replaceChildren(...children) { this.children = children; }
  append(...children) { this.children.push(...children); }
  querySelector() { return new Element(); }
  checkValidity() { return true; }
  showModal() { this.open = true; }
  close() { this.open = false; }
  focus() {}
  select() {}
  add(option) { this.options.push(option); }
}

async function createUi(frequency = 145500000) {
  const elements = new Map();
  const get = id => { if (!elements.has(id)) elements.set(id, new Element(id)); return elements.get(id); };
  get('step').value = '12500'; get('tuningBand').value = 'vhf'; get('volume').value = '45';
  get('presetImports').textContent = '[]';
  const calls = [];
  let current = {frequency, mode: 'NFM', gain: 0, squelch: -100, status: 'stopped', error: '',
    logs: [], level: -120, sequence: 0, spectrum: null, sample_rate: 1024000,
    audio_rate: 32000, spectrum_center_frequency: frequency + 128000};
  const context = vm.createContext({
    console, Uint8Array, Float32Array, AbortController,
    document: {getElementById: get, activeElement: null, createElement: () => new Element(),
      querySelector: selector => selector.startsWith('meta') ? {content: 'test-token'} : get(selector),
      querySelectorAll: () => []},
    localStorage: {getItem: () => null, setItem() {}},
    window: {addEventListener() {}},
    matchMedia: () => ({matches: false}),
    ResizeObserver: class { observe() {} },
    requestAnimationFrame() {},
    setTimeout() { return 1; }, clearTimeout() {},
    fetch: async (url, options = {}) => {
      if (options.method === 'POST') {
        const patch = JSON.parse(options.body);
        calls.push({url, data: patch});
        current = {...current, ...patch};
        current.spectrum_center_frequency = current.frequency + 128000;
      }
      return {ok: true, json: async () => structuredClone(current)};
    },
  });
  for (const file of ['radio-utils.js', 'app.js']) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'), context, {filename: file});
  }
  await new Promise(setImmediate);
  return {get, calls, context, state: () => current};
}

test('MHz text preserves integer hertz including half-kilohertz channels', () => {
  for (const hz of [24000000, 145512500, 145512501, 1750000000]) {
    assert.equal(Math.round(Number(tuning.formatFrequency(hz)) * 1e6), hz);
  }
  assert.equal(tuning.formatFrequency(145512500), '145.5125');
});

test('actual step-button handlers preserve repeated 12.5 kHz channel spacing', async () => {
  const ui = await createUi();
  for (let i = 0; i < 4; i++) await ui.get('stepUp').onclick();
  assert.deepEqual(ui.calls.map(call => call.data.frequency), [145512500, 145525000, 145537500, 145550000]);
  assert.equal(ui.state().frequency, 145550000);
});

test('rapid step presses retain the final requested channel while a request is pending', async () => {
  const ui = await createUi();
  await Promise.all(Array.from({length: 4}, () => ui.get('stepUp').onclick()));
  assert.equal(ui.state().frequency, 145550000);
  assert.equal(ui.calls.at(-1).data.frequency, 145550000);
});

test('saving a preset reads actual receiver state without retuning formatted text', async () => {
  const ui = await createUi(145512500);
  ui.get('frequency').value = '145.512';
  await ui.get('save').onclick();
  assert.equal(ui.calls.length, 0);
  assert.equal(ui.state().frequency, 145512500);
  assert.equal(ui.get('presetFrequency').textContent, '145.5125 MHz · NFM');
  assert.equal(ui.get('presetDialog').open, true);
});

test('spectrum click targets the hardware-centered RF frequency', async () => {
  const ui = await createUi(99500000);
  assert.equal(tuning.frequencyFraction(ui.state(), ui.state().frequency), .375);
  await ui.get('spectrum').onclick({clientX: 984});
  assert.equal(ui.state().frequency, 100100000);
});
