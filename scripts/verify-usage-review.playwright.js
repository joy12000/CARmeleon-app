// Actual external APIs, isolated synthetic route, no physical microphone captured.
async (page) => {
  const context = await page.context().browser().newContext({ viewport: { width: 1440, height: 900 } });
  const p = await context.newPage(), checks = [], errors = [], calls = [], searches = [];
  const route = { id: 'usage-review', title: '검토용 미팅 경로', date: '2099-01-01', isBusiness: true, isActiveInCar: false, stops: [
    { id: 'meeting1', name: '판교 미팅', type: 'business', latitude: 37.3948, longitude: 127.1119, attachedDocumentIds: ['preserve-original'] },
    { id: 'meeting2', name: '다음 미팅', type: 'business', latitude: 37.501, longitude: 127.0396 },
    { id: 'home', name: '집', latitude: 37.4013, longitude: 127.1086 },
  ] };
  await context.addInitScript(route => {
    if (window !== top) return;
    localStorage.setItem('carmeleon_plan_active_v3', JSON.stringify({ carPlateNumber: 'TEST', carModel: 'fixture', batteryOrFuelPercent: 80, isEngineOn: false, activeRoute: route, savedRoutes: [route, { ...route, id: 'separate-route', title: '다른 여정' }], shortcuts: [{ id: 'home', icon: 'home', keyword: '집', name: '모의 집', address: '판교', latitude: 37.4013, longitude: 127.1086 }] }));
    // Preserve real Google audio output; deliberately deny capture to exercise usable recovery.
    navigator.mediaDevices.getUserMedia = async () => { throw new DOMException('Fixture denies microphone', 'NotAllowedError'); };
    const Original = WebSocket;
    window.__usageTools = [];
    window.WebSocket = class extends Original { constructor(url, protocols) { super(url, protocols); this.addEventListener('message', async e => { try { const data = JSON.parse(typeof e.data === 'string' ? e.data : await e.data.text()); window.__usageTools.push(...(data.toolCall?.functionCalls || []).map(c => c.name)); } catch {} }); } };
  }, route);
  p.on('pageerror', e => errors.push(e.name + ': ' + e.message.slice(0, 250)));
  p.on('request', request => { if (request.url().endsWith('/api/fallback/places')) { const data = request.postDataJSON(); searches.push({ query: data.query, scope: data.scope || 'nearby' }); } });
  const verify = (name, condition) => { if (!condition) throw new Error(name); checks.push(name); };
  const plan = () => p.evaluate(() => JSON.parse(localStorage.getItem('carmeleon_plan_active_v3')).activeRoute);
  const ask = async text => { await p.getByRole('textbox', { name: '카멜레온에게 메시지' }).fill(text); await p.getByRole('button', { name: '메시지 보내기', exact: true }).click(); };
  const idle = () => p.locator('.browser-wave[data-phase="LISTENING"]').waitFor({ timeout: 30000 });
  try {
    await p.goto('http://127.0.0.1:5173/?mode=fallback&verification=usage-review');
    await p.getByRole('button', { name: '함께 출발', exact: true }).waitFor();
    verify('voice_captions_default_off_without_fixed_explanation', await p.locator('.browser-conversation').count() === 0 && await p.getByRole('button', { name: '대화 자막', exact: true }).getAttribute('aria-pressed') === 'false');
    await p.getByRole('tab', { name: '자료', exact: true }).click();
    await p.getByLabel('자료를 연결할 방문지').selectOption('meeting2');
    await p.locator('input[type=file]').setInputFiles('C:/CARmeleon/.playwright-mcp/live-material-test.txt');
    await p.getByText('live-material-test.txt', { exact: true }).waitFor();
    await ask('다음 미팅에 붙인 live-material-test.txt 원문에서 제안 금액이 얼마인지 읽고 알려줘.');
    await p.waitForFunction(() => document.querySelector('.browser-conversation')?.textContent?.includes('307'), undefined, { timeout: 40000 });
    await idle();
    verify('future_stop_original_is_read_only_when_asked', (await p.evaluate(() => window.__usageTools)).includes('read_material'));
    await p.getByRole('tab', { name: '경로', exact: true }).click();
    await ask('오늘은 서울 여행이야. 용산역에 갔다가 여의도공원 들르고 집에 가고 싶어. 기존 미팅 일정 대신 이 순서로 바꾸는 변경안을 만들어줘.');
    await p.getByRole('region', { name: '경로 변경 확인' }).waitFor({ timeout: 65000 });
    await idle();
    verify('natural_multi_stop_request_makes_a_complete_proposal', (await p.locator('.browser-proposal').innerText()).includes('용산') && (await p.locator('.browser-proposal').innerText()).includes('여의도'));
    verify('named_places_are_searched_outside_nearby_radius', searches.filter(s => s.scope === 'name').length >= 2);
    verify('proposal_has_actual_road_preview_and_before_after_order', await p.locator('.browser-map[data-preview="true"]').count() === 1 && (await p.locator('.browser-proposal').innerText()).includes('현재 ·'));
    await p.waitForFunction(() => [...document.querySelectorAll('.browser-map-canvas .route-map-pin')].some(pin => pin.title.includes('용산')), undefined, { timeout: 15000 });
    verify('proposal_markers_match_new_visits', await p.locator('.browser-map-canvas .route-map-pin[title*="여의도"]').count() > 0 && await p.locator('.browser-map-canvas .route-map-pin[title*="미팅"]').count() === 0);
    verify('wave_status_does_not_overlap_captions', await p.evaluate(() => document.querySelector('.browser-wave').getBoundingClientRect().bottom <= document.querySelector('.browser-conversation').getBoundingClientRect().top + 1));
    verify('unapproved_plan_is_unchanged', (await plan()).stops[0].id === 'meeting1');
    await p.screenshot({ path: 'C:/CARmeleon/verification/screenshots/usage-route-proposal.png' });
    await ask('응 그렇게 바꿔줘');
    await p.waitForFunction(() => JSON.parse(localStorage.getItem('carmeleon_plan_active_v3')).activeRoute.stops[0].name.includes('용산'), undefined, { timeout: 30000 });
    verify('fresh_natural_approval_applies_exact_planned_order', (await plan()).stops[1].name.includes('여의도') && (await plan()).stops[2].name === '집');
    await idle();
    await p.getByRole('button', { name: '방금 변경 되돌리기', exact: true }).click();
    verify('undo_preserves_original_document_references', (await plan()).stops[0].attachedDocumentIds[0] === 'preserve-original');
    await idle();
    await p.getByRole('button', { name: '다음 미팅 방문 앞당기기', exact: true }).click();
    await p.getByRole('region', { name: '경로 변경 확인' }).waitFor();
    verify('manual_order_edit_uses_same_approval_and_keeps_plan_before_apply', (await plan()).stops[0].id === 'meeting1');
    await p.getByRole('button', { name: '그대로 가기', exact: true }).click();
    verify('cancel_restores_current_road_preview', await p.locator('.browser-map[data-preview="false"]').count() === 1);
    await idle();
    await p.getByRole('button', { name: '대화 종료', exact: true }).click();
    await p.getByRole('button', { name: '함께 출발', exact: true }).click();
    await p.locator('.browser-layout[data-driving="true"]').waitFor({ timeout: 30000 });
    verify('microphone_denial_keeps_live_and_journey_usable', await p.getByRole('button', { name: '마이크 꺼짐', exact: true }).count() === 1 && (await p.getByRole('alert').innerText()).includes('글로 대화'));
    await p.getByRole('button', { name: '잠시 멈춤', exact: true }).click();
    await p.getByRole('button', { name: '시연 조절', exact: true }).click();
    for (let i = 0; i < 3; i++) { await p.getByRole('button', { name: '모의 도착', exact: true }).click(); }
    await p.getByRole('button', { name: '처음부터 보기', exact: true }).waitFor();
    verify('finished_journey_offers_a_real_restart', true);
    await p.getByRole('button', { name: '처음부터 보기', exact: true }).click();
    await p.waitForFunction(() => JSON.parse(localStorage.getItem('carmeleon_browser_context_v1'))['usage-review'].cursor.targetIndex === 0);
    verify('restart_preserves_route_and_originals', (await plan()).stops.length === 3 && (await plan()).stops[0].attachedDocumentIds[0] === 'preserve-original');
    await p.getByRole('button', { name: '대화 자막', exact: true }).click();
    verify('captions_toggle_persists_preference', await p.evaluate(() => localStorage.getItem('carmeleon_browser_captions') === 'true'));
    await p.getByRole('button', { name: '대화 종료', exact: true }).click();
    await p.getByRole('combobox', { name: '경로 선택', exact: true }).selectOption('separate-route');
    await p.waitForFunction(() => document.querySelector('button[aria-label="대화 기록 보기"]')?.disabled);
    verify('changing_route_clears_previous_conversation_and_link_target', await p.getByRole('button', { name: '대화 기록 보기', exact: true }).isDisabled() && !(await p.locator('body').innerText()).includes('307'));
    for (const [width, height] of [[1440, 720], [1024, 768], [768, 900], [390, 844]]) {
      await p.setViewportSize({ width, height });
      verify('no_horizontal_overflow_' + width, await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    }
    await p.setViewportSize({ width: 1440, height: 900 });
    await p.screenshot({ path: 'C:/CARmeleon/verification/screenshots/usage-after.png' });
    verify('no_runtime_errors', errors.length === 0);
    calls.push(...await p.evaluate(() => window.__usageTools));
    return { status: 'PASS', checks, searches, calls, errors, physicalMicrophone: 'NOT_RUN; deliberately denied; real Live audio output' };
  } catch (e) {
    await p.screenshot({ path: 'C:/CARmeleon/verification/screenshots/usage-failure.png' }).catch(() => {});
    return { status: 'FAIL', checks, failure: String(e), ui: (await p.locator('body').innerText()).slice(-5500), searches, calls: await p.evaluate(() => window.__usageTools), errors };
  } finally { await context.close(); }
}
