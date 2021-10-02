import type { RootState } from '.';
import { LogLevel, LogOpenCondition } from './settings';
import { createAsyncThunk, createEntityAdapter, createSlice } from '@reduxjs/toolkit';

interface LogEventPayload {
  timestamp: string;
  level: LogLevel;
  event: string;
  exception?: string;
  student_code?: boolean; // eslint-disable-line camelcase
}

export interface LogEvent {
  showContext: boolean;
  payload: LogEventPayload;
}

const logEventAdapter = createEntityAdapter<LogEvent>({
  selectId: (event) => event.payload.timestamp,
  sortComparer: (a, b) =>
    Date.parse(a.payload.timestamp) - Date.parse(b.payload.timestamp),
});

export const logEventSelectors = logEventAdapter.getSelectors();

const initialState = logEventAdapter.getInitialState({ open: false });

export const copy = createAsyncThunk<void, void, { state: RootState }>(
  'log/copy',
  async (arg, thunkAPI) => {
    const events = logEventSelectors.selectAll(thunkAPI.getState().log);
    const text = events.map((event) => JSON.stringify(event.payload)).join('\n');
    await navigator.clipboard.writeText(text);
  }
);

export const append = createAsyncThunk<
  { maxEvents: number; payload: LogEventPayload; open: boolean; error: boolean },
  LogEventPayload & { [key: string]: any },
  { state: RootState }
>('log/append', async (payload, thunkAPI) => {
  const state = thunkAPI.getState();
  const { maxEvents, openCondition } = state.settings.log;
  const error = payload.level === LogLevel.ERROR || payload.level === LogLevel.CRITICAL;
  const open = state.log.open || (error && openCondition === LogOpenCondition.ERROR);
  return { maxEvents, payload, open, error };
});

export default createSlice({
  name: 'log',
  initialState,
  reducers: {
    open: (state) => ({ ...state, open: true }),
    close: (state) => ({ ...state, open: false }),
    toggleOpen: (state) => ({ ...state, open: !state.open }),
    toggleContext: (state, action) => {
      const event = logEventSelectors.selectById(state, action.payload);
      if (event) {
        logEventAdapter.updateOne(state, {
          id: action.payload,
          changes: { showContext: !event.showContext },
        });
      }
    },
    clear: logEventAdapter.removeAll,
  },
  extraReducers: (builder) => {
    builder.addCase(append.fulfilled, (state, action) => {
      const { maxEvents, payload, open } = action.payload;
      logEventAdapter.addOne(state, { showContext: false, payload });
      const excessCount = logEventSelectors.selectTotal(state) - maxEvents;
      if (excessCount > 0) {
        const expired = logEventSelectors.selectIds(state).slice(0, excessCount);
        logEventAdapter.removeMany(state, expired);
      }
      state.open = open;
    });
  },
});
