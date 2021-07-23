import * as React from 'react';
import { Button, H1, H2, Intent, FocusStyleManager, Pre, useHotkeys } from '@blueprintjs/core';
import { useAppDispatch, useAppSelector } from '../hooks';
import store from '../store';
import { getThemeClass } from '../store/editor';
import { generateHotkeys } from '../store/keybindings';
import log, { LogOpenCondition } from '../store/log';
import { updateDevices } from '../store/peripherals';
import { Mode } from '../store/robot';

import Log from './Log';
import Editor from './Editor';
import Peripherals from './Peripherals';
import Settings from './Settings';
import Toolbar from './Toolbar';

FocusStyleManager.onlyShowFocusOnTabs();

export class ErrorBoundary extends React.Component<{}, { err: null | Error }> {
  constructor(props) {
    super(props);
    this.state = { err: null };
  }

  static getDerivedStateFromError(err) {
    return { err };
  }

  render() {
    if (this.state.err) {
      return (
        <div className="error-boundary">
          <H1>Dawn Crashed</H1>
          <p>
            Dawn did not handle an unexpected error and cannot recover.
            If you can read this message, it is likely that Dawn has an unidentified bug.
          </p>
          <p>
            Copy the diagnostic information below into a text file and file an issue with the developers.
            Try to remember what sequence of actions you performed to produce this error.
          </p>
          <Button
            text="Quit"
            intent={Intent.DANGER}
            className="quit"
            onClick={() => window.ipc.send('quit')}
          />
          <H2>Stack Trace</H2>
          <Pre>
            {this.state.err.stack}
          </Pre>
          <H2>Redux State Tree</H2>
          <Pre>
            {JSON.stringify(store.getState(), null, 2)}
          </Pre>
        </div>
      );
    }
    return this.props.children;
  }
}

export default function App() {
  const dispatch = useAppDispatch();
  const editorRef = React.useRef();
  const editor = editorRef.current?.editor;
  const editorTheme = useAppSelector(state => state.editor.editorTheme);
  const openCondition = useAppSelector(state => state.log.openCondition);
  const keybindings = useAppSelector(state => state.keybindings);
  // TODO: do not overwrite Electron hotkeys
  const hotkeys = React.useMemo(() =>
    generateHotkeys(keybindings, editor), [keybindings]);
  const { handleKeyDown, handleKeyUp } = useHotkeys(hotkeys);
  const [logOpen, setLogOpen] = React.useState(false);
  const [settingsOpen, setSettingsOpen] = React.useState(true);
  const [mode, setMode] = React.useState(Mode.AUTO);
  const openLog = () => setLogOpen(true);
  React.useEffect(() => {
    window.ipc.on('update-devices', (err, [update]) => dispatch(updateDevices(update)));
    // TODO: filter keys (e.g., change back to idle)
    // TODO: watch for low battery
    window.ipc.on('append-event', (err, [event]) => {
      dispatch(log.actions.append(event));
      if (openCondition === LogOpenCondition.ERROR && event.exception) {
        openLog();
      }
    });
    return () => {
      window.ipc.removeListeners('update-devices');
      window.ipc.removeListeners('append-event');
    };
  }, [dispatch, openCondition, openLog]);
  return (
    <div
      id="app"
      className={getThemeClass(editorTheme)}
      onKeyDown={handleKeyDown}
      onKeyUp={handleKeyUp}
    >
      <Toolbar
        editor={editor}
        logOpen={logOpen}
        openSettings={() => setSettingsOpen(true)}
        closeSettings={() => setSettingsOpen(false)}
        openLog={() => setLogOpen(true)}
        closeLog={() => setLogOpen(false)}
        mode={mode}
        setMode={setMode}
      />
      <main>
        <div className="editor">
          <Editor editorRef={editorRef} />
          <Log editor={editor} isOpen={logOpen} toggleOpen={() => setLogOpen(!logOpen)} />
        </div>
        <Peripherals editor={editor} mode={mode} openLog={openLog} />
      </main>
      <Settings
        isOpen={settingsOpen}
        close={() => setSettingsOpen(false)}
        editor={editor}
      />
    </div>
  );
};
