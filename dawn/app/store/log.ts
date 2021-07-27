import { createAsyncThunk, createEntityAdapter, createSlice } from '@reduxjs/toolkit';
import { LogLevel, LogOpenCondition } from './settings';

type LogEventPayload = {
  timestamp: string,
  level: LogLevel,
  event: string,
  exception?: string,
  student_code?: boolean,
};

type LogEvent = {
  id: number,
  showContext: boolean,
  payload: LogEventPayload,
};

const logEventAdapter = createEntityAdapter<LogEvent>({
  sortComparer: (a, b) => a.id - b.id,
});

export const logEventSelectors = logEventAdapter.getSelectors();

const initialState = logEventAdapter.getInitialState({ open: false });

export const copy = createAsyncThunk<
  void,
  void,
  { state: { log: typeof initialState } }
>(
  'log/copy',
  async (arg, thunkAPI) => {
    const events = logEventSelectors.selectAll(thunkAPI.getState().log);
    const text = events.map((event) => JSON.stringify(event)).join('\n');
    await navigator.clipboard.writeText(text);
  },
);

export const append = createAsyncThunk<
  { maxEvents: number, payload: LogEventPayload },
  LogEventPayload
>(
  'log/append',
  async (payload, thunkAPI) => {
    const { maxEvents, openCondition } = thunkAPI.getState().settings.log;
    if (openCondition === LogOpenCondition.ERROR && payload.exception) {
      thunkAPI.dispatch(slice.actions.open());
    }
    return { maxEvents, payload };
  },
);

const slice = createSlice({
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
    builder
      .addCase(append.fulfilled, (state, action) => {
        const { maxEvents, payload } = action.payload;
        logEventAdapter.addOne(state, {
          id: Date.parse(payload.timestamp),
          showContext: false,
          payload,
        });
        const excessCount = logEventSelectors.selectTotal(state) - maxEvents;
        if (excessCount > 0) {
          const expired = logEventSelectors.selectIds(state).slice(0, excessCount);
          logEventAdapter.removeMany(state, expired);
        }
      });
  },
});

export default slice;
