import { createAsyncThunk, createEntityAdapter, PayloadAction } from '@reduxjs/toolkit';
import request from 'superagent';

export function makeEndpointClient<T, ID extends number | string>(
  name: string,
  selectId: (entity: T) => ID,
  mapModified: (entity: T) => Partial<T> = (entity) => entity,
  sortComparer?: (a: T, b: T) => number,
  endpoint?: string
) {
  const adapter = createEntityAdapter<T>({ selectId, sortComparer });
  const selectors = adapter.getSelectors();
  const initialState = adapter.getInitialState({
    modified: [] as ID[],
    deleted: [] as ID[],
  });
  type State = typeof initialState;
  const apiEndpoint = endpoint ?? `/${name}`;

  const fetch = createAsyncThunk<T[]>(`${name}/fetch`, async (arg, thunkAPI) => {
    return (await request.get(apiEndpoint)).body;
  });

  const save = createAsyncThunk(`${name}/save`, async (arg, thunkAPI) => {
    const rootState = thunkAPI.getState() as { [key: string]: any };
    const state: State | undefined = rootState[name];
    if (state) {
      const entities = selectors.selectAll(state);
      // TODO: use set for checking modified
      const modified = entities
        .filter((entity) => state.modified.includes(selectId(entity)))
        .map((entity) => mapModified(entity));
      await request.put(apiEndpoint).send(modified);
      await request.delete(apiEndpoint).send(state.deleted);
      await thunkAPI.dispatch(fetch()).unwrap();
    }
  });

  const sliceOptions = {
    name,
    initialState,
    reducers: {
      upsert(state: State, action: PayloadAction<T>) {
        adapter.upsertOne(state, action);
        const id = selectId(action.payload);
        if (!state.modified.includes(id)) {
          state.modified.push(id);
        }
      },
      remove(state: State, action: PayloadAction<ID>) {
        adapter.removeOne(state, action);
        if (!state.deleted.includes(action.payload)) {
          state.deleted.push(action.payload);
        }
      },
    },
  };

  return { adapter, selectors, fetch, save, sliceOptions };
}

const randomBetween = (min: number, max: number) => min + (max - min) * Math.random();
export const generateTempId = () => randomBetween(Number.MIN_SAFE_INTEGER, 0);
