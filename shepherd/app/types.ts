export enum MatchEventType {
  JOIN = 'join',
  AUTO = 'auto',
  TELEOP = 'teleop',
  IDLE = 'idle',
  ESTOP = 'estop',
  ADD = 'add',
  MULTIPLY = 'multiply',
  EXTEND = 'extend',
  OTHER = 'other',
}

export enum AllianceColor {
  NONE = 'none',
  BLUE = 'blue',
  GOLD = 'gold',
}

export enum MatchPhase {
  IDLE = 'idle',
  ESTOP = 'estop',
  AUTO = 'auto',
  TELEOP = 'teleop',
}

export enum LogLevel {
  DEBUG = 'debug',
  INFO = 'info',
  WARNING = 'warning',
  ERROR = 'error',
  CRITICAL = 'critical',
}

const LogLevelPriority = {
  [LogLevel.DEBUG]: 10,
  [LogLevel.INFO]: 20,
  [LogLevel.WARNING]: 30,
  [LogLevel.ERROR]: 40,
  [LogLevel.CRITICAL]: 50,
};

export function getLogLevels(level: LogLevel) {
  const minLevel = LogLevelPriority[level];
  return new Set(Object
    .entries(LogLevelPriority)
    .filter(([level, priority]) => minLevel <= priority)
    .map(([level]) => level));
}

interface RankStatistics {
  wins: number;
  losses: number;
  ties: number;
  totalScore: number;
}

export interface Alliance {
  id: number;
  name: string;
  stats?: RankStatistics;
}

export interface Team {
  id: number;
  number: number;
  name: string;
  alliance: number | null;
  hostname: string;
  callPort: number;
  logPort: number;
  updatePort: number;
  multicastGroup: string;
  stats?: RankStatistics;
}

export interface MatchEvent {
  id: number;
  match: number;
  type: MatchEventType;
  timestamp: number;
  alliance: AllianceColor;
  team: number | null;
  value: number | null;
  description: string | null;
}

export interface Fixture {
  id: number;
  root: boolean;
  winner: number | null;
  blue: Fixture | null;
  gold: Fixture | null;
  matches: number[];
  winningAlliance?: Alliance;
}

export interface FixtureUpdate {
  id: number;
  winner: number | null;
}

export interface Match {
  id: number;
  fixture: number | null;
  events: MatchEvent[];
}

export interface TimerState {
  phase: MatchPhase;
  timeRemaining: number;
  totalTime: number;
  stage: 'init' | 'running' | 'done';
}

export interface ControlRequest {
  matchId?: number | null;
  events?: Partial<MatchEvent>[];
  activations?: number[];
  reconnect?: boolean;
  timer?: TimerState | null;
}

export interface LogEvent {
  timestamp: string;
  level: LogLevel;
  event: string;
  exception?: string;
  student_code?: boolean; // eslint-disable-line camelcase
  alliance?: AllianceColor;
  team: Partial<Team>;
}

export interface LogEventFilter {
  exclude: boolean;
  key: string;
  value: any;
}

export interface LogSettings {
  maxEvents: number;
  level: LogLevel;
  filters: LogEventFilter[];
  pinToBottom: boolean;
}

export interface User {
  username: null | string;
  darkTheme: boolean;
  game: null | string;
}

export interface Session {
  user?: Partial<User>;
  log?: Partial<LogSettings>;
}

export interface RobotStatus {
  teamId: number;
  updateRate: number;
  uids: string[];
}

export interface ControlState {
  matchId: number | null;
  editing: boolean;
  loading: boolean;
  clientTimestamp: number;
  timer: TimerState;
  robots: RobotStatus[];
}

export interface ControlResponse {
  control: Partial<ControlState>;
  match?: Match;
  events?: LogEvent[];
}

export const displayTeam = (team?: Partial<Team>) =>
  team?.name && (team?.number ?? null) !== null
    ? `${team.name} (#${team.number})`
    : '?';

export function displayAllianceColor(color: AllianceColor) {
  switch (color) {
    case AllianceColor.BLUE:
      return 'Blue';
    case AllianceColor.GOLD:
      return 'Gold';
    default:
      return '?';
  }
}

export function displayTime(duration: number, places: number = 1) {
  if (duration < 0) {
    return '--:--';
  }
  const minutes = Math.trunc(duration / 60)
    .toString()
    .padStart(2, '0');
  const seconds = duration % 60;
  const secondsFormatted = (seconds < 10 ? '0' : '') + seconds.toFixed(places);
  return `${minutes}:${secondsFormatted}`;
}

export function displayPhase(phase: MatchPhase) {
  switch (phase) {
    case MatchPhase.AUTO:
      return 'Autonomous';
    case MatchPhase.TELEOP:
      return 'Tele-op';
    default:
      return '?';
  }
}

export function isRunning(phase: MatchPhase) {
  return phase === MatchPhase.AUTO || phase === MatchPhase.TELEOP;
}

export function getDefaultDuration(phase: MatchPhase) {
  return phase === MatchPhase.AUTO ? 30 : 180;
}

export function displaySummary(event: MatchEvent, team?: Partial<Team>) {
  const alliance = displayAllianceColor(event.alliance);
  const value = event.value ?? 0;
  const duration = displayTime(value / 1000, 0);
  switch (event.type) {
    case MatchEventType.JOIN:
      return `${displayTeam(team)} joined the ${alliance} alliance.`;
    case MatchEventType.AUTO:
      return `Started the autonomous phase for ${displayTeam(team)} for ${duration}.`;
    case MatchEventType.TELEOP:
      return `Started the tele-op phase for ${displayTeam(team)} for ${duration}.`;
    case MatchEventType.IDLE:
      return `Stopped ${displayTeam(team)}.`;
    case MatchEventType.ESTOP:
      return `Emergency-stopped ${displayTeam(team)}.`;
    case MatchEventType.ADD:
      if (value >= 0) {
        return `The ${alliance} alliance scored ${value} points (without multipliers).`;
      } else {
        return `The ${alliance} alliance lost ${-value} points.`;
      }
    case MatchEventType.MULTIPLY:
      return `The ${alliance} alliance got a ${value.toFixed(1)}x score multiplier.`;
    case MatchEventType.EXTEND:
      return `The current phase was extended for ${displayTeam(team)} by ${duration}.`;
    default:
      return `An event occurred for the ${alliance} alliance.`;
  }
}

export function displayLogFilter(filter: LogEventFilter) {
  return `${filter.exclude ? '!' : ''}${filter.key}:${JSON.stringify(filter.value)}`;
}

export function parseLogFilter(filter: string): LogEventFilter | null {
  const match = filter.match(/^(\!)?(.+?)\:(.+)$/i);
  if (match) {
    const [, exclude, key, value] = match;
    try {
      return { exclude: exclude === '!', key, value: JSON.parse(value) };
    } catch {}
  }
  return null;
}

export function getAllianceAllegiance(alliance: Alliance, fixture?: Fixture) {
  if (alliance.id === fixture?.blue?.winner) {
    return AllianceColor.BLUE;
  } else if (alliance.id === fixture?.gold?.winner) {
    return AllianceColor.GOLD;
  }
  return AllianceColor.NONE;
}

export function getQualScore(stats: RankStatistics) {
  return 2000 * stats.wins + 1000 * stats.ties + stats.totalScore;
}

export function countMatchStatistics<M extends Match>(
  matches: M[],
  getAllegiance: (match: M) => AllianceColor,
  getGame: (match: M) => GameState = (match) => GameState.fromEvents(match.events),
) {
  const stats: RankStatistics = { wins: 0, losses: 0, ties: 0, totalScore: 0 };
  for (const match of matches) {
    const allegiance = getAllegiance(match);
    const game = getGame(match);
    const winner = game.winner;
    if (allegiance !== AllianceColor.NONE) {
      if (winner === AllianceColor.NONE) {
        stats.ties += 1;
      } else if (allegiance === winner) {
        stats.wins += 1;
      } else {
        stats.losses += 1;
      }
      stats.totalScore += game[allegiance].score;
    }
  }
  return stats;
}

export interface MatchInterval {
  phase: MatchPhase;
  start: number;
  stop: number;
}

class AllianceState {
  score: number = 0;
  multiplier: number = 1;
  intervals: Map<number, MatchInterval>;

  constructor() {
    this.intervals = new Map();
  }

  get teams(): number[] {
    return Array.from(this.intervals.keys());
  }

  private setTimer(
    event: Partial<MatchEvent>,
    phase: MatchPhase,
    defaultDuration: number = 0
  ) {
    if (event.team && event.timestamp) {
      const interval = this.intervals.get(event.team);
      if (interval && interval.phase !== MatchPhase.ESTOP) {
        this.intervals.set(event.team, {
          phase,
          start: event.timestamp,
          stop: event.timestamp + (event.value ?? defaultDuration),
        });
      }
    }
  }

  apply(event: Partial<MatchEvent>) {
    let value;
    switch (event.type) {
      case MatchEventType.JOIN:
        if (event.team) {
          this.intervals.set(event.team, { phase: MatchPhase.IDLE, start: 0, stop: 0 });
        }
        break;
      case MatchEventType.AUTO:
        this.setTimer(event, MatchPhase.AUTO, 30 * 1000);
        break;
      case MatchEventType.TELEOP:
        this.setTimer(event, MatchPhase.TELEOP, 180 * 1000);
        break;
      case MatchEventType.IDLE:
        this.setTimer(event, MatchPhase.IDLE);
        break;
      case MatchEventType.ESTOP:
        this.setTimer(event, MatchPhase.ESTOP);
        break;
      case MatchEventType.ADD:
        value = event.value ?? 0;
        this.score += value < 0 ? value : this.multiplier * value;
        break;
      case MatchEventType.MULTIPLY:
        value = event.value ?? 1;
        if (value >= 0) {
          this.multiplier = value;
        }
        break;
      case MatchEventType.EXTEND:
        if (event.team) {
          const interval = this.intervals.get(event.team);
          if (interval && isRunning(interval.phase)) {
            this.intervals.set(event.team, {
              ...interval,
              stop: interval.stop + (event.value ?? 0),
            });
          }
        }
        break;
    }
  }
}

export class GameState {
  blue: AllianceState;
  gold: AllianceState;
  transitions: MatchInterval[];
  private phase: MatchPhase = MatchPhase.IDLE;
  private start: number = 0;

  constructor() {
    this.blue = new AllianceState();
    this.gold = new AllianceState();
    this.transitions = [];
  }

  static fromEvents(events: Partial<MatchEvent>[]) {
    const game = new GameState();
    for (const event of events) {
      game.apply(event);
    }
    return game;
  }

  getAlliance(team: number) {
    if (this.blue.teams.includes(team)) {
      return AllianceColor.BLUE;
    } else if (this.gold.teams.includes(team)) {
      return AllianceColor.GOLD;
    }
    return AllianceColor.NONE;
  }

  getTimer(now?: number): Partial<TimerState> {
    const timestamp = now ?? Date.now();
    const intervals = this.intervals
      .filter(([, interval]) =>
        isRunning(interval.phase)
        && interval.start <= timestamp
        && timestamp < interval.stop
      )
      .map(([, interval]) => interval);
    if (intervals.length === 0) {
      return { stage: 'done', timeRemaining: 0 };
    }
    const totalTime = Math.min(...intervals.map((timer) => timer.stop - timer.start));
    const timeRemaining = Math.min(...intervals.map((timer) => timer.stop - timestamp));
    return { stage: 'running', totalTime, timeRemaining };
  }

  get intervals(): [number, MatchInterval][] {
    return Array
      .from(this.blue.intervals.entries())
      .concat(Array.from(this.gold.intervals.entries()));
  }

  get winner(): AllianceColor {
    if (this.blue.score < this.gold.score) {
      return AllianceColor.GOLD;
    } else if (this.blue.score > this.gold.score) {
      return AllianceColor.BLUE;
    }
    return AllianceColor.NONE;
  }

  apply(event: Partial<MatchEvent>) {
    if (event.alliance === AllianceColor.BLUE) {
      this.blue.apply(event);
    } else if (event.alliance === AllianceColor.GOLD) {
      this.gold.apply(event);
    }
    const phases = new Set(this.intervals.map(([, interval]) => interval.phase));
    if (phases.size === 1 && event.timestamp) {
      const [phase] = phases;
      if (phase !== this.phase) {
        this.transitions.push({
          phase: this.phase,
          start: this.start,
          stop: event.timestamp,
        });
        this.phase = phase;
        this.start = event.timestamp;
      }
    }
  }

  get started() {
    return isRunning(this.phase) || this.transitions.some(({ phase }) =>
      isRunning(phase)
    );
  }
}
