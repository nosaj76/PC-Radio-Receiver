'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

function createWorklet() {
  let Processor;
  const context = vm.createContext({
    Float32Array,
    AudioWorkletProcessor: class { constructor() { this.port = {}; } },
    registerProcessor(name, implementation) { Processor = implementation; },
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'audio-worklet.js'), 'utf8'), context);
  return new Processor();
}

function read(worklet, length) {
  const output = new Float32Array(length);
  worklet.process([], [[output]]);
  assert.ok(worklet.count >= 0 && worklet.count <= worklet.maxBuffered);
  return output;
}

test('oversized Fetch packet retains a bounded recent window without repeats', () => {
  const worklet = createWorklet();
  const input = Float32Array.from({length: 40000}, (_, i) => i);
  worklet.port.onmessage({data: input});
  assert.equal(worklet.count, 12000);
  assert.deepEqual(read(worklet, 12000), input.slice(-12000));
  assert.deepEqual(read(worklet, 128), new Float32Array(128));
});

test('backlog overflow drops only stale samples and keeps valid ordering', () => {
  const worklet = createWorklet();
  worklet.port.onmessage({data: Float32Array.from({length: 10000}, (_, i) => i)});
  worklet.port.onmessage({data: Float32Array.from({length: 10000}, (_, i) => i + 10000)});
  assert.deepEqual(read(worklet, 12000), Float32Array.from({length: 12000}, (_, i) => i + 8000));
});

test('multiple read/write cycles preserve audio across ring wraparound', () => {
  const worklet = createWorklet();
  for (let cycle = 0; cycle < 12; cycle++) {
    const packet = Float32Array.from({length: 4096}, (_, i) => cycle * 4096 + i);
    worklet.port.onmessage({data: packet});
    assert.deepEqual(read(worklet, packet.length), packet);
  }
});

test('retune clear discards old audio and waits for a fresh startup buffer', () => {
  const worklet = createWorklet();
  worklet.port.onmessage({data: new Float32Array(5000).fill(.5)});
  worklet.port.onmessage({data: 'clear'});
  worklet.port.onmessage({data: new Float32Array(2048).fill(.25)});
  assert.deepEqual(read(worklet, 128), new Float32Array(128));
  worklet.port.onmessage({data: new Float32Array(2048).fill(.25)});
  assert.deepEqual(read(worklet, 128), new Float32Array(128).fill(.25));
});
