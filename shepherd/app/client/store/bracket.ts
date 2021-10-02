import { Alliance, Fixture, FixtureUpdate } from '../../types';
import { selectors as allianceSelectors } from './alliances';
import { createAsyncThunk, createSlice, EntityState } from '@reduxjs/toolkit';
import request from 'superagent';

export const fetch = createAsyncThunk('bracket/fetch', async () => {
  return (await request.get('/bracket')).body;
});

export const updateWinner = createAsyncThunk(
  'bracket/updateWiner',
  async (update: FixtureUpdate, thunkAPI) => {
    await request.put('/bracket').send(update);
    await thunkAPI.dispatch(fetch()).unwrap();
  }
);

export const generate = createAsyncThunk(
  'bracket/generate',
  async (ranking: number[] | undefined, thunkAPI) => {
    const req = request.post('/bracket');
    if (ranking) {
      req.send(ranking);
    }
    await req;
    await thunkAPI.dispatch(fetch()).unwrap();
  }
);

export const remove = createAsyncThunk('bracket/remove', async () => {
  await request.delete('/bracket');
});

export function getFixtures(
  fixture: Fixture | null,
  fixtures: Fixture[],
  alliances?: EntityState<Alliance>
): Fixture | null {
  if (!fixture) {
    return null;
  }
  if (fixture.winner && alliances) {
    fixture = {
      ...fixture,
      winningAlliance: allianceSelectors.selectById(alliances, fixture.winner),
    };
  }
  fixture = {
    ...fixture,
    blue: getFixtures(fixture.blue, fixtures, alliances),
    gold: getFixtures(fixture.gold, fixtures, alliances),
  };
  fixtures.push(fixture);
  return fixture;
}

export default createSlice({
  name: 'bracket',
  initialState: null as Fixture | null,
  reducers: {},
  extraReducers(builder) {
    builder
      .addCase(fetch.fulfilled, (state, action) => action.payload)
      .addCase(remove.fulfilled, () => null);
  },
});
