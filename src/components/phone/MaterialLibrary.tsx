import type { ReactNode } from "react";
import { FileText, FolderOpen, Route } from "lucide-react";
import type { SavedRoute } from "../../types";
import type { LocalMaterial } from "./localMaterials";
import { EmptyState } from "./PhonePrimitives";

export function MaterialLibrary({
  routes,
  files,
  renderFile,
  onPaths,
  onRoute,
}: {
  routes: SavedRoute[];
  files: LocalMaterial[];
  renderFile: (file: LocalMaterial) => ReactNode;
  onPaths: () => void;
  onRoute: (id: string) => void;
}) {
  const hasLegacyNames = routes.some((route) =>
    route.stops.some((stop) => stop.attachedFile),
  );
  const orphaned = files.filter(
    (file) => !routes.some((route) => route.id === file.routeId),
  );
  return (
    <main className="phone-content">
      <div className="page-heading">
        <h1>여정에 필요한 자료</h1>
      </div>
      <p className="page-description">방문지에 첨부한 자료를 모아뒀어요.</p>
      {routes.map((route) => {
        const linked = files.filter((file) => file.routeId === route.id);
        const legacy = route.stops.filter(
          (stop) =>
            stop.attachedFile &&
            !linked.some(
              (file) =>
                file.stopId === stop.id && file.name === stop.attachedFile,
            ),
        );
        if (!linked.length && !legacy.length) return null;
        return (
          <section className="material-group" key={route.id}>
            <h2>{route.title}</h2>
            {linked.map((file) => (
              <div key={file.id}>
                <p className="material-stop-label">
                  {route.stops.find((stop) => stop.id === file.stopId)?.name ??
                    "이전 방문지"}
                </p>
                {renderFile(file)}
              </div>
            ))}
            {legacy.map((stop) => (
              <div key={stop.id} className="legacy-library-file">
                <FileText size={20} />
                <span>
                  <strong>{stop.attachedFile}</strong>
                  <small>{stop.name} · 기존 파일명만 보관 중</small>
                </span>
                <button
                  className="text-button"
                  onClick={() => onRoute(route.id)}
                >
                  원본 첨부
                </button>
              </div>
            ))}
          </section>
        );
      })}
      {!files.length && !hasLegacyNames && (
        <EmptyState
          title="자료를 함께 준비하세요"
          action={
            <button className="secondary-button" onClick={onPaths}>
              <Route size={18} />
              경로에서 첨부하기
            </button>
          }
        >
          경로의 방문지에서 제안서나 여행 자료를 첨부할 수 있어요.
        </EmptyState>
      )}
      {!!orphaned.length && (
        <section className="material-group">
          <h2>이전 경로의 자료</h2>
          {orphaned.map(renderFile)}
        </section>
      )}
      <div className="storage-note">
        <FolderOpen size={19} />
        <p>
          파일은 이 브라우저에만 보관돼요.
          <br />
          계정·차량 동기화와 AI 자료 분석은 아직 연결되지 않았어요.
        </p>
      </div>
    </main>
  );
}
