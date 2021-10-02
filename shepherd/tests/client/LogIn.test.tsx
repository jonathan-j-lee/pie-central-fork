import LogIn from '../../app/client/components/LogIn';
import { delay, render } from './test-utils';
import { act, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import * as React from 'react';

beforeEach(() => {
  render(<LogIn transitionDuration={0} />);
  userEvent.click(screen.getByText(/log in/i));
});

it.each([
  ['escape', () => userEvent.type(screen.getByLabelText(/close/i), '{escape}')],
  ['close button', () => userEvent.click(screen.getByLabelText(/close/i))],
])('closes the dialog with %s', async (method, closeDialog) => {
  closeDialog();
  await delay(50);
  expect(screen.getAllByText(/log in/i).length).toEqual(1);
});

it.each([
  ['admin', 'not-a-password'],
  ['not-a-user', 'test'],
])('sends a failed login request for %s:%s', async (username, password) => {
  userEvent.type(screen.getByPlaceholderText(/username/i), username);
  userEvent.type(screen.getByPlaceholderText(/password/i), password);
  const [, label, submit] = screen.getAllByText(/log in/i);
  userEvent.click(label);
  await act(async () => {
    userEvent.click(submit);
    await delay(50);
  });
  expect(screen.getByText(/invalid credentials/i)).toBeInTheDocument();
  expect(screen.queryByText(/successfully logged in/i)).not.toBeInTheDocument();
  expect(screen.queryByText(/admin/i)).not.toBeInTheDocument();
  expect(screen.queryByText(/log out/i)).not.toBeInTheDocument();
});

it('sends successful login and logout requests', async () => {
  userEvent.type(screen.getByPlaceholderText(/username/i), 'admin');
  userEvent.type(screen.getByPlaceholderText(/password/i), 'test');
  const [, label, submit] = screen.getAllByText(/log in/i);
  userEvent.click(label);
  await act(async () => {
    userEvent.click(submit);
    await delay(50);
  });
  expect(screen.getByText(/successfully logged in/i)).toBeInTheDocument();
  expect(screen.getByText(/admin/i)).toBeInTheDocument();
  const logOut = screen.getByText(/log out/i);
  expect(logOut).toBeInTheDocument();
  expect(label).not.toBeVisible();
  expect(submit).not.toBeVisible();
  await act(async () => {
    userEvent.click(logOut);
    await delay(50);
  });
  expect(screen.getByText(/successfully logged out/i)).toBeInTheDocument();
  expect(screen.queryByText(/admin/i)).not.toBeInTheDocument();
  expect(screen.getByText(/log in/i)).toBeInTheDocument();
});
