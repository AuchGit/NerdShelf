// React bindings for the store. Components select the slice they need so a
// token drag re-renders only what depends on that token, not the whole tree.
import { useSyncExternalStore, useRef } from 'react';
import { subscribe, getState } from './store';

// Selector hook with referential-equality bail-out via a cached snapshot.
export function useVtt(selector) {
  const lastDeps = useRef({ val: undefined, has: false });
  const getSnapshot = () => {
    const next = selector(getState());
    const prev = lastDeps.current;
    if (prev.has && shallowEqual(prev.val, next)) return prev.val;
    prev.val = next;
    prev.has = true;
    return next;
  };
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

function shallowEqual(a, b) {
  if (Object.is(a, b)) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a == null || b == null) return false;
  const ka = Object.keys(a), kb = Object.keys(b);
  if (ka.length !== kb.length) return false;
  for (const k of ka) if (!Object.is(a[k], b[k])) return false;
  return true;
}

// Common selectors.
export const useSession = () => useVtt((s) => s.session);
export const useIsDM = () => useVtt((s) => s.session.role === 'dm');
export const useActiveMap = () => useVtt((s) => (s.activeMapId ? s.maps[s.activeMapId] : null));
export const useTool = () => useVtt((s) => s.ui.tool);
export const useSelectedTokenId = () => useVtt((s) => s.ui.selectedTokenId);
