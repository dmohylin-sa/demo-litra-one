import React from 'react';
import ReactDOM from 'react-dom/client';
import { HashRouter } from 'react-router-dom';
import { ConfigProvider, App as AntdApp } from 'antd';
import enGB from 'antd/locale/en_GB';
import dayjs from 'dayjs';
import 'dayjs/locale/en-gb';
import 'antd/dist/reset.css';
import 'leaflet/dist/leaflet.css';
import { antdTheme } from './theme.js';
import './styles.css';
import { StoreProvider } from './store/StoreProvider.jsx';
import Shell from './App.jsx';
import { DemoLoginGate } from './demo-login/DemoLoginGate';
import { UX_EXPLORATION } from './concepts/mode.js';
import ExplorationApp from './concepts/ExplorationApp.jsx';

dayjs.locale('en-gb');

// Original prototype: demo sign-in, persisted store, prototype shell (unchanged).
const prototype = (
  <DemoLoginGate>
    <ConfigProvider theme={antdTheme} locale={enGB}>
      <AntdApp>
        <StoreProvider>
          <HashRouter>
            <Shell />
          </HashRouter>
        </StoreProvider>
      </AntdApp>
    </ConfigProvider>
  </DemoLoginGate>
);

// UX exploration mode (ux-exploration branch): concept-only entry. It does not mount the demo
// sign-in, the prototype store (no reads/writes of its localStorage state) or the prototype shell.
const exploration = (
  <ConfigProvider theme={antdTheme} locale={enGB}>
    <AntdApp>
      <HashRouter>
        <ExplorationApp />
      </HashRouter>
    </AntdApp>
  </ConfigProvider>
);

ReactDOM.createRoot(document.getElementById('root')).render(<React.StrictMode>{UX_EXPLORATION ? exploration : prototype}</React.StrictMode>);
