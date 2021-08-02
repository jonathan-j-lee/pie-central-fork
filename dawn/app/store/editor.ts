import { createAsyncThunk, createSlice, isAnyOf } from '@reduxjs/toolkit';
import { Editor } from 'ace-builds/src-min/ace';
import { Store } from 'redux';
import { SettingsState } from './settings';

const NEWLINE = '\n';

interface EditorAnnotation {
  row: number;
  column: number;
  type: 'error' | 'warning' | 'info';
  text: string;
}

export interface EditorState {
  filePath: null | string;
  dirty: boolean;
  prompt: boolean;
  confirmed: boolean;
  annotations: Array<EditorAnnotation>;
}

export const prompt = createAsyncThunk<
  void,
  void,
  { extra: { store: Store }; state: { editor: EditorState } }
>('editor/prompt', async (arg, thunkAPI) => {
  return await new Promise((resolve, reject) => {
    const unsubscribe = thunkAPI.extra.store.subscribe(() => {
      const { prompt, confirmed } = thunkAPI.getState().editor;
      if (!prompt) {
        unsubscribe();
        if (confirmed) {
          resolve();
        } else {
          reject(Error('user aborted action'));
        }
      }
    });
  });
});

export const create = createAsyncThunk<
  { filePath: null },
  { editor?: Editor },
  { state: { editor: EditorState } }
>('editor/create', async ({ editor }, thunkAPI) => {
  const state = thunkAPI.getState();
  if (state.editor.dirty) {
    await thunkAPI.dispatch(prompt()).unwrap();
  }
  if (editor) {
    editor.setValue('');
  }
  return { filePath: null };
});

export const open = createAsyncThunk<
  { filePath: string; contents: string },
  { filePath?: string; editor?: Editor },
  { state: { editor: EditorState; settings: SettingsState } }
>('editor/open', async ({ filePath, editor }, thunkAPI) => {
  const state = thunkAPI.getState();
  if (state.editor.dirty) {
    await thunkAPI.dispatch(prompt()).unwrap();
  }
  if (!filePath) {
    filePath = await window.ipc.invoke('open-file-prompt');
  }
  const contents = await window.ipc.invoke(
    'open-file',
    filePath,
    state.settings.editor.encoding
  );
  if (editor) {
    editor.setValue(contents);
  }
  return { filePath, contents };
});

export const save = createAsyncThunk<
  { filePath: string },
  { editor?: Editor; forcePrompt?: boolean },
  { state: { editor: EditorState; settings: SettingsState } }
>('editor/save', async ({ editor, forcePrompt }, thunkAPI) => {
  const state = thunkAPI.getState();
  let filePath = state.editor.filePath;
  if (!filePath || forcePrompt) {
    filePath = await window.ipc.invoke('save-file-prompt');
  }
  if (editor) {
    let contents = editor.getValue();
    if (state.settings.editor.trimWhitespace) {
      const lines = contents.split(NEWLINE);
      contents = lines.map((line) => line.replace(/\s+$/g, '')).join(NEWLINE);
    }
    if (
      state.settings.editor.appendNewline &&
      !contents.endsWith(NEWLINE) &&
      contents.length > 0
    ) {
      contents += NEWLINE;
    }
    editor.setValue(contents);
    await window.ipc.invoke(
      'save-file',
      filePath,
      contents,
      state.settings.editor.encoding
    );
  }
  return { filePath };
});

const getSeverity = (msgType) => {
  if (msgType === 'error' || msgType === 'fatal') {
    return 'error';
  } else if (msgType === 'warning') {
    return 'warning';
  }
  return 'info';
};

export const lint = createAsyncThunk('editor/lint', async () => {
  const messages = await window.ipc.invoke('request', 'broker-service', 'lint');
  return messages.map(({ line, column, ...message }) => ({
    row: line - 1,
    column,
    type: getSeverity(message.type),
    text: `${message.message} (${message.symbol}, ${message['message-id']})`,
  }));
});

export const exit = createAsyncThunk<void, string, { state: { editor: EditorState } }>(
  'editor/refresh',
  async (replyChannel, thunkAPI) => {
    try {
      const state = thunkAPI.getState();
      if (state.editor.dirty) {
        await thunkAPI.dispatch(prompt()).unwrap();
      }
    } finally {
      window.ipc.send(replyChannel);
    }
  }
);

export default createSlice({
  name: 'editor',
  initialState: {
    filePath: null,
    dirty: false,
    prompt: false,
    confirmed: false,
    annotations: [],
  } as EditorState,
  reducers: {
    setDirty: (state) => ({ ...state, dirty: true }),
    confirm: (state) => ({ ...state, prompt: false, confirmed: true }),
    cancel: (state) => ({ ...state, prompt: false, confirmed: false }),
  },
  extraReducers: (builder) => {
    builder
      .addCase(prompt.pending, (state) => ({ ...state, prompt: true }))
      .addCase(lint.fulfilled, (state, action) => ({
        ...state,
        annotations: action.payload,
      }))
      .addMatcher(
        isAnyOf(create.fulfilled, open.fulfilled, save.fulfilled),
        (state, action) => {
          state.filePath = action.payload.filePath;
          state.dirty = false;
        }
      );
  },
});
