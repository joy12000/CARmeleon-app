export type GeminiVoicePreset = 'cute' | 'bubbly' | 'calm';

const VOICE_PRESET_MAP: Record<GeminiVoicePreset, { voiceName: string; styleCue: string }> = {
  cute: {
    voiceName: 'Leda',
    styleCue: 'Read naturally in Korean with a cute, bright, warm, friendly young companion tone:',
  },
  bubbly: {
    voiceName: 'Aoede',
    styleCue: 'Read naturally in Korean with an upbeat, cheerful, playful companion tone:',
  },
  calm: {
    voiceName: 'Zephyr',
    styleCue: 'Read naturally in Korean with a soft, clear, gentle assistant tone:',
  },
};

/**
 * Gemini TTS가 반환한 16-bit mono PCM 바이트에 표준 RIFF/WAV 헤더(44바이트)를 붙여 브라우저에서 바로 재생 가능하게 만듭니다.
 */
export function pcm16MonoToWav(pcmBytes: Uint8Array, sampleRate = 24000): Uint8Array {
  const wav = new Uint8Array(44 + pcmBytes.length);
  const view = new DataView(wav.buffer);
  const writeAscii = (offset: number, value: string) => {
    for (let i = 0; i < value.length; i++) {
      wav[offset + i] = value.charCodeAt(i);
    }
  };

  const numChannels = 1;
  const bitsPerSample = 16;
  const byteRate = sampleRate * numChannels * (bitsPerSample / 8);
  const blockAlign = numChannels * (bitsPerSample / 8);

  writeAscii(0, 'RIFF');
  view.setUint32(4, 36 + pcmBytes.length, true);
  writeAscii(8, 'WAVE');
  writeAscii(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitsPerSample, true);
  writeAscii(36, 'data');
  view.setUint32(40, pcmBytes.length, true);
  wav.set(pcmBytes, 44);
  return wav;
}

/**
 * Google Gemini TTS REST API(gemini-2.5-flash-preview-tts)를 호출해 Leda/Aoede/Zephyr 음성을 WAV로 합성합니다.
 */
export async function synthesizeGeminiTts(params: {
  text: string;
  preset: GeminiVoicePreset;
  apiKey: string;
  model: string;
}): Promise<{ wav: Uint8Array; voiceName: string; model: string }> {
  const profile = VOICE_PRESET_MAP[params.preset] || VOICE_PRESET_MAP.cute;
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
    params.model
  )}:generateContent`;

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-goog-api-key': params.apiKey,
    },
    body: JSON.stringify({
      contents: [
        {
          parts: [
            {
              text: `${profile.styleCue} "${params.text}"`,
            },
          ],
        },
      ],
      generationConfig: {
        responseModalities: ['AUDIO'],
        speechConfig: {
          voiceConfig: {
            prebuiltVoiceConfig: {
              voiceName: profile.voiceName,
            },
          },
        },
      },
    }),
    signal: AbortSignal.timeout(15_000),
  });

  if (!response.ok) {
    throw new Error(`GEMINI_TTS_HTTP_${response.status}`);
  }

  const payload = (await response.json()) as {
    candidates?: Array<{
      content?: {
        parts?: Array<{
          inlineData?: { data?: string; mimeType?: string };
          inline_data?: { data?: string; mime_type?: string };
        }>;
      };
    }>;
  };

  const part = payload.candidates?.[0]?.content?.parts?.[0];
  const inline = part?.inlineData ?? part?.inline_data;
  const base64Data = inline?.data;
  if (!base64Data) {
    throw new Error('GEMINI_TTS_EMPTY_AUDIO');
  }

  const mimeType =
    (part?.inlineData?.mimeType ?? part?.inline_data?.mime_type ?? '').toLowerCase();
  const rateMatch = mimeType.match(/rate=(\d+)/);
  const sampleRate = rateMatch ? Number(rateMatch[1]) : 24000;
  const rawBytes = Uint8Array.from(Buffer.from(base64Data, 'base64'));
  const wav = mimeType.includes('wav') ? rawBytes : pcm16MonoToWav(rawBytes, sampleRate);

  return {
    wav,
    voiceName: profile.voiceName,
    model: params.model,
  };
}
