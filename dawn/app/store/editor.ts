import { Classes } from '@blueprintjs/core';
import { createAsyncThunk, createSlice, isAnyOf } from '@reduxjs/toolkit';
import { makeUpdateReducer } from './util';

export enum EditorTheme {
  LIGHT = 'light',
  DARK = 'dark',
};

export const getThemeClass = theme =>
  theme === EditorTheme.DARK ? Classes.DARK : '';

interface EditorOperation {
  editorRef: {
    current?: {
      editor: any;  // FIXME
    }
  };
  filePath?: string;
}

export const create = createAsyncThunk<{ filePath: null }, EditorOperation>(
  'editor/create',
  async ({ editorRef }, thunkAPI) => {
    if (editorRef.current) {
      editorRef.current.editor.setValue('');
    }
    return { filePath: null };
  },
);

export const open = createAsyncThunk<
    { filePath: string, contents: string },
    EditorOperation>(
  'editor/open',
  async ({ filePath, editorRef }, thunkAPI) => {
    if (!filePath) {
      filePath = await window.ipc.invoke('open-file-prompt');
    }
    const state = thunkAPI.getState();
    const contents = await window.ipc.invoke('open-file', filePath, state.editor.encoding);
    if (editorRef.current) {
      editorRef.current.editor.setValue(contents);
    }
    return { filePath, contents };
  },
);

export const save = createAsyncThunk<{ filePath: string }, EditorOperation>(
  'editor/save',
  async ({ filePath, editorRef }, thunkAPI) => {
    if (!filePath) {
      filePath = await window.ipc.invoke('save-file-prompt');
    }
    const state = thunkAPI.getState();
    if (editorRef.current) {
      const contents = editorRef.current.editor.getValue();
      await window.ipc.invoke('save-file', filePath, contents, state.editor.encoding);
    }
    return { filePath };
  },
);

export const download = createAsyncThunk<{ contents: string }, EditorOperation>(
  'editor/download',
  async ({ editorRef }, thunkAPI) => {
    const state = thunkAPI.getState();
    const config = { host: state.robot.host, ...state.robot.credentials };
    const contents = await window.ssh.download(config, state.robot.remotePath);
    if (editorRef.current) {
      editorRef.current.editor.setValue(contents);
    }
    return { contents };
  },
);

export const upload = createAsyncThunk<void, EditorOperation>(
  'editor/upload',
  async ({ editorRef }, thunkAPI) => {
    const state = thunkAPI.getState();
    const config = { host: state.robot.host, ...state.robot.credentials };
    if (editorRef.current) {
      const contents = editorRef.current.editor.getValue();
      await window.ssh.upload(config, state.robot.remotePath, contents);
    }
  },
);

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
    toggle: (state, action) => ({ ...state, [action.payload]: !state[action.payload] }),
    setEditorTheme: makeUpdateReducer('editorTheme'),
    setSyntaxTheme: makeUpdateReducer('syntaxTheme'),
    setFontSize: makeUpdateReducer('fontSize'),
    setTabSize: makeUpdateReducer('tabSize'),
    setEncoding: makeUpdateReducer('encoding'),
    setDirty: (state) => ({ ...state, dirty: true }),
  },
  extraReducers: (builder) => {
    builder
      .addMatcher(isAnyOf(
        create.fulfilled,
        open.fulfilled,
        save.fulfilled,
      ), (state, action) => {
        state.filePath = action.payload.filePath;
        state.dirty = false;
      });
  },
});
