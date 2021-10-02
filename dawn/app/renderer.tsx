import './assets/custom.scss';
import App from './components/App';
import ErrorBoundary from './components/ErrorBoundary';
import { SSHConfig } from './preload';
import store from './store';
import { HotkeysProvider } from '@blueprintjs/core';
import * as React from 'react';
import * as ReactDOM from 'react-dom';
import { Provider } from 'react-redux';

declare global {
  interface Window {
    ipc: {
      on(channel: string, handler: (...args: any[]) => any): void;
      removeListeners(channel: string): void;
      invoke(channel: 'open-file-prompt' | 'save-file-prompt'): Promise<string>;
      invoke(
        channel: 'request',
        address: string,
        method: string,
        ...args: any
      ): Promise<any>;
      // FIXME
      // invoke(channel: 'exec', config: SSHConfig, ...commands: SSHCommand):
      invoke(channel: string, ...args: any[]): Promise<any>;
      send(channel: string, ...args: any[]): void;
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
