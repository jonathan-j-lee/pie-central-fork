import { createSlice } from '@reduxjs/toolkit';
import { makeEndpointClient, generateTempId } from './entities';
import * as _ from 'lodash';
import {
  AllianceColor,
  Match,
  MatchEvent,
  MatchEventType,
  MatchPhase,
  TimerState,
} from '../../types';

export const { adapter, selectors, fetch, save, sliceOptions } = makeEndpointClient<
  Match,
  Match['id']
>(
  'matches',
  (match) => match.id,
  (match) =>
    ({
      ...(match.id < 0 ? _.omit(match, 'id') : match),
      events: match.events.map((event) => (event.id < 0 ? _.omit(event, 'id') : event)),
    } as any),
  (a, b) => a.id - b.id,
);

const slice = createSlice({
  ...sliceOptions,
  extraReducers(builder) {
    builder.addCase(fetch.fulfilled, (state, action) => {
      adapter.setAll(state, action);
      state.modified = [];
      state.deleted = [];
    });
  },
});

export default slice;

export const add = () => slice.actions.upsert({ id: generateTempId(), fixture: null, events: [] });

export const addEvent = (match: Match, initialData?: Partial<MatchEvent>) =>
  slice.actions.upsert({
    ...match,
    events: [
      ...match.events,
      {
        id: generateTempId(),
        match: match.id,
        type: MatchEventType.OTHER,
        timestamp: Date.now(),
        alliance: AllianceColor.NONE,
        team: null,
        value: null,
        description: null,
        ...initialData,
      },
    ],
  });

export const updateEvent = (
  match: Match,
  eventId: MatchEvent['id'],
  changes: Partial<MatchEvent>
) =>
  slice.actions.upsert({
    ...match,
    events: match.events.map((event) =>
      event.id === eventId ? { ...event, ...changes } : event
    ),
  });

export const removeEvent = (match: Match, eventId: MatchEvent['id']) =>
  slice.actions.upsert({
    ...match,
    events: match.events.filter((event) => event.id !== eventId),
  });

export const queryEvent = (match: Match, fields: Partial<MatchEvent>) =>
  match.events.filter((event) => _.isMatch(event, fields));
