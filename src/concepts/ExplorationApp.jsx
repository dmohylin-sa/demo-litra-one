import { Routes, Route, Navigate } from 'react-router-dom';
import ConceptsRoutes from './ConceptsRoutes.jsx';

// Concept-only entry for UX exploration mode (see mode.js).
// - Default landing page: the Planner dashboard concept.
// - Every other path, including the original prototype routes, redirects to it.
// - Not mounted here: the prototype shell, its persisted store (StoreProvider / localStorage)
//   and the demo sign-in gate. Their code is unchanged and still used when the mode is off.
const HOME = '/concepts/planner-dashboard';

export default function ExplorationApp() {
  return (
    <Routes>
      <Route path="/concepts/*" element={<ConceptsRoutes />} />
      <Route path="*" element={<Navigate to={HOME} replace />} />
    </Routes>
  );
}
