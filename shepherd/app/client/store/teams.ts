import { createSlice } from '@reduxjs/toolkit';
import { makeEndpointClient, generateTempId } from './entities';
import * as _ from 'lodash';

export interface Team {
  id: number;
  number: number;
  name: string;
  alliance: number | null;
  wins?: number;
  losses?: number;
}

export const { adapter, selectors, fetch, save, sliceOptions } = makeEndpointClient<
  Team,
  Team['id']
>(
  'teams',
  (team) => team.id,
  (team) => (team.id < 0 ? _.omit(team, 'id') : team)
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
export const add = () =>
  slice.actions.upsert({
    id: generateTempId(),
    number: 0,
    name: '',
    alliance: null,
  });
