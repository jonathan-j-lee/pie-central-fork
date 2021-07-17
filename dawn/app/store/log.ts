import { createAsyncThunk, createSlice } from '@reduxjs/toolkit';

export enum Level {
  DEBUG = 'debug',
  INFO = 'info',
  WARNING = 'warning',
  ERROR = 'error',
  CRITICAL = 'critical',
};

export enum LogOpenCondition {
  START = 'start',
  ERROR = 'error',
  NEVER = 'never',
};

const initialState = {
  showSystem: true,
  showTimestamps: true,
  showSeverity: true,
  showTraceback: true,
  pinToBottom: true,
  openCondition: LogOpenCondition.START,
  timeline: [],
  events: {},
  maxEvents: 256,
};

export const copy = createAsyncThunk<
  void,
  void,
  { state: { log: typeof initialState } }
>(
  'log/copy',
  async (arg, thunkAPI) => {
    const { events, timeline } = thunkAPI.getState().log;
    return await navigator.clipboard.writeText(
      timeline
        .map((timestamp) => events[timestamp])
        .map((event) => JSON.stringify(event))
        .join('\n'));
  },
);

const expire = (state) => {
  const expiredCount = state.timeline.length - state.maxEvents;
  const expiredTimestamps = state.timeline.splice(0, expiredCount);
  for (const timestamp of expiredTimestamps) {
    delete state.events[timestamp];
  }
};

export default createSlice({
  name: 'log',
  initialState,
  reducers: {
    toggle: (state, action) => ({ ...state, [action.payload]: !state[action.payload] }),
    set: (state, action) => ({ ...state, ...action.payload }),
    toggleContext: (state, action) => {
      const event = state.events[action.payload];
      if (event) {
        event.showContext = !event.showContext;
      }
    },
    append: (state, action) => {
      const event = action.payload;
      state.events[event.timestamp] = { payload: event, showContext: false };
      state.timeline.push(event.timestamp);
      expire(state);
    },
    clear: state => ({ ...state, timeline: [], events: {} }),
    truncate(state, action) {
      state.maxEvents = action.payload;
      expire(state);
    },
  },
});
