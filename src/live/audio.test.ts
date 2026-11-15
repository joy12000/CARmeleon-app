import { expect, test } from 'bun:test';
import { PcmEncoder, decodePcm, toBase64 } from './audio';
test('PCM clipping and little endian round-trip preserve audio polarity', () => {
  const bytes = new PcmEncoder(16000).encode(new Float32Array([-2, -0.5, 0, 0.5, 2]));
  const samples = decodePcm(toBase64(bytes));
  expect(samples[0]).toBe(-1); expect(samples[1]).toBeCloseTo(-0.5, 4);
  expect(samples[2]).toBe(0); expect(samples[3]).toBeCloseTo(0.5, 4); expect(samples[4]).toBeCloseTo(1, 4);
});
test('fractional resampling has no cumulative drift across worklet chunks', () => {
  const encoder = new PcmEncoder(24000); let samples = 0;
  for (let i = 0; i < 300; i++) samples += encoder.encode(new Float32Array(1024)).length / 2;
  expect(samples).toBe(204800);
});
test('48k microphone becomes 16k PCM', () => {
  expect(new PcmEncoder(48000).encode(new Float32Array(48000)).length).toBe(32000);
});
