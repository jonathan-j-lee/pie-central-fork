import * as React from 'react';
import * as _ from 'lodash';
import {
  act,
  delay,
  getRows,
  init,
  makeEndpointUrl,
  recvControl,
  refresh,
  render,
  screen,
  server,
  upsertEntities,
} from './test-utils';
import { within } from '@testing-library/dom';
import userEvent from '@testing-library/user-event';
import { rest } from 'msw';
import Dashboard from '../../app/client/components/Dashboard';
import { AllianceColor, MatchEventType, MatchPhase } from '../../app/types';

function getControl(pattern: RegExp): HTMLElement {
  const control = screen
    .getByText(pattern)
    .closest('.bp3-form-content') as HTMLElement | null;
  if (!control) {
    throw new Error('control not found');
  }
  return control;
}

beforeEach(async () => {
  render(<Dashboard />);
  init();
  await refresh();
});

it('connects to a match', async () => {
  const inputs = [
    screen.getByDisplayValue(/autonomous/i),
    ...screen.getAllByPlaceholderText(/^number of seconds$/i),
    screen.getByText(/^start$/i).closest('button'),
    screen.getByText(/^Stop$/).closest('button'),
    screen.getByText(/e-stop/i).closest('button'),
    ...screen.getAllByText(/^none$/i),
    screen.getAllByText(/^\(none\)/i)[1].closest('button'),
    screen.getByPlaceholderText(/example: 192\.168\.1\.1/i),
    screen.getByPlaceholderText(/number of points/i),
  ];
  for (const input of inputs) {
    expect(input).toBeDisabled();
  }

  const control = getControl(/connect to robots/i);
  userEvent.click(within(control).getByText(/\(none\)/i));
  await delay(20);

  const menu = screen.getByRole('list');
  const filter = screen.getByPlaceholderText(/filter\s*\.\.\./i);
  userEvent.type(filter, 'tch ');
  expect(within(menu).getByText(/^match 1$/i)).toBeInTheDocument();
  userEvent.type(filter, '9');
  expect(within(menu).queryByText(/^match 1$/i)).not.toBeInTheDocument();
  userEvent.type(filter, '{backspace}1');
  userEvent.click(within(menu).getByText(/^match 1$/i));
  await act(async () => {
    userEvent.click(within(control).getByText(/connect$/i));
    await delay(20);
  });

  const [[payload]] = (window.ws.send as jest.Mock).mock.calls;
  expect(JSON.parse(payload)).toMatchObject({
    matchId: 1,
    timer: {
      phase: 'auto',
      timeRemaining: 30000,
      totalTime: 30000,
      stage: 'init',
    },
  });
  recvControl({
    control: {
      matchId: 1,
      robots: [
        { teamId: 1, updateRate: 0, uids: [] },
        { teamId: 2, updateRate: 0, uids: [] },
      ],
    },
  });
  for (const input of inputs) {
    expect(input).not.toBeDisabled();
  }
  expect(screen.getByText(/selected match/i)).toBeInTheDocument();
});

describe.each([
  [1, [], [1, 2], MatchPhase.TELEOP, 180],
  [4, [{ id: 1, name: /berkeley \(#0\)/i }], [2], MatchPhase.AUTO, 30],
  [5, [{ id: 2, name: /stanford \(#1\)/i }], [1], MatchPhase.AUTO, 30],
])('commands robots for match %d', (matchId, deselected, selected, phase, totalTime) => {
  beforeEach(() => {
    recvControl({
      control: {
        matchId,
        robots: [
          { teamId: 1, updateRate: 0, uids: [] },
          { teamId: 2, updateRate: 0, uids: [] },
        ],
      },
    });
    for (const { name } of deselected) {
      const row = screen.getByText(name).closest('tr');
      if (!row) {
        throw new Error('connection table row not found');
      }
      userEvent.click(row.getElementsByTagName('input')[0]);
    }
  });

  it('starts the selected robots', async () => {
    const phasePattern = phase === MatchPhase.AUTO ? /^autonomous$/i : /^tele-op$/i;
    expect(screen.getByDisplayValue(phasePattern)).toBeInTheDocument();
    expect(screen.getByDisplayValue(totalTime.toString())).toBeInTheDocument();
    await act(async () => {
      userEvent.click(screen.getByText(/^start$/i));
    });
    if (deselected.length) {
      expect(
        screen.getByText(/robots are normally started or stopped all together/i)
      ).toBeInTheDocument();
      await act(async () => {
        userEvent.click(screen.getByText(/^confirm$/i));
      });
    }

    const type = phase === MatchPhase.AUTO
      ? MatchEventType.AUTO
      : MatchEventType.TELEOP;
    const [[payload]] = (window.ws.send as jest.Mock).mock.calls;
    expect(JSON.parse(payload)).toMatchObject({
      events: selected.map(
        (team) => ({ match: matchId, type, team, value: totalTime * 1000 })
      ),
    });
    expect(screen.getAllByText(/started robots/i).length).toBeGreaterThan(0);
  });

  it.each([
    [
      'stops',
      MatchEventType.IDLE,
      /^Stop$/,
      /shepherd normally stops robots/i,
      /stopped robots/i,
    ],
    [
      'e-stops',
      MatchEventType.ESTOP,
      /^e-stop$/i,
      /e-stopped robots cannot be restarted/i,
      /e-stopped robots/i,
    ],
  ])('%s the selected robots', async (action, type, pattern, warning, notification) => {
    await act(async () => {
      userEvent.click(screen.getByText(pattern));
    });
    expect(screen.getByText(warning)).toBeInTheDocument();
    if (deselected.length) {
      expect(
        screen.getByText(/robots are normally started or stopped all together/i)
      ).toBeInTheDocument();
    }
    await act(async () => {
      userEvent.click(screen.getByText(/^confirm$/i));
    });

    const [[payload]] = (window.ws.send as jest.Mock).mock.calls;
    expect(JSON.parse(payload)).toMatchObject({
      events: selected.map((team) => ({ match: matchId, type, team })),
    });
    expect(screen.getAllByText(notification).length).toBeGreaterThan(0);
  });

  it('extends the match for the selected robots', async () => {
    const button = screen.getByText(/add time/i).closest('button');
    if (!button) {
      throw new Error('button not found');
    }
    expect(button).toBeDisabled();
    const control = getControl(/manually delay the shutoff of the selected robots/i);
    const input = within(control).getByPlaceholderText(/number of seconds/i);
    userEvent.type(input, '{selectall}-1');
    userEvent.click(control);
    expect(button).toBeDisabled();
    userEvent.type(input, '{selectall}0.5');
    await act(async () => {
      userEvent.click(button);
    });

    const [[payload]] = (window.ws.send as jest.Mock).mock.calls;
    expect(JSON.parse(payload)).toMatchObject({
      events: selected.map((team) =>
        ({ match: matchId, type: MatchEventType.EXTEND, team, value: 500 })
      ),
    });
    expect(
      screen.getAllByText(/extended match for selected robots/i).length
    ).toBeGreaterThan(0);
  });
});

it('selects robots with controlled checkboxes', () => {
  recvControl({
    control: {
      matchId: 1,
      robots: [
        { teamId: 1, updateRate: 0, uids: [] },
        { teamId: 2, updateRate: 0, uids: [] },
      ],
    },
  });
  const table = screen
    .getByText(/^update rate$/i)
    .closest('table');
  if (!table) {
    throw new Error('robot table not found');
  }
  const [all, ...selected] = table.getElementsByTagName('input');
  expect(selected).toHaveLength(2);

  userEvent.click(selected[0]);
  expect(all).not.toBeChecked();
  userEvent.click(selected[0]);
  expect(all).toBeChecked();
  userEvent.click(selected[1]);
  expect(all).not.toBeChecked();

  userEvent.click(all);
  expect(selected[0]).toBeChecked();
  expect(selected[1]).toBeChecked();
  userEvent.click(all);
  expect(selected[0]).not.toBeChecked();
  expect(selected[1]).not.toBeChecked();

  expect(screen.getByDisplayValue(/tele-op/i)).toBeDisabled();
  expect(screen.getByDisplayValue(/180/)).toBeDisabled();
  expect(screen.getByText(/^start$/i).closest('button')).toBeDisabled();
  expect(screen.getByText(/^Stop$/).closest('button')).toBeDisabled();
  expect(screen.getByText(/^e-stop$/i).closest('button')).toBeDisabled();
  expect(screen.getAllByPlaceholderText(/^number of seconds$/i)[0]).toBeDisabled();
  expect(screen.getByText(/^add time$/i).closest('button')).toBeDisabled();
});

it('displays a connection table', () => {
  recvControl({
    control: {
      matchId: 1,
      robots: [
        { teamId: 1, updateRate: 0.123, uids: ['0', '1'] },
        { teamId: 2, updateRate: 0, uids: [] },
      ],
    },
  });
  const table = screen
    .getByText(/^update rate$/i)
    .closest('table') as HTMLTableElement | null;
  if (!table) {
    throw new Error('connection table not found');
  }
  const rows = getRows(table);
  expect(rows).toHaveLength(2);
  const cells = rows[0]?.getElementsByTagName('td') ?? [];
  expect(cells).toHaveLength(7);
  expect(cells[1]).toHaveTextContent(/^blue$/i);
  expect(cells[2]).toHaveTextContent(/berkeley \(#0\)/i);
  expect(cells[3]).toHaveTextContent(/localhost/i);
  expect(cells[4]).toHaveTextContent(/0\.12\b/);
  expect(cells[5]).toHaveTextContent(/0, 1/i);
});

it('removes a robot from the connection table', async () => {
  recvControl({
    control: { matchId: 5, robots: [{ teamId: 1, updateRate: 0, uids: [] }]}
  });
  const row = screen
    .getByText(/^berkeley \(#0\)$/i)
    .closest('tr') as HTMLTableElement | null;
  if (!row) {
    throw new Error('connection table not found');
  }
  userEvent.click(row.getElementsByTagName('button')[0]);
  await delay(50);

  expect(upsertEntities).toHaveBeenCalledWith('matches', [
    expect.objectContaining({
      id: 5,
      events: [
        expect.objectContaining({
          type: MatchEventType.JOIN,
          alliance: AllianceColor.GOLD,
          team: 2,
        }),
        expect.objectContaining({ type: MatchEventType.ADD }),
        expect.objectContaining({ type: MatchEventType.ADD }),
      ],
    }),
  ]);
  expect(window.ws.send).toHaveBeenCalledTimes(1);
});

it.each([
  ['blue', /stanford \(#1\)/i, 2, '127.0.0.1'],
  ['gold', /berkeley \(#0\)/i, 1, ''],
])('adds a team to the %s alliance', async (alliance, team, teamId, hostname) => {
  recvControl({ control: { matchId: 1 } });
  const button = screen.getByText(/^add team$/i).closest('button');
  if (!button) {
    throw new Error('button not found');
  }
  expect(button).toBeDisabled();
  const control = getControl(/assign a team to an alliance/i);
  userEvent.selectOptions(within(control).getByDisplayValue(/^none$/i), [alliance]);
  userEvent.click(within(control).getByText(/\(none\)/i));
  await delay(20);
  const menu = screen.getByRole('list');
  userEvent.click(within(menu).getByText(team));
  if (hostname) {
    userEvent.type(
      within(control).getByPlaceholderText(/example: 192\.168\.1\.1/i),
      hostname,
    );
    userEvent.click(control);
  }
  await act(async () => {
    userEvent.click(button);
    await delay(200);
  });

  if (hostname) {
    expect(upsertEntities).toHaveBeenCalledWith('teams', [
      expect.objectContaining({ id: teamId, hostname })
    ]);
  }
  expect(upsertEntities).toHaveBeenCalledWith('matches', [
    expect.objectContaining({
      id: 1,
      events: expect.arrayContaining([
        expect.objectContaining({
          match: 1,
          timestamp: 0,
          alliance,
          team: teamId,
          type: MatchEventType.JOIN,
        }),
      ]),
    }),
  ]);
  expect(screen.getAllByText(/added team to match/i).length).toBeGreaterThan(0);
});

it.each([
  ['blue', 2.5],
  ['gold', -2.5],
])("adjusts the %s alliance's score", async (alliance, points) => {
  recvControl({ control: { matchId: 1 } });
  const button = screen.getByText(/add score/i).closest('button');
  if (!button) {
    throw new Error('button not found');
  }
  expect(button).toBeDisabled();
  const control = getControl(/add or subtract points/i);
  userEvent.selectOptions(within(control).getByDisplayValue(/^none$/i), [alliance]);
  const pointsInput = within(control).getByPlaceholderText(/number of points/i);
  userEvent.type(pointsInput, '{selectall}' + points.toString());
  await act(async () => {
    userEvent.click(button);
    await delay(100);
  });

  expect(upsertEntities).toHaveBeenCalledWith(
    'matches',
    [expect.objectContaining({
      id: 1,
      events: expect.arrayContaining([
        expect.objectContaining({
          match: 1,
          type: MatchEventType.ADD,
          alliance,
          team: null,
          value: points,
        }),
      ]),
    })]
  );
  expect(screen.queryAllByText(/adjusted score/i).length).toBeGreaterThan(0);
});

it('estimates when all matches will be finished', async () => {
  jest.useFakeTimers();
  jest.setSystemTime(10000);
  expect(screen.getByText(/finish 1 remaining scheduled match(es)?/i)).toBeInTheDocument();
  recvControl({ control: { matchId: 1 } });
  jest.useRealTimers();
  await delay(20);
  const estimate = new Date(40000).toLocaleTimeString();
  expect(screen.getByText(estimate, { exact: false })).toBeInTheDocument();
  server.use(
    rest.get(makeEndpointUrl('matches'), (req, res, ctx) => {
      return res(ctx.json([]));
    }),
  );
  await refresh();
  expect(screen.getByText(/you have completed all matches/i));
});
