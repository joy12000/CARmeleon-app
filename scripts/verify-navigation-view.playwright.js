// Split-window camera/UI checks with synthetic route; real Kakao proposal, no microphone or Live session.
async (page) => {
  const context = await page.context().browser().newContext({ viewport: { width: 1280, height: 720 } });
  const p = await context.newPage(), checks = [], errors = [], warnings = [];
  const route = { id: 'camera-fixture', title: '수원 여행', date: '2099-01-01', isTravel: true, stops: [{ id: 'suwon', name: '수원화성', latitude: 37.2868, longitude: 127.0134 }, { id: 'home', name: '집', latitude: 37.4013, longitude: 127.1086 }] };
  await context.addInitScript(route => {
    if (window !== top) return;
    localStorage.setItem('carmeleon_plan_active_v3', JSON.stringify({ activeRoute: route, savedRoutes: [route], shortcuts: [{ id: 'home', icon: 'home', keyword: '집', name: '집', latitude: 37.4013, longitude: 127.1086 }] }));
    localStorage.setItem('carmeleon_browser_captions', 'false');
  }, route);
  p.on('pageerror', error => errors.push(error.message));
  p.on('console', message => { if (message.type() === 'error') errors.push(message.text()); if (message.type() === 'warning') warnings.push(message.text()); });
  const camera = p.locator('.browser-map-canvas');
  const read = () => camera.evaluate(e => ({ renderer: e.dataset.renderer, pitch: Number(e.dataset.pitch), bearing: Number(e.dataset.bearing), zoom: Number(e.dataset.zoom) }));
  const verify = (name, ok, detail) => { if (!ok) throw new Error(name + ': ' + JSON.stringify(detail)); checks.push({ name, ...(detail || {}) }); };
  try {
    await p.goto('http://127.0.0.1:5173/?mode=fallback&verification=camera', { waitUntil: 'domcontentloaded' });
    await p.locator('.browser-map-canvas[data-renderer="maplibre"][data-pitch="55"]').waitFor({ timeout: 30000 });
    await p.waitForFunction(() => !document.querySelector('.browser-start').disabled);
    await p.waitForTimeout(800);
    verify('default_camera_is_geographically_pitched', (await read()).pitch === 55, await read());
    await p.screenshot({ path: 'C:/CARmeleon/verification/screenshots/split-demo-default.png' });
    await p.getByRole('button', { name: '전체 경로 보기', exact: true }).click();
    await p.locator('.browser-map-canvas[data-pitch="0"]').waitFor();
    verify('overview_returns_to_north_up_flat_map', (await read()).bearing === 0, await read());
    await p.screenshot({ path: 'C:/CARmeleon/verification/screenshots/split-demo-overview.png' });
    await p.getByRole('button', { name: '모의 위치 따라가기', exact: true }).click();
    await p.locator('.browser-map-canvas[data-pitch="55"]').waitFor();
    verify('follow_restores_navigation_camera', await p.getByRole('button', { name: '모의 위치 따라가기', exact: true }).getAttribute('aria-pressed') === 'true', await read());
    await p.waitForTimeout(500);
    const before = await read();
    await p.mouse.move(650, 340); await p.mouse.wheel(0, -300);
    await p.waitForTimeout(800);
    const after = await read();
    verify('wheel_changes_zoom_and_releases_follow', after.zoom > before.zoom && await p.getByRole('button', { name: '모의 위치 따라가기', exact: true }).getAttribute('aria-pressed') === 'false', { before, after });
    await p.getByRole('button', { name: '모의 위치 따라가기', exact: true }).click();
    await p.waitForTimeout(500);
    const layout = await p.evaluate(() => ({ map: document.querySelector('.browser-map-panel').getBoundingClientRect().toJSON(), app: document.querySelector('.browser-app-panel').getBoundingClientRect().toJSON(), agent: document.querySelector('.browser-agent').getBoundingClientRect().toJSON() }));
    verify('map_left_and_carmeleon_app_flush_right', layout.map.x === 0 && Math.abs(layout.map.right - layout.app.left) < 1 && layout.app.right === 1280 && layout.map.height === 720 && layout.app.height === 720, layout);
    verify('all_product_controls_are_inside_the_right_app', await p.evaluate(() => { const panel = document.querySelector('.browser-app-panel'); return ['.browser-header', '.browser-next-stop', '.browser-sidebar', '.browser-agent'].every(selector => panel.contains(document.querySelector(selector))); }));
    verify('map_contains_no_product_overlays', await p.locator('.browser-map-panel .browser-next-stop, .browser-map-panel .browser-agent, .browser-map-panel .browser-sidebar, .browser-map-panel .browser-header').count() === 0);
    verify('attribution_is_visible', await p.locator('.maplibregl-ctrl-attrib').isVisible());
    const withinRight = async locator => locator.evaluate(e => { const r = e.getBoundingClientRect(), app = document.querySelector('.browser-app-panel').getBoundingClientRect(); return r.left >= app.left - 1 && r.right <= app.right + 1 && r.top >= 0 && r.bottom <= innerHeight + 1; });
    await p.getByRole('button', { name: '경로·자료', exact: true }).click();
    verify('preparation_opens_inside_right_app_without_covering_map', await withinRight(p.locator('.browser-sidebar')) && await p.locator('.browser-map-panel').isVisible());
    await p.getByRole('tab', { name: '자료', exact: true }).click();
    verify('material_controls_stay_in_right_app', await withinRight(p.getByRole('button', { name: '자료 추가', exact: true })));
    await p.getByRole('tab', { name: '기억', exact: true }).click();
    verify('memory_editor_stays_in_right_app', await withinRight(p.getByRole('textbox', { name: '기억할 내용', exact: true })));
    await p.getByRole('tab', { name: '경로', exact: true }).click();
    await p.getByRole('textbox', { name: '가는 길에 들를 곳', exact: true }).fill('카페');
    await p.getByRole('button', { name: '검색', exact: true }).click();
    await p.locator('.browser-places li button').first().click();
    const proposal = p.getByRole('region', { name: '경로 변경 확인', exact: true });
    await proposal.waitFor({ timeout: 30000 });
    verify('real_road_proposal_opens_in_right_app_and_closes_editor', await withinRight(proposal) && !(await p.locator('.browser-sidebar').isVisible()));
    await p.locator('.browser-map[data-status="ready"]').waitFor({ timeout: 30000 });
    await p.waitForTimeout(1000);
    await p.screenshot({ path: 'C:/CARmeleon/verification/screenshots/split-demo-proposal.png' });
    await p.getByRole('button', { name: '그대로 가기', exact: true }).click();
    await proposal.waitFor({ state: 'detached' });
    verify('cancel_keeps_existing_plan', await p.evaluate(() => JSON.parse(localStorage.getItem('carmeleon_plan_active_v3')).activeRoute.stops.length === 2));
    const noticeClose = p.getByRole('button', { name: '안내 닫기', exact: true });
    if (await noticeClose.count()) await noticeClose.click();
    await p.getByRole('button', { name: '대화 설정', exact: true }).click();
    verify('settings_stay_inside_right_app', await withinRight(p.getByRole('menu', { name: '동행 설정', exact: true })));
    await p.getByRole('menuitem', { name: '야간 화면', exact: true }).click();
    await p.screenshot({ path: 'C:/CARmeleon/verification/screenshots/split-demo-night.png' });
    await p.getByRole('button', { name: '대화 설정', exact: true }).click();
    await p.getByRole('menuitem', { name: '주간 화면', exact: true }).click();
    verify('demo_tools_are_outside_the_product', await p.locator('.browser-app-panel .carmeleon-demo-tools').count() === 0 && await p.locator('.carmeleon-demo-popover').count() === 0);
    for (const width of [1440, 1280, 1024, 768, 390]) {
      await p.setViewportSize({ width, height: 900 });
      await p.getByRole('button', { name: '글로 대화하기', exact: true }).click();
      verify('right_side_input_and_no_overflow_' + width, await withinRight(p.getByRole('textbox', { name: '카멜레온에게 메시지', exact: true })) && await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
      await p.getByRole('button', { name: '글로 대화하기', exact: true }).click();
    }
    await p.setViewportSize({ width: 1440, height: 900 });
    await p.waitForTimeout(1000);
    await p.screenshot({ path: 'C:/CARmeleon/verification/screenshots/split-demo-wide.png' });
    verify('no_browser_errors', errors.length === 0, { errors });
    verify('no_style_warnings', warnings.length === 0, { warnings });
    return { status: 'PASS', checks, errors, warnings, scope: 'Split demo layout, actual vector tiles and Kakao search/road proposal/cancel; no Live or microphone. Earlier full agent run is historical evidence.' };
  } catch (error) { return { status: 'FAIL', checks, errors, warnings, failure: String(error), camera: await read().catch(() => null) }; }
  finally { await context.close(); }
}
