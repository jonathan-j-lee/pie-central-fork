import { createEntityAdapter, createSlice } from '@reduxjs/toolkit';
import * as _ from 'lodash';

const MAX_VALUES = 50;

const slice = createSlice({
  name: 'peripherals',
  initialState: {
    devices: {},
    gamepads: {},
  },
  reducers: {
    updatePeripherals(state, action) {
      const { peripheralType, timestamp, update } = action.payload;
      const peripherals = state[peripheralType];
      if (!peripherals) {
        return;
      }
      for (const [uid, params] of _.toPairs(update)) {
        _.defaults(peripherals, { [uid]: {} });
        const timelines = peripherals[uid];
        for (const [param, value] of _.toPairs(params)) {
          _.defaults(timelines, { [param]: [] });
          const timeline = timelines[param];
          const size = timeline.push([timestamp, value]);
          timeline.splice(0, size - MAX_VALUES);
        }
      }
      state[peripheralType] = _.pick(peripherals, _.keys(update));
    },
  },
});

export default slice;
export const updateDevices = (update, options = {}) => slice.actions.updatePeripherals(
  { peripheralType: 'devices', timestamp: Date.now(), update, ...options });
export const updateGamepads = (update, options = {}) => slice.actions.updatePeripherals(
  { peripheralType: 'gamepads', timestamp: Date.now(), update, ...options });
