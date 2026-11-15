import { describe, expect, test } from 'bun:test';
import { pcm16MonoToWav } from '../../server/agent/tts';
import {
  detectDetourKind,
  extractPlaceSearchQuery,
  extractWakeCommand,
  isBriefingUtterance,
  pickBestTranscriptAlternative,
} from './voiceFlow';

describe('Korean wake-word & speech flow resilience', () => {
  test('recognizes exact and common Chrome Korean STT misrecognitions of 카멜레온', () => {
    const cases: Array<[string, string]> = [
      ['카멜레온', ''],
      ['카멜레온~ 가까운 주유소 찾아줘', '가까운 주유소 찾아줘'],
      ['카메론 화장실 급해', '화장실 급해'],
      ['카멜 내용 5페이지 보안 뭐야', '5페이지 보안 뭐야'],
      ['카밀레온 근처 편의점', '근처 편의점'],
      ['가멜레온아 커피 마시고 싶어', '커피 마시고 싶어'],
      ['카멜리언 오늘 일정 알려줘', '오늘 일정 알려줘'],
      ['카메라 온 목적지 어디야', '목적지 어디야'],
      ['까멜레온 야 고마워', '고마워'],
      ['카멜레온 어디야', '어디야'],
      ['카멜 수익 배분 비율이 몇 대 몇이야', '수익 배분 비율이 몇 대 몇이야'],
    ];

    for (const [input, expectedCommand] of cases) {
      const res = extractWakeCommand(input);
      expect(res.woke).toBe(true);
      expect(res.command).toBe(expectedCommand);
    }

    expect(extractWakeCommand('카라멜 마끼아또 주세요').woke).toBe(false);
    expect(extractWakeCommand('주유소 찾아줘').woke).toBe(false);
  });

  test('picks best alternative from Web Speech maxAlternatives list', () => {
    const res = pickBestTranscriptAlternative([
      '화면 내용 주유소 찾아줘',
      '카멜 내용 주유소 찾아줘',
      '카멜레온 주유소 찾아줘',
    ]);
    expect(res.woke).toBe(true);
    expect(res.command).toBe('주유소 찾아줘');
  });

  test('detects detour categories even with STT spacing issues or phonetic typos', () => {
    expect(detectDetourKind('가까운 주요소 찾아줘')).toBe('gas');
    expect(detectDetourKind('근처 편이점 들러줘')).toBe('convenience');
    expect(detectDetourKind('화장 실 급해')).toBe('restroom');
    expect(detectDetourKind('주차 할 곳 찾아줘')).toBe('parking');
    expect(detectDetourKind('까페 가자')).toBe('coffee');
    expect(extractPlaceSearchQuery('근처 다이소 찾아줘')).toBe('다이소');
    expect(isBriefingUtterance('5페이지 보안 내용이 뭐야?')).toBe(false);
    expect(isBriefingUtterance('전체 미팅 자료 요약해줘')).toBe(true);
  });

  test('wraps Gemini 24kHz PCM bytes into a valid RIFF/WAVE header', () => {
    const pcm = new Uint8Array([0x01, 0x02, 0x03, 0x04]);
    const wav = pcm16MonoToWav(pcm, 24000);
    expect(wav.length).toBe(48);
    expect(String.fromCharCode(...wav.slice(0, 4))).toBe('RIFF');
    expect(String.fromCharCode(...wav.slice(8, 12))).toBe('WAVE');
    expect(String.fromCharCode(...wav.slice(36, 40))).toBe('data');
  });
});
