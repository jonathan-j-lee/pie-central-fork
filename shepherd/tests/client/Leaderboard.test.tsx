import * as React from 'react';
import * as _ from 'lodash';
import {
  act,
  delay,
  deleteEntities,
  getColumn,
  getRows,
  init,
  logIn,
  recvControl,
  refresh,
  render,
  screen,
  upsertEntities,
} from './test-utils';
import { within } from '@testing-library/dom';
import userEvent from '@testing-library/user-event';
import Leaderboard from '../../app/client/components/Leaderboard';

beforeEach(async () => {
  render(<Leaderboard transitionDuration={0} />);
  init();
  await refresh();
  await act(async () => {
    recvControl({ control: { matchId: 4 } });
  });
  userEvent.click(screen.getByText(/include elimination matches/i));
});

it('displays teams', () => {
  const table = screen
    .getByText(/^number$/i)
    .closest('table') as HTMLTableElement | null;
  if (!table) {
    throw new Error('team table not found');
  }
  const rows = getRows(table);
  expect(rows).toHaveLength(2);
  let cells = rows[0]?.getElementsByTagName('td') ?? [];
  expect(cells).toHaveLength(7);
  expect(cells[0]).toHaveTextContent(/berkeley/i);
  expect(cells[1]).toHaveTextContent(/0/i);
  expect(cells[2]).toHaveTextContent(/alameda/i);
  expect(cells[3]).toHaveTextContent(/1/i);
  expect(cells[4]).toHaveTextContent(/0/i);
  expect(cells[5]).toHaveTextContent(/1/i);
  expect(cells[6]).toHaveTextContent(/4/i);
  userEvent.click(screen.getByText(/include elimination matches/i));
  expect(cells[3]).toHaveTextContent(/1/i);
  expect(cells[4]).toHaveTextContent(/1/i);
  expect(cells[5]).toHaveTextContent(/1/i);
  expect(cells[6]).toHaveTextContent(/-1/i);
  cells = rows[1]?.getElementsByTagName('td') ?? [];
  expect(cells).toHaveLength(7);
  expect(cells[0]).toHaveTextContent(/stanford/i);
  expect(cells[1]).toHaveTextContent(/1/i);
  expect(cells[2]).toHaveTextContent(/santa clara/i);
  expect(cells[3]).toHaveTextContent(/1/i);
  expect(cells[4]).toHaveTextContent(/1/i);
  expect(cells[5]).toHaveTextContent(/1/i);
  expect(cells[6]).toHaveTextContent(/1/i);
  userEvent.click(screen.getByText(/include elimination matches/i));
  expect(cells[3]).toHaveTextContent(/0/i);
  expect(cells[4]).toHaveTextContent(/1/i);
  expect(cells[5]).toHaveTextContent(/1/i);
  expect(cells[6]).toHaveTextContent(/-4/i);
});

it('displays alliances', () => {
  const table = screen
    .getByText(/^berkeley \(#0\)$/i)
    .closest('table') as HTMLTableElement | null;
  if (!table) {
    throw new Error('alliance table not found');
  }
  const rows = getRows(table);
  expect(rows).toHaveLength(2);
  let cells = rows[0]?.getElementsByTagName('td') ?? [];
  expect(cells).toHaveLength(6);
  expect(cells[0]).toHaveTextContent(/alameda/i);
  expect(cells[1]).toHaveTextContent(/berkeley \(#0\)/i);
  expect(cells[2]).toHaveTextContent(/0/i);
  expect(cells[3]).toHaveTextContent(/1/i);
  expect(cells[4]).toHaveTextContent(/0/i);
  expect(cells[5]).toHaveTextContent(/-5/i);
  cells = rows[1]?.getElementsByTagName('td') ?? [];
  expect(cells).toHaveLength(6);
  expect(cells[0]).toHaveTextContent(/santa clara/i);
  expect(cells[1]).toHaveTextContent(/stanford \(#1\)/i);
  expect(cells[2]).toHaveTextContent(/1/i);
  expect(cells[3]).toHaveTextContent(/0/i);
  expect(cells[4]).toHaveTextContent(/0/i);
  expect(cells[5]).toHaveTextContent(/5/i);
});

it.each([
  ['name', 0, () => screen.getAllByText(/^name$/i)[0], [/berkeley/i, /stanford/i]],
  ['number', 1, () => screen.getByText(/^number$/i), [/0/, /1/]],
  ['alliance', 2, () => screen.getByText(/^alliance$/i), [/alameda/i, /santa clara/i]],
  ['wins', 3, () => screen.getAllByText(/^wins$/i)[0], [/0/, /1/]],
  ['losses', 4, () => screen.getAllByText(/^losses$/i)[0], [/0/, /1/]],
  ['ties', 5, () => screen.getAllByText(/^ties$/i)[0], [/1/, /1/]],
  ['total score', 6, () => screen.getAllByText(/^total score$/i)[0], [/-4/, /4/]],
  ['name', 0, () => screen.getAllByText(/^name$/i)[1], [/alameda/i, /santa clara/i]],
  ['wins', 2, () => screen.getAllByText(/^wins$/i)[1], [/0/, /1/]],
  ['losses', 3, () => screen.getAllByText(/^losses$/i)[1], [/0/, /1/]],
  ['ties', 4, () => screen.getAllByText(/^ties$/i)[1], [/0/, /0/]],
  ['total score', 5, () => screen.getAllByText(/^total score$/i)[1], [/-5/, /5/]],
])('sorts teams or alliances by %s', (heading, index, getHeading, contents) => {
  const [button] = getHeading()?.closest('td')?.getElementsByTagName('button') ?? [];
  const table = button.closest('table') as HTMLTableElement | null;
  if (!table) {
    throw new Error('table not found');
  }
  userEvent.click(button);
  let cells = getColumn(table, index);
  expect(cells).toHaveLength(contents.length);
  for (const [cell, content] of _.zip(cells, contents)) {
    if (content) {
      expect(cell).toHaveTextContent(content);
    }
  }
  userEvent.click(button);
  cells = getColumn(table, index);
  for (const [cell, content] of _.zip(cells, _.reverse(contents))) {
    if (content) {
      expect(cell).toHaveTextContent(content);
    }
  }
});

it('allows editing teams', async () => {
  expect(screen.queryByText(/^Edit$/)).not.toBeInTheDocument();
  await logIn();
  userEvent.click(screen.getByText(/^Edit$/));
  const table = screen.getByText(/number/i).closest('table') as HTMLTableElement | null;
  if (!table) {
    throw new Error('table not found');
  }

  const [removeButton] = getColumn(table, 8);
  userEvent.click(within(removeButton).getByRole('button', { hidden: true }));
  userEvent.click(screen.getByText(/add team/i));

  const alliances = getColumn(table, 2);
  userEvent.click(within(alliances[0]).getByText(/santa clara/i));
  await delay(20);

  const menu = screen.getByRole('list');
  const filter = screen.getByPlaceholderText(/filter\s*\.\.\./i);
  userEvent.type(filter, 'med');
  expect(within(menu).getByText(/alameda/i)).toBeInTheDocument();
  userEvent.type(filter, 'x');
  expect(within(menu).queryByText(/alameda/i)).not.toBeInTheDocument();
  userEvent.type(filter, '{backspace}');
  userEvent.click(within(menu).getByText(/alameda/i));

  const rows = getRows(table);
  expect(rows).toHaveLength(2);
  const [name, number] = rows[1].getElementsByTagName('input');
  userEvent.type(name, 'MIT');
  userEvent.type(number, '{selectall}-1');
  userEvent.click(within(rows[1]).getByText(/^Settings$/));
  userEvent.type(screen.getByLabelText(/hostname/i), 'localhost');
  userEvent.type(screen.getByLabelText(/remote call port/i), '{selectall}5000');
  userEvent.type(screen.getByLabelText(/log publisher port/i), '{selectall}5001');
  userEvent.type(screen.getByLabelText(/update port/i), '{selectall}-1');
  userEvent.type(screen.getByLabelText(/multicast group/i), '{selectall}224.1.1.2');
  userEvent.click(screen.getByText(/^close$/i));
  await act(async () => {
    userEvent.click(screen.getByText(/^Confirm$/));
    await delay(100);
  });

  expect(upsertEntities).toHaveBeenCalledWith('teams', [
    expect.objectContaining({ id: 2, alliance: 1 }),
    expect.objectContaining({
      name: 'MIT',
      number: 0,
      alliance: null,
      hostname: 'localhost',
      callPort: 5000,
      logPort: 5001,
      updatePort: 1,
      multicastGroup: '224.1.1.2',
    }),
  ]);
  expect(deleteEntities).toHaveBeenCalledWith('teams', [1]);
  expect(
    screen.getAllByText(/^saved team and alliance data\.$/i).length
  ).toBeGreaterThan(0);
});

it('allows editing alliances', async () => {
  await logIn();
  userEvent.click(screen.getByText(/^Edit$/));
  const table = screen
    .getByText(/berkeley \(#0\)/i)
    .closest('table') as HTMLTableElement | null;
  if (!table) {
    throw new Error('table not found');
  }

  const [removeButton] = getColumn(table, 6);
  userEvent.click(within(removeButton).getByRole('button', { hidden: true }));
  userEvent.click(screen.getByText(/add alliance/i));

  const names = getColumn(table, 0);
  userEvent.type(
    within(names[0]).getByDisplayValue(/santa clara/i),
    '{selectall}Contra Costa',
  );
  userEvent.type(within(names[1]).getByPlaceholderText(/enter a name/i), 'San Mateo');
  await act(async () => {
    userEvent.click(screen.getByText(/^Confirm$/));
    await delay(100);
  });

  expect(upsertEntities).toHaveBeenCalledWith('alliances', [
    expect.objectContaining({ id: 2, name: 'Contra Costa' }),
    expect.objectContaining({ name: 'San Mateo' }),
  ]);
  expect(deleteEntities).toHaveBeenCalledWith('alliances', [1]);
  expect(
    screen.getAllByText(/^saved team and alliance data\.$/i).length
  ).toBeGreaterThan(0);
});

it('shows a help dialog', async () => {
  userEvent.click(screen.getByText(/^Help$/));
  expect(screen.getByText(/teams form and compete in alliances/i)).toBeInTheDocument();
  userEvent.click(screen.getByText(/^OK$/));
  await delay(10);
  expect(
    screen.queryByText(/teams form and compete in alliances/i)
  ).not.toBeInTheDocument();
});
