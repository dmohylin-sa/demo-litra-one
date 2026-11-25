import { useMemo } from 'react';
import { StoreProvider } from '../../store/StoreProvider.jsx';
import { createSeed } from '../../data/seed.js';
import { ixOf } from '../../domain/ix.js';
import Contracts from '../../pages/Contracts.jsx';
import ProductHeader from '../product/ProductHeader.jsx';
import '../concepts.css';

// Administration workspace of the unified navigation. For now it holds one section, Contracts & rate cards, and shows
// the prototype's existing screen (src/pages/Contracts.jsx) unchanged. That screen reads the prototype store, so it is
// given its own in-memory store here (StoreProvider persist={false}): the prototype's saved demo state is neither read
// nor written, and changes last until the page is left. It opens as the Administrator, who can edit rates.
const SECTIONS = [{ key: 'contracts', label: 'Contracts & rate cards' }];

export default function Administration() {
  const admin = useMemo(() => ixOf(createSeed().masters).user('U-ADM'), []);
  return (
    <div className="cn-root adm-root">
      <ProductHeader active="admin" user={admin} />
      <div className="cn-context">
        <div className="cn-page-ctx">
          <div className="cn-ctx-field">
            <span className="cn-ctx-label">Administration</span>
            <nav className="adm-sections" aria-label="Administration sections">
              {SECTIONS.map((s) => (
                <span key={s.key} className="adm-section is-active" aria-current="page">{s.label}</span>
              ))}
            </nav>
          </div>
        </div>
      </div>
      <div className="adm-body">
        <StoreProvider persist={false} role="admin">
          <div className="content-wrap">
            <Contracts />
          </div>
        </StoreProvider>
      </div>
    </div>
  );
}
