import * as React from 'react';
import { Ace } from 'ace-builds/ace';
import * as _ from 'lodash';
import { Provider } from 'react-redux';
import { render as rtlRender, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom';
import 'jest-canvas-mock';

import Editor from '../app/components/Editor';
import KeybindingMapper from '../app/components/KeybindingMapper';
import OverwriteDialog from '../app/components/OverwriteDialog';
import Toolbar from '../app/components/Toolbar';

import { AppStore, makeStore } from '../app/store';
import { append } from '../app/store/log';
import { updateDevices } from '../app/store/peripherals';
import runtimeSlice, { Mode } from '../app/store/runtime';
import settingsSlice, { LogLevel } from '../app/store/settings';

const openSettings = jest.fn();
const closeSettings = jest.fn();
const setMode = jest.fn();

export function TestEditor() {
  const [editor, setEditor] = React.useState<Ace.Editor | undefined>();
  return (
    <>
      <KeybindingMapper editor={editor} mode={Mode.TELEOP} platform="win">
        <div id="app">
          <Toolbar
            editor={editor}
            openSettings={openSettings}
            closeSettings={closeSettings}
            mode={Mode.TELEOP}
            setMode={setMode}
            transitionDuration={0}
          />
          <main>
            <div id="editor-pane">
              <Editor name="test-editor" editor={editor} setEditor={setEditor} />
            </div>
          </main>
          <OverwriteDialog editor={editor} transitionDuration={0} />
        </div>
      </KeybindingMapper>
    </>
  );
}

interface Commands {
  [command: string]: {
    keybinding: string;
    menu?: TextMatch;
    item: TextMatch;
  };
}

export function makeCommandTriggers(
  commands: Commands
): Array<[string, { [command: string]: () => Promise<void> }]> {
  return [
    [
      'toolbar',
      _.mapValues(commands, ({ menu, item }) => async () => {
        if (menu) {
          userEvent.click(screen.getByText(menu));
        }
        userEvent.click(await screen.findByText(item));
      }),
    ],
    [
      'keybindings',
      _.mapValues(commands, ({ keybinding }) => async () => {
        userEvent.type(screen.getByText(/^\d+:\d+$/), keybinding);
      }),
    ],
  ];
}

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
