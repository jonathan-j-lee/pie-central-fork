import { createAsyncThunk, configureStore } from '@reduxjs/toolkit';
import { Store } from 'redux';
import { Editor } from 'ace-builds/src-min/ace';

import editor, { open } from './editor';
import log from './log';
import peripherals from './peripherals';
import runtime from './runtime';
import settings, { load, save } from './settings';

const extraArgument: { store?: Store } = {};
const store = configureStore({
  reducer: {
    log: log.reducer,
    editor: editor.reducer,
    peripherals: peripherals.reducer,
    runtime: runtime.reducer,
    settings: settings.reducer,
  },
  middleware: (getDefaultMiddleware) =>
    getDefaultMiddleware({
      thunk: { extraArgument },
    }),
});
extraArgument.store = store;

export default store;
export type RootState = ReturnType<typeof store.getState>;
export type AppDispatch = typeof store.dispatch;

export const initializeSettings = createAsyncThunk<
  void,
  { editor?: Editor },
  { state: RootState }
>('settings/init', async ({ editor }, thunkAPI) => {
  await thunkAPI.dispatch(load()).unwrap();
  const filePath = thunkAPI.getState().editor.filePath;
  if (filePath) {
    await thunkAPI.dispatch(open({ filePath, editor })).unwrap();
  }
  await thunkAPI.dispatch(save()).unwrap();
});
