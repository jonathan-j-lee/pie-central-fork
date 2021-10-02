import RuntimeStatusCard from '../app/components/RuntimeStatusCard';
import { changeMode, Mode } from '../app/store/runtime';
import { log, render, screen, dispatchDevUpdate } from './test-utils';
import * as React from 'react';

beforeEach(() => {
  render(<RuntimeStatusCard />);
});

it('shows when Dawn is disconnected', async () => {
  expect(await screen.findByText(/disconnected/i)).toBeInTheDocument();
  const help = await screen.findByText(/dawn is not receiving updates from runtime/i);
  expect(help).toBeInTheDocument();
});

it('shows when Dawn is connected', async () => {
  dispatchDevUpdate({}, { timestamp: 5000 }, 5050);
  dispatchDevUpdate({}, { timestamp: 5100 }, 5150);
  expect(await screen.findByText(/^connected$/i)).toBeInTheDocument();
});

it('shows when Dawn is encountering latency', async () => {
  dispatchDevUpdate({}, { timestamp: 5000 }, 12000);
  expect(await screen.findByText(/increased latency/i)).toBeInTheDocument();
});

it('shows when Dawn encounters an error', async () => {
  dispatchDevUpdate();
  log.error('Process terminated', { timestamp: '2021-08-03T16:18:21.392159Z' });
  expect(await screen.findByText(/errors detected/i)).toBeInTheDocument();
  const help = await screen.findByText(/check the console for messages/i);
  expect(help).toBeInTheDocument();
});

// it.each([])('displays the alliance', async () => {});

it.each([
  [Mode.AUTO, /autonomous/i],
  [Mode.TELEOP, /teleop/i],
  [Mode.IDLE, /idle/i],
  [Mode.ESTOP, /idle/i],
])('displays the mode %s', async (mode, match) => {
  dispatchDevUpdate({}, { timestamp: 5000 }, 5050);
  dispatchDevUpdate({}, { timestamp: 5100 }, 5150);
  dispatchDevUpdate({}, { timestamp: 5200 }, 5250);
  window.store.dispatch(changeMode(mode));
  expect(await screen.findByText(match)).toBeInTheDocument();
});

// TODO: test disconnect
