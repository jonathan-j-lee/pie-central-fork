import * as React from 'react';
import { FocusStyleManager } from '@blueprintjs/core';
import { useAppSelector } from '../hooks';
import { getThemeClass } from '../store/editor';

import Log from './Log';
import Editor from './Editor';
import Peripherals from './Peripherals';
import Settings from './Settings';
import Toolbar from './Toolbar';

FocusStyleManager.onlyShowFocusOnTabs();

export default function App() {
  const editorRef = React.createRef();
  const editorTheme = useAppSelector(state => state.editor.editorTheme);
  const [logOpen, setLogOpen] = React.useState(false);
  const [settingsOpen, setSettingsOpen] = React.useState(false);
  return (
    <div id="app" className={getThemeClass(editorTheme)}>
      <Toolbar
        editorRef={editorRef}
        logOpen={logOpen}
        toggleLogOpen={() => setLogOpen(!logOpen)}
        openSettings={() => setSettingsOpen(true)}
      />
      <main>
        <Editor editorRef={editorRef} />
        <Peripherals />
      </main>
      <Log isOpen={logOpen} />
      <Settings isOpen={settingsOpen} close={() => setSettingsOpen(false)} />
    </div>
  );
};
