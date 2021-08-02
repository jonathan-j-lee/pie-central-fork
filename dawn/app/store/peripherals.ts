import { createEntityAdapter, createSlice } from '@reduxjs/toolkit';
import * as _ from 'lodash';

const MAX_VALUES = 50;

export interface Peripheral {
  uid: number;
  type: 'gamepad' | 'smart-device';
  params: { [name: string]: Array<[number, any]> };
}

const selectId = ({ type, uid }) => `${type}-${uid}`;

const peripheralAdapter = createEntityAdapter<Peripheral>({
  selectId,
  sortComparer: (a, b) =>
    a.type === b.type ? a.uid - b.uid : a.type.localeCompare(b.type),
});

export const peripheralSelectors = peripheralAdapter.getSelectors();

const slice = createSlice({
  name: 'peripherals',
  initialState: peripheralAdapter.getInitialState(),
  reducers: {
    update(state, action) {
      const { type, timestamp, update } = action.payload;
      const expiredUids = new Set(
        peripheralSelectors
          .selectAll(state)
          .filter((peripheral) => peripheral.type === type)
          .map((peripheral) => selectId(peripheral))
      );
      for (const [uid, values] of _.toPairs(update)) {
        const id = selectId({ type, uid });
        const params = { ...peripheralSelectors.selectById(state, id)?.params };
        for (const [param, value] of _.toPairs(values)) {
          const timeline = (params[param] ?? []).slice(-(MAX_VALUES - 1));
          timeline.push([timestamp, value]);
          params[param] = timeline;
        }
        peripheralAdapter.upsertOne(state, { uid, type, params });
        expiredUids.delete(id);
      }
      peripheralAdapter.removeMany(state, Array.from(expiredUids));
    },
  },
});

export default slice;
export const updateDevices = (update, other = {}) =>
  slice.actions.update({
    type: 'smart-device',
    timestamp: Date.now(),
    update,
    ...other,
  });
export const updateGamepads = (update, other = {}) =>
  slice.actions.update({ type: 'gamepad', timestamp: Date.now(), update, ...other });
