import { createSlice } from '@reduxjs/toolkit';
import * as _ from 'lodash';
import { makeEndpointClient, generateTempId } from './entities';
import { Team } from '../../types';

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
    hostname: '',
    callPort: 6000,
    logPort: 6001,
    updatePort: 6003,
    multicastGroup: '224.1.1.1',
  });
