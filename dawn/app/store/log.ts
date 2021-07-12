import { createSlice } from '@reduxjs/toolkit';

export enum Level {
  DEBUG = 'debug',
  INFO = 'info',
  WARNING = 'warning',
  ERROR = 'error',
  CRITICAL = 'critical',
};

export default createSlice({
  name: 'log',
  initialState: {
    showSystem: true,
    showTimestamps: true,
    showSeverity: true,
    showTraceback: true,
    events: [],
    maxEvents: 256,
    // openOnStart: true,  -- open on start, open on error, open never
  },
  reducers: {
    toggle: (state, action) => ({ ...state, [action.payload]: !state[action.payload] }),
    append: (state, action) => {
      const size = state.events.push(action.payload);
      state.events.splice(0, size - state.maxEvents);
    },
    clear: state => ({ ...state, events: [] }),
    truncate: (state, action) => ({
      ...state,
      events: state.events.slice(-action.payload),
      maxEvents: action.payload,
    }),
  },
});
