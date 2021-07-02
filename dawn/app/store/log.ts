import { createSlice } from '@reduxjs/toolkit';
import { makeUpdateReducer, makeToggleReducer } from './util';

export default createSlice({
  name: 'log',
  initialState: {
    showSystem: true,
    showTimestamps: true,
    showSeverity: true,
    showTraceback: true,
    showContext: true,
    events: [],
    maxEvents: 256,
    openOnStart: true,
  },
  reducers: {
    append: (state, action) => {
      const size = state.events.push(action.payload);
      if (size >= 2*state.maxEvents) {
        state.events = state.events.slice(-state.maxEvents);
      }
    },
    clear: state => ({ ...state, events: [] }),
    setMaxEvents: makeUpdateReducer('maxEvents'),
    truncate: state => ({ ...state }),  // TODO: FIXME
    toggleSystem: makeToggleReducer('showSystem'),
    toggleTimestamps: makeToggleReducer('showTimestamps'),
    toggleSeverity: makeToggleReducer('showSeverity'),
    toggleTraceback: makeToggleReducer('showTraceback'),
  },
});
