import { createContext, useContext } from 'react';
import { Tooltip } from 'antd';

// Research annotations for the stakeholder session. Same tags as the journey map structure
// (04-design-workspace/02-analysis/2026-11-19-ux-journey-map-structure.md):
//   F documented fact (WBS = pre-sale scope, not agreed) · A assumption · R UX recommendation · G gap / open question
export const NotesContext = createContext(true);

const KIND = {
  F: 'Documented (pre-sale WBS or demo script, not agreed with Litra)',
  A: 'Assumption made for this concept',
  R: 'UX recommendation / hypothesis',
  G: 'Gap or open question',
};

// compact: letter only (refs move into the tooltip), for tight spots such as the product header.
export function Note({ kind = 'F', refs, compact = false, children }) {
  const on = useContext(NotesContext);
  if (!on) return null;
  return (
    <Tooltip
      title={
        <div style={{ maxWidth: 320 }}>
          <div style={{ fontSize: 11, opacity: 0.75, marginBottom: 2 }}>{KIND[kind]}{compact && refs ? ` · ${refs}` : ''}</div>
          {children}
        </div>
      }
    >
      <span className={`cn-note cn-note-${kind}`}>
        <b>{kind === 'G' ? '?' : kind}</b>
        {compact ? null : refs}
      </span>
    </Tooltip>
  );
}
