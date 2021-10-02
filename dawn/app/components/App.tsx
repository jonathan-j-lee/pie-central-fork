import { useAppDispatch } from '../hooks';
import { initializeSettings } from '../store';
import { exit } from '../store/editor';
import { append } from '../store/log';
import { updateDevices } from '../store/peripherals';
import { Mode } from '../store/runtime';
import Editor from './Editor';
import KeybindingMapper from './KeybindingMapper';
import Log from './Log';
import OverwriteDialog from './OverwriteDialog';
import PeripheralList from './PeripheralList';
import RuntimeStatusCard from './RuntimeStatusCard';
import Settings from './Settings';
import ThemeProvider from './ThemeProvider';
import Toolbar from './Toolbar';
import { platform } from './Util';
import { FocusStyleManager } from '@blueprintjs/core';
import { Ace } from 'ace-builds/ace';
import * as React from 'react';

const INITIALIZE_DELAY = 100;

FocusStyleManager.onlyShowFocusOnTabs();

export default function App(props: { transitionDuration?: number }) {
  const dispatch = useAppDispatch();
  const [editor, setEditor] = React.useState<Ace.Editor | undefined>();
  // TODO: do not overwrite Electron hotkeys
  // TODO: add gamepads
  const [settingsOpen, setSettingsOpen] = React.useState(false);
  const closeSettings = () => setSettingsOpen(false);
  const [mode, setMode] = React.useState(Mode.AUTO);
  React.useEffect(() => {
    window.ipc.on('update-devices', ([update]) => dispatch(updateDevices(update)));
    // TODO: filter keys (e.g., change back to idle)
    // TODO: watch for low battery
    window.ipc.on('append-event', ([event]) => dispatch(append(event)));
    window.ipc.on('exit', (replyChannel) => dispatch(exit(replyChannel)));
    return () => {
      for (const channel of ['update-devices', 'append-event', 'exit']) {
        window.ipc.removeListeners(channel);
      }
    };
  }, [dispatch]);
  React.useEffect(() => {
    /* Delay slightly so the main process can register a 'save-settings' handler. */
    if (editor) {
      const initialize = () => dispatch(initializeSettings({ editor }));
      const timeoutId = setTimeout(initialize, INITIALIZE_DELAY);
      return () => clearTimeout(timeoutId);
    }
  }, [editor]);
  return (
    <ThemeProvider>
      <KeybindingMapper editor={editor} mode={mode} platform={platform}>
        <div id="app">
          <Toolbar
            editor={editor}
            openSettings={() => setSettingsOpen(true)}
            closeSettings={closeSettings}
            mode={mode}
            setMode={setMode}
            transitionDuration={props.transitionDuration}
          />
          <main>
            <div id="editor-pane">
              <Editor editor={editor} setEditor={setEditor} />
              <Log />
            </div>
            <div id="runtime-pane">
              <RuntimeStatusCard />
              <PeripheralList />
            </div>
          </main>
          <Settings
            isOpen={settingsOpen}
            close={closeSettings}
            platform={platform}
            transitionDuration={props.transitionDuration}
          />
          <OverwriteDialog
            editor={editor}
            transitionDuration={props.transitionDuration}
          />
        </div>
      </KeybindingMapper>
    </ThemeProvider>
  );
}
