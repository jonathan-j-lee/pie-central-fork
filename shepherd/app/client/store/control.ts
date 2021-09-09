import { createAction, createAsyncThunk, createSlice } from '@reduxjs/toolkit';
import { Action, Dispatch, MiddlewareAPI } from 'redux';
import request from 'superagent';
import * as _ from 'lodash';
import matchesSlice from './matches';
import { ControlRequest, ControlState, MatchPhase, MatchEventType } from '../../types';
import type { RootState } from '.';
import * as teamUtils from './teams';
import * as matchUtils from './matches';

export const init = createAction<{ host: string } | undefined>('control/init');
export const send = createAction<ControlRequest>('control/send');

const slice = createSlice({
  name: 'control',
  initialState: {
    matchId: null,
    clientTimestamp: 0,
    timer: {
      phase: MatchPhase.IDLE,
      timeRemaining: 0,
      totalTime: 0,
      stage: 'done',
    },
    robots: [],
  } as ControlState,
  reducers: {
    update: (state, action) => ({ ...state, ...action.payload }),
  },
});

export function wsClient({ dispatch }: MiddlewareAPI) {
  let ws: WebSocket | null = null;
  return (next: Dispatch) => (action: Action) => {
    if (init.match(action)) {
      if (ws !== null) {
        ws.close();
      }
      ws = new WebSocket(action.payload?.host ?? `ws://${window.location.host}`);
      ws.addEventListener('message', (event) => {
        try {
          const { control, match } = JSON.parse(event.data);
          dispatch(slice.actions.update({ ...control, clientTimestamp: Date.now() }));
          if (match) {
            dispatch(matchesSlice.actions.upsert(match));
          }
        } catch {}
      });
    } else if (send.match(action) && ws !== null) {
      try {
        ws.send(JSON.stringify(action.payload));
      } catch {}
    }
    return next(action);
  };
}

export default slice;
