import { createEntityAdapter, createSlice, PayloadAction } from '@reduxjs/toolkit';
import * as _ from 'lodash';

const MAX_VALUES = 50;

type PeripheralType = 'gamepad' | 'smart-device';

export interface Peripheral {
  uid: string;
  type: PeripheralType;
  params: { [name: string]: Array<[number, any]> };
}

interface PeripheralUpdate {
  type: PeripheralType;
  timestamp: number;
  params: {
    [uid: string]: {
      [param: string]: any;
    };
  };
  disconnect?: boolean;
}

const selectId = ({ type, uid }: { type: PeripheralType; uid: string }) =>
  `${type}-${uid}`;

const compareUid = (a: string, b: string) => {
  const uidA = BigInt(a);
  const uidB = BigInt(b);
  return uidA < uidB ? -1 : uidA > uidB ? 1 : 0;
};

const peripheralAdapter = createEntityAdapter<Peripheral>({
  selectId,
  sortComparer: (a, b) =>
    a.type === b.type ? compareUid(a.uid, b.uid) : a.type.localeCompare(b.type),
});

export const peripheralSelectors = peripheralAdapter.getSelectors();

const slice = createSlice({
  name: 'peripherals',
  initialState: peripheralAdapter.getInitialState(),
  reducers: {
    update(state, action: PayloadAction<PeripheralUpdate>) {
      const { type, timestamp, params } = action.payload;
      const expiredUids = new Set(
        peripheralSelectors
          .selectAll(state)
          .filter((peripheral) => peripheral.type === type)
          .map((peripheral) => selectId(peripheral))
      );
      for (const [uid, values] of _.toPairs(params)) {
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
export const updateDevices = (params: PeripheralUpdate['params'], other = {}) =>
  slice.actions.update({
    type: 'smart-device',
    timestamp: Date.now(),
    params,
    ...other,
  });
export const updateGamepads = (params: PeripheralUpdate['params'], other = {}) =>
  slice.actions.update({ type: 'gamepad', timestamp: Date.now(), params, ...other });
