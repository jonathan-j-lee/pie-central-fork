import { Classes } from '@blueprintjs/core';
import { createSlice } from '@reduxjs/toolkit';
import { makeUpdateReducer, makeToggleReducer } from './util';

export enum EditorTheme {
  LIGHT = 'light',
  DARK = 'dark',
};

export const getThemeClass = theme =>
  theme === EditorTheme.DARK ? Classes.DARK : '';

export default createSlice({
  name: 'editor',
  initialState: {
    editorTheme: EditorTheme.DARK,
    syntaxHighlighting: true,
    lineNumbers: true,
    longLineMarker: true,
    highlightLine: true,
    wrapLines: true,
    basicAutocompletion: true,
    liveAutocompletion: true,
    appendNewline: true,
    syntaxTheme: 'solarized_dark',
    fontSize: 13,
    tabSize: 4,
    encoding: 'utf-8',
    filePath: null,
    dirty: false,
  },
  reducers: {
    setEditorTheme: makeUpdateReducer('editorTheme'),
    toggleSyntaxHighlighting: makeToggleReducer('syntaxHighlighting'),
    toggleLineNumbers: makeToggleReducer('lineNumbers'),
    toggleLongLineMarker: makeToggleReducer('longLineMarker'),
    toggleHighlightLine: makeToggleReducer('highlightLine'),
    toggleWrapLines: makeToggleReducer('wrapLines'),
    toggleBasicAutocompletion: makeToggleReducer('basicAutocompletion'),
    toggleLiveAutocompletion: makeToggleReducer('liveAutocompletion'),
    toggleAppendNewline: makeToggleReducer('appendNewline'),
    setSyntaxTheme: makeUpdateReducer('syntaxTheme'),
    setFontSize: makeUpdateReducer('fontSize'),
    setTabSize: makeUpdateReducer('tabSize'),
    setEncoding: makeUpdateReducer('encoding'),
    newFile: state => ({ ...state, filePath: null, dirty: false }),
    openFile: (state, { payload }) => ({ ...state, filePath: payload, dirty: false }),
    setDirty: state => ({ ...state, dirty: true, }),
    save: (state, action) =>
      ({ ...state, dirty: false, filePath: action.payload || state.filePath }),
  },
});
