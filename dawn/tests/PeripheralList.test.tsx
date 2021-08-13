import * as React from 'react';
import { render, screen, dispatchDevUpdate } from './test-utils';
import PeripheralList from '../app/components/PeripheralList';
import userEvent from '@testing-library/user-event';

beforeEach(() => {
  render(<PeripheralList />);
});

it('shows a placeholder when there are no devices', async () => {
  expect(await screen.findByText(/no devices detected/i)).toBeInTheDocument();
});

it('shows a card when a device connects', async () => {
  const update = { 12345: { switch0: false, switch1: true, switch2: false } };
  dispatchDevUpdate(update, { timestamp: 5000 }, 5050);
  dispatchDevUpdate(update, { timestamp: 5100 }, 5150);
  expect(await screen.findByText(/limit switch/i)).toBeInTheDocument();
  expect(await screen.findByText(/12345/i)).toBeInTheDocument();
});

it('updates when new parameter data are received', async () => {
  const update = { 12345: { switch0: false, dir: 'up' } };
  dispatchDevUpdate(update, { timestamp: 5000 }, 5050);
  dispatchDevUpdate(update, { timestamp: 5100 }, 5150);
  userEvent.click(await screen.findByText(/show parameters/i));
  expect(await screen.findByText(/dir: up/i)).toBeInTheDocument();
  update[12345].dir = 'down';
  dispatchDevUpdate(update, { timestamp: 5200 }, 5250);
  expect(screen.queryByText(/dir: up/i)).not.toBeInTheDocument();
  expect(await screen.findByText(/dir: down/i)).toBeInTheDocument();
});

it('sorts devices by type and UID', async () => {
  const update = { '9444732965739290427392': {}, '0': {}, '4722366482869645213696': {} };
  for (let i = 0; i < 60; i++) {
    const timestamp = 5000 + 10*i;
    dispatchDevUpdate(update, { timestamp }, timestamp + 5);
  }
  const uids = screen.queryAllByText(/^\d+$/);
  expect(uids).toHaveLength(3);
  const [uid1, uid2, uid3] = uids;
  expect(uid1).toHaveTextContent('0');
  expect(uid2).toHaveTextContent('4722366482869645213696');
  expect(uid3).toHaveTextContent('9444732965739290427392');
});
