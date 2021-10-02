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
  RobotStatus,
} from '../types';
import {
  Match as MatchModel,
  MatchEvent as MatchEventModel,
  Team as TeamModel,
} from './db';
import { EntityManager, MikroORM } from '@mikro-orm/core';
import RuntimeClient from '@pioneers/runtime-client';
import EventEmitter from 'events';
import * as _ from 'lodash';
import winston from 'winston';
import WebSocket, { Server as WebSocketServer } from 'ws';

const logger = winston.createLogger({
  level: 'debug',
  transports: [new winston.transports.Console()],
});

const EXECUTOR_ADDRESS = 'executor-service';

class Robot extends EventEmitter {
  private teamId: number;
  private client: RuntimeClient;
  private timeout: { id: ReturnType<typeof setTimeout>; stop: number } | null = null;
  private updates: number = 0;
  private lastUpdate: number;
  private uids: string[];

  constructor(teamId: number, client: RuntimeClient) {
    // TODO: extend runtime client
    super();
    this.teamId = teamId;
    this.client = client;
    this.lastUpdate = Date.now();
    this.uids = [];
  }

  static async connect(team: TeamModel) {
    const client = new RuntimeClient();
    const robot = new Robot(team.id, client);
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
      (err, events) => {
        if (events) {
          this.emit('log', events);
        } else {
          logger.error('Failed to receive log events', { ...ctx, err });
        }
      },
      options
    );
  }

  async close() {
    await this.idle();
    this.client.close();
  }

  async idle() {
    logger.debug('Idling robot', { teamId: this.teamId });
    this.clearTimeout();
    await this.request(EXECUTOR_ADDRESS, 'idle');
  }

  private setTimeout(stop: number) {
    if (this.timeout && this.timeout.stop !== stop) {
      clearTimeout(this.timeout.id);
    }
    const timeRemaining = Math.max(0, stop - Date.now());
    const id = setTimeout(() => this.emit('idle'), timeRemaining);
    this.timeout = { id, stop };
  }

  private clearTimeout() {
    if (this.timeout) {
      clearTimeout(this.timeout.id);
    }
    this.timeout = null;
  }

  private async request(address: string, method: string, ...args: any): Promise<any> {
    try {
      const result = await this.client.request(address, method, ...args);
      logger.debug('Request executed successfully', { address, method, args, result });
      return result;
    } catch (err) {
      logger.warn('Request failed', { err, address, method, args });
    }
  }

  private notify(address: string, method: string, ...args: any) {
    try {
      this.client.notify(address, method, ...args);
      logger.debug('Notification executed successfully', { address, method, args });
    } catch (err) {
      logger.warn('Notification failed', { err, address, method, args });
    }
  }

  async auto(stop: number) {
    logger.debug('Entering autonomous mode', { teamId: this.teamId });
    this.setTimeout(stop);
    await this.request(EXECUTOR_ADDRESS, 'auto');
  }

  async teleop(stop: number) {
    logger.debug('Entering teleop mode', { teamId: this.teamId });
    this.setTimeout(stop);
    await this.request(EXECUTOR_ADDRESS, 'teleop');
  }

  async estop() {
    logger.error('Emergency-stopping robot', { teamId: this.teamId });
    this.clearTimeout();
    this.notify(EXECUTOR_ADDRESS, 'estop');
  }

  async exec() {
    // TODO
  }

  makeUpdate(): RobotStatus {
    const now = Date.now();
    const delta = now - this.lastUpdate;
    const update = {
      teamId: this.teamId,
      updateRate: delta > 0 ? (1000 * this.updates) / delta : 0,
      uids: this.uids,
    };
    this.updates = 0;
    this.lastUpdate = now;
    return update;
  }
}

export default class FieldControl {
  private orm: MikroORM;
  private wsServer: WebSocketServer;
  private matchId: number | null = null;
  private timer: TimerState;
  private robots: Map<number, Robot>;

  constructor(orm: MikroORM, wsServer: WebSocketServer) {
    this.orm = orm;
    this.wsServer = wsServer;
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
      await robot.close();
    }
  }

  async disconnectAll() {
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
    const newRobot = await Robot.connect(team);
    newRobot.on('idle', async () => {
      await this.handle({
        events: [{ match, type: MatchEventType.IDLE, team: teamId }],
        activations: [teamId],
      });
    });
    newRobot.on(
      'log',
      async (events: LogEvent[]) =>
        await this.broadcast({
          res: {
            control: {},
            events: events.map((event) => ({
              ...event,
              team: _.pick(team, ['id', 'number', 'name', 'hostname']),
            })),
          },
        })
    );
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
        if (!activations || activations.includes(teamId)) {
          switch (interval.phase) {
            case MatchPhase.AUTO:
              robot.auto(interval.stop);
              break;
            case MatchPhase.TELEOP:
              robot.teleop(interval.stop);
              break;
            case MatchPhase.IDLE:
              robot.idle();
              break;
            case MatchPhase.ESTOP:
              robot.estop();
              break;
          }
        }
      } catch (err) {
        logger.error('Unable to connect to robot', { err });
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
      if (req.reconnect || !this.matchId) {
        await this.disconnectAll();
      }
      await this.appendEvents(req.events ?? []);
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

  async broadcast({
    clients,
    res,
  }: {
    clients?: Set<WebSocket> | WebSocket[];
    res?: ControlResponse;
  } = {}) {
    const payload = JSON.stringify(res ?? (await this.makeResponse()));
    (clients ?? this.wsServer.clients).forEach((client) => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(payload);
      }
    });
  }
}
