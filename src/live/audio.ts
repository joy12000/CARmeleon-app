/** PCM16 mono conversion, with fractional sample carry across worklet blocks. */
export class PcmEncoder {
  private pending: number[] = [];
  private phase = 0;
  constructor(private inputRate: number, private outputRate = 16000) {
    if (!Number.isFinite(inputRate) || inputRate < outputRate) throw new Error('Unsupported microphone sample rate');
  }
  encode(input: Float32Array) {
    this.pending.push(...input);
    const ratio = this.inputRate / this.outputRate;
    const count = Math.max(0, Math.floor((this.pending.length - this.phase) / ratio));
    const bytes = new Uint8Array(count * 2), view = new DataView(bytes.buffer);
    for (let i = 0; i < count; i++) {
      const start = Math.floor(this.phase + i * ratio), end = Math.floor(this.phase + (i + 1) * ratio);
      let value = 0;
      for (let j = start; j < end; j++) value += this.pending[j];
      value = Math.max(-1, Math.min(1, value / Math.max(1, end - start)));
      view.setInt16(i * 2, Math.round(value * (value < 0 ? 32768 : 32767)), true);
    }
    const consumed = this.phase + count * ratio;
    this.pending = this.pending.slice(Math.floor(consumed));
    this.phase = consumed - Math.floor(consumed);
    return bytes;
  }
}
export function toBase64(bytes: Uint8Array) {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return btoa(binary);
}
export function decodePcm(data: string) {
  const raw = atob(data), bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  const view = new DataView(bytes.buffer), output = new Float32Array(Math.floor(bytes.length / 2));
  for (let i = 0; i < output.length; i++) output[i] = view.getInt16(i * 2, true) / 32768;
  return output;
}

export class AudioOutput {
  private next = 0;
  private sources = new Set<AudioBufferSourceNode>();
  private gain: GainNode;
  constructor(public context: AudioContext, private changed: (playing: boolean) => void) {
    this.gain = context.createGain(); this.gain.connect(context.destination);
  }
  get playing() { return this.sources.size > 0; }
  push(data: string, sampleRate = 24000) {
    const samples = decodePcm(data);
    if (!samples.length) return;
    // Protect against a stalled speaker accumulating a long stale monologue.
    if (this.next - this.context.currentTime > 20) this.stop();
    const buffer = this.context.createBuffer(1, samples.length, sampleRate);
    buffer.copyToChannel(new Float32Array(samples), 0);
    const source = this.context.createBufferSource();
    source.buffer = buffer; source.connect(this.gain);
    this.gain.gain.cancelScheduledValues(this.context.currentTime);
    this.gain.gain.setValueAtTime(1, this.context.currentTime);
    this.sources.add(source);
    source.onended = () => { source.disconnect(); this.sources.delete(source); if (!this.sources.size) this.changed(false); };
    source.start(Math.max(this.context.currentTime + 0.025, this.next));
    this.next = Math.max(this.context.currentTime + 0.025, this.next) + buffer.duration;
    this.changed(true);
  }
  stop() {
    const time = this.context.currentTime;
    this.gain.gain.cancelScheduledValues(time);
    this.gain.gain.setValueAtTime(this.gain.gain.value, time);
    this.gain.gain.linearRampToValueAtTime(0, time + 0.035);
    for (const source of this.sources) { source.onended = () => source.disconnect(); try { source.stop(time + 0.04); } catch { source.disconnect(); } }
    this.sources.clear(); this.next = 0; this.changed(false);
  }
}
