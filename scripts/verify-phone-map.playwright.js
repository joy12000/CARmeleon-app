// Playwright MCP browser_run_code_unsafe filename. A function expression, without a trailing semicolon.
async (page) => {
  const context = await page.context().browser().newContext({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce' });
  const p = await context.newPage(); p.setDefaultTimeout(8000);
  const checks = [];
  const verify = (name, ok, details) => { if (!ok) throw new Error(`${name}: ${JSON.stringify(details)}`); checks.push({name,details}); };
  const fixture = { carPlateNumber: '시험', carModel: 'UI fixture', batteryOrFuelPercent: 50, isEngineOn: false, shortcuts: [], pastRoutes: [],
    activeRoute: { id: 'map-test', title: '실지도 검사', date: '2099-01-01', isActiveInCar: false, stops: [
      {id:'a',name:'<img src="/map-injection-test" onerror="window.mapInjected=true">',latitude:37.505,longitude:126.957},
      {id:'unknown',name:'좌표 없는 곳'}, {id:'b',name:'여의도',latitude:37.525,longitude:126.925}
    ] }, savedRoutes: [] };
  fixture.savedRoutes.push(structuredClone(fixture.activeRoute));
  const seed = (data) => p.evaluate(value => localStorage.setItem('carmeleon_plan_active_v3', JSON.stringify(value)), data);
  try {
    await p.goto('http://127.0.0.1:5173/?mode=phone'); await seed(fixture); await p.reload();
    await p.locator('.route-real-map[data-status=ready]').waitFor({timeout:20000});
    const tiles = await p.locator('.leaflet-tile-loaded').evaluateAll(images => images.filter(image=>image.complete && image.naturalWidth===256).length);
    verify('live_osm_tiles_loaded', tiles>0, {provider:await p.locator('.route-real-map').getAttribute('data-provider'),tiles});
    verify('only_saved_coordinates_rendered', await p.locator('.route-map-marker').count()===2 && await p.getByText('위치 미확인 1곳은 지도에서 제외했어요.').isVisible(), 'Missing coordinate has no invented marker');
    verify('no_line_across_unknown_stop', await p.locator('.leaflet-overlay-pane path').count()===0, 'Unknown middle visit interrupts order segments');
    verify('visible_source_attribution', await p.locator('.leaflet-control-attribution').getByRole('link',{name:'OpenStreetMap'}).isVisible(), 'Attribution preserved');
    await p.getByRole('button',{name:'실지도 검사 경로 열기',exact:true}).click();
    await p.locator('.route-real-map[data-status=ready]').waitFor({timeout:20000});
    await p.locator('.route-map-marker').first().click();
    verify('place_names_are_plain_text', (await p.locator('.leaflet-popup-content').innerText()).includes('<img') && await p.locator('.leaflet-popup-content img').count()===0 && await p.evaluate(()=>window.mapInjected===undefined), 'Stored names cannot inject markup');
    await p.getByRole('button',{name:'지도 확대',exact:true}).click();
    await p.getByRole('button',{name:'지도 축소',exact:true}).click();
    await p.getByRole('button',{name:'모든 방문지 보기',exact:true}).click();
    verify('interactive_controls_available', !(await p.evaluate(()=>document.documentElement.scrollWidth>innerWidth)), 'Zoom and fit work without page overflow');
    const coordinates = await p.evaluate(async()=>{
      const {coordinateOf}=await import('/src/components/phone/mapProviders.ts');
      return [coordinateOf({latitude:0,longitude:0}),coordinateOf({latitude:NaN,longitude:127}),coordinateOf({latitude:91,longitude:127}),coordinateOf({lat:37.5,lng:127}),coordinateOf({latitude:'37.5',longitude:127})];
    });
    verify('coordinate_validation_keeps_zero_and_legacy_fields', coordinates[0]?.latitude===0&&coordinates[1]===null&&coordinates[2]===null&&coordinates[3]?.latitude===37.5&&coordinates[4]===null, coordinates);
    await context.route('https://tile.openstreetmap.org/**', route=>route.abort());
    await p.reload(); await p.locator('.route-real-map[data-status=error]').waitFor({timeout:20000});
    verify('tile_failure_is_explicit', await p.getByRole('button',{name:'다시 불러오기',exact:true}).isVisible(), 'No fabricated replacement map');
    await context.unroute('https://tile.openstreetmap.org/**');
    await p.getByRole('button',{name:'다시 불러오기',exact:true}).click();
    await p.locator('.route-real-map[data-status=ready]').waitFor({timeout:20000});
    verify('retry_recovers_live_map', await p.locator('.leaflet-tile-loaded').count()>0, 'Actual tiles return after network recovery');
    fixture.activeRoute.stops = [{id:'unknown',name:'좌표 없는 곳'}];fixture.savedRoutes=[structuredClone(fixture.activeRoute)];await seed(fixture);await p.reload();
    verify('all_coordinates_missing_has_no_map', await p.getByText('방문지의 위치를 확인해 주세요.',{exact:true}).isVisible() && await p.locator('.route-map-frame').count()===0, 'No default origin or random coordinate');
    return {status:'passed',checks};
  } finally {await context.close();}
}
