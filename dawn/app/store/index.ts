import {
  createAsyncThunk,
  createReducer,
  configureStore,
} from '@reduxjs/toolkit';
import { combineReducers, Store } from 'redux';
import * as _ from 'lodash';

import editor, { open } from './editor';
import keybindings from './keybindings';
import log from './log';
import peripherals from './peripherals';
import robot from './robot';

export const importSettings = createAsyncThunk<any, any>(
  'settings/import',
  async (settings, thunkAPI) => {
    return settings ?? await window.ipc.invoke('load-settings');
  },
);

const defaultReducer = combineReducers({
  log: log.reducer,
  keybindings: keybindings.reducer,
  editor: editor.reducer,
  peripherals: peripherals.reducer,
  robot: robot.reducer,
});
const reducer = createReducer(undefined, (builder) => {
  builder
    .addCase(importSettings.fulfilled, (state, action) =>
      _.merge({}, state, action.payload))
    .addDefaultCase((state, action) => defaultReducer(state, action));
});

const extraArgument: { store?: Store } = {};
const store = configureStore({
  reducer,
  middleware: (getDefaultMiddleware) => getDefaultMiddleware({
    thunk: { extraArgument }
  }),
});
extraArgument.store = store;

export default store;
export type RootState = ReturnType<typeof store.getState>;
export type AppDispatch = typeof store.dispatch;

export const selectSettings = (state: RootState) => ({
  editor: _.omit(state.editor, ['dirty', 'annotations', 'prompt', 'confirmed']),
  keybindings: state.keybindings,
  log: _.omit(state.log, ['events', 'timeline']),
  robot: _.pick(state.robot, [
    'host',
    'remotePath',
    'restartCommand',
    'credentials',
  ]),
});

export const exportSettings = createAsyncThunk<any>(
  'settings/export',
  async (arg, thunkAPI) => {
    const state = thunkAPI.getState();
    const settings = selectSettings(state);
    await window.ipc.invoke('save-settings', settings);
    return settings;
  },
);

export const initializeSettings = createAsyncThunk<
  void,
  { editor?: any },
  { state: RootState }
>(
  'settings/init',
  async ({ editor }, thunkAPI) => {
    await thunkAPI.dispatch(importSettings(null)).unwrap();
    const { filePath } = thunkAPI.getState().editor;
    if (filePath) {
      await thunkAPI.dispatch(open({ filePath, editor })).unwrap();
    }
    await thunkAPI.dispatch(exportSettings()).unwrap();
  },
);
