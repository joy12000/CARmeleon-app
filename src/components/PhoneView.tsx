import { useEffect, useRef, useState } from "react";
import {
  ArrowRight,
  Bookmark,
  Car,
  Check,
  ChevronRight,
  Download,
  FileText,
  FolderOpen,
  MapPin,
  Moon,
  MoreHorizontal,
  Paperclip,
  Pencil,
  Plus,
  Route,
  Settings2,
  Sun,
  Trash2,
  X,
} from "lucide-react";
import type { DailyPlan, ShortcutPlace } from "../types";
import { mockSavedRoutes, mockPastRoutes } from "../mockData";
import { isPastRouteDate } from "../utils/dateUtils";
import {
  cloneRoute,
  displayDate,
  emptyRoute,
  newId,
  routeKind,
  usePhonePlanner,
} from "./phone/usePhonePlanner";
import { EmptyState, PhoneDialog, PhoneHeader } from "./phone/PhonePrimitives";
import { RouteEditor, StopPicker } from "./phone/RouteEditor";
import {
  deleteLocalMaterial,
  downloadLocalMaterial,
  listLocalMaterials,
  saveLocalMaterial,
} from "./phone/localMaterials";
import type { LocalMaterial } from "./phone/localMaterials";
import { MaterialLibrary } from "./phone/MaterialLibrary";
import { RouteLocationMap } from "./phone/RouteLocationMap";
import "./phone/phone.css";

interface PhoneViewProps {
  currentPlan: DailyPlan;
  onUpdatePlan: (plan: DailyPlan) => void;
}
type Tab = "paths" | "materials" | "settings";
const exampleRouteIds = new Set(
  [...mockSavedRoutes, ...mockPastRoutes].map((route) => route.id),
);
type Confirm = { title: string; detail: string; action: () => void };

export function PhoneView({ currentPlan: plan, onUpdatePlan }: PhoneViewProps) {
  const [tab, setTab] = useState<Tab>("paths");
  const [dark, setDark] = useState(() => {
    try {
      return localStorage.getItem("carmeleon_phone_theme") === "dark";
    } catch {
      return false;
    }
  });
  const [storageError, setStorageError] = useState("");
  const [archive, setArchive] = useState(false);
  const [confirm, setConfirm] = useState<Confirm | null>(null);
  const [menu, setMenu] = useState(false);
  const [files, setFiles] = useState<LocalMaterial[]>([]);
  const [uploading, setUploading] = useState(false);
  const [uploadTarget, setUploadTarget] = useState<{
    routeId: string;
    stopId: string;
  } | null>(null);
  const [shortcutPicker, setShortcutPicker] = useState(false);
  const [shortcutDraft, setShortcutDraft] = useState<ShortcutPlace | null>(
    null,
  );
  const fileInput = useRef<HTMLInputElement>(null);
  const safeUpdate = (next: DailyPlan) => {
    try {
      onUpdatePlan(next);
      setStorageError("");
      return true;
    } catch {
      setStorageError(
        "저장 공간이 부족하거나 저장이 차단됐어요. 기존 내용을 보존했어요. 공간을 확인하고 다시 저장해 주세요.",
      );
      return false;
    }
  };
  const planner = usePhonePlanner(plan, safeUpdate);
  const { selected, draft } = planner;
  const refreshFiles = () =>
    listLocalMaterials()
      .then(setFiles)
      .catch((error) => setStorageError(error.message));
  useEffect(() => {
    void refreshFiles();
  }, []);
  useEffect(() => {
    try {
      localStorage.setItem("carmeleon_phone_theme", dark ? "dark" : "light");
    } catch {
      /* Theme changes do not modify route data. */
    }
  }, [dark]);
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: "instant" });
  }, [tab, planner.selectedId, !!draft, archive]);
  useEffect(() => {
    if (!planner.message) return;
    const timer = setTimeout(() => planner.setMessage(""), 5500);
    return () => clearTimeout(timer);
  }, [planner.message]);
  const allRoutes = [
    ...plan.savedRoutes,
    ...(plan.pastRoutes ?? []),
    ...(plan.activeRoute.stops.length ? [plan.activeRoute] : []),
  ].filter(
    (route, index, all) =>
      all.findIndex((item) => item.id === route.id) === index,
  );
  const routes = allRoutes.filter((route) =>
    archive ? isPastRouteDate(route.date) : !isPastRouteDate(route.date),
  );
  const featured =
    routes.find((route) => route.id === plan.activeRoute.id) ?? routes[0];
  const changeTab = (next: Tab) => {
    setTab(next);
    planner.setSelectedId(null);
    setMenu(false);
  };
  const chooseFile = (routeId: string, stopId: string) => {
    setUploadTarget({ routeId, stopId });
    fileInput.current?.click();
  };
  const askDeleteFile = (file: LocalMaterial) =>
    setConfirm({
      title: "이 파일을 삭제할까요?",
      detail: `${file.name} 원본이 이 브라우저에서 삭제돼요.`,
      action: () => {
        void deleteLocalMaterial(file.id)
          .then(refreshFiles)
          .catch((error) => setStorageError(error.message));
      },
    });
  const download = (id: string) => {
    void downloadLocalMaterial(id).catch((error) =>
      setStorageError(error.message),
    );
  };
  const exportPlan = () => {
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(plan, null, 2)], { type: "application/json" }),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = `carmeleon-plan-${new Date().toISOString().slice(0, 10)}.json`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const fileRow = (file: LocalMaterial) => (
    <div className="material-row" key={file.id}>
      <FileText size={22} />
      <button className="material-name" onClick={() => download(file.id)}>
        <strong>{file.name}</strong>
        <small>{(file.size / 1024).toFixed(0)} KB · 이 기기</small>
      </button>
      <button
        className="icon-button"
        aria-label={`${file.name} 다운로드`}
        onClick={() => download(file.id)}
      >
        <Download size={18} />
      </button>
      <button
        className="icon-button"
        aria-label={`${file.name} 삭제`}
        onClick={() => askDeleteFile(file)}
      >
        <X size={18} />
      </button>
    </div>
  );

  return (
    <div className={`phone-app ${dark ? "phone-dark" : ""}`}>
      <input
        hidden
        type="file"
        ref={fileInput}
        aria-label="자료 파일 선택"
        onChange={async (event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (!file || !uploadTarget) return;
          setUploading(true);
          try {
            await saveLocalMaterial(
              file,
              uploadTarget.routeId,
              uploadTarget.stopId,
            );
            await refreshFiles();
            planner.setMessage("원본 파일을 이 기기에 저장했어요.");
          } catch (error) {
            setStorageError((error as Error).message);
          } finally {
            setUploading(false);
          }
        }}
      />
      {draft ? (
        <RouteEditor
          draft={draft}
          shortcuts={plan.shortcuts}
          onChange={planner.setDraft}
          onSave={() => planner.save(draft)}
          onClose={() =>
            setConfirm({
              title: "편집을 그만둘까요?",
              detail: "저장하지 않은 변경 내용은 사라져요.",
              action: () => planner.setDraft(null),
            })
          }
        />
      ) : (
        <>
          <PhoneHeader
            title={
              selected
                ? "경로"
                : tab === "paths"
                  ? "내 경로"
                  : tab === "materials"
                    ? "자료"
                    : "설정"
            }
            back={
              selected
                ? () => {
                    planner.setSelectedId(null);
                    setMenu(false);
                  }
                : undefined
            }
            action={
              selected ? (
                <button
                  className="icon-button"
                  aria-label="경로 더 보기"
                  aria-expanded={menu}
                  onClick={() => setMenu(!menu)}
                >
                  <MoreHorizontal />
                </button>
              ) : (
                <button
                  className="icon-button"
                  aria-label={dark ? "주간 화면" : "야간 화면"}
                  onClick={() => setDark(!dark)}
                >
                  {dark ? <Sun size={21} /> : <Moon size={21} />}
                </button>
              )
            }
          />
          {selected ? (
            <main className="phone-content detail-content">
              {menu && (
                <div className="route-menu">
                  <button
                    onClick={() => {
                      planner.setDraft(cloneRoute(selected));
                      setMenu(false);
                    }}
                  >
                    <Pencil size={18} />
                    경로 편집
                  </button>
                  <button
                    className="danger-text"
                    onClick={() => {
                      setMenu(false);
                      setConfirm({
                        title: "이 경로를 삭제할까요?",
                        detail:
                          "이 기기의 경로가 삭제돼요. 첨부한 원본 파일은 자료에 남겨둬요.",
                        action: () => planner.remove(selected),
                      });
                    }}
                  >
                    <Trash2 size={18} />
                    경로 삭제
                  </button>
                </div>
              )}
              <div className="route-meta">
                <span>{displayDate(selected.date)}</span>
                <span>{routeKind(selected)}</span>
              </div>
              <h1 className="detail-title">{selected.title}</h1>
              <RouteLocationMap route={selected} interactive />
              <div className="section-heading">
                <h2>함께 갈 곳</h2>
                <button
                  className="text-button"
                  onClick={() => planner.setDraft(cloneRoute(selected))}
                >
                  <Pencil size={16} />
                  편집
                </button>
              </div>
              <ol className="stop-timeline">
                {selected.stops.map((stop, index) => (
                  <li key={stop.id}>
                    <div className="timeline-marker">
                      <span>{index + 1}</span>
                    </div>
                    <div className="timeline-body">
                      <div className="stop-title">
                        <h3>{stop.name}</h3>
                        {stop.time && <time>{stop.time}</time>}
                      </div>
                      {stop.address && (
                        <p className="stop-address">{stop.address}</p>
                      )}
                      {stop.memo && (
                        <details className="stop-memo">
                          <summary>메모 보기</summary>
                          <p>{stop.memo}</p>
                        </details>
                      )}
                      {stop.attachedFile &&
                        !files.some(
                          (file) =>
                            file.routeId === selected.id &&
                            file.stopId === stop.id &&
                            file.name === stop.attachedFile,
                        ) && (
                          <div className="legacy-file">
                            <FileText size={16} />
                            <span>
                              {stop.attachedFile}
                              <small>
                                기존 파일명 · 원본을 다시 첨부해 주세요
                              </small>
                            </span>
                          </div>
                        )}
                      {files
                        .filter(
                          (file) =>
                            file.routeId === selected.id &&
                            file.stopId === stop.id,
                        )
                        .map(fileRow)}
                      <button
                        className="text-button attach-button"
                        disabled={uploading}
                        onClick={() => chooseFile(selected.id, stop.id)}
                      >
                        <Paperclip size={16} />
                        {uploading ? "저장 중" : "자료 첨부"}
                      </button>
                    </div>
                  </li>
                ))}
              </ol>
              {selected.stops.length === 0 && (
                <EmptyState
                  title="방문지를 추가해 주세요"
                  action={
                    <button
                      className="secondary-button"
                      onClick={() => planner.setDraft(cloneRoute(selected))}
                    >
                      <Plus size={18} />
                      방문지 추가
                    </button>
                  }
                >
                  순서와 메모를 함께 준비할 수 있어요.
                </EmptyState>
              )}
              <div className="detail-footer">
                <button
                  className="primary-button"
                  disabled={!selected.stops.length}
                  onClick={() =>
                    isPastRouteDate(selected.date)
                      ? planner.restore(selected)
                      : planner.prepare(selected)
                  }
                >
                  {isPastRouteDate(selected.date) ? (
                    <Plus size={19} />
                  ) : (
                    <Car size={20} />
                  )}
                  {isPastRouteDate(selected.date)
                    ? "오늘 경로로 복사"
                    : "준비 경로로 선택"}
                </button>
                <p>이 기기에 저장 · 차량 동기화 미연결</p>
              </div>
            </main>
          ) : tab === "paths" ? (
            <main className="phone-content paths-content">
              <div className="page-heading">
                <h1>{archive ? "지난 경로" : "다음 여정"}</h1>
                <button
                  className="icon-button add-route-button"
                  aria-label="새 경로 만들기"
                  onClick={() => planner.setDraft(emptyRoute())}
                >
                  <Plus />
                </button>
              </div>
              <div className="path-tabs">
                <button
                  aria-pressed={!archive}
                  onClick={() => setArchive(false)}
                >
                  준비한 경로
                </button>
                <button aria-pressed={archive} onClick={() => setArchive(true)}>
                  지난 경로
                </button>
              </div>
              {featured ? (
                <>
                  <section className="featured-route">
                    <button
                      className="featured-route-summary"
                      onClick={() => planner.setSelectedId(featured.id)}
                      aria-label={`${featured.title} 경로 열기`}
                    >
                      <div className="route-meta">
                        <span>{displayDate(featured.date)}</span>
                        <span>{routeKind(featured)}</span>
                      </div>
                      <h2>{featured.title}</h2>
                    </button>
                    <RouteLocationMap route={featured} />
                    <button
                      className="featured-route-footer"
                      onClick={() => planner.setSelectedId(featured.id)}
                    >
                      <span>
                        <MapPin size={16} />
                        {featured.stops.length}곳
                      </span>
                      <span>
                        경로 살펴보기
                        <ArrowRight size={19} />
                      </span>
                    </button>
                  </section>
                  {routes.length > 1 && (
                    <section className="saved-paths">
                      <div className="section-heading">
                        <h2>{archive ? "다녀온 곳" : "다른 경로"}</h2>
                        <span>{routes.length - 1}개</span>
                      </div>
                      {routes
                        .filter((route) => route.id !== featured.id)
                        .map((route) => (
                          <button
                            className="saved-route-row"
                            key={route.id}
                            onClick={() => planner.setSelectedId(route.id)}
                          >
                            <div className="route-row-icon">
                              <Route size={21} />
                            </div>
                            <span>
                              <strong>{route.title}</strong>
                              <small>
                                {displayDate(route.date)} · {route.stops.length}
                                곳 · {routeKind(route)}
                              </small>
                            </span>
                            <ChevronRight size={19} />
                          </button>
                        ))}
                    </section>
                  )}
                  <button
                    className="new-route-button"
                    onClick={() => planner.setDraft(emptyRoute())}
                  >
                    <Plus size={20} />새 경로 만들기
                  </button>
                </>
              ) : (
                <EmptyState
                  title={
                    archive
                      ? "아직 지난 경로가 없어요"
                      : "첫 경로를 만들어 볼까요?"
                  }
                  action={
                    <button
                      className="primary-button"
                      onClick={() => planner.setDraft(emptyRoute())}
                    >
                      <Plus size={19} />새 경로 만들기
                    </button>
                  }
                >
                  방문할 곳과 기억할 내용을 한곳에 준비하세요.
                </EmptyState>
              )}
              <div className="local-status">
                <span className="status-dot" />이 기기에 저장됨
                {allRoutes.some((route) => exampleRouteIds.has(route.id)) && (
                  <span>예시 경로 포함</span>
                )}
              </div>
            </main>
          ) : tab === "materials" ? (
            <MaterialLibrary
              routes={allRoutes}
              files={files}
              renderFile={fileRow}
              onPaths={() => changeTab("paths")}
              onRoute={planner.setSelectedId}
            />
          ) : (
            <main className="phone-content settings-content">
              <div className="page-heading">
                <h1>설정</h1>
              </div>
              <section className="settings-section">
                <h2>저장과 연결</h2>
                <div className="settings-info">
                  <Car size={22} />
                  <span>
                    <strong>차량 동기화 미연결</strong>
                    <small>지금은 이 기기에서 경로를 준비할 수 있어요.</small>
                  </span>
                </div>
                <button className="settings-row" onClick={exportPlan}>
                  <span>경로 데이터 내보내기</span>
                  <Download size={19} />
                </button>
                <p className="field-hint">
                  JSON에는 경로·메모·장소가 담겨요. 원본 파일은 자료에서 각각
                  내려받아 주세요.
                </p>
              </section>
              <section className="settings-section">
                <div className="section-heading">
                  <h2>자주 가는 장소</h2>
                  <button
                    className="icon-button"
                    aria-label="자주 가는 장소 추가"
                    onClick={() => setShortcutPicker(true)}
                  >
                    <Plus size={21} />
                  </button>
                </div>
                {plan.shortcuts.map((place) => (
                  <div className="shortcut-setting" key={place.id}>
                    <Bookmark size={19} />
                    <button onClick={() => setShortcutDraft({ ...place })}>
                      <strong>{place.keyword}</strong>
                      <small>{place.name}</small>
                    </button>
                    <button
                      className="icon-button"
                      aria-label={`${place.keyword} 삭제`}
                      onClick={() =>
                        setConfirm({
                          title: "저장한 장소를 삭제할까요?",
                          detail: `${place.keyword} 단축어를 지워요. 기존 경로는 바뀌지 않아요.`,
                          action: () =>
                            safeUpdate({
                              ...plan,
                              shortcuts: plan.shortcuts.filter(
                                (item) => item.id !== place.id,
                              ),
                            }),
                        })
                      }
                    >
                      <Trash2 size={17} />
                    </button>
                  </div>
                ))}
              </section>
              <section className="settings-section">
                <h2>화면</h2>
                <button
                  className="settings-row"
                  role="switch"
                  aria-checked={dark}
                  onClick={() => setDark(!dark)}
                >
                  <span>야간 화면</span>
                  <span className={`phone-switch ${dark ? "is-on" : ""}`}>
                    <span />
                  </span>
                </button>
              </section>
              <p className="phone-version">carmeleon · 모바일 준비 화면</p>
            </main>
          )}
          <nav className="phone-navigation" aria-label="기본 메뉴">
            {(
              [
                { id: "paths", label: "경로", icon: Route },
                { id: "materials", label: "자료", icon: FolderOpen },
                { id: "settings", label: "설정", icon: Settings2 },
              ] as const
            ).map((item) => (
              <button
                key={item.id}
                aria-current={tab === item.id ? "page" : undefined}
                onClick={() => changeTab(item.id)}
              >
                <item.icon size={22} strokeWidth={1.7} />
                <span>{item.label}</span>
              </button>
            ))}
          </nav>
        </>
      )}
      {(planner.message || storageError) && (
        <div
          className={`phone-notice ${storageError ? "notice-error" : ""}`}
          role={storageError ? "alert" : "status"}
        >
          {storageError ? <FileText size={18} /> : <Check size={18} />}
          <span>{storageError || planner.message}</span>
          <button
            className="icon-button"
            aria-label="알림 닫기"
            onClick={() => {
              setStorageError("");
              planner.setMessage("");
            }}
          >
            <X size={17} />
          </button>
        </div>
      )}
      {confirm && (
        <PhoneDialog title={confirm.title} onClose={() => setConfirm(null)}>
          <p className="dialog-description">{confirm.detail}</p>
          <div className="dialog-buttons">
            <button
              className="secondary-button"
              onClick={() => setConfirm(null)}
            >
              취소
            </button>
            <button
              className="primary-button"
              onClick={() => {
                confirm.action();
                setConfirm(null);
              }}
            >
              확인
            </button>
          </div>
        </PhoneDialog>
      )}
      {shortcutPicker && (
        <StopPicker
          shortcuts={[]}
          onClose={() => setShortcutPicker(false)}
          onAdd={(stop) => {
            setShortcutPicker(false);
            setShortcutDraft({
              id: newId("shortcut"),
              keyword: stop.name,
              name: stop.name,
              address: stop.address ?? "",
              latitude: stop.latitude,
              longitude: stop.longitude,
              icon: "star",
            });
          }}
        />
      )}
      {shortcutDraft && (
        <PhoneDialog
          title="자주 가는 장소"
          onClose={() => setShortcutDraft(null)}
        >
          <form
            className="stack-form"
            onSubmit={(event) => {
              event.preventDefault();
              if (!shortcutDraft.keyword.trim() || !shortcutDraft.name.trim())
                return;
              const exists = plan.shortcuts.some(
                (item) => item.id === shortcutDraft.id,
              );
              if (
                safeUpdate({
                  ...plan,
                  shortcuts: exists
                    ? plan.shortcuts.map((item) =>
                        item.id === shortcutDraft.id ? shortcutDraft : item,
                      )
                    : [...plan.shortcuts, shortcutDraft],
                })
              )
                setShortcutDraft(null);
            }}
          >
            <label>
              짧은 이름
              <input
                autoFocus
                required
                value={shortcutDraft.keyword}
                onChange={(event) =>
                  setShortcutDraft({
                    ...shortcutDraft,
                    keyword: event.target.value,
                  })
                }
                placeholder="집, 회사, 단골 카페"
              />
            </label>
            <label>
              장소 이름
              <input
                required
                value={shortcutDraft.name}
                onChange={(event) =>
                  setShortcutDraft({
                    ...shortcutDraft,
                    name: event.target.value,
                  })
                }
              />
            </label>
            <label>
              주소
              <input
                value={shortcutDraft.address}
                onChange={(event) =>
                  setShortcutDraft({
                    ...shortcutDraft,
                    address: event.target.value,
                  })
                }
              />
            </label>
            <button className="primary-button" type="submit">
              장소 저장
            </button>
          </form>
        </PhoneDialog>
      )}
    </div>
  );
}
