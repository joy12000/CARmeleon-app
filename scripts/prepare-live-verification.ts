import { mkdir } from 'node:fs/promises';
import { synthesizeGeminiTts } from '../server/agent/tts';

await mkdir('.playwright-mcp', { recursive: true });
await Bun.write('.playwright-mcp/live-material-test.txt', '검증용 예제 메모\n이번 미팅 예산은 307만원이다. 계약 기간은 11개월이다.\n');
// A minimal original PDF to exercise the browser's real PDF.js worker.
const objects = [
  '<< /Type /Catalog /Pages 2 0 R >>',
  '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
  '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
  '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
];
const stream = 'BT /F1 18 Tf 72 720 Td (PROJECT_BUDGET_307 CONTRACT_11_MONTHS) Tj ET';
objects.push('<< /Length ' + stream.length + ' >>\nstream\n' + stream + '\nendstream');
let pdf = '%PDF-1.4\n'; const offsets = [0];
objects.forEach((object, i) => { offsets.push(pdf.length); pdf += (i + 1) + ' 0 obj\n' + object + '\nendobj\n'; });
const xref = pdf.length;
pdf += 'xref\n0 6\n0000000000 65535 f \n' + offsets.slice(1).map(n => String(n).padStart(10, '0') + ' 00000 n \n').join('');
pdf += 'trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n' + xref + '\n%%EOF\n';
await Bun.write('.playwright-mcp/live-material-test.pdf', pdf);
const wav = Bun.file('.playwright-mcp/live-input-test.wav');
if (!await wav.exists()) {
  const key = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
  if (!key) throw new Error('GEMINI_API_KEY is required for the one-time synthetic speech fixture.');
  const result = await synthesizeGeminiTts({ text: '잠깐만. 내 다음 방문지는 어디야?', preset: 'calm', apiKey: key, model: 'gemini-2.5-flash-preview-tts' });
  await Bun.write(wav, result.wav);
}
console.log('Prepared synthetic TXT/PDF/speech fixtures. No personal microphone recording or private material was used.');
