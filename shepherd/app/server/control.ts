import { EntityManager, MikroORM } from '@mikro-orm/core';
import RuntimeClient from '@pioneers/runtime-client';
import WebSocket from 'ws';
import winston from 'winston';
import * as _ from 'lodash';
import {
  Match as MatchModel,
  MatchEvent as MatchEventModel,
  Team as TeamModel,
} from './db';
import {
  GameState,
  Match,
  MatchEvent,
  LogEvent,
  ControlRequest,
  ControlResponse,
  MatchEventType,
  MatchPhase,
  TimerState,
  RobotUpdate,
} from '../types';

const logger = winston.createLogger({
  level: 'debug',
  transports: [new winston.transports.Console()],
});

class Robot {
  private teamId: number;
  private client: RuntimeClient;
  private idleCallback: () => Promise<void>;
  private timeout: { id: ReturnType<typeof setTimeout>; stop: number } | null = null;
  private logEvents: LogEvent[];
  private updates: number = 0;
  private lastUpdate: number;
  private uids: string[];

  constructor(
    teamId: number,
    client: RuntimeClient,
    idleCallback: () => Promise<void>
  ) {
    this.teamId = teamId;
    this.client = client;
    this.idleCallback = idleCallback;
    this.logEvents = [];
    this.lastUpdate = Date.now();
    this.uids = [];
  }

  static async connect(team: TeamModel, idleCallback: () => Promise<void>) {
    const client = new RuntimeClient();
    const robot = new Robot(team.id, client, idleCallback);
    await robot.open(team);
    return robot;
  }

  async open(team: TeamModel) {
    const ctx = { team: team.id, hostname: team.hostname };
    const options = {
      host: team.hostname,
      callPort: team.callPort,
      logPort: team.logPort,
      updatePort: team.updatePort,
      // TODO: add log levels
      multicastGroup: team.multicastGroup,
    };
    await this.client.open(
      (err, [update]) => {
        if (update) {
          this.updates += 1;
          this.uids = _.keys(update);
        } else {
          logger.error('Failed to receive peripheral update', { ...ctx, err });
        }
      },
      (err, event) => {
        if (event) {
          this.logEvents.push(event);
        } else {
          logger.error('Failed to receive log event', { ...ctx, err });
        }
      },
      options
    );
  }

  close() {
    this.client.close();
  }

  async idle() {
    logger.debug('Idling robot', { teamId: this.teamId });
    this.clearTimeout();
    await this.client.request('executor-service', 'idle');
  }

  private setTimeout(stop: number) {
    const timeRemaining = Math.max(0, stop - Date.now());
    if (this.timeout && this.timeout.stop !== stop) {
      clearTimeout(this.timeout.id);
    }
    const id = setTimeout(async () => {
      await this.idleCallback();
    }, timeRemaining);
    this.timeout = { id, stop };
  }

  private clearTimeout() {
    if (this.timeout) {
      clearTimeout(this.timeout.id);
    }
    this.timeout = null;
  }

  async auto(stop: number) {
    logger.debug('Entering autonomous mode', { teamId: this.teamId });
    this.setTimeout(stop);
    await this.client.request('executor-service', 'auto');
  }

  async teleop(stop: number) {
    logger.debug('Entering teleop mode', { teamId: this.teamId });
    this.setTimeout(stop);
    await this.client.request('executor-service', 'teleop');
  }

  async estop() {
    logger.error('Emergency-stopping robot', { teamId: this.teamId });
    this.clearTimeout();
    this.client.notify('executor-service', 'estop');
  }

  async exec() {
    // TODO
  }

  makeUpdate(): RobotUpdate {
    const now = Date.now();
    const delta = now - this.lastUpdate;
    const update = {
      teamId: this.teamId,
      logEvents: this.logEvents,
      updateRate: delta > 0 ? (1000 * this.updates) / delta : 0,
      uids: this.uids,
    };
    this.logEvents = [];
    this.updates = 0;
    this.lastUpdate = now;
    return update;
  }
}

export default class FieldControl {
  private orm: MikroORM;
  private matchId: number | null = null;
  private timer: TimerState;
  private robots: Map<number, Robot>;

  constructor(orm: MikroORM) {
    this.orm = orm;
    this.timer = {
      phase: MatchPhase.IDLE,
      timeRemaining: 0,
      totalTime: 0,
      stage: 'init',
    };
    this.robots = new Map();
  }

  private async getMatch(em?: EntityManager): Promise<MatchModel> {
    if (this.matchId === null) {
      throw new Error('match ID not set');
    }
    return await (em ?? this.orm.em).findOneOrFail(MatchModel, this.matchId, {
      refresh: true,
    });
  }

  private async disconnect(teamId: number) {
    const robot = this.robots.get(teamId);
    this.robots.delete(teamId);
    if (robot) {
      robot.close();
    }
  }

  private async disconnectAll() {
    for (const teamId of Array.from(this.robots.keys())) {
      await this.disconnect(teamId);
    }
  }

  private async getRobot(teamId: number) {
    if (!this.matchId) {
      throw new Error('match ID not set');
    }
    const robot = this.robots.get(teamId);
    if (robot) {
      return robot;
    }
    const match = this.matchId;
    const team = await this.orm.em.findOneOrFail(TeamModel, { id: teamId });
    const newRobot = await Robot.connect(team, async () => {
      await this.handle({
        events: [{ match, type: MatchEventType.IDLE, team: teamId }],
        activations: [teamId],
      });
    });
    this.robots.set(teamId, newRobot);
    return newRobot;
  }

  private async connectAll(activations?: number[]) {
    const match = await this.getMatch(this.orm.em.fork());
    const game = GameState.fromEvents(match.toJSON().events);
    const teamIds = new Set<number>();
    for (const [teamId, interval] of game.intervals) {
      try {
        const robot = await this.getRobot(teamId);
        teamIds.add(teamId);
        if (activations && !activations.includes(teamId)) {
          continue;
        }
        // TODO: set mode concurrently
        switch (interval.phase) {
          case MatchPhase.AUTO:
            await robot.auto(interval.stop);
            break;
          case MatchPhase.TELEOP:
            await robot.teleop(interval.stop);
            break;
          case MatchPhase.IDLE:
            await robot.idle();
            break;
          case MatchPhase.ESTOP:
            await robot.estop();
            break;
        }
      } catch (err) {
        logger.error('Unable to connect to and start robot', { err });
      }
    }
    for (const teamId of this.robots.keys()) {
      if (!teamIds.has(teamId)) {
        await this.disconnect(teamId);
      }
    }
  }

  private async appendEvents(events: Partial<MatchEvent>[]) {
    if (events.length > 0) {
      const em = this.orm.em.fork();
      const match = await this.getMatch(em);
      const game = GameState.fromEvents(match.toJSON().events);
      const mappedEvents = MatchModel.mapEvents(events, game);
      for (const event of mappedEvents) {
        match.events.add(em.create(MatchEventModel, event));
      }
      await em.persistAndFlush(match);
    }
  }

  async handle(req: ControlRequest) {
    this.matchId = req.matchId === undefined ? this.matchId : req.matchId;
    this.timer = req.timer ?? this.timer;
    try {
      await this.appendEvents(req.events ?? []);
      // TODO: match population script/tournament generator
      if (req.reconnect) {
        await this.disconnectAll();
      }
      await this.connectAll(req.activations);
    } catch (err) {
      logger.error('Error while handling control request', { err });
    }
  }

  private async makeResponse(): Promise<ControlResponse> {
    const res: ControlResponse = {
      control: {
        matchId: this.matchId,
        robots: Array.from(this.robots.values()).map((robot) => robot.makeUpdate()),
      },
      match: null,
    };
    try {
      const match = (await this.getMatch()).toJSON() as Match;
      const game = GameState.fromEvents(match.events);
      const timer = game.getTimer();
      if (
        (this.timer.stage === 'init' && timer.stage === 'running') ||
        this.timer.stage === 'running'
      ) {
        this.timer = { ...this.timer, ...timer };
      }
      res.control.timer = this.timer;
      return { ...res, match };
    } catch {
      return res;
    }
  }

  async broadcast(clients: Set<WebSocket> | WebSocket[]) {
    const res = await this.makeResponse();
    const buf = JSON.stringify(res);
    clients.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(buf);
      }
    });
  }
}
