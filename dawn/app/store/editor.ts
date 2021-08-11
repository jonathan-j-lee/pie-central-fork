import { createAsyncThunk, createSlice, isAnyOf } from '@reduxjs/toolkit';
import { Ace } from 'ace-builds/ace';
import { Store } from 'redux';
import settingsSlice from './settings';
import type { AppDispatch, RootState } from '.';

const NEWLINE = '\n';

interface EditorAnnotation {
  row: number;
  column: number;
  type: 'error' | 'warning' | 'info';
  text: string;
}

export interface EditorState {
  dirty: boolean;
  prompt: boolean;
  confirmed: boolean;
  annotations: Array<EditorAnnotation>;
}

const PROMPT_TIMEOUT = 60000;

export const prompt = createAsyncThunk<
  void,
  void,
  { extra: { store?: Store }; state: RootState; dispatch: AppDispatch }
>('editor/prompt', async (arg, thunkAPI) => {
  await new Promise<void>((resolve, reject) => {
    if (!thunkAPI.extra.store) {
      reject(new Error('store not provided'));
      return;
    }
    const unsubscribe = thunkAPI.extra.store.subscribe(() => {
      const { prompt, confirmed } = thunkAPI.getState().editor;
      if (!prompt) {
        clearTimeout(timeout);
        unsubscribe();
        if (confirmed) {
          resolve();
        } else {
          reject(Error('user aborted action'));
        }
      }
    });
    const timeout = setTimeout(() => {
      unsubscribe();
      reject(new Error('timed out waiting for user confirmation'));
    }, PROMPT_TIMEOUT);
  });
});

export const create = createAsyncThunk<
  { filePath: null },
  { editor?: Ace.Editor },
  { state: RootState; dispatch: AppDispatch }
>('editor/create', async ({ editor }, thunkAPI) => {
  const state = thunkAPI.getState();
  if (state.editor.dirty) {
    await thunkAPI.dispatch(prompt()).unwrap();
  }
  if (editor) {
    editor.setValue('');
  }
  thunkAPI.dispatch(
    settingsSlice.actions.update({
      path: 'editor.filePath',
      value: null,
    })
  );
  return { filePath: null };
});

export const open = createAsyncThunk<
  { filePath: string; contents: string },
  { filePath?: string; editor?: Ace.Editor },
  { state: RootState; dispatch: AppDispatch }
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
    thunkAPI.dispatch(
      settingsSlice.actions.update({
        path: 'editor.filePath',
        value: filePath,
      })
    );
  }
  return { filePath, contents };
});

export const save = createAsyncThunk<
  { filePath: string },
  { editor?: Ace.Editor; forcePrompt?: boolean },
  { state: RootState }
>('editor/save', async ({ editor, forcePrompt }, thunkAPI) => {
  const state = thunkAPI.getState();
  let filePath = state.settings.editor.filePath;
  if (!filePath || forcePrompt) {
    filePath = await window.ipc.invoke('save-file-prompt');
  }
  if (editor) {
    let contents = editor.getValue();
    if (state.settings.editor.trimWhitespace) {
      const lines: Array<string> = contents.split(NEWLINE);
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
    thunkAPI.dispatch(
      settingsSlice.actions.update({
        path: 'editor.filePath',
        value: filePath,
      })
    );
  }
  return { filePath };
});

type LintMessageType = 'convention' | 'refactor' | 'warning' | 'error' | 'fatal';
interface LintMessage {
  type: LintMessageType;
  line: number;
  column: number;
  message: string;
  symbol: string;
  'message-id': string;
}

const getSeverity = (msgType: LintMessageType) => {
  if (msgType === 'error' || msgType === 'fatal') {
    return 'error';
  } else if (msgType === 'warning') {
    return 'warning';
  }
  return 'info';
};

export const lint = createAsyncThunk('editor/lint', async () => {
  const messages = await window.ipc.invoke('request', 'broker-service', 'lint');
  return messages.map((message: LintMessage) => ({
    row: message.line - 1,
    column: message.column,
    type: getSeverity(message.type),
    text: `${message.message} (${message.symbol}, ${message['message-id']})`,
  }));
});

export const exit = createAsyncThunk<
  void,
  string,
  { state: RootState; dispatch: AppDispatch }
>('editor/exit', async (replyChannel, thunkAPI) => {
  try {
    const state = thunkAPI.getState();
    if (state.editor.dirty) {
      await thunkAPI.dispatch(prompt()).unwrap();
    }
  } finally {
    window.ipc.send(replyChannel);
  }
});

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
        (state) => {
          state.dirty = false;
        }
      );
  },
});
