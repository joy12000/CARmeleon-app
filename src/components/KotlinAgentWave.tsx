import React, { useEffect, useRef } from 'react';

export interface KotlinAgentWaveProps {
  phase: 'IDLE' | 'LISTENING' | 'SPEAKING' | 'THINKING' | 'WAITING';
  dark?: boolean;
  className?: string;
  inputLevel?: number;
}

/**
 * 실제 Android/Kotlin 차량용 앱(AgentWave.kt)과 동일한 7겹 가우시안 리본 파형.
 * Canvas를 사용해 requestAnimationFrame으로 끊김 없이 실제 앱과 같은 실루엣·속도로 움직입니다.
 */
export const KotlinAgentWave: React.FC<KotlinAgentWaveProps> = ({
  phase,
  dark = false,
  className = '',
  inputLevel = 0,
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const phaseRef = useRef(phase);
  const darkRef = useRef(dark);
  const levelRef = useRef(inputLevel); levelRef.current = inputLevel;

  useEffect(() => {
    phaseRef.current = phase;
  }, [phase]);

  useEffect(() => {
    darkRef.current = dark;
  }, [dark]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let animId = 0;
    let animPhase = 0;
    let currentAmp = 0;
    let spreadGain = 0;
    let lastTime = performance.now();

    const draw = (now: number) => {
      const dt = Math.min(0.1, (now - lastTime) / 1000);
      lastTime = now;

      const curPhase = phaseRef.current;
      const isDark = darkRef.current;
      const isSpeaking = curPhase === 'SPEAKING';

      const rect = canvas.getBoundingClientRect();
      const width = Math.max(120, Math.round(rect.width));
      const height = Math.max(80, Math.round(rect.height));

      // 카멜레온이 말할 때(SPEAKING)만 일렁이고, 평소에는 가만히 정지 상태로 유지
      const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      const targetAmp = isSpeaking ? height * (reduced ? 0.12 : 0.30) : curPhase === 'LISTENING' ? height * 0.13 * levelRef.current : curPhase === 'THINKING' ? height * .06 : height * .018;
      const targetSpread = isSpeaking ? 1 : curPhase === 'LISTENING' ? Math.min(1, levelRef.current) : 0;
      const ease = Math.min(1, dt * (isSpeaking ? 9 : 6));
      currentAmp += (targetAmp - currentAmp) * ease;
      spreadGain += (targetSpread - spreadGain) * ease;

      if (!reduced && (isSpeaking || curPhase === 'THINKING' || currentAmp > 0.4)) {
        const periodSec = 2.8;
        animPhase = (animPhase + (2 * Math.PI * dt) / periodSec) % (2 * Math.PI);
      }

      const dpr = window.devicePixelRatio || 1;

      if (canvas.width !== width * dpr || canvas.height !== height * dpr) {
        canvas.width = width * dpr;
        canvas.height = height * dpr;
      }

      ctx.save();
      ctx.scale(dpr, dpr);
      ctx.clearRect(0, 0, width, height);

      const center = height / 2;
      const amplitude = currentAmp;

      // AgentWave.kt / CarmeleonTheme.kt 동일 잉크 토큰 (#191C20 light / #F2F3F5 dark)
      const [r, g, b] =
        curPhase === 'LISTENING'
          ? isDark
            ? [120, 178, 255]
            : [40, 95, 212]
          : isDark
          ? [242, 243, 245]
          : [25, 28, 32];

      for (let ribbon = 0; ribbon < 7; ribbon++) {
        ctx.beginPath();
        const spread = (ribbon - 3) * 0.18;
        for (let step = 0; step <= 150; step++) {
          const t = step / 150;
          const envArg = (t - 0.5) * 3.8;
          const envelope = Math.exp(-(envArg * envArg));
          const pulse =
            Math.sin(t * Math.PI * 3 + animPhase + spread) * 0.78 +
            Math.sin(t * Math.PI * 5 - animPhase * 0.5 + spread * 2) * 0.22;
          const y =
            center +
            amplitude * envelope * pulse +
            (ribbon - 3) * height * (0.004 + 0.018 * spreadGain) * envelope;
          const x = t * width;
          if (step === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        const alpha = ribbon === 3 ? 1 : 0.16 + ribbon * 0.07;
        ctx.strokeStyle = `rgba(${r}, ${g}, ${b}, ${alpha})`;
        ctx.lineWidth = ribbon === 3 ? 2.2 : 1.2;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.stroke();
      }

      ctx.restore();
      animId = requestAnimationFrame(draw);
    };

    animId = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(animId);
  }, []);

  return (
    <canvas
      ref={canvasRef}
      className={`w-full block ${className}`}
      style={{ height: 180 }}
      aria-label="CARmeleon AI Wave"
    />
  );
};
