'use strict';

import * as React from 'react';
import * as ReactDOM from 'react-dom';
import { Provider } from 'react-redux';
import { HotkeysProvider } from '@blueprintjs/core';
import App from './components/App';
import ErrorBoundary from './components/ErrorBoundary';
import store from './store';
import './assets/custom.scss';
import { SSHExecCommandOptions, SSHExecCommandResponse } from 'node-ssh';

interface SSHConfig {
  host: string;
  username: string;
  password: string;
  privateKey: string;
}

interface Command {
  command: string;
  options?: SSHExecCommandOptions;
}

declare global {
  interface Window {
    ipc: {
      on(channel: string, handler: (...args: any[]) => any);
      removeListeners(channel: string);
      invoke(channel: string, ...args: any[]): Promise<any>;
      send(channel: string, ...args: any[]);
    };
    ssh: {
      upload(config: SSHConfig, path: string, contents: string): Promise<void>;
      download(config: SSHConfig, path: string): Promise<string>;
    };
  }
}

ReactDOM.render(
  <Provider store={store}>
    <HotkeysProvider>
      <ErrorBoundary>
        <App />
      </ErrorBoundary>
    </HotkeysProvider>
  </Provider>,
  document.getElementById('content')
);
