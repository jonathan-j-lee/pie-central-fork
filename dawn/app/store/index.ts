import {
  createAsyncThunk,
  createReducer,
  configureStore,
} from '@reduxjs/toolkit';
import { combineReducers } from 'redux';
import * as _ from 'lodash';

import editor from './editor';
import log from './log';
import peripherals, { updateDevices } from './peripherals';
import robot from './robot';

export const selectSettings = ({ editor, log, robot }) => ({
  editor: _.omit(editor, ['dirty']),
  log: _.omit(log, ['events']),
  robot: _.pick(robot, [
    'host',
    'remotePath',
    'restartCommand',
    'credentials',
  ]),
});

export const importSettings = createAsyncThunk<undefined, any>(
  'settings/import',
  async (settings, thunkAPI) => {
    return settings;
  },
);

export const exportSettings = createAsyncThunk(
  'settings/export',
  async (arg, thunkAPI) => {
    const state = thunkAPI.getState();
    const settings = selectSettings(state);
    await window.ipc.invoke('save-settings', settings);
    return settings;
  },
);

const defaultReducer = combineReducers({
  log: log.reducer,
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
const store = configureStore({ reducer });

window.ipc.on('update-devices', (err, [update]) =>
  store.dispatch(updateDevices(update)));

window.ipc.on('append-event', (err, [event]) =>
  store.dispatch(log.actions.append(event)));

export default store;
export type RootState = ReturnType<typeof store.getState>;
export type AppDispatch = typeof store.dispatch;
