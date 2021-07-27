import * as React from 'react';
import { FocusStyleManager } from '@blueprintjs/core';

import { useAppDispatch } from '../hooks';
import { exit } from '../store/editor';
import { append } from '../store/log';
import { updateDevices } from '../store/peripherals';
import { Mode } from '../store/robot';

import Log from './Log';
import Editor from './Editor';
import KeybindingMapper from './KeybindingMapper';
import OverwriteDialog from './OverwriteDialog';
import Peripherals from './Peripherals';
import RuntimeStatusCard from './RuntimeStatusCard';
import Settings from './Settings';
import ThemeProvider from './ThemeProvider';
import Toolbar from './Toolbar';

FocusStyleManager.onlyShowFocusOnTabs();

export default function App() {
  const dispatch = useAppDispatch();
  const [editor, setEditor] = React.useState(null);
  // TODO: do not overwrite Electron hotkeys
  const [settingsOpen, setSettingsOpen] = React.useState(false);
  const closeSettings = () => setSettingsOpen(false);
  const [mode, setMode] = React.useState(Mode.AUTO);
  React.useEffect(() => {
    window.ipc.on('update-devices', (err, [update]) => dispatch(updateDevices(update)));
    // TODO: filter keys (e.g., change back to idle)
    // TODO: watch for low battery
    window.ipc.on('append-event', (err, [event]) => dispatch(append(event)));
    window.ipc.on('exit', (replyChannel) => dispatch(exit(replyChannel)));
    return () => {
      for (const channel of ['update-devices', 'append-event', 'exit']) {
        window.ipc.removeListeners(channel);
      }
    };
  }, [dispatch]);
  return (
    <ThemeProvider>
      <KeybindingMapper editor={editor} mode={mode}>
        <div id="app">
          <Toolbar
            editor={editor}
            openSettings={() => setSettingsOpen(true)}
            closeSettings={closeSettings}
            mode={mode}
            setMode={setMode}
          />
          <main>
            <div id="editor-pane">
              <Editor editor={editor} setEditor={setEditor} />
              <Log editor={editor} />
            </div>
            <div id="runtime-pane">
              <RuntimeStatusCard />
              <Peripherals editor={editor} />
            </div>
          </main>
          <Settings
            isOpen={settingsOpen}
            close={closeSettings}
            platform={editor?.commands.platform}
          />
          <OverwriteDialog editor={editor} />
        </div>
      </KeybindingMapper>
    </ThemeProvider>
  );
};
