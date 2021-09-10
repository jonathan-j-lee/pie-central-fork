import { createAsyncThunk, createSlice } from '@reduxjs/toolkit';
import request from 'superagent';
import { Fixture, FixtureUpdate } from '../../types';

export const fetch = createAsyncThunk(
  'bracket/fetch',
  async (arg, thunkAPI) => {
    return (await request.get('/bracket')).body;
  },
);

export const updateWinner = createAsyncThunk(
  'bracket/updateWiner',
  async (update: FixtureUpdate, thunkAPI) => {
    await request.put('/bracket').send(update);
    await thunkAPI.dispatch(fetch()).unwrap();
  },
);

export const generate = createAsyncThunk(
  'bracket/generate',
  async (arg, thunkAPI) => {
    await request.post('/bracket');
    await thunkAPI.dispatch(fetch()).unwrap();
  },
);

export const remove = createAsyncThunk(
  'bracket/remove',
  async (arg, thunkAPI) => {
    await request.delete('/bracket');
  },
);

export function getFixtures(fixture: Fixture | null): Fixture[] {
  if (!fixture) {
    return [];
  }
  return [fixture].concat(getFixtures(fixture.blue)).concat(getFixtures(fixture.gold));
}

export default createSlice({
  name: 'bracket',
  initialState: null as Fixture | null,
  reducers: {
  },
  extraReducers(builder) {
    builder
      .addCase(fetch.fulfilled, (state, action) => action.payload)
      .addCase(remove.fulfilled, (state, action) => null);
  }
});
