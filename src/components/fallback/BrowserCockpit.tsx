import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { ArrowDown, ArrowUp, Bell, BellOff, Captions, Check, ChevronRight, FileText, History, Keyboard, MapPin, Mic, MicOff, Moon, MoreHorizontal, Pause, Play, Plus, RotateCcw, Route, Send, Settings2, Smartphone, Sun, Trash2, Undo2, VolumeX, X } from 'lucide-react';
import type { DailyPlan, SavedRoute } from '../../types';
import { BrowserJourney } from '../../live/journey';
import { GeminiLiveClient } from '../../live/GeminiLiveClient';
import { CompanionQueue, demoPlaybackSpeed } from '../../live/companion';
import { RouteAgent, agentStage } from '../../live/RouteAgent';
import { situationLabel } from '../../live/situation';
import type { LiveMessage, LiveState } from '../../live/protocol';
import { extractBrowserMaterial } from '../../live/materials';
import { downloadLocalMaterial, listLocalMaterials, readLocalMaterial, saveLocalMaterial } from '../phone/localMaterials';
import { KotlinAgentWave } from '../KotlinAgentWave';
import { LiveRouteMap } from './LiveRouteMap';
import { CueSources } from './CueSources';
import './browser.css';

const labels: Record<LiveState, string> = { idle: '여기서 함께할게요', connecting: '대화를 연결하고 있어요', listening: '편하게 말씀하세요', thinking: '잠시 생각하고 있어요', speaking: '카멜레온이 말하고 있어요', error: '연결을 확인해 주세요' };
const minutes = (seconds: number) => Math.max(1, Math.round(seconds / 60)) + '분';
const distance = (meters: number) => (meters / 1000).toFixed(1) + ' km';

export function BrowserCockpit({ plan, onUpdatePlan, onPhone }: { plan: DailyPlan; onUpdatePlan: (plan: DailyPlan) => void; onPhone: () => void }) {
  const latest = useRef({ plan, onUpdatePlan }); latest.current = { plan, onUpdatePlan };
  const journey = useMemo(() => new BrowserJourney(plan.activeRoute, (route: SavedRoute) => {
    const { plan: current, onUpdatePlan: update } = latest.current;
    update({ ...current, activeRoute: route, savedRoutes: current.savedRoutes.map(r => r.id === route.id ? route : r) });
  }, localStorage, undefined, (() => {
    const home = plan.shortcuts.find(s => s.icon === 'home' && typeof s.latitude === 'number' && typeof s.longitude === 'number');
    return plan.activeRoute.origin || (home ? { latitude: home.latitude!, longitude: home.longitude! } : undefined);
  })()), [plan.activeRoute.id]);
  useSyncExternalStore(journey.subscribe, journey.getVersion);
  const state = journey.state, target = journey.target;
  const companion = useMemo(() => new CompanionQueue(), [journey]);
  const companionVersion = useSyncExternalStore(companion.subscribe, companion.getVersion);
  const agent = useMemo(() => new RouteAgent(plan.activeRoute.id), [journey]);
  const agentVersion = useSyncExternalStore(agent.subscribe, agent.getVersion);
  const [agentEpoch, setAgentEpoch] = useState(0);
  const [preparationEpoch, setPreparationEpoch] = useState(0);
  const [liveState, setLiveState] = useState<LiveState>('idle');
  const [error, setError] = useState(''), [notice, setNotice] = useState('');
  const [mic, setMic] = useState(false), [level, setLevel] = useState(0), [dark, setDark] = useState(false);
  const [tab, setTab] = useState<'route' | 'materials' | 'memory'>('route');
  const [messages, setMessages] = useState<LiveMessage[]>([]);
  const [text, setText] = useState(''), [query, setQuery] = useState(''), [note, setNote] = useState('');
  const [editingNote, setEditingNote] = useState<string | null>(null);
  const [detailsOpen, setDetailsOpen] = useState(false), [historyOpen, setHistoryOpen] = useState(false), [demoOpen, setDemoOpen] = useState(false);
  const [focusView, setFocusView] = useState(true);
  const [settingsOpen, setSettingsOpen] = useState(false), [textOpen, setTextOpen] = useState(false), [sourcesOpen, setSourcesOpen] = useState(false);
  const [captions, setCaptions] = useState(() => { try { return localStorage.getItem('carmeleon_browser_captions') === 'true'; } catch { return false; } });
  const [goal, setGoal] = useState(state.preferences.goal), [materialStopId, setMaterialStopId] = useState('');
  const [busy, setBusy] = useState(false), [speedMode, setSpeedMode] = useState('companion');
  const [capabilities, setCapabilities] = useState<{ liveConfigured: boolean; model: string } | null>(null);
  const fileInput = useRef<HTMLInputElement>(null), log = useRef<HTMLDivElement>(null);
  const ids = useRef<{ user?: string; assistant?: string }>({});
  const queryControl = useRef<AbortController>();
  const lastUserAt = useRef(0);
  const pendingProactive = useRef<string | null>(null);
  const pendingPreparation = useRef('');
  const lastSpeechAt = useRef(0), wasSpeaking = useRef(false), handledArrival = useRef<object | null>(null);
  const lastWorld = useRef<{ sentAt: number; elapsed: number; state: string }>();
  const recentMessages = useRef(messages); recentMessages.current = messages;
  const live = useMemo(() => new GeminiLiveClient({
    state: next => {
      if (wasSpeaking.current && next !== 'speaking') lastSpeechAt.current = Date.now();
      wasSpeaking.current = next === 'speaking';
      if ((next === 'idle' || next === 'error') && pendingProactive.current) { companion.finish(true); pendingProactive.current = null; }
      setLiveState(next); if (next === 'idle' || next === 'error') setMic(false);
    },
    error: setError, level: setLevel,
    userActivity: () => { lastUserAt.current = Date.now(); agent.userActivity(); if (pendingProactive.current) companion.finish(true); pendingProactive.current = null; },
    turnComplete: interrupted => {
      if (pendingProactive.current) {
        const id = companion.lastCue?.id; companion.finish(interrupted);
        if (!interrupted && id) try { journey.markCueHeard(id); } catch { setNotice('들은 안내 기록을 저장하지 못했어요. 다음 연결에서 다시 알려줄 수 있어요.'); }
      }
      pendingProactive.current = null; lastSpeechAt.current = Date.now();
      setAgentEpoch(v => v + 1);
    },
    transcript: (role, value, complete) => {
      if (role === 'user') pendingProactive.current = null;
      const id = ids.current[role] || crypto.randomUUID(); ids.current[role] = id;
      setMessages(previous => {
        const found = previous.some(m => m.id === id);
        return (found ? previous.map(m => m.id === id ? { ...m, text: value } : m) : [...previous, { id, role, text: value }]).slice(-40);
      });
      if (complete) {
        ids.current[role] = undefined;
        if (role === 'user') { journey.recordInput(value); lastUserAt.current = Date.now(); }
      }
    },
    tool: async (name, args, signal) => {
      if (name === 'get_journey') return { ...journey.context(), currentAgentTask: agent.current ? { id: agent.current.id, goal: agent.current.goal, status: agent.current.status, question: agent.current.speech } : null };
      if (name === 'complete_agent_task' && (args.status === 'done' || args.status === 'dismissed')) return agent.resolve(String(args.task_id || ''), args.status, recentMessages.current);
      const result = await journey.tool(name, args, signal);
      if (name === 'forget' || name === 'update_note') agent.clearSensitive();
      return result;
    },
    context: () => ({ ...journey.context(), currentAgentTask: agent.current ? { id: agent.current.id, goal: agent.current.goal, status: agent.current.status, question: agent.current.speech, placeId: agent.current.placeId } : null, lastCompanionCue: companion.lastCue ? { topic: companion.lastCue.topic, speech: companion.lastCue.spokenText || companion.lastCue.prepared?.speech, place: companion.lastCue.place, encounter: companion.lastCue.encounterEvidence, sources: companion.lastCue.prepared?.sources } : null, recentConversation: recentMessages.current.slice(-8).map(m => ({ role: m.role, text: m.text.slice(0, 1500) })) }),
  }), [journey, companion, agent]);
  const selectedSpeed = speedMode === 'companion' ? 30 : Number(speedMode);
  const speed = demoPlaybackSpeed({ selected: selectedSpeed, automatic: speedMode === 'companion', duration: state.leg?.durationSeconds || 0, progress: state.progress, road: state.leg, position: state.position, cues: companion.cues, preparing: companion.status === 'preparing' || agent.blocksNarration, busy: liveState === 'speaking' || liveState === 'thinking', quiet: state.preferences.quiet, sinceUser: Date.now() - lastUserAt.current, sinceSpeech: Date.now() - lastSpeechAt.current });

  useEffect(() => {
    const control = new AbortController();
    void fetch('/api/fallback/status', { signal: control.signal }).then(r => r.ok ? r.json() : null).then(setCapabilities).catch(() => {});
    void journey.loadLeg();
    return () => { control.abort(); queryControl.current?.abort(); live.disconnect(); agent.dispose(); journey.dispose(); };
  }, [journey, live, agent]);
  useEffect(() => {
    setMessages([]); recentMessages.current = []; ids.current = {};
    setHistoryOpen(false); setFocusView(true); setDetailsOpen(false); setMaterialStopId(''); setGoal(journey.state.preferences.goal); setTextOpen(false); setSourcesOpen(false); setSettingsOpen(false);
    setText(''); setQuery(''); setEditingNote(null); setNote(''); setError(''); setNotice('');
    lastUserAt.current = 0; lastSpeechAt.current = 0; pendingProactive.current = null; handledArrival.current = null;
    lastWorld.current = undefined;
  }, [journey]);
  useEffect(() => {
    const timer = setInterval(() => journey.advance(speed / 5), 200);
    return () => clearInterval(timer);
  }, [journey, speed]);
  useEffect(() => { if (state.driving) setFocusView(true); }, [state.driving]);
  useEffect(() => { if (state.proposal) setDetailsOpen(false); }, [state.proposal?.id]);
  useEffect(() => { setGoal(state.preferences.goal); }, [state.preferences.goal]);
  useEffect(() => { if (!notice) return; const timer = setTimeout(() => setNotice(''), 4500); return () => clearTimeout(timer); }, [notice]);
  useEffect(() => { if (historyOpen) log.current?.scrollTo({ top: log.current.scrollHeight, behavior: 'smooth' }); }, [messages, historyOpen]);
  const connected = live.connected;
  useEffect(() => {
    if (!connected || liveState !== 'listening' || Date.now() - lastUserAt.current < 1500) return;
    const world = journey.world(), observed = lastWorld.current;
    const stateKey = JSON.stringify([world.motion, world.nextStopId, world.arrival]);
    if (observed && observed.state === stateKey && (Date.now() - observed.sentAt < 5000 || Math.abs(world.elapsedSeconds - observed.elapsed) < 30)) return;
    live.observeWorld(world);
    lastWorld.current = { sentAt: Date.now(), elapsed: world.elapsedSeconds, state: stateKey };
  }, [connected, liveState, state.elapsedSeconds, state.driving, state.arrival, target?.id, live, journey]);
  const preparationKey = useMemo(() => JSON.stringify([state.revision, target?.id, state.preferences, state.notes, state.materials.map(m => [m.id, m.selected, m.stopId, m.text])]), [state.revision, target?.id, state.preferences, state.notes, state.materials]);
  useEffect(() => {
    agent.sync(journey);
    if (!connected || !state.driving || state.preferences.quiet) { agent.cancel(); return; }
    if (liveState === 'listening') {
      const quietFor = Date.now() - lastUserAt.current;
      if (quietFor < 1500) { const timer = setTimeout(() => setAgentEpoch(v => v + 1), 1500 - quietFor); return () => clearTimeout(timer); }
      void agent.observe(journey, recentMessages.current, 'departure');
    }
  }, [connected, liveState, state.driving, state.revision, preparationKey, agentEpoch, agentVersion, Math.floor(state.progress * 3), journey, agent]);
  useEffect(() => { if (!connected || !state.driving) return; const timer = setInterval(() => setAgentEpoch(v => v + 1), 45000); return () => clearInterval(timer); }, [connected, state.driving]);
  useEffect(() => {
    if (!connected || !state.driving || state.preferences.quiet || liveState !== 'listening' || Date.now() - lastUserAt.current < 12000 || Date.now() - lastSpeechAt.current < 18000) return;
    void agent.present(journey).then(task => {
      if (!task || !live.connected || state.preferences.quiet) return;
      live.updateContext('동행 에이전트가 스스로 조사한 작업이다. ' + JSON.stringify({ goal: task.goal, speech: task.speech, sources: task.result?.sources }) + (task.placeId ? '\n경로에는 아직 미적용이다. 이미 열린 최신 변경안의 실제 우회 시간을 기준으로 짧게 제안하고 승인 질문 하나만 한다. 제안을 다시 만들거나 적용하지 않는다.' : '\n준비한 핵심/확인 질문을 한두 문장으로 전한다. 내부 단계나 도구를 나열하지 않는다.'), true);
    });
  }, [agentVersion, state.progress, state.driving, state.preferences.quiet, liveState, connected, agent, journey, live]);
  useEffect(() => {
    const control = new AbortController();
    if (capabilities?.liveConfigured && state.leg) void companion.prepare(journey, control.signal);
    return () => control.abort();
  }, [capabilities?.liveConfigured, preparationKey, preparationEpoch, state.leg, companion, journey]);
  useEffect(() => {
    const key = state.route.id + ':' + state.revision + ':' + target?.id;
    if (pendingProactive.current && (pendingProactive.current !== key || pendingPreparation.current !== preparationKey || state.preferences.quiet || companion.expired({ road: state.leg, position: state.position, progress: state.progress }))) { companion.finish(true); live.stopSpeaking(); pendingProactive.current = null; }
    if (!state.driving || !target || !state.leg || state.proposal || !connected || pendingProactive.current || agent.blocksNarration) return;
    const cue = companion.claim({ progress: state.progress, road: state.leg, position: state.position, duration: state.leg.durationSeconds, speed, leadSpeed: speedMode === 'companion' ? selectedSpeed : speed, quiet: state.preferences.quiet, idle: liveState === 'listening', sinceUser: Date.now() - lastUserAt.current, sinceSpeech: Date.now() - lastSpeechAt.current });
    if (cue?.prepared) { pendingProactive.current = key; pendingPreparation.current = preparationKey; live.speakPrepared(cue.spokenText || cue.prepared.speech); }
  }, [state.progress, state.driving, state.revision, state.preferences.quiet, liveState, state.proposal, target?.id, live, speed, speedMode, selectedSpeed, companion, companionVersion, connected, preparationKey]);
  useEffect(() => {
    if (!state.arrival || handledArrival.current === state.arrival) return;
    handledArrival.current = state.arrival;
    if (connected && liveState === 'listening' && !state.preferences.quiet && Date.now() - lastUserAt.current > 12000 && Date.now() - lastSpeechAt.current > 8000)
      live.updateContext('현재 방문지에 도착했다. 잠깐 경유한 장소라면 쉬었다 다시 출발하면 원래 다음 목적지로 이어간다는 점만 한 문장으로 말한다. 질문으로 끝내지 않는다.', true);
  }, [state.arrival, connected, live, liveState, state.preferences.quiet]);

  const run = async (action: () => void | Promise<unknown>) => {
    setError('');
    try { await action(); } catch (e) { setError(e instanceof Error && !/Failed to fetch|NetworkError|Load failed/i.test(e.message) ? e.message : '연결이 잠시 끊겼어요. 잠시 뒤 다시 시도해 주세요.'); }
  };
  const connect = () => run(async () => { await live.connect(true); setMic(live.micEnabled); });
  const startJourney = () => run(async () => {
    if (state.driving) { journey.setDriving(false); return; }
    if (!live.connected) { await live.connect(true); setMic(live.micEnabled); }
    if (!live.connected) return;
    const returning = state.arrival?.detour;
    journey.setDriving(true); setDetailsOpen(false);
    live.updateContext(returning ? '사용자가 잠깐 경유를 마치고 다시 출발했다. 원래 다음 방문지를 이어간다고 한 문장으로 말한다.' : '사용자가 함께 출발을 눌렀다. 앞 구간에서 준비한 여행 이야기/업무 브리핑이 적절한 시점에 자동으로 이어진다. 일반적인 동행 인사나 출발 확인은 하지 않는다.', !!returning && !state.preferences.quiet);
  });
  const toggleQuiet = () => run(() => { journey.setPreferences({ quiet: !state.preferences.quiet }); if (state.preferences.quiet && pendingProactive.current) { companion.finish(true); pendingProactive.current = null; live.stopSpeaking(); } if (!state.preferences.quiet) setNotice(state.driving ? '다가오는 장소에 맞춰 먼저 이야기할게요.' : '출발 버튼을 누르면 이동에 맞춰 먼저 이야기할게요.'); live.updateContext('사용자가 먼저 말하기 설정을 바꿨다. 새 질문 전에는 확인 응답을 하지 않는다.'); });
  const sendText = async (value: string) => {
    if (!value.trim()) return;
    agent.userActivity();
    if (pendingProactive.current) companion.finish(true);
    pendingProactive.current = null;
    journey.recordInput(value.trim()); lastUserAt.current = Date.now();
    setMessages(m => [...m, { id: crypto.randomUUID(), role: 'user' as const, text: value.trim() }].slice(-40)); setText('');
    if (!live.connected) await live.connect(false);
    if (live.connected) live.sendText(value.trim());
  };
  const decide = (decision: 'approve' | 'cancel') => run(() => {
    if (!state.proposal) return;
    journey.decide(state.proposal.id, decision, 'button');
    setNotice(decision === 'approve' ? '경로를 바꿨어요.' : '기존 경로로 함께 가요.');
    live.updateContext(decision === 'approve' ? '사용자가 적용 버튼을 눌러 변경안을 승인했고 방문 계획에 반영됐다.' : '사용자가 경로 변경을 취소했다.', !state.preferences.quiet);
  });
  const search = () => run(async () => {
    if (!query.trim()) return;
    queryControl.current?.abort(); const control = new AbortController(); queryControl.current = control;
    setBusy(true);
    try { await journey.search(query.trim(), control.signal, /근처|주변|^(카페|식당|화장실|충전소|주유소|관광명소)$/.test(query.trim()) ? 'nearby' : 'name'); } finally { if (queryControl.current === control) setBusy(false); }
  });
  const propose = (id: string) => run(async () => {
    queryControl.current?.abort(); const control = new AbortController(); queryControl.current = control;
    setBusy(true);
    try { await journey.propose(id, control.signal); live.updateContext('실제 검색 장소로 경유 변경안을 계산했다. 아직 적용되지 않았으며 사용자 확인을 기다린다.', true); }
    finally { if (queryControl.current === control) setBusy(false); }
  });
  const attach = async (blob: Blob, name: string, id: string, stopId: string) => {
    try { const text = await extractBrowserMaterial(blob, name); journey.addMaterial({ id, name, text, selected: true, stopId }); }
    catch (e) {
      journey.addMaterial({ id, name, text: '', selected: false, stopId });
      throw e;
    }
    live.updateContext('사용자가 자료 발췌를 대화 맥락으로 선택했다.');
  };
  const upload = (files: FileList | null) => run(async () => {
    if (!files?.length) return; setBusy(true);
    try {
      for (const file of Array.from(files).slice(0, 4)) {
        const saved = await saveLocalMaterial(file, state.route.id, materialStopId || target?.id || state.route.stops[0]?.id || '');
        await attach(file, saved.name, saved.id, saved.stopId);
      }
      setNotice('원본을 보관하고 읽은 발췌를 연결했어요.');
    } finally { setBusy(false); if (fileInput.current) fileInput.current.value = ''; }
  });
  const importOriginals = () => run(async () => {
    setBusy(true);
    try {
      const stored = (await listLocalMaterials()).filter(m => m.routeId === state.route.id && !state.materials.some(current => current.id === m.id));
      if (!stored.length) { setNotice('이 경로에서 새로 연결할 원본이 없어요. 자료를 추가해 주세요.'); return; }
      for (const material of stored.slice(0, 4)) {
        const blob = await readLocalMaterial(material.id);
        if (blob) await attach(blob, material.name, material.id, material.stopId);
      }
      setNotice('준비 화면에 보관한 원본을 읽었어요.');
    } finally { setBusy(false); }
  });
  const resetConversation = () => { companion.clear(); agent.clearSensitive(); live.disconnect(); setMessages([]); ids.current = {}; setNotice('대화에 사용할 맥락이 바뀌었어요. 대화 시작을 눌러 다시 연결해 주세요.'); };
  const selectRoute = (id: string) => run(() => {
    const route = plan.savedRoutes.find(r => r.id === id);
    if (route) onUpdatePlan({ ...plan, activeRoute: route });
  });
  const restart = () => run(async () => {
    setBusy(true); companion.restart(); agent.clearSensitive(); if (live.connected) live.stopSpeaking(); pendingProactive.current = null;
    try { await journey.restart(); setFocusView(true); setDetailsOpen(false); live.updateContext('사용자가 여정을 처음으로 돌렸다. 계획·원본·기억은 보존했다. 출발 전에는 말하지 않는다.'); }
    finally { setBusy(false); }
  });
  const moveStop = (index: number, direction: number) => run(async () => {
    const remaining = state.route.stops.slice(state.targetIndex), current = index - state.targetIndex, next = current + direction;
    if (next < 0 || next >= remaining.length) return;
    [remaining[current], remaining[next]] = [remaining[next], remaining[current]];
    queryControl.current?.abort(); const control = new AbortController(); queryControl.current = control; setBusy(true);
    try { await journey.proposeRoute(remaining.map(stop => stop.id), control.signal); live.updateContext('사용자가 수동으로 방문 순서를 바꾸는 변경안을 만들었다. 적용 버튼을 누르기 전까지 저장하지 않는다.'); }
    finally { if (queryControl.current === control) setBusy(false); }
  });
  const remainingSeconds = state.leg ? Math.max(0, state.leg.durationSeconds * (1 - state.progress)) : 0;
  const remainingMeters = state.leg ? Math.max(0, state.leg.distanceMeters * (1 - state.progress)) : 0;
  const phase = liveState === 'speaking' ? 'SPEAKING' : liveState === 'thinking' || liveState === 'connecting' || agent.phase === 'planning' ? 'THINKING' : liveState === 'listening' ? 'LISTENING' : 'IDLE';
  const visibleMessages = historyOpen ? messages : messages.slice(-2);
  const showCaptions = captions || historyOpen || (textOpen && messages.length > 0);
  const detailsVisible = !focusView || detailsOpen;
  const proposal = state.proposal;
  const previewStops = proposal?.action === 'route' ? proposal.routeStops?.slice(state.targetIndex) : proposal?.action === 'add' && proposal.place && target ? [{ id: proposal.place.id, name: proposal.place.name, ...proposal.place.coordinate }, target] : proposal?.action === 'skip' ? state.route.stops.slice(state.targetIndex + 1, state.targetIndex + 2) : undefined;
  const startLabel = state.driving ? '잠시 멈춤' : state.arrival ? '다시 출발' : state.progress > 0 ? '이어서 출발' : '함께 출발';
  const preparationFailed = companion.cues.length > 0 && companion.cues.every(cue => cue.state === 'error');
  const proactiveStatus = connected && state.driving && !state.preferences.quiet && liveState === 'listening' && !pendingProactive.current && !proposal
    ? agent.phase === 'planning' ? '가는 길을 살펴보고 있어요'
      : agent.current?.status === 'waiting_answer' ? '답을 기다리고 있어요'
      : companion.status === 'preparing' ? '다음 이야기를 준비하고 있어요'
      : preparationFailed ? '다음 이야기를 준비하지 못했어요'
      : companion.cues.some(cue => cue.kind === 'travel' && cue.state === 'ready') ? '소개할 장소에 가까워지면 이야기할게요'
      : companion.cues.length > 0 && companion.cues.every(cue => cue.state === 'spoken') ? '이 구간 이야기는 이미 들었어요'
      : companion.cues.find(cue => cue.state === 'skipped' && cue.reason)?.reason || ''
    : '';

  return <><div className="browser-cockpit" data-theme={dark ? 'dark' : 'light'}>
    <main className="browser-layout" data-driving={state.driving} data-focused={focusView} data-details={detailsOpen}>
      <section className="browser-map-panel" aria-label="내비게이션 시연 지도">
        <LiveRouteMap route={state.route} position={state.position} origin={journey.initialPosition} follow={state.driving} road={state.leg} preview={proposal?.preview} previewStops={previewStops} previewOrigin={proposal?.from} />
      </section>
      <section className="browser-app-panel" aria-label="CARmeleon 앱">
    <header className="browser-header">
      <strong className="browser-app-name">CARmeleon</strong>
      <div className="browser-header-actions"><button aria-label="경로·자료" title="경로·자료" onClick={() => { setFocusView(true); setDetailsOpen(!detailsVisible); }} aria-expanded={detailsVisible}><Route size={19} /></button><button aria-label="대화 설정" title="대화 설정" aria-expanded={settingsOpen} onClick={() => setSettingsOpen(v => !v)}><MoreHorizontal size={20} /></button></div>
      {settingsOpen && <div className="browser-settings-menu" role="menu" aria-label="동행 설정"><button role="menuitemcheckbox" aria-checked={!state.preferences.quiet} onClick={() => { void toggleQuiet(); setSettingsOpen(false); }}>{state.preferences.quiet ? <BellOff size={17} /> : <Bell size={17} />}먼저 말하기</button><button role="menuitemcheckbox" aria-checked={captions} onClick={() => { const value = !captions; setCaptions(value); try { localStorage.setItem('carmeleon_browser_captions', String(value)); } catch {} setSettingsOpen(false); }}><Captions size={17} />대화 자막</button><button role="menuitem" disabled={!messages.length} onClick={() => { setHistoryOpen(v => !v); setSettingsOpen(false); }}><History size={17} />대화 기록</button>{companion.lastCue?.prepared && <button role="menuitem" onClick={() => { setSourcesOpen(v => !v); setSettingsOpen(false); }}><FileText size={17} />이야기 출처</button>}<button role="menuitem" onClick={() => { setDark(v => !v); setSettingsOpen(false); }}>{dark ? <Sun size={17} /> : <Moon size={17} />}{dark ? '주간 화면' : '야간 화면'}</button><button role="menuitem" onClick={onPhone}><Smartphone size={17} />이동 준비</button>{connected && <button role="menuitem" onClick={() => { live.disconnect(); setSettingsOpen(false); }}><X size={17} />대화 종료</button>}</div>}
    </header>
      <div className="browser-next-stop"><div className="browser-destination"><strong>{state.arrival?.name || target?.name || state.route.title}</strong>{state.arrival && target && <span>도착 · 다음은 {target.name}</span>}</div>{target ? <button className="browser-primary browser-start" aria-label={startLabel} title={startLabel} disabled={!state.leg || liveState === 'connecting'} onClick={() => void startJourney()}>{state.driving ? <Pause size={18} /> : <Play size={18} />}</button> : <button className="browser-start" aria-label="다음 이동 준비" title="다음 이동 준비" onClick={onPhone}><Route size={19} /></button>}{state.leg && <div className="browser-eta"><strong>{minutes(remainingSeconds)}</strong><span>{distance(remainingMeters)}</span></div>}</div>
      {!detailsVisible && state.route.stops.length > state.targetIndex + 1 && <ol className="browser-upcoming" aria-label="이후 방문 순서">{state.route.stops.slice(state.targetIndex + 1, state.targetIndex + 3).map(stop => <li key={stop.id}><span aria-hidden="true" /><strong>{stop.name}</strong>{stop.time && <time>{stop.time}</time>}</li>)}</ol>}
      {proposal?.preview && <div className="browser-preview-label" role="status">변경안 미리보기 · 승인 전</div>}
      {state.roadError && <div className="browser-route-error" role="status"><p>{state.roadError}</p><button onClick={() => void journey.loadLeg()}>다시 계산</button></div>}
      <aside className="browser-sidebar">
        <label className="browser-route-select"><span>함께할 경로</span><select aria-label="경로 선택" value={state.route.id} onChange={e => void selectRoute(e.target.value)}>{plan.savedRoutes.map(r => <option key={r.id} value={r.id}>{r.title}</option>)}{!plan.savedRoutes.some(r => r.id === state.route.id) && <option value={state.route.id}>{state.route.title}</option>}</select></label>
        <div className="browser-tabs" role="tablist" aria-label="이동 준비"><button role="tab" aria-selected={tab === 'route'} onClick={() => setTab('route')}><Route size={17} />경로</button><button role="tab" aria-selected={tab === 'materials'} onClick={() => setTab('materials')}><FileText size={17} />자료</button><button role="tab" aria-selected={tab === 'memory'} onClick={() => setTab('memory')}>기억</button></div>
        <div className="browser-sidebar-content">
          {tab === 'route' && <>
            <h1>{target ? target.name + ' 가는 길' : '오늘의 경로를 마쳤어요'}</h1>
            <p className="browser-situation">{situationLabel[journey.situation]}</p>
            <form className="browser-goal" onSubmit={e => { e.preventDefault(); void run(() => { journey.setPreferences({ goal }); live.updateContext('사용자가 오늘의 이동 목적을 적었다. 이후 도움이 이 목적에 맞춰야 한다.'); setNotice('오늘의 목적을 기억했어요.'); }); }}><label htmlFor="browser-goal">오늘은 어떻게 함께 갈까요?</label><div><input id="browser-goal" value={goal} onChange={e => setGoal(e.target.value)} maxLength={300} placeholder="예: 미팅 준비에 집중하고 싶어" /><button aria-label="이동 목적 저장"><Check size={16} /></button></div></form>
            <ol className="browser-stops">{state.route.stops.map((stop, index) => <li key={stop.id} data-current={index === state.targetIndex} data-done={index < state.targetIndex}><span className="browser-stop-dot">{index < state.targetIndex ? <Check size={13} /> : index + 1}</span><div><strong>{stop.name}</strong>{stop.time && <span>{stop.time}</span>}{index === state.targetIndex && <small>다음 방문지</small>}</div>{!state.driving && index >= state.targetIndex && <div className="browser-stop-move"><button aria-label={stop.name + ' 방문 앞당기기'} disabled={busy || index === state.targetIndex} onClick={() => void moveStop(index, -1)}><ArrowUp size={15} /></button><button aria-label={stop.name + ' 방문 뒤로 옮기기'} disabled={busy || index === state.route.stops.length - 1} onClick={() => void moveStop(index, 1)}><ArrowDown size={15} /></button></div>}</li>)}</ol>
            <form className="browser-search" onSubmit={e => { e.preventDefault(); void search(); }}><label htmlFor="browser-place-search">가는 길에 들를 곳</label><div><input id="browser-place-search" value={query} onChange={e => setQuery(e.target.value)} placeholder="카페, 화장실, 장소 이름" maxLength={120} /><button type="submit" disabled={busy || !query.trim()}>검색</button></div></form>
            {busy && <p className="browser-secondary" role="status">확인하고 있어요…</p>}
            <ul className="browser-places">{state.places.map(place => <li key={place.id}><a href={place.source.url} target="_blank" rel="noreferrer"><strong>{place.name}</strong><span>{place.address}</span></a><button aria-label={place.name + ' 경유 제안'} disabled={busy} onClick={() => void propose(place.id)}><Plus size={19} /></button></li>)}</ul>
          </>}
          {tab === 'materials' && <>
            <h1>방문 전에 읽어둘 자료</h1><p className="browser-secondary">선택한 자료의 발췌를 Gemini와 대화할 때 사용해요. 원본은 이 브라우저에 보관해요.</p>
            <input type="file" accept=".pdf,.txt,.md,.csv,.json" ref={fileInput} onChange={e => void upload(e.target.files)} hidden multiple />
            <div className="browser-file-actions"><button className="browser-primary" disabled={busy} onClick={() => fileInput.current?.click()}><Plus size={17} />자료 추가</button><button disabled={busy} onClick={() => void importOriginals()}>준비한 원본 연결</button></div>
            <label className="browser-material-target">어느 방문지의 자료인가요?<select aria-label="자료를 연결할 방문지" value={materialStopId || target?.id || state.route.stops[0]?.id || ''} onChange={e => setMaterialStopId(e.target.value)}>{state.route.stops.map(stop => <option key={stop.id} value={stop.id}>{stop.name}</option>)}</select></label>
            {!state.materials.length && <p className="browser-empty">PDF나 메모를 연결하면 도착 전에 핵심을 짚어줄게요.</p>}
            <ul className="browser-materials">{state.materials.map(material => <li key={material.id}><label><input type="checkbox" checked={material.selected} disabled={!material.text} onChange={e => void run(() => { journey.selectMaterial(material.id, e.target.checked); if (!e.target.checked) resetConversation(); else live.updateContext('자료 선택이 변경됐다.'); })} /><strong>{material.name}</strong></label><span>{state.route.stops.find(stop => stop.id === material.stopId)?.name || (material.stopId ? '경로에서 제외된 방문지' : '경로 공통')} · {material.text ? '발췌 ' + material.text.length.toLocaleString() + '자' : '원본만 보관'}</span><div><button onClick={() => void run(() => downloadLocalMaterial(material.id))}>원본 받기</button><button onClick={() => void run(() => { journey.removeMaterial(material.id); resetConversation(); })}>연결 해제</button></div></li>)}</ul>
          </>}
          {tab === 'memory' && <>
            <h1>가는 길에 기억할 것</h1><p className="browser-secondary">이 경로에서 기억할 선호나 할 일을 적어 주세요.</p>
            {agent.tasks.length > 0 && <section className="browser-agent-tasks" aria-label="카멜레온이 챙기는 일"><h2>함께 챙기는 일</h2><ol>{agent.tasks.slice(-5).reverse().map(task => <li key={task.id}><strong>{task.goal}</strong><span>{agentStage[task.status]}</span></li>)}</ol></section>}
            <form className="browser-note-form" onSubmit={e => { e.preventDefault(); void run(() => { if (editingNote) { journey.updateNote(editingNote, note); agent.clearSensitive(); } else journey.addNote(note); setNote(''); setEditingNote(null); live.updateContext('사용자가 기억을 추가하거나 수정했다.'); }); }}><textarea aria-label="기억할 내용" placeholder="예: 커피는 디카페인으로" value={note} onChange={e => setNote(e.target.value)} maxLength={500} /><button className="browser-primary" disabled={!note.trim()}>{editingNote ? '기억 수정' : '기억하기'}</button>{editingNote && <button type="button" onClick={() => { setEditingNote(null); setNote(''); }}>수정 취소</button>}</form>
            {!state.notes.length && <p className="browser-empty">“이거 기억해줘”라고 말해도 돼요.</p>}
            <ul className="browser-notes">{state.notes.map(item => <li key={item.id}><span>{item.text}</span><button aria-label={item.text + ' 기억 수정'} onClick={() => { setEditingNote(item.id); setNote(item.text); }}>수정</button><button aria-label={item.text + ' 기억 삭제'} onClick={() => void run(() => { journey.forget(item.id); agent.clearSensitive(); live.updateContext('사용자가 기억을 삭제했다.'); })}><Trash2 size={16} /></button></li>)}</ul>
          </>}
        </div>
      </aside>
      <section className="browser-agent" aria-label="카멜레온 음성 대화" data-management={detailsVisible} data-expanded={showCaptions && messages.length > 0 || !!proposal || textOpen || sourcesOpen || !!error || !!notice} data-encounter-distance={companion.lastCue?.encounterEvidence?.distanceMeters} data-encounter-side={companion.lastCue?.encounterEvidence?.side} data-encounter-progress={companion.lastCue?.encounterEvidence?.progress} data-companion-status={companion.status} data-ready-cues={companion.cues.filter(cue => cue.state === 'ready').length} data-situation={journey.situation} data-agent-phase={agent.phase} data-agent-task={agent.current?.status || 'none'}>
        <div className="browser-wave" data-phase={phase} style={{ '--mic-level': level } as React.CSSProperties}><KotlinAgentWave phase={phase} dark={dark} inputLevel={level} />{(liveState === 'connecting' || liveState === 'error') && <p role="status">{labels[liveState]}</p>}</div>
        {proactiveStatus && <div className="browser-proactive-status" role="status"><span>{proactiveStatus}</span>{preparationFailed && agent.phase !== 'planning' && <button onClick={() => { companion.clear(); setPreparationEpoch(value => value + 1); }}>다시 준비</button>}</div>}
        {showCaptions ? <div className="browser-conversation" data-expanded={historyOpen} ref={log} role="log" aria-label="대화 기록">{visibleMessages.map(message => <p key={message.id} data-role={message.role}><span>{message.role === 'user' ? '나' : '카멜레온'}</span>{message.text}</p>)}</div> : <div className="browser-silence" />}
        {sourcesOpen && <CueSources cue={companion.lastCue} />}
        {proposal && <div className="browser-proposal" role="region" aria-label="경로 변경 확인"><strong>{proposal.action === 'skip' ? proposal.label + ' 건너뛰기' : proposal.label}</strong>{proposal.afterNames && <p className="browser-path-diff"><span>현재 · {proposal.beforeNames?.join(' → ')}</span><span>변경 · {proposal.afterNames.join(' → ')}</span></p>}<p>{proposal.action === 'route' ? '전체 이동 약 ' + minutes(proposal.preview?.durationSeconds || 0) + ' · ' + distance(proposal.distanceMeters) + ' · 체류 시간 제외' : proposal.action === 'skip' ? '나머지 방문 순서는 유지돼요.' : (Math.abs(proposal.extraSeconds) < 30 ? '이동 시간 차이 1분 미만' : '약 ' + minutes(Math.abs(proposal.extraSeconds)) + (proposal.extraSeconds < 0 ? ' 단축' : ' 추가')) + ' · 체류 시간 제외'}</p><div><button onClick={() => void decide('cancel')}>그대로 가기</button><button className="browser-primary" onClick={() => void decide('approve')}><Check size={17} />{proposal.action === 'route' ? '변경 적용' : proposal.action === 'skip' ? '건너뛰기' : '들렀다 가기'}</button></div></div>}
        {error && <div className="browser-error" role="alert"><span>{error}</span><button onClick={() => setError('')} aria-label="오류 안내 닫기"><X size={17} /></button></div>}
        {notice && <div className="browser-notice" role="status"><span>{notice}</span><button onClick={() => setNotice('')} aria-label="안내 닫기"><X size={15} /></button></div>}
        {journey.canUndo && <button className="browser-undo" onClick={() => void run(() => { journey.undo(); setNotice('원래 경로로 돌아왔어요.'); live.updateContext('사용자가 마지막 경로 변경을 되돌렸다.', true); })}><Undo2 size={15} />방금 변경 되돌리기</button>}
        {capabilities && !capabilities.liveConfigured && <p className="browser-config-note">Gemini 키 설정 후 개발 서버를 다시 시작해 주세요.</p>}
        <div className="browser-voice-controls">
          {!live.connected ? <button className="browser-primary" aria-label="대화 시작" title="대화 시작" onClick={() => void connect()} disabled={liveState === 'connecting'}><Mic size={19} /></button> : <button aria-label={mic ? '마이크 켜짐' : '마이크 꺼짐'} title={mic ? '마이크 끄기' : '마이크 켜기'} className={mic ? 'browser-mic-active' : ''} onClick={() => void run(async () => { await live.setMicrophone(!mic); setMic(live.micEnabled); })} aria-pressed={mic}>{mic ? <Mic size={18} /> : <MicOff size={18} />}</button>}
          {liveState === 'speaking' && <button aria-label="말하는 중지" title="말하는 중지" onClick={() => live.stopSpeaking()}><VolumeX size={19} /></button>}
          <button aria-label="글로 대화하기" title="글로 대화하기" aria-pressed={textOpen} onClick={() => setTextOpen(v => !v)}><Keyboard size={19} /></button>
        </div>
        {textOpen && <form className="browser-chat-form" onSubmit={e => { e.preventDefault(); void run(() => sendText(text)); }}><input aria-label="카멜레온에게 메시지" value={text} onChange={e => setText(e.target.value)} placeholder="카멜레온에게 말하기" maxLength={2000} /><button aria-label="메시지 보내기" disabled={!text.trim() || liveState === 'connecting'}><Send size={18} /></button></form>}
      </section>
      </section>
    </main>
  </div><aside className="carmeleon-demo-tools" aria-label="앱 외부 시연 도구">
    <button className="carmeleon-demo-toggle" aria-label="시연 조절" aria-expanded={demoOpen} onClick={() => setDemoOpen(v => !v)} title="시연 도구 · 차량 앱 외부"><Settings2 size={14} />시연</button>
    {demoOpen && <div className="carmeleon-demo-popover"><header><strong>시연 도구</strong><button aria-label="시연 도구 닫기" onClick={() => setDemoOpen(false)}><X size={14} /></button></header><p>차량 앱 외부 · 도로 위치 재생</p><label>속도<select aria-label="모의 주행 속도" value={speedMode} onChange={e => setSpeedMode(e.target.value)}><option value="companion">동행 시연 · 자동</option><option value="1">1배</option><option value="30">30배</option><option value="120">120배</option></select></label><output aria-label="시연 시각">{new Date(state.worldTime).toLocaleTimeString('ko-KR', { timeZone: 'Asia/Seoul', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })}</output><div><button disabled={!target} onClick={() => void run(() => journey.arrive())}>모의 도착<ChevronRight size={14} /></button><button disabled={busy} onClick={() => void restart()}><RotateCcw size={14} />처음부터 보기</button></div><small>자동 모드는 조사·대화 중 천천히 이동해요.</small></div>}
  </aside></>;
}
