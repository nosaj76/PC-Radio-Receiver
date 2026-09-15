class RadioAudio extends AudioWorkletProcessor {
  constructor() {
    super();
    this.buffer = new Float32Array(32768); this.read = 0; this.write = 0; this.count = 0; this.started = false;
    this.port.onmessage = ({data}) => {
      if (data === 'clear') { this.count = 0; this.read = this.write; this.started = false; return; }
      if (this.count + data.length > 12000) { this.read = this.write; this.count = 0; this.started = false; }
      for (let i = 0; i < data.length; i++) { this.buffer[this.write] = data[i]; this.write = (this.write + 1) % this.buffer.length; }
      this.count += data.length;
    };
  }
  process(inputs, outputs) {
    const out = outputs[0][0];
    if (!this.started && this.count >= 4096) this.started = true;
    for (let i = 0; i < out.length; i++) {
      if (this.started && this.count) { out[i] = this.buffer[this.read]; this.read = (this.read + 1) % this.buffer.length; this.count--; }
      else { out[i] = 0; this.started = false; }
    }
    return true;
  }
}
registerProcessor('radio-audio', RadioAudio);
