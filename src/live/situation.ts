import type { RouteStop, SavedRoute } from '../types';
export type Situation = 'travel' | 'work' | 'daily';
export type CompanionPreferences = { focus: 'auto' | Situation; goal: string; quiet: boolean };
export const defaultPreferences: CompanionPreferences = { focus: 'auto', goal: '', quiet: false };
export function focusFromGoal(goal: string): CompanionPreferences['focus'] {
  const work = /미팅|회의|업무|출장|영업/.test(goal), travel = /여행|관광|나들이|구경/.test(goal);
  if (work && !travel) return 'work';
  if (travel && !work) return 'travel';
  if (!work && !travel && /귀가|퇴근|집으로/.test(goal)) return 'daily';
  return 'auto';
}
export function situationFor(route: SavedRoute, target: RouteStop | undefined, hasTargetMaterial: boolean, preferences: CompanionPreferences): Situation {
  if (preferences.focus !== 'auto') return preferences.focus;
  if (!target || /^(집|우리집|귀가)$/.test(target.name.trim())) return 'daily';
  if (target.type === 'business') return 'work';
  if (target.type === 'travel') return 'travel';
  if (route.isTravel && !route.isBusiness) return 'travel';
  if (hasTargetMaterial) return 'work';
  if (/미팅|회의|본사|연구소|기업|거래처/.test(target.category || target.name)) return 'work';
  if (route.isBusiness && !route.isTravel) return 'work';
  return 'daily';
}
export const situationLabel: Record<Situation, string> = { work: '다음 만남을 준비하며', travel: '가는 길도 여행이니까', daily: '편하게 함께 가요' };
