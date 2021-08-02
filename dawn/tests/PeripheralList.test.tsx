import * as React from 'react';
import { fireEvent, render, screen, dispatchDevUpdate } from './test-utils';
import Peripherals from '../app/components/Peripherals';

beforeEach(() => {
  render(<Peripherals />);
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
  fireEvent.click(await screen.findByRole('button', { name: /show parameters/i }));
  expect(await screen.findByText(/dir\: up/i)).toBeInTheDocument();
  update[12345].dir = 'down';
  dispatchDevUpdate(update, { timestamp: 5200 }, 5250);
  expect(screen.queryByText(/dir\: up/i)).not.toBeInTheDocument();
  expect(await screen.findByText(/dir\: down/i)).toBeInTheDocument();
});
