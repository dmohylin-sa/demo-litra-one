import { Routes, Route, Navigate } from 'react-router-dom';
import ConceptsRoutes from './ConceptsRoutes.jsx';
import { FIRST_STEP } from './demo-steps.js';

// Concept-only entry for UX exploration mode (see mode.js).
// - Default landing page: step 01 of the BA demo journey (src/concepts/demo-steps.js), which opens the Control Tower.
// - Every other path, including the original prototype routes, redirects to it.
// - The concept index (#/concepts) still lists every concept and alternative.
// - Not mounted here: the prototype shell, its persisted store (StoreProvider / localStorage)
//   and the demo sign-in gate. Their code is unchanged and still used when the mode is off.
const HOME = FIRST_STEP.route; // '/concepts/demo/01'

export default function ExplorationApp() {
  return (
    <Routes>
      <Route path="/concepts/*" element={<ConceptsRoutes />} />
      <Route path="*" element={<Navigate to={HOME} replace />} />
    </Routes>
  );
}
