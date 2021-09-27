import * as React from 'react';
import * as _ from 'lodash';
import {
  act,
  delay,
  deleteEntities,
  getColumn,
  getRows,
  logIn,
  refresh,
  render,
  screen,
  upsertEntities,
} from './test-utils';
import { within } from '@testing-library/dom';
import userEvent from '@testing-library/user-event';
import Schedule from '../../app/client/components/Schedule';

jest.mock('@svgdotjs/svg.js', () => ({
  SVG: jest.fn(() => ({
    path: jest.fn().mockReturnThis(),
    fill: jest.fn().mockReturnThis(),
    stroke: jest.fn().mockReturnThis(),
    text: jest.fn().mockReturnThis(),
    pattern: jest.fn().mockReturnThis(),
    rect: jest.fn().mockReturnThis(),
    center: jest.fn().mockReturnThis(),
    clear: jest.fn().mockReturnThis(),
    viewbox: jest.fn().mockReturnThis(),
    polyline: jest.fn().mockReturnThis(),
    on: jest.fn().mockReturnThis(),
  })),
}));

jest.mock('react-router-dom', () => {
  return {
    // TODO: mock BrowserRouter, Switch, Route, Redirect
    Link: ({ to, children }: { to: string, children?: React.ReactNode }) =>
      <span>{children}</span>,
    useLocation: () => ({
      key: '',
      pathname: '/schedule',
      search: '?match=1',
      hash: '',
      state: {},
    }),
    useHistory: () => ({
      push(path: string) {
        console.log(path);
      },
    }),
  };
});

beforeEach(async () => {
  render(<Schedule transitionDuration={0} />);
  await refresh();
});

const EM_DASH = '\u2014';

it('displays matches', () => {
  const table = screen
    .getByText(/^number$/i)
    .closest('table') as HTMLTableElement | null;
  if (!table) {
    return fail('match table not found');
  }
  const rows = getRows(table);
  expect(rows).toHaveLength(3);
  let cells = rows[0]?.getElementsByTagName('td') ?? [];
  expect(cells).toHaveLength(8);
  expect(cells[0]).toHaveTextContent(/match 1/i);
  expect(cells[1]).toHaveTextContent(/alameda/i);
  expect(cells[2]).toHaveTextContent(/berkeley \(#0\)/i);
  expect(cells[3]).toHaveTextContent(/-5/i);
  expect(cells[4]).toHaveTextContent(/santa clara/i);
  expect(cells[5]).toHaveTextContent(/stanford \(#1\)/i);
  expect(cells[6]).toHaveTextContent(/5/i);
  expect(cells[7]).toHaveTextContent(/alameda vs\. santa clara/i);
  cells = rows[2]?.getElementsByTagName('td') ?? [];
  expect(cells).toHaveLength(8);
  expect(cells[0]).toHaveTextContent(/match 3/i);
  expect(cells[1]).toHaveTextContent(EM_DASH);
  expect(cells[2]).toHaveTextContent(/berkeley \(#0\)/i);
  expect(cells[3]).toHaveTextContent(/0/i);
  expect(cells[4]).toHaveTextContent(EM_DASH);
  expect(cells[5]).toHaveTextContent(/stanford \(#1\)/i);
  expect(cells[6]).toHaveTextContent(/0/i);
  expect(cells[7]).toHaveTextContent(EM_DASH);
});

it('displays match events', () => {
  const table = screen
    .getByText(/^timestamp$/i)
    .closest('table') as HTMLTableElement | null;
  if (!table) {
    return fail('match event table not found');
  }
  const rows = getRows(table);
  expect(rows).toHaveLength(8);
  let cells = rows[0]?.getElementsByTagName('td') ?? [];
  expect(cells).toHaveLength(5);
  expect(cells[0]).toHaveTextContent(EM_DASH);
  expect(cells[1]).toHaveTextContent(/blue/i);
  expect(cells[2]).toHaveTextContent(/berkeley \(#0\)/i);
  expect(cells[3]).toHaveTextContent(/berkeley \(#0\) joined the blue alliance\./i);
  expect(cells[4]).toHaveTextContent(EM_DASH);
  cells = rows[3]?.getElementsByTagName('td') ?? [];
  expect(cells).toHaveLength(5);
  expect(cells[0]).toHaveTextContent(/\+00:00\.0/);
  expect(cells[1]).toHaveTextContent(/gold/i);
  expect(cells[2]).toHaveTextContent(/stanford \(#1\)/i);
  expect(cells[3]).toHaveTextContent(/started the autonomous phase for stanford \(#1\) for 00:30\./i);
  expect(cells[4]).toHaveTextContent(EM_DASH);
  cells = rows[6]?.getElementsByTagName('td') ?? [];
  expect(cells).toHaveLength(5);
  expect(cells[0]).toHaveTextContent(/\+00:30\.0/);
  expect(cells[1]).toHaveTextContent(/blue/i);
  expect(cells[2]).toHaveTextContent(EM_DASH);
  expect(cells[3]).toHaveTextContent(/the blue alliance lost 5 points\./i);
  expect(cells[4]).toHaveTextContent(EM_DASH);
});

it.each([
  [
    'number',
    0,
    () => screen.getByText(/number/i),
    [/match 1/i, /match 2/i, /match 3/i],
  ],
  [
    'blue alliance',
    1,
    () => screen.getAllByText(/alliance/i)[0],
    [/alameda/i, EM_DASH, EM_DASH],
  ],
  [
    'blue score',
    3,
    () => screen.getAllByText(/score/i)[0],
    [/^-5$/, /0$/, /(^|[^-])4$/],
  ],
  [
    'gold alliance',
    4,
    () => screen.getAllByText(/alliance/i)[1],
    [/santa clara/i, EM_DASH, EM_DASH],
  ],
  [
    'gold score',
    6,
    () => screen.getAllByText(/score/i)[1],
    [/^-4$/, /0$/, /(^|[^-])5$/],
  ],
  [
    'fixture',
    7,
    () => screen.getByText(/elimination round/i),
    [/alameda vs\. santa clara/i, EM_DASH, EM_DASH],
  ],
  [
    'timestamp',
    0,
    () => screen.getByText(/^timestamp$/i),
    [
      // Starts ascending, so clicking the sort button will cause the list to be in
      // descending order.
      /^\+00:30\.0$/,
      /^\+00:30\.0$/,
      /^\+00:20\.0$/,
      /^\+00:20\.0$/,
      /^\+00:00\.0$/,
      /^\+00:00\.0$/,
      EM_DASH,
      EM_DASH,
    ],
  ],
  [
    'alliance',
    1,
    () => screen.getAllByText(/^alliance$/i)[2],
    [/blue/i, /blue/i, /blue/i, /blue/i, /gold/i, /gold/i, /gold/i, /gold/i],
  ],
  [
    'team',
    2,
    () => screen.getByText(/^team$/i),
    [
      /berkeley \(#0\)/i,
      /berkeley \(#0\)/i,
      /berkeley \(#0\)/i,
      /stanford \(#1\)/i,
      /stanford \(#1\)/i,
      /stanford \(#1\)/i,
      EM_DASH,
      EM_DASH,
    ],
  ],
])('sorts matches or match events by %s', (heading, index, getHeading, contents) => {
  const [button] = getHeading()?.closest('td')?.getElementsByTagName('button') ?? [];
  const table = button.closest('table') as HTMLTableElement | null;
  if (!table) {
    return fail('table not found');
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

it('allows editing matches', async () => {
  expect(screen.queryByText(/^Edit$/)).not.toBeInTheDocument();
  await logIn();
  userEvent.click(screen.getByText(/^Edit$/));
  const table = screen.getByText(/number/i).closest('table') as HTMLTableElement | null;
  if (!table) {
    return fail('table not found');
  }

  const [, removeButton] = getColumn(table, 8);
  userEvent.click(within(removeButton).getByRole('button', { hidden: true }));
  userEvent.click(screen.getByText(/add match/i));

  const [fixture4, fixture1] = getColumn(table, 7);
  userEvent.click(within(fixture4).getByText(/\(none\)/i));
  await delay(10); // Cannot set a custom transition duration on the select

  const menu = screen.getByRole('list');
  const filter = screen.getByPlaceholderText(/filter\s*\.\.\./i);
  userEvent.type(filter, 'meda Vs. ');
  expect(within(menu).getByText(/alameda vs\. santa clara/i)).toBeInTheDocument();
  userEvent.type(filter, 'x');
  expect(within(menu).queryByText(/alameda vs\. santa clara/i)).not.toBeInTheDocument();
  userEvent.type(filter, '{backspace}');
  userEvent.click(within(menu).getByText(/alameda vs\. santa clara/i));

  userEvent.click(within(fixture1).getByText(/alameda vs\. santa clara/i));
  await delay(20);
  userEvent.click(within(screen.getAllByRole('list')[1]).getByText(/\(none\)/i));

  await act(async () => {
    userEvent.click(screen.getByText(/confirm/i));
    await delay(100);
  });
  const [[endpoint, payload]] = upsertEntities.mock.calls;
  expect(endpoint).toEqual('matches');
  expect(payload).toMatchObject([{ fixture: 1 }, { fixture: null, id: 1 }]);
  expect(payload[0].id).toBeUndefined();
  expect(deleteEntities).toHaveBeenCalledWith('matches', [2]);
  expect(screen.getAllByText(/^saved match schedule\.$/i).length).toBeGreaterThan(0);
});

it('allows editing match events', async () => {
  await logIn();
  userEvent.click(screen.getByText(/^Edit$/));
  const table = screen
    .getByText(/timestamp/i)
    .closest('table') as HTMLTableElement | null;
  if (!table) {
    return fail('table not found');
  }

  const [, , removeButton] = getColumn(table, 6);
  userEvent.click(within(removeButton).getByRole('button', { hidden: true }));
  userEvent.click(screen.getByText(/add event/i));

  const teams = getColumn(table, 2);
  userEvent.click(within(teams[2]).getByText(/stanford \(#1\)/i));
  await delay(10);

  const menu = screen.getByRole('list');
  const filter = screen.getByPlaceholderText(/filter\s*\.\.\./i);
  userEvent.type(filter, 'Ford');
  expect(within(menu).getByText(/stanford \(#1\)/i)).toBeInTheDocument();
  expect(within(menu).queryByText(/berkeley \(#0\)/i)).not.toBeInTheDocument();
  userEvent.type(filter, 'x');
  expect(within(menu).queryByText(/stanford \(#1\)/i)).not.toBeInTheDocument();
  userEvent.type(filter, '{backspace}');
  expect(within(menu).getByText(/stanford \(#1\)/i)).toBeInTheDocument();

  const rows = getRows(table);
  expect(rows).toHaveLength(8);
  userEvent.type(rows[7].getElementsByTagName('input')[0], '{selectall}50000');
  userEvent.selectOptions(within(rows[7]).getByDisplayValue(/^none$/i), ['blue']);
  userEvent.selectOptions(within(rows[7]).getByDisplayValue(/^other$/i), ['multiply']);
  userEvent.type(within(rows[7]).getByDisplayValue(/^0$/), '2.5');
  userEvent.type(within(rows[0]).getByPlaceholderText(/enter a description/i), 'A');
  userEvent.type(within(rows[7]).getByPlaceholderText(/enter a description/i), 'B');

  await act(async () => {
    userEvent.click(screen.getByText(/confirm/i));
    await delay(100);
  });
  const [[endpoint, payload]] = upsertEntities.mock.calls;
  expect(endpoint).toEqual('matches');
  expect(payload).toMatchObject([
    {
      id: 1,
      events: [
        { id: 1, description: 'A' },
        { id: 2 },
        { id: 4 },
        { id: 5 },
        { id: 6 },
        { id: 7 },
        { id: 8 },
        {
          match: 1,
          timestamp: 50000,
          alliance: 'blue',
          team: null,
          type: 'multiply',
          value: 2.5,
          description: 'B',
        },
      ],
    },
  ]);
  expect(screen.getAllByText(/^saved match schedule\.$/i).length).toBeGreaterThan(0);
});

it('shows a help dialog', async () => {
  userEvent.click(screen.getByText(/^Help$/));
  expect(screen.getByText(/final tournament is a best-of-three/i)).toBeInTheDocument();
  userEvent.click(screen.getByText(/^OK$/));
  await delay(10);
  expect(
    screen.queryByText(/final tournament is a best-of-three/i)
  ).not.toBeInTheDocument();
});

it('requests bracket generation', async () => {
  await logIn();
  userEvent.click(screen.getByText(/^Edit$/));
  userEvent.click(screen.getByText(/^generate bracket$/i));
  const alertMessage = screen.getByText(/are you sure/i);
  expect(alertMessage).toBeInTheDocument();
  const alert = alertMessage.closest('div.bp3-alert') as HTMLDivElement | null;
  if (!alert) {
    return fail('alert not found');
  }
  await act(async () => {
    userEvent.click(within(alert).getByText(/^confirm$/i));
    await delay(20);
  });
  expect(upsertEntities).toHaveBeenCalledWith('bracket', [1, 2]);
});

it('requests bracket deletion', async () => {
  await logIn();
  userEvent.click(screen.getByText(/^Edit$/));
  userEvent.click(screen.getByText(/^remove bracket$/i));
  const alertMessage = screen.getByText(/are you sure/i);
  expect(alertMessage).toBeInTheDocument();
  const alert = alertMessage.closest('div.bp3-alert') as HTMLDivElement | null;
  if (!alert) {
    return fail('alert not found');
  }
  await act(async () => {
    userEvent.click(within(alert).getByText(/^confirm$/i));
    await delay(20);
  });
  expect(deleteEntities).toHaveBeenCalledWith('bracket');
});
