// Real Kakao road + Google preparation/Live output. Isolates the narration scheduler:
// autonomous investigator returns wait; no roadside search; first preparation fails once.
async (page) => {
  const context = await page.context().browser().newContext({ viewport: { width: 1440, height: 900 } });
  const p = await context.newPage(), checks = [], errors = [], preparations = [];
  const route = { id: 'location-voice', title: '수원 여행', date: '2099-01-01', isTravel: true, stops: [{ id: 'hwaseong', name: '수원화성', latitude: 37.2868, longitude: 127.0134 }, { id: 'home', name: '집', latitude: 37.2802, longitude: 127.0109 }] };
  await context.addInitScript(route => {
    if (window !== top) return;
    localStorage.setItem('carmeleon_plan_active_v3', JSON.stringify({ activeRoute: route, savedRoutes: [route], shortcuts: [{ id: 'home', icon: 'home', name: '집', latitude: 37.2802, longitude: 127.0109 }] }));
    localStorage.setItem('carmeleon_browser_context_v1', JSON.stringify({ [route.id]: { preferences: { focus: 'travel', goal: '', quiet: true }, notes: [], materials: [] } }));
    localStorage.setItem('carmeleon_browser_captions', 'true');
    navigator.mediaDevices.getUserMedia = async () => { throw new DOMException('No physical capture', 'NotAllowedError'); };
  }, route);
  let failPreparation = true;
  await p.route('**/api/fallback/agent', r => r.fulfill({ json: { plan: { outcome: 'wait', topic: 'sightseeing', goal: '이동하며 적절한 설명 지점을 기다림', reason: 'Narration scheduler isolation fixture', speech: '', sourceIds: [] }, places: [], comparisons: [], sources: [], trace: { tools: [], rounds: 0 } } }));
  await p.route('**/api/fallback/places', r => r.fulfill({ json: { status: 'READY', places: [] } }));
  await p.route('**/api/fallback/prepare', r => { if (failPreparation) { failPreparation = false; return r.fulfill({ status: 503, json: { error: 'Intentional one-time failure fixture' } }); } return r.continue(); });
  p.on('pageerror', error => errors.push(error.message));
  p.on('response', async r => { if (r.url().endsWith('/api/fallback/prepare')) { try { const data = await r.json(); preparations.push({ status: r.status(), speech: data.speech, sources: data.sources?.map(s => s.title) }); } catch {} } });
  const verify = (name, ok, detail = {}) => { if (!ok) throw new Error(name + ': ' + JSON.stringify(detail)); checks.push({ name, ...detail }); };
  const settings = async () => p.getByRole('button', { name: '대화 설정', exact: true }).click();
  try {
    await p.goto('http://127.0.0.1:5173/?mode=fallback&verification=location', { waitUntil: 'domcontentloaded' });
    await p.getByRole('button', { name: '함께 출발', exact: true }).waitFor();
    await settings(); await p.getByRole('menuitemcheckbox', { name: '먼저 말하기', exact: true }).click();
    verify('enabling_while_paused_explains_that_departure_is_needed', await p.getByText('출발 버튼을 누르면 이동에 맞춰 먼저 이야기할게요.', { exact: true }).isVisible());
    verify('enabling_does_not_start_the_microphone_or_driving', await p.getByRole('button', { name: '대화 시작', exact: true }).count() === 1 && await p.locator('.browser-layout').getAttribute('data-driving') === 'false');
    await p.getByRole('button', { name: '함께 출발', exact: true }).click();
    await p.getByText('다음 이야기를 준비하지 못했어요', { exact: true }).waitFor({ timeout: 45000 });
    verify('preparation_failure_is_visible_instead_of_silent', true);
    const dismiss = p.getByRole('button', { name: '오류 안내 닫기', exact: true }); if (await dismiss.count()) await dismiss.click();
    await p.getByRole('button', { name: '다시 준비', exact: true }).click();
    await p.getByText('소개할 장소에 가까워지면 이야기할게요', { exact: true }).waitFor({ timeout: 40000 });
    verify('retry_uses_real_grounded_preparation', preparations.some(p => p.status === 200 && p.sources?.length > 0), { preparations });
    verify('ready_story_waits_for_proximity_instead_of_early_playback', await p.locator('.browser-conversation [data-role="assistant"]').count() === 0 && await p.locator('.browser-agent').getAttribute('data-encounter-distance') === null);
    await p.screenshot({ path: 'C:/CARmeleon/verification/screenshots/location-waiting.png' });
    await p.locator('.browser-conversation [data-role="assistant"]').first().waitFor({ timeout: 75000 });
    const triggered = await p.locator('.browser-agent').evaluate(e => ({ distanceMeters: Number(e.getAttribute('data-encounter-distance')), side: e.getAttribute('data-encounter-side'), progress: Number(e.getAttribute('data-encounter-progress')) }));
    verify('actual_live_speech_starts_only_on_destination_approach', triggered.distanceMeters > 0 && triggered.distanceMeters <= 200 && triggered.progress > .5, triggered);
    await p.waitForFunction(() => (JSON.parse(localStorage.getItem('carmeleon_browser_context_v1') || '{}')['location-voice']?.heardCueIds || []).length > 0, undefined, { timeout: 60000 });
    const spoken = await p.locator('.browser-conversation [data-role="assistant"]').last().innerText();
    verify('spoken_voice_names_why_this_place_is_being_introduced', spoken.includes('수원화성') && /도착할|도착.*앞|가까워/.test(spoken), { speech: spoken });
    verify('speech_does_not_claim_observed_visibility', !/보이시|보이죠|지금.{0,6}보/.test(spoken));
    verify('no_user_question_was_needed', await p.locator('.browser-conversation [data-role="user"]').count() === 0);
    await settings(); await p.getByRole('menuitem', { name: '이야기 출처', exact: true }).click();
    verify('on_demand_sources_show_the_actual_trigger_distance', (await p.locator('.browser-cue-sources').innerText()).includes('이야기 시작 기준 · 약 ' + triggered.distanceMeters + 'm'));
    await p.screenshot({ path: 'C:/CARmeleon/verification/screenshots/location-spoken.png' });
    if (await p.getByRole('button', { name: '잠시 멈춤', exact: true }).count()) await p.getByRole('button', { name: '잠시 멈춤', exact: true }).click();
    await settings(); await p.getByRole('menuitem', { name: '대화 종료', exact: true }).click();
    verify('no_runtime_errors', errors.length === 0, { errors });
    return { status: 'PASS', checks, preparations, errors, scope: 'Real Google grounded preparation + Live audio + Kakao road. Autonomous investigator and roadside search are isolation fixtures. No physical microphone or Pleos; directional geometry has separate unit tests.' };
  } catch (error) {
    await p.screenshot({ path: 'C:/CARmeleon/verification/screenshots/location-failure.png' }).catch(() => {});
    return { status: 'FAIL', checks, preparations, errors, failure: String(error), ui: (await p.locator('body').innerText()).slice(-2500) };
  } finally { await context.close(); }
}
