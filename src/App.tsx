import { lazy, Suspense, useState } from "react";
import { PhoneView } from "./components/PhoneView";
import { BrowserCockpit } from "./components/fallback/BrowserCockpit";
import { CarDashboardView } from "./components/CarDashboardView";
import { initialDailyPlan, getTodayDateString } from "./mockData";
import { DailyPlan } from "./types";

const FullVehicleCockpit = lazy(() => import("./components/FullVehicleCockpit").then(module => ({ default: module.FullVehicleCockpit })));

export default function App() {
  const searchParams =
    typeof window !== "undefined"
      ? new URLSearchParams(window.location.search)
      : null;
  const modeParam = searchParams?.get("mode");

  const isPhoneStandalone = modeParam === "phone";
  const isLegacyCar = modeParam === "legacy-car";

  // 기본값으로 차량용 앱(car)을 화면 전체에 띄웁니다!
  const [viewMode, setViewMode] = useState<"phone" | "car">(() => {
    if (isPhoneStandalone) return "phone";
    return "car";
  });

  const [currentPlan, setCurrentPlan] = useState<DailyPlan>(() => {
    const todayStr = getTodayDateString(0);
    let saved: string | null = null;
    try {
      saved =
        localStorage.getItem("carmeleon_plan_active_v3") ||
        localStorage.getItem("carmeleon_plan_active_v2");
    } catch {
      /* Browsing still works if storage is disabled. Saving reports the failure. */
    }
    if (saved) {
      try {
        const parsed: DailyPlan = JSON.parse(saved);
        if (parsed.savedRoutes && parsed.savedRoutes.length > 0) {
          parsed.savedRoutes = parsed.savedRoutes.map((r) =>
            r.date.includes("오늘") ? { ...r, date: todayStr } : r,
          );
        }
        if (parsed.activeRoute && parsed.activeRoute.date.includes("오늘")) {
          parsed.activeRoute.date = todayStr;
        }
        if (!parsed.pastRoutes) parsed.pastRoutes = [];
        return parsed;
      } catch (_) {}
    }
    return initialDailyPlan;
  });

  const handleUpdatePlan = (newPlan: DailyPlan) => {
    localStorage.setItem("carmeleon_plan_active_v3", JSON.stringify(newPlan));
    setCurrentPlan(newPlan);
  };

  if (viewMode === "phone") {
    return (
      <div className="relative">
        <div className="fixed top-3 right-4 z-50">
          <button
            onClick={() => setViewMode("car")}
            className="px-3.5 py-1.5 rounded-xl text-xs font-bold bg-blue-600 hover:bg-blue-700 text-white shadow-md shadow-blue-500/20 flex items-center gap-1.5 transition-all active:scale-95"
          >
            <span>🚗 차량용 대시보드로 전환</span>
          </button>
        </div>
        <PhoneView currentPlan={currentPlan} onUpdatePlan={handleUpdatePlan} />
      </div>
    );
  }

  if (isLegacyCar) {
    return (
      <div className="w-full h-full min-h-screen bg-[#f8fafc] text-slate-900 overflow-hidden font-sans select-none flex flex-col relative">
        <div className="absolute top-2.5 right-4 z-50">
          <button
            onClick={() => setViewMode("phone")}
            className="px-3.5 py-1.5 rounded-xl text-xs font-bold bg-white/95 hover:bg-white text-slate-700 hover:text-slate-900 border border-slate-200/90 shadow-sm hover:shadow flex items-center gap-1.5 transition-all active:scale-95"
          >
            <span>📱 스마트폰 앱 모드로 전환</span>
          </button>
        </div>
        <CarDashboardView
          currentPlan={currentPlan}
          onUpdatePlan={handleUpdatePlan}
          onSwitchToPhoneView={() => setViewMode("phone")}
          isStandaloneCarApp={true}
        />
      </div>
    );
  }

  if (modeParam !== "legacy-cockpit") {
    return <BrowserCockpit plan={currentPlan} onUpdatePlan={handleUpdatePlan} onPhone={() => setViewMode("phone")} />;
  }

  // =========================================================================
  // [순수 100% 풀스크린 차량 인포테인먼트 앱 (Pleos Automotive Cockpit UI)]:
  // 외곽 웹 껍데기/배너 전혀 없이 실제 차 화면 그대로 100% 화면을 꽉 채웁니다.
  // =========================================================================
  return (
    <Suspense fallback={<div role="status">이전 차량 시안을 불러오고 있어요.</div>}><FullVehicleCockpit
      currentPlan={currentPlan}
      onSwitchToPhoneView={() => setViewMode("phone")}
    /></Suspense>
  );
}
