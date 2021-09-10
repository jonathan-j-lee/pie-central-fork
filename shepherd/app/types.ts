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

export interface Alliance {
  id: number;
  name: string;
  wins?: number;
  losses?: number;
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
  wins?: number;
  losses?: number;
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
}

export interface RobotUpdate {
  teamId: number;
  logEvents: LogEvent[];
  updateRate: number;
  uids: string[];
}

export interface ControlState {
  matchId: number | null;
  clientTimestamp: number;
  timer: TimerState;
  robots: RobotUpdate[];
}

export interface ControlResponse {
  control: Partial<ControlState>;
  match: Match | null;
}

export const displayTeam = (team?: Team) =>
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

export function displaySummary(event: MatchEvent, team?: Team) {
  const alliance = displayAllianceColor(event.alliance);
  const value = event.value ?? 0;
  switch (event.type) {
    case MatchEventType.JOIN:
      return `${displayTeam(team)} joined the ${alliance} alliance.`;
    case MatchEventType.AUTO:
      return `Started the autonomous phase for ${displayTeam(team)}.`;
    case MatchEventType.TELEOP:
      return `Started the tele-op phase for ${displayTeam(team)}.`;
    case MatchEventType.IDLE:
      return `Stopped ${displayTeam(team)}.`;
    case MatchEventType.ESTOP:
      return `Emergency-stopped ${displayTeam(team)}.`;
    case MatchEventType.ADD:
      if (value >= 0) {
        return `The ${alliance} alliance scored ${value} points (without multipliers).`;
      } else {
        return `The ${alliance} alliance lost ${-value} points`;
      }
    case MatchEventType.MULTIPLY:
      return `The ${alliance} alliance got a ${value}x score multiplier.`;
    case MatchEventType.EXTEND:
      const duration = displayTime(value / 1000, 0);
      return `${displayTeam(team)} extended the current phase by ${duration}.`;
    default:
      return `An event occurred for the ${alliance} alliance.`;
  }
}

interface MatchInterval {
  phase: MatchPhase;
  start: number;
  stop: number;
}

export class AllianceState {
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
    const team = event.team ?? null;
    if (team !== null && this.intervals.has(team) && event.timestamp) {
      const start = Number(event.timestamp);
      const timer = { phase, start, stop: start + (event.value ?? defaultDuration) };
      this.intervals.set(team, timer);
    }
  }

  apply(event: Partial<MatchEvent>) {
    const team = event.team ?? null;
    let value;
    switch (event.type) {
      case MatchEventType.JOIN:
        if (team !== null) {
          this.intervals.set(team, { phase: MatchPhase.IDLE, start: 0, stop: 0 });
        }
        break;
      case MatchEventType.AUTO:
        this.setTimer(event, MatchPhase.AUTO, 30 * 1000);
        break;
      case MatchEventType.TELEOP:
        this.setTimer(event, MatchPhase.TELEOP, 180 * 1000);
        break;
      case MatchEventType.IDLE:
        this.setTimer(event, MatchPhase.IDLE, 0);
        break;
      case MatchEventType.ESTOP:
        this.setTimer(event, MatchPhase.ESTOP, 0);
        break;
      case MatchEventType.ADD:
        value = event.value ?? 0;
        this.score += value < 0 ? value : this.multiplier * value;
        break;
      case MatchEventType.MULTIPLY:
        value = event.value ?? 1;
        if (value > 0) {
          this.multiplier = value;
        }
        break;
      case MatchEventType.EXTEND:
        if (team !== null) {
          const timer = this.intervals.get(team);
          if (timer) {
            this.intervals.set(team, {
              ...timer,
              stop: timer.stop + (event.value ?? 0),
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

  constructor() {
    this.blue = new AllianceState();
    this.gold = new AllianceState();
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
    const intervals = Array.from(this.blue.intervals.values())
      .concat(Array.from(this.gold.intervals.values()))
      .filter((interval) => isRunning(interval.phase) && timestamp < interval.stop);
    if (intervals.length === 0) {
      return { stage: 'done', timeRemaining: 0 };
    }
    const totalTime = Math.max(...intervals.map((timer) => timer.stop - timer.start));
    const timeRemaining = Math.min(...intervals.map((timer) => timer.stop - timestamp));
    return { stage: 'running', totalTime, timeRemaining };
  }

  get intervals(): [number, MatchInterval][] {
    return Array.from(this.blue.intervals.entries()).concat(
      Array.from(this.gold.intervals.entries())
    );
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
  }
}
