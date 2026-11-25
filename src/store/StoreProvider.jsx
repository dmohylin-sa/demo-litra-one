import { createContext, useContext, useEffect, useMemo, useReducer, useRef } from 'react';
import { reducer } from './reducer.js';
import { createSeed } from '../data/seed.js';
import { ixOf } from '../domain/ix.js';

const KEY = 'litra-one-demo-state';
const Ctx = createContext(null);

function load(persist) {
  const fresh = createSeed();
  if (!persist) return fresh;
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const saved = JSON.parse(raw);
      if (saved?.version === fresh.version) return { ...saved, sim: { speed: 0 } };
    }
  } catch {
    /* storage unavailable - start fresh */
  }
  return fresh;
}

// persist (default true): the prototype's behaviour - state saved in localStorage, test hook on window.
// persist={false}: a fresh, in-memory store (used by UX concepts that embed a prototype screen, so they never read or
// write the prototype's saved state). role: optional starting role for such an embedded store.
export function StoreProvider({ children, persist = true, role }) {
  const [state, dispatch] = useReducer(reducer, undefined, () => {
    const s = load(persist);
    return role ? { ...s, ui: { ...s.ui, role } } : s;
  });

  useEffect(() => {
    if (!persist) return undefined;
    const h = setTimeout(() => {
      try {
        localStorage.setItem(KEY, JSON.stringify(state));
      } catch {
        /* ignore */
      }
    }, 500);
    return () => clearTimeout(h);
  }, [state, persist]);

  // Demo clock: N simulated minutes per real second.
  useEffect(() => {
    if (!state.sim.speed) return undefined;
    const h = setInterval(() => dispatch({ type: 'TICK', min: state.sim.speed }), 1000);
    return () => clearInterval(h);
  }, [state.sim.speed]);

  // UBW posting queue: invoices in "Posting" get a response after ~1.6 s.
  const scheduled = useRef(new Set());
  useEffect(() => {
    state.invoices
      .filter((i) => i.status === 'Posting' && !scheduled.current.has(i.id))
      .forEach((i) => {
        scheduled.current.add(i.id);
        setTimeout(() => {
          dispatch({ type: 'INV_POST_RESULT', id: i.id });
          scheduled.current.delete(i.id);
        }, 1600);
      });
  }, [state.invoices]);

  // Test hook for automated browser checks (read state, dispatch actions).
  const stateRef = useRef(state);
  stateRef.current = state;
  useEffect(() => {
    if (persist) window.__litra = { dispatch, getState: () => stateRef.current };
  }, [persist]);

  const ix = ixOf(state.masters);
  const value = useMemo(() => ({ state, dispatch, ix }), [state, ix]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export const useStore = () => useContext(Ctx);
