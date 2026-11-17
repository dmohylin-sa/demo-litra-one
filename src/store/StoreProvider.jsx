import { createContext, useContext, useEffect, useMemo, useReducer, useRef } from 'react';
import { reducer } from './reducer.js';
import { createSeed } from '../data/seed.js';
import { ixOf } from '../domain/ix.js';

const KEY = 'litra-one-demo-state';
const Ctx = createContext(null);

function load() {
  const fresh = createSeed();
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

export function StoreProvider({ children }) {
  const [state, dispatch] = useReducer(reducer, undefined, load);

  useEffect(() => {
    const h = setTimeout(() => {
      try {
        localStorage.setItem(KEY, JSON.stringify(state));
      } catch {
        /* ignore */
      }
    }, 500);
    return () => clearTimeout(h);
  }, [state]);

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
    window.__litra = { dispatch, getState: () => stateRef.current };
  }, []);

  const ix = ixOf(state.masters);
  const value = useMemo(() => ({ state, dispatch, ix }), [state, ix]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export const useStore = () => useContext(Ctx);
