// Run with the Playwright MCP browser_run_code_unsafe tool's filename argument.
// Uses its own browser context, synthetic data and IndexedDB. No user storage or API writes.
async (page) => {
  const origin = "http://127.0.0.1:5173";
  const context = await page
    .context()
    .browser()
    .newContext({
      viewport: { width: 390, height: 844 },
      reducedMotion: "reduce",
    });
  const checks = [];
  const errors = [];
  const requests = [];
  const verify = (name, condition, details) => {
    if (!condition) throw new Error(`${name}: ${JSON.stringify(details)}`);
    checks.push({ name, details });
  };
  const fixture = {
    carPlateNumber: "시험",
    carModel: "UI fixture",
    batteryOrFuelPercent: 50,
    isEngineOn: false,
    activeRoute: {
      id: "test-route",
      title: "서울에서 보내는 하루",
      date: "2099-01-01",
      isActiveInCar: false,
      isTravel: true,
      stops: [
        {
          id: "stop-a",
          name: "중앙대학교",
          address: "동작구",
          latitude: 37.505,
          longitude: 126.957,
          poiId: "original-poi",
          poiSubId: "original-sub",
          time: "13:30",
          memo: "원본 메모",
          attachedDocumentIds: ["original-document"],
          aiBriefing: { summaryPoints: ["보존해야 하는 원본"] },
        },
        {
          id: "stop-b",
          name: "여의도",
          address: "영등포구",
          latitude: 37.525,
          longitude: 126.925,
          memo: "두 번째 방문지",
        },
      ],
    },
    savedRoutes: [],
    pastRoutes: [],
    shortcuts: [
      {
        id: "home",
        keyword: "집",
        name: "시험 집",
        address: "시험 주소",
        latitude: 37.5,
        longitude: 127.0,
        icon: "home",
      },
    ],
  };
  fixture.savedRoutes.push(structuredClone(fixture.activeRoute));
  await context.addInitScript((data) => {
    if (!localStorage.getItem("phone-test-seeded")) {
      localStorage.setItem("carmeleon_plan_active_v3", JSON.stringify(data));
      localStorage.setItem("phone-test-seeded", "true");
    }
  }, fixture);
  const p = await context.newPage();
  p.setDefaultTimeout(6000);
  p.on("pageerror", (error) => errors.push(error.message));
  p.on("request", (request) => {
    if (new URL(request.url()).pathname.startsWith("/api/"))
      requests.push(request.method() + " " + request.url());
  });
  const saved = () =>
    p.evaluate(() =>
      JSON.parse(localStorage.getItem("carmeleon_plan_active_v3")),
    );
  const settle = () => p.evaluate(() => document.fonts.ready);
  const overflow = () =>
    p.evaluate(() => document.documentElement.scrollWidth > innerWidth);
  try {
    await p.goto(`${origin}/?mode=phone`);
    await settle();
    verify(
      "opens_preparation_without_fake_login",
      await p.getByRole("heading", { name: "다음 여정" }).isVisible(),
      "Local preparation opens directly",
    );
    await p
      .getByRole("button", { name: "서울에서 보내는 하루 경로 열기" })
      .click();
    await p.getByRole("button", { name: "편집", exact: true }).click();
    await p.getByLabel("경로 이름", { exact: true }).fill("수정한 서울 하루");
    await p.getByRole("button", { name: "중앙대학교 아래로 이동" }).click();
    await p.getByRole("button", { name: /중앙대학교.*13:30/ }).click();
    await p.getByLabel("메모", { exact: true }).fill("미팅 전 확인할 메모");
    await p.getByRole("button", { name: "경로 저장", exact: true }).click();
    let data = await saved();
    const edited = data.savedRoutes[0];
    verify(
      "edit_and_reorder_persist",
      edited.title === "수정한 서울 하루" &&
        edited.stops.map((s) => s.id).join(",") === "stop-b,stop-a" &&
        edited.stops[1].memo === "미팅 전 확인할 메모",
      edited,
    );
    verify(
      "hidden_original_fields_preserved",
      edited.stops[1].latitude === 37.505 &&
        edited.stops[1].poiSubId === "original-sub" &&
        edited.stops[1].attachedDocumentIds[0] === "original-document" &&
        edited.stops[1].aiBriefing.summaryPoints[0] === "보존해야 하는 원본" &&
        edited.stops[1].time === "13:30",
      edited.stops[1],
    );
    await p.getByRole("button", { name: "준비 경로로 선택" }).click();
    data = await saved();
    verify(
      "selection_does_not_claim_vehicle_success",
      !data.activeRoute.isActiveInCar &&
        (await p
          .getByText("이 기기에 저장 · 차량 동기화 미연결", { exact: true })
          .isVisible()),
      data.activeRoute.isActiveInCar,
    );

    await p
      .getByRole("button", { name: "자료 첨부", exact: true })
      .first()
      .click();
    const contents = "원본 자료 확인\nCARmeleon test";
    await p.locator("input[type=file]").setInputFiles({
      name: "meeting-original.txt",
      mimeType: "text/plain",
      buffer: Buffer.from(contents),
    });
    await p
      .getByRole("button", {
        name: "meeting-original.txt 다운로드",
        exact: true,
      })
      .waitFor();
    const [download] = await Promise.all([
      p.waitForEvent("download"),
      p
        .getByRole("button", {
          name: "meeting-original.txt 다운로드",
          exact: true,
        })
        .click(),
    ]);
    const stream = await download.createReadStream();
    const chunks = [];
    for await (const chunk of stream) chunks.push(chunk);
    verify(
      "original_file_byte_roundtrip",
      Buffer.concat(chunks).toString("utf8") === contents,
      download.suggestedFilename(),
    );
    await p.reload();
    await settle();
    await p.getByRole("button", { name: "자료", exact: true }).click();
    verify(
      "file_survives_reload",
      await p
        .getByRole("button", {
          name: "meeting-original.txt 다운로드",
          exact: true,
        })
        .isVisible(),
      "IndexedDB original reopened",
    );
    await p
      .getByRole("button", { name: "meeting-original.txt 삭제", exact: true })
      .click();
    await p.getByRole("button", { name: "취소", exact: true }).click();
    verify(
      "delete_cancel_preserves_original",
      await p
        .getByRole("button", {
          name: "meeting-original.txt 다운로드",
          exact: true,
        })
        .isVisible(),
      "No delete before confirmation",
    );

    await p.getByRole("button", { name: "경로", exact: true }).click();
    await p
      .getByRole("button", { name: "새 경로 만들기", exact: true })
      .first()
      .click();
    await p.getByLabel("경로 이름", { exact: true }).fill("새로 준비한 경로");
    await p.getByRole("button", { name: "경로 저장", exact: true }).click();
    verify(
      "empty_route_is_not_saved",
      (await saved()).savedRoutes.length === 1 &&
        (await p
          .getByRole("alert")
          .filter({ hasText: "방문지를 한 곳 이상" })
          .isVisible()),
      "Destination required",
    );
    await p.getByRole("button", { name: "방문지 추가", exact: true }).click();
    await p.getByRole("button", { name: /집.*시험 집/ }).click();
    await p.getByRole("button", { name: "방문지 추가", exact: true }).click();
    await p
      .getByLabel("장소 이름 검색", { exact: true })
      .fill("검색에없는시험장소");
    verify(
      "search_does_not_invent_matches",
      (await p
        .getByText("저장된 장소가 없어요.", { exact: false })
        .isVisible()) && (await p.locator(".place-result").count()) === 0,
      "No fabricated address",
    );
    await p.getByRole("button", { name: "직접 입력하기" }).click();
    await p
      .getByLabel("주소", { exact: true })
      .last()
      .fill("사용자가 확인한 주소");
    await p
      .getByRole("button", { name: "방문지 추가", exact: true })
      .last()
      .click();
    await p.getByRole("button", { name: "경로 저장", exact: true }).click();
    data = await saved();
    verify(
      "create_route_with_shortcut_and_manual_place",
      data.savedRoutes.length === 2 &&
        data.savedRoutes[0].stops[0].latitude === 37.5 &&
        data.savedRoutes[0].stops[1].address === "사용자가 확인한 주소" &&
        data.savedRoutes[0].stops[1].latitude === undefined,
      data.savedRoutes[0],
    );

    await p.getByRole("button", { name: "뒤로", exact: true }).click();
    for (const [width, height] of [
      [320, 700],
      [390, 844],
      [844, 390],
      [1024, 768],
    ]) {
      await p.setViewportSize({ width, height });
      await settle();
      verify(
        `layout_${width}x${height}`,
        !(await overflow()) &&
          (await p.getByRole("navigation", { name: "기본 메뉴" }).isVisible()),
        "No horizontal overflow; navigation available",
      );
      await p.screenshot({
        path: `C:/CARmeleon/verification/screenshots/mobile-verified-${width}.png`,
      });
    }
    await p.setViewportSize({ width: 390, height: 844 });
    await p.getByRole("button", { name: "야간 화면", exact: true }).click();
    await p.screenshot({
      path: "C:/CARmeleon/verification/screenshots/mobile-verified-dark.png",
    });
    await p.reload();
    verify(
      "theme_survives_reload",
      (await p.locator(".phone-dark").count()) === 1,
      "Dark preference restored",
    );
    await p.getByRole("button", { name: "설정", exact: true }).click();
    await p.getByRole("button", { name: /집.*시험 집/ }).click();
    await p.getByLabel("짧은 이름").fill("우리 집");
    await p.getByRole("button", { name: "장소 저장", exact: true }).click();
    data = await saved();
    verify(
      "shortcut_edit_preserves_coordinates",
      data.shortcuts[0].keyword === "우리 집" &&
        data.shortcuts[0].latitude === 37.5 &&
        data.shortcuts[0].longitude === 127,
      data.shortcuts[0],
    );
    const [exported] = await Promise.all([
      p.waitForEvent("download"),
      p.getByRole("button", { name: "경로 데이터 내보내기" }).click(),
    ]);
    const exportStream = await exported.createReadStream();
    const exportedChunks = [];
    for await (const chunk of exportStream) exportedChunks.push(chunk);
    verify(
      "export_preserves_route_and_original_links",
      JSON.parse(Buffer.concat(exportedChunks).toString()).savedRoutes.find(
        (r) => r.id === "test-route",
      ).stops[1].attachedDocumentIds[0] === "original-document",
      "JSON plan exported without file bytes",
    );

    await p.getByRole("button", { name: "자료", exact: true }).click();
    await p
      .getByRole("button", { name: "meeting-original.txt 삭제", exact: true })
      .click();
    await p.getByRole("button", { name: "확인", exact: true }).click();
    await p.getByRole("heading", { name: "자료를 함께 준비하세요" }).waitFor();
    verify(
      "delete_requires_confirmation",
      (await p
        .getByRole("button", { name: "meeting-original.txt 다운로드" })
        .count()) === 0,
      "Original removed after explicit confirmation",
    );

    await p.getByRole("button", { name: "경로", exact: true }).click();
    await p.getByRole("button", { name: /^새로 준비한 경로/ }).click();
    await p.getByRole("button", { name: "편집", exact: true }).click();
    await p
      .getByLabel("경로 이름", { exact: true })
      .fill("저장되지 않아야 하는 이름");
    await p.evaluate(() => {
      const original = Storage.prototype.setItem;
      Storage.prototype.setItem = function (key, value) {
        if (key === "carmeleon_plan_active_v3")
          throw new DOMException("Test quota", "QuotaExceededError");
        return original.call(this, key, value);
      };
    });
    await p.getByRole("button", { name: "경로 저장", exact: true }).click();
    verify(
      "quota_error_preserves_draft_and_original",
      (await p
        .getByText("저장 공간이 부족하거나 저장이 차단됐어요.", {
          exact: false,
        })
        .isVisible()) &&
        (await saved()).savedRoutes[0].title === "새로 준비한 경로" &&
        (await p.getByLabel("경로 이름", { exact: true }).inputValue()) ===
          "저장되지 않아야 하는 이름",
      "No false saved success",
    );
    await p.getByRole("button", { name: "뒤로", exact: true }).click();
    await p.keyboard.press("Escape");
    verify(
      "escape_closes_confirmation_only",
      (await p.getByRole("dialog").count()) === 0 &&
        (await p.getByLabel("경로 이름", { exact: true }).isVisible()),
      "Draft preserved",
    );
    await p.reload();
    await p.getByRole("button", { name: "지난 경로", exact: true }).click();
    verify(
      "empty_archive_remains_empty_after_reload",
      (await p
        .getByRole("heading", { name: "아직 지난 경로가 없어요" })
        .isVisible()) && (await saved()).pastRoutes.length === 0,
      "Deleted/empty archive not repopulated with samples",
    );
    await p.getByRole("button", { name: "준비한 경로", exact: true }).click();
    for (let remaining = 2; remaining > 0; remaining--) {
      await p.locator(".featured-route-summary").click();
      await p
        .getByRole("button", { name: "경로 더 보기", exact: true })
        .click();
      await p.getByRole("button", { name: "경로 삭제", exact: true }).click();
      await p.getByRole("button", { name: "확인", exact: true }).click();
      verify(
        `delete_route_${remaining}`,
        (await saved()).savedRoutes.length === remaining - 1,
        "Explicit deletion updates only local plan",
      );
    }
    await p.reload();
    verify(
      "last_route_deletion_survives_reload",
      (await p
        .getByRole("heading", { name: "첫 경로를 만들어 볼까요?" })
        .isVisible()) && (await saved()).activeRoute.stops.length === 0,
      "No deleted active route reappears",
    );
    verify("no_vehicle_or_account_requests", requests.length === 0, requests);
    verify("no_browser_runtime_errors", errors.length === 0, errors);
    return { status: "passed", checks };
  } finally {
    await context.close();
  }
}
