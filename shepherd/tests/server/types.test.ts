import {
  AllianceColor,
  GameState,
  LogLevel,
  MatchEventType,
  MatchPhase,
  getLogLevels,
  displayTeam,
  displayTime,
  displaySummary,
  displayLogFilter,
  parseLogFilter,
  getQualScore,
  countMatchStatistics,
} from '../../app/types';

it('gets all included log levels', () => {
  expect(getLogLevels(LogLevel.DEBUG)).toEqual(
    new Set([
      LogLevel.DEBUG,
      LogLevel.INFO,
      LogLevel.WARNING,
      LogLevel.ERROR,
      LogLevel.CRITICAL,
    ])
  );
  expect(getLogLevels(LogLevel.INFO)).toEqual(
    new Set([LogLevel.INFO, LogLevel.WARNING, LogLevel.ERROR, LogLevel.CRITICAL])
  );
  expect(getLogLevels(LogLevel.WARNING)).toEqual(
    new Set([LogLevel.WARNING, LogLevel.ERROR, LogLevel.CRITICAL])
  );
  expect(getLogLevels(LogLevel.ERROR)).toEqual(
    new Set([LogLevel.ERROR, LogLevel.CRITICAL])
  );
  expect(getLogLevels(LogLevel.CRITICAL)).toEqual(new Set([LogLevel.CRITICAL]));
});

it('displays a team', () => {
  expect(displayTeam({ name: 'Berkeley', number: 0 })).toEqual('Berkeley (#0)');
  expect(displayTeam({ name: 'Berkeley' })).toEqual('?');
  expect(displayTeam({ number: 0 })).toEqual('?');
  expect(displayTeam()).toEqual('?');
});

it('displays a time', () => {
  expect(displayTime(0)).toEqual('00:00.0');
  expect(displayTime(123.44)).toEqual('02:03.4');
  expect(displayTime(60 * 1000, 0)).toEqual('1000:00');
  expect(displayTime(-0.1)).toEqual('--:--');
});

it('displays a summary', () => {
  const summary = (type: MatchEventType, value?: number) =>
    displaySummary(
      {
        id: 1,
        match: 1,
        type,
        timestamp: 1632267193036,
        alliance: AllianceColor.BLUE,
        team: 0,
        value: value ?? null,
        description: null,
      },
      {
        name: 'Berkeley',
        number: 0,
      }
    );
  expect(summary(MatchEventType.JOIN)).toEqual(
    'Berkeley (#0) joined the Blue alliance.'
  );
  expect(summary(MatchEventType.AUTO, 30010)).toEqual(
    'Started the autonomous phase for Berkeley (#0) for 00:30.'
  );
  expect(summary(MatchEventType.TELEOP, 30010)).toEqual(
    'Started the tele-op phase for Berkeley (#0) for 00:30.'
  );
  expect(summary(MatchEventType.IDLE)).toEqual('Stopped Berkeley (#0).');
  expect(summary(MatchEventType.ESTOP)).toEqual('Emergency-stopped Berkeley (#0).');
  expect(summary(MatchEventType.ADD, 5)).toEqual(
    'The Blue alliance scored 5 points (without multipliers).'
  );
  expect(summary(MatchEventType.ADD, -5)).toEqual('The Blue alliance lost 5 points.');
  expect(summary(MatchEventType.MULTIPLY, 0.51)).toEqual(
    'The Blue alliance got a 0.5x score multiplier.'
  );
  expect(summary(MatchEventType.EXTEND, 10010)).toEqual(
    'The current phase was extended for Berkeley (#0) by 00:10.'
  );
  expect(summary(MatchEventType.OTHER)).toEqual(
    'An event occurred for the Blue alliance.'
  );
});

it('displays a log filter', () => {
  expect(
    displayLogFilter({ exclude: false, key: 'key', value: { student_code: true } })
  ).toEqual('key:{"student_code":true}');
  expect(displayLogFilter({ exclude: true, key: 'key', value: 5 })).toEqual('!key:5');
});

it('parses a log filter', () => {
  expect(parseLogFilter('key:5')).toEqual({ exclude: false, key: 'key', value: 5 });
  expect(parseLogFilter('!key:{"x": 1}')).toEqual({
    exclude: true,
    key: 'key',
    value: { x: 1 },
  });
  expect(parseLogFilter('key:value')).toBe(null);
  expect(parseLogFilter('nofilter')).toBe(null);
});

it('computes a qualification score', () => {
  expect(getQualScore({ wins: 2, ties: 1, losses: 1, totalScore: -50 })).toBe(4950);
});

it('counts match statistics', () => {
  expect(countMatchStatistics([], () => AllianceColor.BLUE)).toEqual({
    wins: 0,
    losses: 0,
    ties: 0,
    totalScore: 0,
  });
  const match = {
    id: 1,
    match: 1,
    timestamp: 1632267193036,
    alliance: AllianceColor.BLUE,
    team: null,
    value: 5,
    description: null,
  };
  expect(
    countMatchStatistics(
      [
        {
          id: 1,
          fixture: null,
          events: [
            { ...match, type: MatchEventType.ADD, alliance: AllianceColor.GOLD },
          ],
        },
        {
          id: 2,
          fixture: null,
          events: [
            { ...match, type: MatchEventType.ADD, alliance: AllianceColor.BLUE },
          ],
        },
        { id: 3, fixture: null, events: [] },
      ],
      () => AllianceColor.BLUE
    )
  ).toEqual({ wins: 1, losses: 1, ties: 1, totalScore: 5 });
});

describe('game state', () => {
  it('adds teams to alliances', () => {
    const game = GameState.fromEvents([
      { type: MatchEventType.JOIN, team: 1, alliance: AllianceColor.BLUE },
      { type: MatchEventType.JOIN, team: 2, alliance: AllianceColor.GOLD },
      { type: MatchEventType.JOIN, team: 3, alliance: AllianceColor.GOLD },
      { type: MatchEventType.JOIN, team: 4, alliance: AllianceColor.NONE },
    ]);
    expect(game.blue.teams).toEqual([1]);
    expect(game.gold.teams).toEqual([2, 3]);
    expect(game.getAlliance(1)).toEqual(AllianceColor.BLUE);
    expect(game.getAlliance(2)).toEqual(AllianceColor.GOLD);
    expect(game.getAlliance(3)).toEqual(AllianceColor.GOLD);
    expect(game.getAlliance(4)).toEqual(AllianceColor.NONE);
  });

  it.each([
    [MatchEventType.AUTO, MatchPhase.AUTO],
    [MatchEventType.TELEOP, MatchPhase.TELEOP],
  ])('can enter and exit %s', (type, phase) => {
    const blue = { team: 1, alliance: AllianceColor.BLUE };
    const gold = { team: 2, alliance: AllianceColor.GOLD };
    const game = GameState.fromEvents([
      { type: MatchEventType.JOIN, ...blue },
      { type: MatchEventType.JOIN, ...gold },
    ]);
    expect(game.transitions).toMatchObject([]);
    expect(game.intervals).toMatchObject([
      [1, { phase: MatchPhase.IDLE }],
      [2, { phase: MatchPhase.IDLE }],
    ]);
    expect(game.started).toBeFalsy();

    game.apply({ type, ...blue, timestamp: 5, value: 5 });
    expect(game.intervals).toMatchObject([
      [1, { phase, start: 5, stop: 10 }],
      [2, { phase: MatchPhase.IDLE }],
    ]);
    game.apply({ type, ...gold, timestamp: 8, value: 6 });
    expect(game.intervals).toMatchObject([
      [1, { phase, start: 5, stop: 10 }],
      [2, { phase, start: 8, stop: 14 }],
    ]);
    expect(game.started).toBeTruthy();

    expect(game.getTimer(0)).toEqual({ stage: 'done', timeRemaining: 0 });
    expect(game.getTimer(5)).toEqual({
      stage: 'running',
      timeRemaining: 5,
      totalTime: 5,
    });
    expect(game.getTimer(8)).toEqual({
      stage: 'running',
      timeRemaining: 2,
      totalTime: 5,
    });
    expect(game.getTimer(10)).toEqual({
      stage: 'running',
      timeRemaining: 4,
      totalTime: 6,
    });
    expect(game.getTimer(14)).toEqual({ stage: 'done', timeRemaining: 0 });

    game.apply({ type: MatchEventType.IDLE, ...blue, timestamp: 14 });
    game.apply({ type: MatchEventType.IDLE, ...gold, timestamp: 15 });
    expect(game.intervals).toMatchObject([
      [1, { phase: MatchPhase.IDLE, start: 14 }],
      [2, { phase: MatchPhase.IDLE, start: 15 }],
    ]);
    expect(game.transitions).toMatchObject([
      { phase: MatchPhase.IDLE, stop: 8 },
      { phase, start: 8, stop: 15 },
    ]);
    expect(game.started).toBeTruthy();
  });

  it('enters e-stop', () => {
    const match = { team: 1, alliance: AllianceColor.BLUE, timestamp: 100 };
    const game = GameState.fromEvents([
      { ...match, type: MatchEventType.JOIN },
      { ...match, type: MatchEventType.ESTOP },
    ]);
    expect(game.intervals).toMatchObject([[1, { phase: MatchPhase.ESTOP }]]);
    game.apply({ ...match, type: MatchEventType.AUTO });
    game.apply({ ...match, type: MatchEventType.TELEOP });
    game.apply({ ...match, type: MatchEventType.IDLE });
    expect(game.intervals).toMatchObject([[1, { phase: MatchPhase.ESTOP }]]);
  });

  it('adds points to the score', () => {
    const game = GameState.fromEvents([
      { type: MatchEventType.ADD, alliance: AllianceColor.BLUE, value: 1 },
      { type: MatchEventType.MULTIPLY, alliance: AllianceColor.BLUE, value: 0.5 },
      { type: MatchEventType.ADD, alliance: AllianceColor.BLUE, value: 2 },
      { type: MatchEventType.ADD, alliance: AllianceColor.BLUE, value: -1 },
      { type: MatchEventType.MULTIPLY, alliance: AllianceColor.BLUE, value: 2 },
      { type: MatchEventType.ADD, alliance: AllianceColor.BLUE, value: 1 },
    ]);
    expect(game.blue.score).toBeCloseTo(3);
  });

  it.each([
    [MatchEventType.AUTO, MatchPhase.AUTO],
    [MatchEventType.TELEOP, MatchPhase.TELEOP],
  ])('can extend the %s phase', (type, phase) => {
    const match = { team: 1, alliance: AllianceColor.BLUE };
    const game = GameState.fromEvents([
      { type: MatchEventType.JOIN, ...match },
      { type, ...match, timestamp: 5, value: 5 },
      { type: MatchEventType.EXTEND, ...match, value: 5 },
    ]);
    expect(game.intervals).toMatchObject([[1, { phase, start: 5, stop: 15 }]]);
  });
});
