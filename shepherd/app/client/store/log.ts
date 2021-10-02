import {
  LogEvent as LogEventPayload,
  LogLevel,
  LogEventFilter,
  LogSettings,
  Session,
} from '../../types';
import { fetch as fetchSession, save as saveSession } from './session';
import { createSlice, createEntityAdapter, PayloadAction } from '@reduxjs/toolkit';
import * as _ from 'lodash';

export interface LogEvent {
  showContext: boolean;
  payload: LogEventPayload;
}

const adapter = createEntityAdapter<LogEvent>({
  selectId: (event) => event.payload.timestamp,
  sortComparer: (a, b) =>
    Date.parse(a.payload.timestamp) - Date.parse(b.payload.timestamp),
});
export const selectors = adapter.getSelectors();

const initialState = adapter.getInitialState({
  maxEvents: 400,
  level: LogLevel.INFO,
  filters: [] as LogEventFilter[],
  pinToBottom: true,
} as LogSettings);

function removeExcessEvents(state: typeof initialState) {
  const excessCount = selectors.selectTotal(state) - state.maxEvents;
  if (excessCount > 0) {
    const expired = selectors.selectIds(state).slice(0, excessCount);
    adapter.removeMany(state, expired);
  }
}

export default createSlice({
  name: 'log',
  initialState,
  reducers: {
    append(state, action: PayloadAction<LogEventPayload[]>) {
      adapter.addMany(
        state,
        action.payload.map((payload) => ({ showContext: false, payload }))
      );
      removeExcessEvents(state);
    },
    toggleContext(state, action: PayloadAction<string>) {
      const event = selectors.selectById(state, action.payload);
      if (event) {
        adapter.updateOne(state, {
          id: action.payload,
          changes: { showContext: !event.showContext },
        });
      }
    },
    clear: adapter.removeAll,
  },
  extraReducers(builder) {
    builder
      .addCase(saveSession.pending, (state, action) => ({
        ...state,
        ...action.meta.arg.log,
      }))
      .addCase(fetchSession.fulfilled, (state, action: PayloadAction<Session>) => {
        state = _.merge({}, state, action.payload.log);
        removeExcessEvents(state);
        return state;
      });
  },
});
