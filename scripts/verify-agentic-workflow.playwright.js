// Real Gemini agent tool loop + Live voice + Kakao search/roads; isolated synthetic journey.
async (page) => {
  const context = await page.context().browser().newContext({ viewport: { width: 1440, height: 900 } });
  const p = await context.newPage(), checks = [], errors = [], investigations = [], worldObservations = [];
  const travel = { id: 'agentic-travel', title: '수원 여행 가는 길 커피', date: '2099-01-01', isTravel: true, isActiveInCar: false, stops: [{ id: 'suwon', name: '수원화성', type: 'travel', latitude: 37.2868, longitude: 127.0134 }, { id: 'home', name: '집', latitude: 37.4013, longitude: 127.1086 }] };
  const work = { id: 'agentic-work', title: '고객 납기 협의', date: '2099-01-01', isBusiness: true, isActiveInCar: false, stops: [{ id: 'meeting', name: '판교 미팅', type: 'business', latitude: 37.3948, longitude: 127.1119, memo: '고객과 12월 18일 납기로 이야기했다. 오늘 미팅에서 기준일을 확정한다.' }, { id: 'home', name: '집', latitude: 37.4013, longitude: 127.1086 }] };
  await context.addInitScript(({ travel, work }) => {
    if (window !== top) return;
    if (!localStorage.getItem('__agentic_fixture_seeded')) {
      localStorage.setItem('carmeleon_plan_active_v3', JSON.stringify({ carPlateNumber: 'TEST', carModel: 'fixture', batteryOrFuelPercent: 80, isEngineOn: false, activeRoute: travel, savedRoutes: [travel, work], shortcuts: [{ id: 'home', icon: 'home', keyword: '집', name: '모의 집', address: '판교', latitude: 37.4013, longitude: 127.1086 }] }));
      localStorage.setItem('carmeleon_browser_context_v1', JSON.stringify({ [travel.id]: { preferences: { focus: 'travel', goal: '여행 가는 길에 커피 한 잔 마시며 쉬고 싶어. 우회는 10분 안쪽으로 찾아줘.', quiet: false }, notes: [], materials: [] }, [work.id]: { preferences: { focus: 'work', goal: '고객과 실제 납기 기준일을 확실하게 합의하고 싶어.', quiet: false }, notes: [], materials: [] } }));
      localStorage.setItem('carmeleon_browser_captions', 'true'); localStorage.setItem('__agentic_fixture_seeded', 'true');
    }
    navigator.mediaDevices.getUserMedia = async () => { throw new DOMException('No physical capture', 'NotAllowedError'); };
  }, { travel, work });
  p.on('pageerror', e => errors.push(e.name + ': ' + e.message.slice(0, 200)));
  p.on('response', async r => { if (r.url().endsWith('/api/fallback/agent')) { try { const data = await r.json(), input = r.request().postDataJSON(); investigations.push({ status: r.status(), routeId: input.routeId, observed: { position: input.position, progress: input.world?.progress }, data }); } catch {} } });
  p.on('websocket', socket => socket.on('framesent', event => { try { const data = JSON.parse(String(event.payload)); for (const turn of data.clientContent?.turns || []) for (const part of turn.parts || []) { if (part.text?.startsWith('이동 상황 갱신')) { const index = part.text.indexOf('\n'); worldObservations.push(JSON.parse(part.text.slice(index + 1))); } } } catch {} }));
  const verify = (name, ok, detail = {}) => { if (!ok) throw new Error(name + ': ' + JSON.stringify(detail)); checks.push({ name, ...detail }); };
  const tasks = id => p.evaluate(id => JSON.parse(localStorage.getItem('carmeleon_route_agent_v1') || '{}')[id] || [], id);
  const ask = async text => { if (!(await p.getByRole('textbox', { name: '카멜레온에게 메시지' }).count())) await p.getByRole('button', { name: '글로 대화하기', exact: true }).click(); await p.getByRole('textbox', { name: '카멜레온에게 메시지' }).fill(text); await p.getByRole('button', { name: '메시지 보내기', exact: true }).click(); };
  const idle = () => p.locator('.browser-wave[data-phase="LISTENING"]').waitFor({ timeout: 45000 });
  try {
    await p.goto('http://127.0.0.1:5173/?mode=fallback&verification=agentic', { waitUntil: 'domcontentloaded', timeout: 20000 });
    await p.getByRole('button', { name: '함께 출발', exact: true }).waitFor();
    verify('map_left_and_carmeleon_right_without_open_preparation_or_chat', !(await p.locator('.browser-sidebar').isVisible()) && await p.locator('.browser-chat-form').count() === 0 && await p.evaluate(() => { const map = document.querySelector('.browser-map-panel').getBoundingClientRect(), panel = document.querySelector('.browser-app-panel'), app = panel.getBoundingClientRect(); return map.x === 0 && Math.abs(map.right - app.left) < 1 && Math.abs(app.right - innerWidth) < 1 && panel.contains(document.querySelector('.browser-agent')); }));
    await p.locator('.browser-map-canvas[data-renderer="maplibre"][data-pitch="55"]').waitFor({ timeout: 30000 });
    verify('real_geographic_camera_starts_pitched', true);
    verify('demo_module_is_outside_the_product_and_closed', await p.locator('.browser-cockpit .carmeleon-demo-tools').count() === 0 && await p.locator('.carmeleon-demo-popover').count() === 0 && await p.locator('.browser-drive-controls').count() === 0);
    verify('demo_launcher_is_compact', await p.getByRole('button', { name: '시연 조절', exact: true }).evaluate(e => e.getBoundingClientRect().height <= 32 && e.getBoundingClientRect().width <= 80));
    await p.getByRole('button', { name: '함께 출발', exact: true }).click();
    await p.getByRole('region', { name: '경로 변경 확인' }).waitFor({ timeout: 100000 });
    await idle();
    const travelInvestigation = investigations.find(r => r.routeId === travel.id && r.status === 200 && r.data.plan.outcome === 'suggest_stop');
    verify('goal_drives_autonomous_real_search_and_road_comparison', !!travelInvestigation && travelInvestigation.data.trace.tools.includes('search_near_route') && travelInvestigation.data.trace.tools.includes('compare_detours') && travelInvestigation.data.comparisons.length >= 1, { trace: travelInvestigation?.data.trace, comparisons: travelInvestigation?.data.comparisons });
    verify('agent_proposes_without_an_extra_user_command', await p.locator('.browser-conversation [data-role="user"]').count() === 0);
    verify('autonomous_proposal_does_not_write_without_approval', await p.evaluate(() => JSON.parse(localStorage.getItem('carmeleon_plan_active_v3')).activeRoute.stops.length === 2));
    verify('agent_tracks_approval_as_pending_work', (await tasks(travel.id)).some(t => t.status === 'awaiting_approval'));
    await p.screenshot({ path: 'C:/CARmeleon/verification/screenshots/agentic-travel-proposal.png' });
    await p.getByRole('button', { name: '들렀다 가기', exact: true }).click();
    await p.waitForFunction(() => (JSON.parse(localStorage.getItem('carmeleon_route_agent_v1') || '{}')['agentic-travel'] || []).some(t => t.status === 'in_route'));
    verify('approved_goal_continues_until_visit', true);
    await idle(); await p.getByRole('button', { name: '잠시 멈춤', exact: true }).click();
    await p.reload(); await p.getByRole('button', { name: '함께 출발', exact: true }).waitFor();
    verify('agent_owned_goal_survives_reconnection', (await tasks(travel.id)).some(t => t.status === 'in_route'));
    await p.getByRole('button', { name: '시연 조절', exact: true }).click();
    await p.getByRole('button', { name: '모의 도착', exact: true }).click();
    await p.waitForFunction(() => (JSON.parse(localStorage.getItem('carmeleon_route_agent_v1') || '{}')['agentic-travel'] || []).some(t => t.status === 'done'));
    verify('arrival_completes_the_same_agent_owned_goal', true);
    await p.getByRole('button', { name: '시연 도구 닫기', exact: true }).click();
    await p.getByRole('button', { name: '경로·자료', exact: true }).click();
    await p.getByRole('combobox', { name: '경로 선택' }).selectOption(work.id);
    await p.getByRole('button', { name: '경로·자료', exact: true }).click();
    await p.getByRole('tab', { name: '자료', exact: true }).click();
    await p.locator('input[type=file]').setInputFiles('C:/CARmeleon/.playwright-mcp/agentic-contract.txt');
    await p.getByText('agentic-contract.txt', { exact: true }).waitFor();
    await p.getByRole('button', { name: '함께 출발', exact: true }).click();
    await p.waitForFunction(() => (JSON.parse(localStorage.getItem('carmeleon_route_agent_v1') || '{}')['agentic-work'] || []).some(t => t.status === 'waiting_answer'), undefined, { timeout: 100000 });
    await idle();
    const speech = await p.locator('.browser-conversation').innerText();
    const workInvestigation = investigations.find(r => r.routeId === work.id && r.status === 200 && r.data.plan.outcome === 'ask');
    verify('business_reads_actual_original_and_notices_a_conflict', !!workInvestigation && workInvestigation.data.trace.tools.includes('read_material') && speech.includes('18일') && speech.includes('28일'), { speech, trace: workInvestigation?.data.trace });
    verify('business_asks_a_useful_question_without_being_prompted', await p.locator('.browser-conversation [data-role="user"]').count() === 0);
    await p.screenshot({ path: 'C:/CARmeleon/verification/screenshots/agentic-business-question.png' });
    await ask('고객과 합의한 18일이 맞아. 18일 기준으로 협의하자. 이건 기억해줘.');
    await p.waitForFunction(() => (JSON.parse(localStorage.getItem('carmeleon_route_agent_v1') || '{}')['agentic-work'] || []).some(t => t.status === 'done'), undefined, { timeout: 75000 });
    await idle();
    verify('answer_resolves_pending_work_and_saves_requested_memory', await p.evaluate(() => JSON.parse(localStorage.getItem('carmeleon_browser_context_v1'))['agentic-work'].notes.some(n => n.text.includes('18'))));
    verify('movement_observations_reach_the_live_model', worldObservations.some(w => w.motion === 'MOVING' && w.elapsedSeconds > 0), { count: worldObservations.length });
    const before = worldObservations[worldObservations.length - 1];
    const previousSpeech = await p.locator('.browser-conversation [data-role="assistant"]').last().innerText();
    await ask('우리 지금 도착한 거야, 아직 가는 중이야?');
    await p.waitForFunction(previous => { const lines = [...document.querySelectorAll('.browser-conversation [data-role="assistant"]')]; return lines.length > 0 && lines[lines.length - 1].textContent !== previous; }, previousSpeech);
    await idle();
    const recent = await p.locator('.browser-conversation [data-role="assistant"]').last().innerText();
    verify('agent_treats_world_motion_as_current_journey_facts', /가는|이동|남|도착 전|도착하지/.test(recent) && !/모의|시연|가정/.test(recent), { speech: recent, lastWorld: before });
    await p.getByRole('button', { name: '잠시 멈춤', exact: true }).click();
    await p.getByRole('button', { name: '대화 설정', exact: true }).click();
    await p.getByRole('menuitem', { name: '대화 종료', exact: true }).click();
    await p.screenshot({ path: 'C:/CARmeleon/verification/screenshots/agentic-product-layout.png' });
    for (const width of [1440, 1024, 768, 390]) { await p.setViewportSize({ width, height: 900 }); verify('no_overflow_' + width, await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)); }
    verify('no_runtime_errors', errors.length === 0);
    return { status: 'PASS', checks, investigations, errors, worldObservationCount: worldObservations.length, physicalMicrophone: 'NOT_RUN; capture denied; real Live output' };
  } catch (e) {
    await p.screenshot({ path: 'C:/CARmeleon/verification/screenshots/agentic-failure.png' }).catch(() => {});
    const routeId = await p.evaluate(() => JSON.parse(localStorage.getItem('carmeleon_plan_active_v3')).activeRoute.id).catch(() => 'unavailable');
    return { status: 'FAIL', checks, investigations, errors, failure: String(e), tasks: await tasks(routeId).catch(() => []), ui: (await p.locator('body').innerText()).slice(-4500), worldObservations: worldObservations.slice(-2) };
  } finally { await context.close(); }
}
