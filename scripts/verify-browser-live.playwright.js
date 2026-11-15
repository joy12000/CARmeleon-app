// Playwright function. Real Google/Kakao calls: requires local .env and a running demo server.
// This creates its own context and never writes to the user's browser storage.
async (page) => {
  const followup = page.url().includes('followup=1');
  const context = await page.context().browser().newContext({ viewport: { width: 1440, height: 900 } });
  const p = await context.newPage();
  const checks = [];
  const verify = (name, ok, detail) => { if (!ok) throw new Error(name + ': ' + JSON.stringify(detail)); checks.push({ name, detail }); };
  const errors = [];
  p.on('pageerror', () => errors.push('runtime_error'));
  const fixtureRoute = { id: 'browser-live-test', title: '판교에서 강남으로', date: '2099-01-01', isActiveInCar: false,
    stops: [{ id: 'first', name: '판교역', latitude: 37.3948, longitude: 127.1119 }, { id: 'last', name: '강남역', latitude: 37.4979, longitude: 127.0276 }] };
  if (followup) { fixtureRoute.title = '수원 여행'; fixtureRoute.isTravel = true; fixtureRoute.stops[0] = { id: 'first', name: '수원화성', latitude: 37.2868, longitude: 127.0134 }; }
  const fixture = { carPlateNumber: '시연', carModel: 'fixture', batteryOrFuelPercent: 80, isEngineOn: false,
    activeRoute: fixtureRoute, savedRoutes: [fixtureRoute], shortcuts: [{ id: 'home', keyword: '집', name: '모의 출발점', address: '판교', latitude: 37.4013, longitude: 127.1086, icon: 'home' }] };
  await context.addInitScript(data => {
    if (!localStorage.getItem('carmeleon_plan_active_v3')) localStorage.setItem('carmeleon_plan_active_v3', JSON.stringify(data));
    window.__liveTest = { inputChunks: 0, audioChunks: 0, interruptions: 0, toolCalls: 0, tracks: [], ready: false };
    const Original = window.WebSocket;
    window.WebSocket = class extends Original {
      constructor(url, protocols) {
        super(url, protocols);
        this.addEventListener('message', async event => {
          try {
            const value = JSON.parse(typeof event.data === 'string' ? event.data : await event.data.text());
            const content = value.serverContent || value.server_content;
            if (content?.interrupted) window.__liveTest.interruptions++;
            for (const part of content?.modelTurn?.parts || content?.model_turn?.parts || [])
              if (part.inlineData?.data || part.inline_data?.data) window.__liveTest.audioChunks++;
            window.__liveTest.toolCalls += (value.toolCall?.functionCalls || value.tool_call?.function_calls || []).length;
          } catch {}
        });
      }
      send(data) {
        try { const value = JSON.parse(data); if (value.realtimeInput?.audio || value.realtime_input?.audio) window.__liveTest.inputChunks++; } catch {}
        return super.send(data);
      }
    };
    // Test audio enters through the real getUserMedia -> AudioWorklet -> PCM path.
    navigator.mediaDevices.getUserMedia = async () => {
      const audio = new AudioContext({ sampleRate: 24000 }); await audio.resume();
      const destination = audio.createMediaStreamDestination();
      const raw = await fetch('/.playwright-mcp/live-input-test.wav').then(r => r.arrayBuffer());
      const buffer = await audio.decodeAudioData(raw);
      const silent = audio.createOscillator(), gain = audio.createGain(); gain.gain.value = 0;
      silent.connect(gain); gain.connect(destination); silent.start();
      window.__liveTest.tracks.push(...destination.stream.getTracks());
      window.__liveTest.play = () => { const source = audio.createBufferSource(); source.buffer = buffer; source.connect(destination); source.start(); };
      window.__liveTest.ready = true;
      return destination.stream;
    };
  }, fixture);
  const talk = async text => {
    await p.getByRole('textbox', { name: '카멜레온에게 메시지' }).fill(text);
    await p.getByRole('button', { name: '메시지 보내기', exact: true }).click();
  };
  const waitIdle = async () => { await p.locator('.browser-wave[data-phase="LISTENING"]').waitFor({ timeout: 30000 }); };
  try {
    await p.goto('http://127.0.0.1:5173/?mode=fallback&verification=live');
    await p.getByRole('button', { name: '모의 주행 시작', exact: true }).waitFor({ state: 'visible' });
    const status = await p.request.get('http://127.0.0.1:5173/api/fallback/status').then(r => r.json());
    verify('live_model_configured', status.liveConfigured, { model: status.model });
    if (followup) {
      if (!page.url().includes('proactiveOnly=1')) {
      await p.getByRole('tab', { name: '자료', exact: true }).click();
      await p.locator('input[type=file]').setInputFiles('C:/CARmeleon/.playwright-mcp/live-material-test.pdf');
      await p.getByText('live-material-test.pdf', { exact: true }).waitFor();
      await p.waitForFunction(() => localStorage.getItem('carmeleon_browser_context_v1')?.includes('PROJECT_BUDGET_307'), undefined, { timeout: 20000 });
      verify('real_pdf_worker_extracts_original', true, {});
      await talk('연결된 PDF에 있는 예산 숫자와 계약 개월을 한국어로 짧게 읽어줘.');
      await p.waitForFunction(() => { const text = document.querySelector('[aria-label="대화 기록"]')?.textContent || ''; return text.includes('307') && text.includes('11'); }, undefined, { timeout: 30000 });
      await waitIdle(); verify('live_pdf_source_answer', true, {});
      await p.getByRole('button', { name: '마이크 꺼짐', exact: true }).click();
      await p.waitForFunction(() => window.__liveTest.ready && window.__liveTest.inputChunks > 5);
      await talk('현재 경로와 여행 준비 방법을 20초 정도 자세히 설명해줘.');
      await p.locator('[data-phase="SPEAKING"]').waitFor({ timeout: 25000 });
      const baseline = await p.evaluate(() => window.__liveTest.interruptions);
      await p.evaluate(() => window.__liveTest.play());
      await p.waitForFunction(b => window.__liveTest.interruptions > b, baseline, { timeout: 20000 });
      await p.waitForFunction(() => document.querySelector('[aria-label="대화 기록"]')?.textContent?.includes('잠깐'), undefined, { timeout: 20000 });
      verify('new_audio_causes_new_interruption', true, await p.evaluate(b => ({ baseline: b, observed: window.__liveTest.interruptions, inputChunks: window.__liveTest.inputChunks }), baseline));
      await waitIdle();
      await p.getByRole('button', { name: '마이크 켜짐', exact: true }).click();
      verify('mic_toggle_stops_tracks_while_session_stays_connected', await p.evaluate(() => window.__liveTest.tracks.every(t => t.readyState === 'ended')), {});
      } else { await talk('여행을 함께할 준비가 됐다고 한 문장으로 말해줘.'); await p.locator('[data-phase="SPEAKING"]').waitFor({ timeout: 25000 }); await waitIdle(); }
      await p.getByRole('tab', { name: '경로', exact: true }).click();
      await p.getByLabel('모의 주행 속도').selectOption('120');
      const beforeAudio = await p.evaluate(() => {
        const original = Date.now; Date.now = () => original() + 31000;
        return window.__liveTest.audioChunks;
      });
      await p.getByRole('button', { name: '모의 주행 시작', exact: true }).click();
      const originalMinutes = Number.parseFloat(await p.locator('.browser-eta strong').innerText());
      await p.waitForFunction(original => {
        const value = Number.parseFloat(document.querySelector('.browser-eta strong')?.textContent || '');
        return value <= original * 0.6;
      }, originalMinutes, { timeout: 20000 });
      await p.getByLabel('모의 주행 속도').selectOption('30');
      await p.waitForFunction(n => window.__liveTest.audioChunks > n, beforeAudio, { timeout: 45000 });
      verify('route_approach_speaks_without_a_user_prompt', true, {});
      await p.getByRole('button', { name: '모의 도착', exact: true }).click();
      await p.getByRole('button', { name: '대화 종료', exact: true }).click();
      await p.getByRole('tab', { name: '기억', exact: true }).click();
      await p.getByRole('textbox', { name: '기억할 내용' }).fill('디카페인');
      await p.getByRole('button', { name: '기억하기', exact: true }).click();
      await p.getByRole('button', { name: '디카페인 기억 수정', exact: true }).click();
      await p.getByRole('textbox', { name: '기억할 내용' }).fill('라테는 디카페인');
      await p.getByRole('button', { name: '기억 수정', exact: true }).click();
      verify('memory_edit_updates_same_record', await p.evaluate(() => { const state = JSON.parse(localStorage.getItem('carmeleon_browser_context_v1'))['browser-live-test']; return state.notes.length === 1 && state.notes[0].text === '라테는 디카페인'; }), {});
      await p.getByRole('button', { name: '라테는 디카페인 기억 삭제', exact: true }).click();
      verify('memory_delete', await p.evaluate(() => JSON.parse(localStorage.getItem('carmeleon_browser_context_v1'))['browser-live-test'].notes.length === 0), {});
      verify('no_followup_runtime_errors', errors.length === 0, { errors: errors.length });
      return { status: 'PASS', checks, realExternalCalls: true, injectedSpeech: true, physicalMicrophone: 'NOT_RUN' };
    }
    await talk('내 다음 방문지를 확인해서 한 문장으로 알려줘.');
    await waitIdle();
    await p.waitForFunction(() => document.querySelector('[aria-label="대화 기록"]')?.textContent?.includes('판교역'), { timeout: 25000 });
    verify('live_context_and_streamed_audio', await p.evaluate(() => window.__liveTest.audioChunks > 0), {});
    await talk('커피는 디카페인으로 마신다는 걸 기억 도구로 저장해줘.');
    await p.waitForFunction(() => localStorage.getItem('carmeleon_browser_context_v1')?.includes('디카페인'), { timeout: 25000 });
    await waitIdle(); verify('model_memory_tool_writes_storage', true, {});
    await talk('지금 위치 주변 카페를 실제로 찾아 하나만 경유 변경안으로 제안해줘. 아직 적용하지 마.');
    await p.getByRole('region', { name: '경로 변경 확인' }).waitFor({ timeout: 30000 });
    const before = await p.evaluate(() => JSON.parse(localStorage.getItem('carmeleon_plan_active_v3')).activeRoute.stops.length);
    verify('proposal_before_approval_keeps_route', before === 2, { stops: before });
    await p.screenshot({ path: 'C:/CARmeleon/verification/screenshots/browser-live-proposal.png' });
    await waitIdle(); await talk('응');
    await p.waitForFunction(() => JSON.parse(localStorage.getItem('carmeleon_plan_active_v3')).activeRoute.stops.length === 3, { timeout: 30000 });
    await waitIdle(); verify('fresh_spoken_text_approval_applies_real_place', true, {});
    await p.getByRole('tab', { name: '자료', exact: true }).click();
    await p.locator('input[type=file]').setInputFiles('C:/CARmeleon/.playwright-mcp/live-material-test.txt');
    await p.getByText('live-material-test.txt', { exact: true }).waitFor();
    await talk('방금 연결한 live-material-test.txt 원문 발췌에서 미팅 예산과 계약 기간을 읽어줘.');
    await p.waitForFunction(() => {
      const text = document.querySelector('[aria-label="대화 기록"]')?.textContent || '';
      return text.includes('307') && text.includes('11');
    }, { timeout: 25000 });
    await waitIdle(); verify('real_uploaded_original_context_answer', true, {});
    await p.getByRole('button', { name: '마이크 꺼짐', exact: true }).click();
    await p.waitForFunction(() => window.__liveTest.ready && window.__liveTest.inputChunks > 5, { timeout: 15000 });
    await talk('방문 경로와 준비 방법을 자세히 20초 정도 이야기해줘.');
    await p.locator('[data-phase="SPEAKING"]').waitFor({ timeout: 25000 });
    const previousInterruptions = await p.evaluate(() => window.__liveTest.interruptions);
    await p.evaluate(() => window.__liveTest.play());
    await p.waitForFunction(baseline => window.__liveTest.interruptions > baseline, previousInterruptions, { timeout: 20000 });
    await p.waitForFunction(() => document.querySelector('[aria-label="대화 기록"]')?.textContent?.includes('잠깐'), { timeout: 20000 });
    verify('microphone_worklet_and_server_barge_in', true, await p.evaluate(() => ({ inputChunks: window.__liveTest.inputChunks, audioChunks: window.__liveTest.audioChunks, interruptions: window.__liveTest.interruptions, toolCalls: window.__liveTest.toolCalls })));
    await p.getByRole('button', { name: '대화 종료', exact: true }).click();
    verify('disconnect_stops_all_owned_tracks', await p.evaluate(() => window.__liveTest.tracks.every(t => t.readyState === 'ended')), {});
    await p.getByRole('tab', { name: '경로', exact: true }).click();
    await p.reload();
    await p.getByRole('button', { name: '모의 주행 시작', exact: true }).waitFor();
    verify('approved_path_survives_reload', await p.evaluate(() => JSON.parse(localStorage.getItem('carmeleon_plan_active_v3')).activeRoute.stops.length === 3), {});
    await p.getByRole('button', { name: '야간 화면', exact: true }).click();
    await p.screenshot({ path: 'C:/CARmeleon/verification/screenshots/browser-live-dark.png' });
    verify('dark_theme', await p.locator('.browser-cockpit').getAttribute('data-theme') === 'dark', {});
    for (const width of [1440, 1024, 768, 390]) {
      await p.setViewportSize({ width, height: 900 });
      verify('no_horizontal_overflow_' + width, await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), {});
    }
    await p.setViewportSize({ width: 1440, height: 900 });
    await p.screenshot({ path: 'C:/CARmeleon/verification/screenshots/browser-live-final.png' });
    verify('no_runtime_exceptions', errors.length === 0, { errors: errors.length });
    return { status: 'PASS', checks, realExternalCalls: true, physicalMicrophone: 'NOT_RUN', injectedSpeech: true };
  } catch (error) {
    await p.screenshot({ path: 'C:/CARmeleon/verification/screenshots/browser-live-failure.png' }).catch(() => {});
    return { status: 'FAIL', checks, failure: String(error), lastUi: (await p.locator('body').innerText()).slice(-2400), counters: await p.evaluate(() => ({ inputChunks: window.__liveTest?.inputChunks, audioChunks: window.__liveTest?.audioChunks, interruptions: window.__liveTest?.interruptions, toolCalls: window.__liveTest?.toolCalls })) };
  } finally { await context.close(); }
}
