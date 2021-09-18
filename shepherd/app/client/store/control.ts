import { createAction, createAsyncThunk, createSlice, isAnyOf } from '@reduxjs/toolkit';
import { Action, Dispatch, MiddlewareAPI } from 'redux';
import request from 'superagent';
import * as _ from 'lodash';
import { fetch as fetchAlliances } from './alliances';
import { fetch as fetchBracket } from './bracket';
import logSlice from './log';
import matchesSlice, {
  addEvent,
  fetch as fetchMatches,
  queryEvent,
  removeEvent,
  save as saveMatches,
  selectors as matchSelectors,
  updateEvent,
} from './matches';
import teamsSlice, {
  fetch as fetchTeams,
  save as saveTeams,
  selectors as teamSelectors,
} from './teams';
import {
  AllianceColor,
  ControlRequest,
  ControlState,
  MatchPhase,
  MatchEventType,
  RobotStatus,
  Team,
} from '../../types';
import type { RootState } from '.';

export const init = createAction<{ host: string } | undefined>('control/init');
const send = createAction<ControlRequest>('control/send');

export interface RobotSelection {
  [teamId: number]: boolean;
}

export interface Robot extends RobotStatus {
  selected: boolean;
  team: Team;
}

type Mode =
  | MatchEventType.AUTO
  | MatchEventType.TELEOP
  | MatchEventType.IDLE
  | MatchEventType.ESTOP;

export const connectMatch = (matchId: number, phase: MatchPhase, totalTime: number) =>
  send({
    matchId,
    timer: {
      phase,
      timeRemaining: totalTime * 1000,
      totalTime: totalTime * 1000,
      stage: 'init',
    },
  });

export const connectTeam = createAsyncThunk<
  void,
  { alliance: AllianceColor, teamId: number, hostname: string },
  { state: RootState }
>(
  'control/connectTeam',
  async ({ alliance, teamId, hostname }, thunkAPI) => {
    const { control: { matchId }, teams, matches } = thunkAPI.getState();
    const match = matchId ? matchSelectors.selectById(matches, matchId) : undefined;
    const team = teamId ? teamSelectors.selectById(teams, teamId) : undefined;
    if (match && team) {
      if (hostname) {
        thunkAPI.dispatch(teamsSlice.actions.upsert({ ...team, hostname }));
        await thunkAPI.dispatch(saveTeams()).unwrap();
      }
      const query = { type: MatchEventType.JOIN, team: teamId };
      const [target] = queryEvent(match, query);
      if (target) {
        thunkAPI.dispatch(updateEvent(match, target.id, { alliance }));
      } else {
        thunkAPI.dispatch(addEvent(match, { ...query, alliance }));
      }
      await thunkAPI.dispatch(saveMatches()).unwrap();
      thunkAPI.dispatch(send({}));
    }
  },
);

export const disconnectTeam = createAsyncThunk<
  void,
  { teamId: number },
  { state: RootState }
>(
  'control/disconnectTeam',
  async ({ teamId }, thunkAPI) => {
    const { control: { matchId }, matches } = thunkAPI.getState();
    const match = matchId ? matchSelectors.selectById(matches, matchId) : undefined;
    if (match) {
      const query = { type: MatchEventType.JOIN, team: teamId };
      const [target] = queryEvent(match, query);
      if (target) {
        thunkAPI.dispatch(removeEvent(match, target.id));
        await thunkAPI.dispatch(saveMatches()).unwrap();
        thunkAPI.dispatch(send({}));
      }
    }
  },
);

export const changeMode = createAsyncThunk<
  void,
  { mode: Mode, totalTime?: number, robots: Robot[] },
  { state: RootState }
>(
  'control/changeMode',
  async ({ mode, totalTime, robots }, thunkAPI) => {
    const { control: { matchId } } = thunkAPI.getState();
    if (matchId !== null) {
      const events = robots
        .filter((robot) => robot.selected)
        .map((robot) => ({
          match: matchId,
          type: mode,
          team: robot.teamId,
          value: totalTime ? 1000 * totalTime : null,
        }));
      thunkAPI.dispatch(send({ events }));
    }
  },
);

export const adjustScore = createAsyncThunk<
  void,
  { alliance: AllianceColor, points: number },
  { state: RootState }
>(
  'control/adjustScore',
  async ({ alliance, points }, thunkAPI) => {
    const { control: { matchId }, matches } = thunkAPI.getState();
    const match = matchId ? matchSelectors.selectById(matches, matchId) : undefined;
    if (match && points !== 0) {
      const event = {
        type: MatchEventType.ADD,
        alliance,
        value: points,
        description: 'Score manually adjusted by referee.',
      };
      thunkAPI.dispatch(addEvent(match, event));
      await thunkAPI.dispatch(saveMatches()).unwrap();
    }
  },
);

export const extendMatch = createAsyncThunk<
  void,
  { extension: number, robots: Robot[] },
  { state: RootState }
>(
  'control/extend',
  async ({ extension, robots }, thunkAPI) => {
    if (extension > 0) {
      const { control: { matchId } } = thunkAPI.getState();
      if (matchId !== null) {
        robots = robots.filter((robot) => robot.selected);
        const events = robots.map((robot) => ({
          match: matchId,
          type: MatchEventType.EXTEND,
          team: robot.teamId,
          value: extension * 1000,
        }));
        const activations = robots.map((robot) => robot.teamId);
        thunkAPI.dispatch(send({ events, activations }));
      }
    }
  },
);

export const refresh = createAsyncThunk<void, void, { state: RootState }>(
  'control/refresh',
  async (arg, thunkAPI) => {
    const { editing } = thunkAPI.getState().control;
    if (!editing) {
      await Promise.all([
        thunkAPI.dispatch(fetchAlliances()).unwrap(),
        thunkAPI.dispatch(fetchBracket()).unwrap(),
        thunkAPI.dispatch(fetchMatches()).unwrap(),
        thunkAPI.dispatch(fetchTeams()).unwrap(),
      ]);
    }
  },
);

const slice = createSlice({
  name: 'control',
  initialState: {
    matchId: null,
    editing: false,
    loading: false,
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
  extraReducers(builder) {
    builder
      .addCase(refresh.pending, (state) => ({ ...state, loading: true }))
      .addMatcher(isAnyOf(refresh.fulfilled, refresh.rejected),
        (state) => ({ ...state, loading: false }));
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
          const { control, match, events } = JSON.parse(event.data);
          dispatch(slice.actions.update({ ...control, clientTimestamp: Date.now() }));
          if (match) {
            dispatch(matchesSlice.actions.upsert(match));
          }
          if (events) {
            dispatch(logSlice.actions.append(events));
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
