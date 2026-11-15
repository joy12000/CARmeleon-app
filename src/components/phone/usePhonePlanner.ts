import { useState } from "react";
import type { DailyPlan, RouteStop, SavedRoute } from "../../types";
import {
  getIsoDateString,
  formatIsoToDisplayDate,
} from "../../utils/dateUtils";

export const newId = (prefix: string) => `${prefix}-${crypto.randomUUID()}`;
export const cloneRoute = (route: SavedRoute): SavedRoute =>
  structuredClone(route);
export const emptyRoute = (): SavedRoute => ({
  id: newId("route"),
  title: "",
  date: getIsoDateString(),
  isActiveInCar: false,
  isTravel: true,
  stops: [],
});
export const displayDate = (date: string) =>
  /^\d{4}-\d{2}-\d{2}$/.test(date) ? formatIsoToDisplayDate(date) : date;
export const routeKind = (route: SavedRoute) =>
  route.isBusiness && route.isTravel
    ? "업무 · 여행"
    : route.isBusiness
      ? "업무"
      : route.isTravel
        ? "여행"
        : "일상";
export const fileStopKey = (routeId: string, stopId: string) =>
  `${routeId}/${stopId}`;

/** The phone edits preparation data. Selecting it does not report a Pleos navigation acknowledgement. */
export function usePhonePlanner(
  plan: DailyPlan,
  update: (plan: DailyPlan) => boolean,
) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState<SavedRoute | null>(null);
  const [message, setMessage] = useState("");
  const selected = [
    ...plan.savedRoutes,
    ...(plan.pastRoutes ?? []),
    plan.activeRoute,
  ].find((route) => route.id === selectedId);
  const save = (route: SavedRoute) => {
    const next = { ...route, title: route.title.trim() };
    const exists = plan.savedRoutes.some((item) => item.id === route.id);
    const archived = plan.pastRoutes?.some((item) => item.id === route.id);
    if (
      !update({
        ...plan,
        savedRoutes: exists
          ? plan.savedRoutes.map((item) => (item.id === route.id ? next : item))
          : archived
            ? plan.savedRoutes
            : [next, ...plan.savedRoutes],
        pastRoutes: plan.pastRoutes?.map((item) =>
          item.id === route.id ? next : item,
        ),
        activeRoute: plan.activeRoute.id === route.id ? next : plan.activeRoute,
      })
    )
      return;
    setSelectedId(route.id);
    setDraft(null);
    setMessage("이 기기에 경로를 저장했어요.");
  };
  const prepare = (route: SavedRoute) => {
    // Keep the legacy field unchanged: it is not evidence that this phone controls a vehicle.
    if (!update({ ...plan, activeRoute: route })) return;
    setMessage("준비 경로로 선택했어요. 차량 동기화는 아직 연결되지 않았어요.");
  };
  const remove = (route: SavedRoute) => {
    const remaining = plan.savedRoutes.filter((item) => item.id !== route.id);
    if (
      !update({
        ...plan,
        savedRoutes: remaining,
        pastRoutes: plan.pastRoutes?.filter((item) => item.id !== route.id),
        activeRoute:
          plan.activeRoute.id === route.id
            ? (remaining[0] ?? { ...emptyRoute(), title: "준비한 경로 없음" })
            : plan.activeRoute,
      })
    )
      return;
    setSelectedId(null);
    setMessage("이 기기에서 경로를 삭제했어요.");
  };
  const restore = (route: SavedRoute) => {
    const next = {
      ...cloneRoute(route),
      id: newId("route"),
      date: getIsoDateString(),
      isActiveInCar: false,
    };
    // Stop IDs and original material references are retained when copying an itinerary.
    save(next);
  };
  const updateStop = (stopId: string, changes: Partial<RouteStop>) =>
    setDraft(
      (current) =>
        current && {
          ...current,
          stops: current.stops.map((stop) =>
            stop.id === stopId ? { ...stop, ...changes } : stop,
          ),
        },
    );
  return {
    selected,
    selectedId,
    setSelectedId,
    draft,
    setDraft,
    save,
    prepare,
    remove,
    restore,
    updateStop,
    message,
    setMessage,
  };
}
