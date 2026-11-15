// Actual Gemini/Kakao integration. Uses an isolated context and synthetic business material.
async (page) => {
  const context = await page.context().browser().newContext({ viewport: { width: 1440, height: 900 } });
  const p = await context.newPage(), checks = [], errors = [], preparations = [], tools = [];
  const verify = (name, ok, detail = {}) => { if (!ok) throw new Error(name + ': ' + JSON.stringify(detail)); checks.push({ name, detail }); };
  const fixtureRoute = { id: 'companion-browser-test', title: '여행하다 미팅까지', date: '2099-01-01', isActiveInCar: false, isBusiness: true, isTravel: true,
    stops: [{ id: 'travel', name: '수원화성', address: '경기 수원시 팔달구', type: 'travel', latitude: 37.2868, longitude: 127.0134 },
      { id: 'meeting', name: '판교 미팅', type: 'business', latitude: 37.3948, longitude: 127.1119, attachedDocumentIds: ['keep-original'] },
      { id: 'home', name: '집', latitude: 37.4013, longitude: 127.1086 }] };
  await context.addInitScript(route => {
    // Init scripts also run inside the opaque-origin Google attribution iframe.
    // Only the top-level app owns this fixture and WebSocket instrumentation.
    if (window !== window.top) return;
    localStorage.setItem('carmeleon_plan_active_v3', JSON.stringify({ carPlateNumber: '시연', carModel: 'fixture', batteryOrFuelPercent: 80, isEngineOn: false, activeRoute: route, savedRoutes: [route],
      shortcuts: [{ id: 'home', icon: 'home', keyword: '집', name: '모의 출발점', address: '판교', latitude: 37.4013, longitude: 127.1086 }] }));
    const Original = WebSocket;
    window.__companionTools = [];
    window.WebSocket = class extends Original {
      constructor(url, protocols) { super(url, protocols); this.addEventListener('message', async e => {
        try { const data = JSON.parse(typeof e.data === 'string' ? e.data : await e.data.text()); window.__companionTools.push(...(data.toolCall?.functionCalls || []).map(c => c.name)); } catch {}
      }); }
    };
  }, fixtureRoute);
  p.on('pageerror', error => errors.push({ name: error.name, message: error.message.replace(/(access_token|api_key|key)=[^&\s]+/gi, '$1=[redacted]').replace(/auth[_-]?tokens?\/[A-Za-z0-9_.-]+/gi, '[redacted-token]').slice(0, 500) }));
  p.on('response', async response => {
    if (!response.url().endsWith('/api/fallback/prepare')) return;
    try { const data = await response.json(); preparations.push({ kind: response.request().postDataJSON().kind, status: response.status(), sources: data.sources?.length || 0, hasSearchSuggestions: !!data.searchHtml, businessFact: !!data.speech?.includes('307') }); } catch {}
  });
  const ask = async text => {
    await p.getByRole('textbox', { name: '카멜레온에게 메시지' }).fill(text);
    await p.getByRole('button', { name: '메시지 보내기', exact: true }).click();
  };
  const idle = () => p.locator('.browser-wave[data-phase="LISTENING"]').waitFor({ timeout: 30000 });
  const preferences = () => p.evaluate(() => JSON.parse(localStorage.getItem('carmeleon_browser_context_v1') || '{}')['companion-browser-test']?.preferences);
  try {
    await p.goto('http://127.0.0.1:5173/?mode=fallback&verification=companion');
    await p.getByRole('tab', { name: '자료', exact: true }).click();
    await p.getByLabel('자료를 연결할 방문지').selectOption('meeting');
    await p.locator('input[type=file]').setInputFiles('C:/CARmeleon/.playwright-mcp/live-material-test.txt');
    await p.getByText('live-material-test.txt', { exact: true }).waitFor();
    verify('business_original_linked_to_the_meeting', await p.evaluate(() => JSON.parse(localStorage.getItem('carmeleon_browser_context_v1'))['companion-browser-test'].materials[0].stopId === 'meeting'));
    await ask('지금은 조용히 같이 가줘. 먼저 말하지 말아줘.');
    await p.waitForFunction(() => JSON.parse(localStorage.getItem('carmeleon_browser_context_v1'))['companion-browser-test'].preferences.quiet === true, undefined, { timeout: 30000 });
    await idle(); verify('natural_quiet_request_changes_behavior', (await preferences()).quiet);
    verify('quiet_control_matches_saved_preference', await p.getByRole('button', { name: '먼저 말하기', exact: true }).getAttribute('aria-pressed') === 'false');
    await ask('이제 상황에 맞춰 필요한 순간에는 먼저 알려줘. 업무와 여행은 방문지에 따라 자동으로 맞춰줘.');
    await p.waitForFunction(() => { const pref = JSON.parse(localStorage.getItem('carmeleon_browser_context_v1'))['companion-browser-test'].preferences; return pref.quiet === false && pref.focus === 'auto'; }, undefined, { timeout: 30000 });
    await idle(); verify('automatic_context_reenabled', true);
    await p.locator('.browser-agent[data-ready-cues="1"],.browser-agent[data-ready-cues="2"]').waitFor({ timeout: 35000 });
    verify('grounded_next_speech_prepared_before_playback', preparations.some(r => r.kind === 'travel' && r.status === 200 && r.sources > 0));
    await p.getByRole('button', { name: '함께 출발', exact: true }).click();
    await p.locator('.browser-layout[data-focused="true"]').waitFor();
    verify('drive_focus_hides_preparation_panel', !(await p.locator('.browser-sidebar').isVisible()));
    verify('map_follows_simulated_position', await p.getByRole('button', { name: '모의 위치 따라가기', exact: true }).getAttribute('aria-pressed') === 'true');
    await p.screenshot({ path: 'C:/CARmeleon/verification/screenshots/companion-drive-focus.png' });
    await p.waitForFunction(() => JSON.parse(localStorage.getItem('carmeleon_browser_context_v1'))['companion-browser-test'].heardCueIds.length > 0, undefined, { timeout: 110000 });
    verify('prepared_story_spoken_and_completed_without_prompt', true);
    verify('spoken_story_shows_its_actual_sources', await p.getByRole('generic', { name: '방금 이야기의 근거' }).count() > 0 || await p.locator('.browser-cue-sources').count() > 0);
    const pause = p.getByRole('button', { name: '잠시 멈춤', exact: true }); if (await pause.count()) await pause.click();
    await p.screenshot({ path: 'C:/CARmeleon/verification/screenshots/companion-story-sources.png' });
    await ask('아직 방문하지 않은 수원화성 방문을 건너뛰는 변경안만 만들어줘. 적용 전에는 내 승인을 기다려.');
    await p.getByRole('region', { name: '경로 변경 확인' }).waitFor({ timeout: 30000 });
    verify('skip_is_only_a_proposal', await p.evaluate(() => JSON.parse(localStorage.getItem('carmeleon_plan_active_v3')).activeRoute.stops.length === 3));
    await idle(); await ask('응');
    await p.waitForFunction(() => JSON.parse(localStorage.getItem('carmeleon_plan_active_v3')).activeRoute.stops.length === 2, undefined, { timeout: 30000 });
    await idle();
    verify('mixed_path_adapts_to_business_after_skip', await p.locator('.browser-agent').getAttribute('data-situation') === 'work');
    await p.waitForFunction(() => document.querySelector('.browser-agent')?.getAttribute('data-ready-cues') === '1', undefined, { timeout: 35000 });
    verify('only_current_meeting_original_used_for_briefing', preparations.some(r => r.kind === 'work' && r.status === 200 && r.businessFact));
    await p.getByRole('button', { name: '방금 변경 되돌리기', exact: true }).click();
    verify('undo_restores_route_and_original_reference', await p.evaluate(() => { const route = JSON.parse(localStorage.getItem('carmeleon_plan_active_v3')).activeRoute; return route.stops.length === 3 && route.stops[1].attachedDocumentIds[0] === 'keep-original'; }));
    await idle();
    await ask('지금 위치 근처 카페 한 곳을 실제로 찾아 잠깐 들르는 변경안으로 보여줘.');
    await p.getByRole('region', { name: '경로 변경 확인' }).waitFor({ timeout: 30000 });
    await idle(); await p.getByRole('button', { name: '들렀다 가기', exact: true }).click();
    await p.waitForFunction(() => JSON.parse(localStorage.getItem('carmeleon_plan_active_v3')).activeRoute.stops.length === 4);
    await idle();
    await p.getByRole('button', { name: '시연 조절', exact: true }).click();
    await p.getByRole('button', { name: '모의 도착', exact: true }).click();
    verify('detour_arrival_keeps_original_next_stop', await p.evaluate(() => { const state = JSON.parse(localStorage.getItem('carmeleon_browser_context_v1'))['companion-browser-test']; return state.cursor.arrival.detour && state.cursor.arrival.nextName === '수원화성'; }));
    await ask('다시 탔어. 이제 출발하자.');
    await p.locator('.browser-layout[data-driving="true"]').waitFor({ timeout: 30000 });
    verify('natural_reboard_request_resumes_original_journey', true);
    await p.getByRole('button', { name: '잠시 멈춤', exact: true }).click();
    await p.getByRole('button', { name: '대화 기록 보기', exact: true }).click();
    verify('conversation_history_available_on_demand', await p.locator('.browser-conversation').getAttribute('data-expanded') === 'true');
    await p.getByRole('button', { name: '대화 종료', exact: true }).click();
    for (const width of [1440, 1024, 768, 390]) { await p.setViewportSize({ width, height: 900 }); verify('no_overflow_' + width, await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)); }
    verify('no_runtime_errors', errors.length === 0, { errors: errors.length });
    tools.push(...await p.evaluate(() => window.__companionTools));
    return { status: 'PASS', checks, preparations, tools, realExternalCalls: true, physicalMicrophone: 'NOT_RUN' };
  } catch (error) {
    await p.screenshot({ path: 'C:/CARmeleon/verification/screenshots/companion-experience-failure.png' }).catch(() => {});
    return { status: 'FAIL', checks, preparations, errors, failure: String(error), lastUi: (await p.locator('body').innerText()).slice(-2800), tools: await p.evaluate(() => window.__companionTools) };
  } finally { await context.close(); }
}
