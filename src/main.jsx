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

dayjs.locale('en-gb');

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
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
  </React.StrictMode>,
);
