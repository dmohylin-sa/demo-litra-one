// UX exploration mode.
//
// Default (no flag, including `npm run build` and the GitHub Pages deploy): the original prototype
// runs unchanged, and the UX concepts are reachable at #/concepts (see Root in App.jsx).
//
// Opt-in exploration mode runs the app as a standalone UX exploration: only the concepts under
// src/concepts/ are reachable; the original prototype shell, store and demo sign-in are not mounted.
//
// To run the standalone UX exploration:  npm run dev:ux   (Vite mode "ux")
// or, equivalently:                      VITE_UX_EXPLORATION=true npm run dev
export const UX_EXPLORATION = import.meta.env.MODE === 'ux' || import.meta.env.VITE_UX_EXPLORATION === 'true';
