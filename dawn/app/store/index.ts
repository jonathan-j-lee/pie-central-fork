import { createAsyncThunk, configureStore } from '@reduxjs/toolkit';
import { Store } from 'redux';
import { Ace } from 'ace-builds/ace';

import editor, { open } from './editor';
import log from './log';
import peripherals from './peripherals';
import runtime from './runtime';
import settings, { load, save } from './settings';

export function makeStore(options = {}) {
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
    ...options,
  });
  extraArgument.store = store;
  return store;
}

const store = makeStore();
export default store;
export type AppStore = typeof store;
export type RootState = ReturnType<typeof store.getState>;
export type AppDispatch = typeof store.dispatch;

export const initializeSettings = createAsyncThunk<
  void,
  { editor?: Ace.Editor },
  { state: RootState }
>('settings/init', async ({ editor }, thunkAPI) => {
  await thunkAPI.dispatch(load()).unwrap();
  const filePath = thunkAPI.getState().settings.editor.filePath;
  if (filePath) {
    await thunkAPI.dispatch(open({ filePath, editor })).unwrap();
  }
  await thunkAPI.dispatch(save()).unwrap();
});
