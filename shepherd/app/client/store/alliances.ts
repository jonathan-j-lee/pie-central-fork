import { createSlice } from '@reduxjs/toolkit';
import { makeEndpointClient, generateTempId } from './entities';
import * as _ from 'lodash';

export interface Alliance {
  id: number;
  name: string;
  wins?: number;
  losses?: number;
}

export const { adapter, selectors, fetch, save, sliceOptions } = makeEndpointClient<
  Alliance,
  Alliance['id']
>(
  'alliances',
  (alliance) => alliance.id,
  (alliance) => (alliance.id < 0 ? _.omit(alliance, 'id') : alliance)
);

const slice = createSlice({
  ...sliceOptions,
  extraReducers(builder) {
    builder.addCase(fetch.fulfilled, (state, action) => {
      adapter.setAll(state, action);
      state.modified = [];
      state.deleted = [];
    });
  },
});

export default slice;
export const add = () => slice.actions.upsert({ id: generateTempId(), name: '' });
