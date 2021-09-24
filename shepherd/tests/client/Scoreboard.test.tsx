import * as React from 'react';
import Scoreboard from '../../app/client/components/Scoreboard';
import { MatchPhase } from '../../app/types';
import { act, render, recvControl, screen } from './test-utils';
import { init, refresh } from '../../app/client/store/control';

beforeEach(async () => {
  jest.useFakeTimers();
  render(<Scoreboard />);
  window.store.dispatch(init());
  await window.store.dispatch(refresh()).unwrap();
});

afterEach(() => {
  jest.useRealTimers();
});

it('displays the time remaining', async () => {
  expect(screen.getByText(/--:--/i)).toBeInTheDocument();
  jest.setSystemTime(5000);
  recvControl({
    control: {
      timer: {
        phase: MatchPhase.AUTO,
        timeRemaining: 30000,
        totalTime: 30000,
        stage: 'init',
      },
    },
  });
  await act(async () => {
    jest.advanceTimersByTime(5010);
  });
  expect(screen.getByText(/^00:30.0$/)).toBeInTheDocument();
  recvControl({
    control: {
      timer: {
        phase: MatchPhase.AUTO,
        timeRemaining: 29500,
        totalTime: 30000,
        stage: 'running',
      },
    },
  });
  await act(async () => {
    jest.advanceTimersByTime(5010);
  });
  expect(screen.getByText(/^00:24.5$/)).toBeInTheDocument();
  recvControl({
    control: {
      timer: {
        phase: MatchPhase.AUTO,
        timeRemaining: 25000,
        totalTime: 30000,
        stage: 'running',
      },
    },
  });
  await act(async () => {
    jest.advanceTimersByTime(5010);
  });
  expect(screen.getByText(/^00:20.0$/)).toBeInTheDocument();
  await act(async () => {
    jest.advanceTimersByTime(200010);
  })
  expect(screen.getByText(/^00:00.0$/)).toBeInTheDocument();
  recvControl({
    control: {
      timer: {
        phase: MatchPhase.TELEOP,
        timeRemaining: 180000,
        totalTime: 180000,
        stage: 'init',
      },
    },
  });
  expect(await screen.findByText(/^03:00.0$/)).toBeInTheDocument();
});

it.each([
  [MatchPhase.AUTO, /autonomous/i],
  [MatchPhase.TELEOP, /tele-op/i],
  [MatchPhase.IDLE, /^\?$/i],
])('displays the %s phase', (phase, pattern) => {
  recvControl({
    control: {
      timer: { phase, timeRemaining: 0, totalTime: 10, stage: 'done' },
    },
  });
  expect(screen.getByText(pattern)).toBeInTheDocument();
});

it('displays alliances, teams, and scores', async () => {
  expect(screen.getByText(/blue: 0/i)).toBeInTheDocument();
  expect(screen.getByText(/gold: 0/i)).toBeInTheDocument();
  recvControl({ control: { matchId: 1 } });
  expect(screen.getByText(/blue: 0.5/i)).toBeInTheDocument();
  expect(screen.getByText(/gold: 0/i)).toBeInTheDocument();
  expect(screen.getByText(/alameda/i)).toBeInTheDocument();
  expect(screen.getByText(/santa clara/i)).toBeInTheDocument();
  expect(screen.getByText(/berkeley \(#0\)/i)).toBeInTheDocument();
  expect(screen.getByText(/stanford \(#1\)/i)).toBeInTheDocument();
});
