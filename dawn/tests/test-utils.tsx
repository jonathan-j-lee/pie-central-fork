import * as React from 'react';
import * as _ from 'lodash';
import { Provider } from 'react-redux';
import { render as rtlRender } from '@testing-library/react';
import '@testing-library/jest-dom';
import 'jest-canvas-mock';

import { AppStore, makeStore } from '../app/store';
import { append } from '../app/store/log';
import { updateDevices } from '../app/store/peripherals';
import runtimeSlice from '../app/store/runtime';
import settingsSlice, { LogLevel } from '../app/store/settings';

declare global {
  interface Window {
    store: AppStore;
  }
}

(global as any).DAWN_PKG_INFO = {
  name: '@pioneers/dawn',
  version: 'test',
  buildTimestamp: 0,
  description: 'PiE Robotics System Frontend',
  license: 'ISC',
  author: 'Pioneers in Engineering',
};

export type TextMatch =
  | RegExp
  | string
  | ((content: string, element: Element | null) => boolean);

function render(
  ui: React.ReactElement<any>,
  { storeOptions = {}, renderOptions = {} } = {}
) {
  window.ipc = {
    on: jest.fn(),
    removeListeners: jest.fn(),
    invoke: jest.fn().mockReturnValue(Promise.resolve()),
    send: jest.fn(),
  };
  window.ssh = {
    upload: jest.fn().mockReturnValue(Promise.resolve()),
    download: jest.fn().mockReturnValue(Promise.resolve()),
  };
  window.store = makeStore(storeOptions);
  window.ResizeObserver =
    window.ResizeObserver ??
    jest.fn(() => {
      return {
        disconnect: jest.fn(),
        observe: jest.fn(),
        unobserve: jest.fn(),
      };
    });
  let clipboard = '';
  Object.defineProperty(navigator, 'clipboard', {
    value: {
      writeText: jest.fn(async (text) => {
        clipboard = text;
      }),
      readText: jest.fn(async () => clipboard),
    },
    writable: true,
  });
  window.HTMLElement.prototype.scrollIntoView = jest.fn();
  function Wrapper({ children }: { children?: React.ReactNode }) {
    return <Provider store={window.store}>{children}</Provider>;
  }
  return rtlRender(ui, { wrapper: Wrapper, ...renderOptions });
}

const updateSetting = (path: string, value: any) =>
  window.store.dispatch(settingsSlice.actions.update({ path, value }));

const log = _.chain(LogLevel)
  .map((level) => [
    level,
    (event: string, context: { timestamp: string; [key: string]: any }) =>
      window.store.dispatch(
        append({
          level,
          event,
          ...context,
        })
      ),
  ])
  .fromPairs()
  .value();

const dispatchDevUpdate = (update = {}, other = {}, timestamp = 0) => {
  window.store.dispatch(updateDevices(update, other));
  window.store.dispatch(runtimeSlice.actions.updateRate(timestamp));
};

export * from '@testing-library/react';
export { render, log, dispatchDevUpdate, updateSetting };
export const delay = (timeout: number) =>
  new Promise((resolve) => setTimeout(resolve, timeout));
