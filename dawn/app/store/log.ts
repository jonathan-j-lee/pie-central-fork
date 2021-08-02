import { createAsyncThunk, createEntityAdapter, createSlice } from '@reduxjs/toolkit';
import { LogLevel, LogOpenCondition, SettingsState } from './settings';

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

const isError = (level: LogLevel) =>
  level === LogLevel.ERROR || level === LogLevel.CRITICAL;

const logEventAdapter = createEntityAdapter<LogEvent>({
  selectId: (event) => event.payload.timestamp,
  sortComparer: (a, b) =>
    Date.parse(a.payload.timestamp) - Date.parse(b.payload.timestamp),
});

export const logEventSelectors = logEventAdapter.getSelectors();

const initialState = logEventAdapter.getInitialState({ open: false });

export const copy = createAsyncThunk<
  void,
  void,
  { state: { log: typeof initialState } }
>('log/copy', async (arg, thunkAPI) => {
  const events = logEventSelectors.selectAll(thunkAPI.getState().log);
  const text = events.map((event) => JSON.stringify(event)).join('\n');
  await navigator.clipboard.writeText(text);
});

export const append = createAsyncThunk<
  { maxEvents: number; payload: LogEventPayload; open: boolean },
  LogEventPayload,
  { state: { settings: SettingsState; log: typeof initialState } }
>('log/append', async (payload, thunkAPI) => {
  const state = thunkAPI.getState();
  const { maxEvents, openCondition } = state.settings.log;
  const open =
    state.log.open ||
    (isError(payload.level) && openCondition === LogOpenCondition.ERROR);
  return { maxEvents, payload, open };
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
