import type { CompanionCue } from '../../live/companion';
export function CueSources({ cue }: { cue?: CompanionCue }) {
  if (!cue?.prepared || (cue.state !== 'spoken' && cue.state !== 'scheduled')) return null;
  const prepared = cue.prepared;
  // Provider HTML is sandboxed. It never receives same-origin access, scripts or application data.
  const searchDoc = prepared.searchHtml ? '<meta name="referrer" content="no-referrer"><meta http-equiv="Content-Security-Policy" content="default-src &#39;none&#39;; style-src &#39;unsafe-inline&#39;; img-src https://www.google.com https://www.gstatic.com;"><style>body{margin:0;font:12px system-ui;}a{overflow-wrap:anywhere}</style>' + prepared.searchHtml : '';
  return <div className="browser-cue-sources" aria-label="방금 이야기의 근거">
    <span>{cue.topic} · 출처</span>
    {cue.encounterEvidence && <p>이야기 시작 기준 · 약 {cue.encounterEvidence.distanceMeters}m · {cue.encounterEvidence.kind === 'destination' ? '목적지 접근' : cue.encounterEvidence.side === 'left' ? '왼편' : cue.encounterEvidence.side === 'right' ? '오른편' : '앞쪽'}</p>}
    <div>{prepared.sources.slice(0, 3).map((source, i) => source.url ? <a key={source.url} href={source.url} target="_blank" rel="noreferrer">{source.title}</a> : <span key={i}>{source.title}</span>)}</div>
    {searchDoc && <iframe title="Google 검색 제안" sandbox="allow-popups allow-popups-to-escape-sandbox" referrerPolicy="no-referrer" srcDoc={searchDoc} />}
  </div>;
}
