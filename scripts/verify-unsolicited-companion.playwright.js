// No user text/voice request for either story. Uses actual preparation and Live playback.
async (page) => {
  const context = await page.context().browser().newContext({ viewport: { width: 1440, height: 900 } });
  const p = await context.newPage(), checks = [], errors = [], preparations = [];
  const travel = { id: 'unsolicited-travel', title: '수원 여행', date: '2099-01-01', isTravel: true, isActiveInCar: false, stops: [
    { id: 'hwaseong', name: '수원화성', type: 'travel', latitude: 37.2868, longitude: 127.0134 }, { id: 'return', name: '집', latitude: 37.2802, longitude: 127.0109 },
  ] };
  const work = { id: 'unsolicited-work', title: '방문 전 납기 협의', date: '2099-01-01', isBusiness: true, isActiveInCar: false, stops: [
    { id: 'business', name: '판교 미팅', type: 'business', latitude: 37.3948, longitude: 127.1119, time: '13:30', memo: '가격보다 납기부터 논의한다. 고객이 요청한 납품일은 12월 18일이다. 오늘 그 날짜에 맞출 수 있는지 먼저 확인한다.' },
    { id: 'return', name: '집', latitude: 37.2802, longitude: 127.0109 },
  ] };
  await context.addInitScript(({ travel, work }) => {
    if (window !== top) return;
    localStorage.setItem('carmeleon_plan_active_v3', JSON.stringify({ carPlateNumber: 'TEST', carModel: 'fixture', batteryOrFuelPercent: 80, isEngineOn: false, activeRoute: travel, savedRoutes: [travel, work], shortcuts: [{ id: 'home', icon: 'home', keyword: '집', name: '모의 집', address: '수원', latitude: 37.2802, longitude: 127.0109 }] }));
    localStorage.setItem('carmeleon_browser_captions', 'true');
    navigator.mediaDevices.getUserMedia = async () => { throw new DOMException('No physical capture', 'NotAllowedError'); };
  }, { travel, work });
  p.on('pageerror', e => errors.push(e.name + ': ' + e.message.slice(0, 180)));
  p.on('response', async r => { if (r.url().endsWith('/api/fallback/prepare')) { try { const d = await r.json(), q = r.request().postDataJSON(); preparations.push({ kind: q.kind, status: r.status(), sources: d.sources?.map(s => s.title), usesMemo: !!q.visit?.memo, hasOriginal: q.materials?.length > 0 }); } catch {} } });
  const verify = (name, ok, detail = {}) => { if (!ok) throw new Error(name + ': ' + JSON.stringify(detail)); checks.push({ name, ...detail }); };
  const run = async (id, kind) => {
    if (kind === 'work') await p.getByRole('combobox', { name: '경로 선택' }).selectOption(id);
    const preparedAt = Date.now();
    await p.locator('.browser-agent[data-ready-cues="1"],.browser-agent[data-ready-cues="2"]').waitFor({ timeout: 40000 });
    verify(kind + '_prepared_before_voice_connection', await p.getByRole('button', { name: '대화 시작', exact: true }).count() === 1, { preparationWaitMs: Date.now() - preparedAt });
    const startAt = Date.now();
    await p.getByRole('button', { name: '함께 출발', exact: true }).click();
    await p.locator('.browser-conversation [data-role="assistant"]').first().waitFor({ timeout: 50000 });
    const firstSpeechMs = Date.now() - startAt;
    await p.waitForFunction(id => (JSON.parse(localStorage.getItem('carmeleon_browser_context_v1') || '{}')[id]?.heardCueIds?.length || 0) > 0, id, { timeout: 60000 });
    const speech = await p.locator('.browser-conversation').innerText();
    verify(kind + '_speaks_without_a_user_question', await p.locator('.browser-conversation [data-role="user"]').count() === 0, { firstSpeechMs, speech });
    verify(kind + '_finishes_before_simulated_arrival', await p.locator('.browser-layout').getAttribute('data-driving') === 'true');
    verify(kind + '_shows_grounded_source', await p.locator('.browser-cue-sources').isVisible());
    if (kind === 'work') verify('business_briefing_uses_saved_delivery_memo_without_a_document', /납기|납품|12월|18일/.test(speech) && preparations.some(r => r.kind === 'work' && r.usesMemo && !r.hasOriginal));
    await p.screenshot({ path: 'C:/CARmeleon/verification/screenshots/unsolicited-' + kind + '.png' });
    await p.getByRole('button', { name: '잠시 멈춤', exact: true }).click();
    await p.getByRole('button', { name: '대화 종료', exact: true }).click();
    if (kind === 'travel') await p.getByRole('button', { name: '경로·자료', exact: true }).click();
  };
  try {
    await p.goto('http://127.0.0.1:5173/?mode=fallback&verification=unsolicited');
    await run(travel.id, 'travel');
    await run(work.id, 'work');
    verify('no_runtime_errors', errors.length === 0);
    return { status: 'PASS', checks, preparations, errors, physicalMicrophone: 'NOT_RUN', typedUserRequests: 0, simulation: 'default automatic companion clock; real road geometry and Google audio' };
  } catch (e) {
    await p.screenshot({ path: 'C:/CARmeleon/verification/screenshots/unsolicited-failure.png' }).catch(() => {});
    return { status: 'FAIL', checks, preparations, errors, failure: String(e), ui: (await p.locator('body').innerText()).slice(-4500) };
  } finally { await context.close(); }
}
