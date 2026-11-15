import { resolve } from 'node:path';
import { ApiError } from './models';

export type Config = {
  production: boolean; hostname: string; port: number; dataDir: string; databaseUrl?: string;
  s3?: { bucket: string; endpoint?: string; region?: string; accessKeyId: string; secretAccessKey: string };
  model?: string; apiKey?: string; geminiApiKey?: string; geminiTtsModel: string; kakaoLocalRestApiKey?: string; kakaoDirectionsRestApiKey?: string; maxUploadBytes: number; allowedOrigins: string[]; allowRegistration: boolean;
};
export function readConfig(env: Record<string, string | undefined> = process.env): Config {
  const production = env.NODE_ENV === 'production';
  const s3Fields = [env.CARMELEON_S3_BUCKET, env.CARMELEON_S3_ACCESS_KEY_ID, env.CARMELEON_S3_SECRET_ACCESS_KEY];
  if (s3Fields.some(Boolean) && !s3Fields.every(Boolean)) throw new ApiError(500, 'S3_CONFIG_INCOMPLETE', 'S3 bucket와 자격 증명을 모두 설정하세요.');
  if (env.DATABASE_URL && !/^postgres(ql)?:\/\//.test(env.DATABASE_URL)) throw new ApiError(500, 'DATABASE_CONFIG_INVALID', 'DATABASE_URL은 PostgreSQL URL이어야 해요.');
  if (production && (!env.DATABASE_URL || !s3Fields.every(Boolean))) throw new ApiError(500, 'CLOUD_CONFIG_REQUIRED', '운영 서버에는 PostgreSQL과 비공개 S3 객체 저장소가 필요해요.');
  return {
    production, hostname: env.CARMELEON_AGENT_HOST ?? '0.0.0.0', port: Number(env.CARMELEON_AGENT_PORT ?? 3001),
    dataDir: resolve(env.CARMELEON_AGENT_DATA_DIR ?? '.carmeleon-private'), databaseUrl: env.DATABASE_URL,
    s3: s3Fields.every(Boolean) ? { bucket: env.CARMELEON_S3_BUCKET!, endpoint: env.CARMELEON_S3_ENDPOINT, region: env.CARMELEON_S3_REGION, accessKeyId: env.CARMELEON_S3_ACCESS_KEY_ID!, secretAccessKey: env.CARMELEON_S3_SECRET_ACCESS_KEY! } : undefined,
    apiKey: env.OPENAI_API_KEY, model: env.CARMELEON_OPENAI_MODEL,
    geminiApiKey: env.GEMINI_API_KEY?.trim() || env.GOOGLE_API_KEY?.trim() || undefined,
    geminiTtsModel: env.CARMELEON_GEMINI_TTS_MODEL?.trim() || 'gemini-2.5-flash-preview-tts',
    kakaoLocalRestApiKey: env.KAKAO_LOCAL_REST_API_KEY?.trim() || undefined,
    kakaoDirectionsRestApiKey: env.KAKAO_DIRECTIONS_REST_API_KEY?.trim() || undefined,
    maxUploadBytes: 20 * 1024 * 1024,
    allowedOrigins: (env.CARMELEON_ALLOWED_ORIGINS ?? '').split(',').map(s => s.trim()).filter(Boolean),
    allowRegistration: !production || env.CARMELEON_ALLOW_REGISTRATION === 'true',
  };
}
