import { EntityData, EntityManager, EntityRepository, MikroORM } from '@mikro-orm/core';
import RuntimeClient from '@pioneers/runtime-client';
import WebSocket, { Server as WebSocketServer } from 'ws';
import winston from 'winston';
import * as _ from 'lodash';
import { Match as MatchModel, MatchEvent as MatchEventModel } from './db';
import {
  AllianceColor,
  AllianceState,
  GameState,
  Match,
  MatchEvent,
  ControlRequest,
  ControlResponse,
  MatchEventType,
  MatchPhase,
  TimerState,
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

  constructor(
    teamId: number,
    client: RuntimeClient,
    idleCallback: () => Promise<void>
  ) {
    this.teamId = teamId;
    this.client = client;
    this.idleCallback = idleCallback;
  }

  async idle() {
    logger.debug('Idling robot', { teamId: this.teamId });
    this.clearTimeout();
    // await this.client.request('executor-service', 'idle');
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
    // await this.client.request('executor-service', 'auto');
  }

  async teleop(stop: number) {
    logger.debug('Entering teleop mode', { teamId: this.teamId });
    this.setTimeout(stop);
    // await this.client.request('executor-service', 'teleop');
  }

  async estop() {
    logger.error('Emergency-stopping robot', { teamId: this.teamId });
    this.clearTimeout();
    // this.client.notify('executor-service', 'estop');
  }

  async exec() {
    // TODO
  }
}

function getTimeRemaining(blueStop: number, goldStop: number): number {
  const now = Date.now();
  const blueTime = blueStop - now;
  const goldTime = goldStop - now;
  if (blueTime <= 0 && goldTime <= 0) {
    return 0;
  } else if (blueTime <= 0) {
    return goldTime;
  } else if (goldTime <= 0) {
    return blueTime;
  } else {
    return Math.min(blueTime, goldTime);
  }
}

export default class FieldControl {
  private wsServer: WebSocketServer;
  private orm: MikroORM;
  private matchId: number | null = null;
  private timer: TimerState;
  private robots: Map<number, Robot>;

  constructor(wsServer: WebSocketServer, orm: MikroORM) {
    this.wsServer = wsServer;
    this.orm = orm;
    this.timer = {
      phase: MatchPhase.IDLE,
      timeRemaining: 0,
      totalTime: 0,
      running: false,
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
      // TODO
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
    const newRobot = new Robot(teamId, null, async () => {
      await this.handle({
        events: [{ match, type: MatchEventType.IDLE, team: teamId }],
        activations: [teamId],
      });
    });
    // TODO: connect
    this.robots.set(teamId, newRobot);
    return newRobot;
  }

  private async connectAll(activations?: number[]) {
    const match = await this.getMatch();
    const game = GameState.fromEvents(match.toJSON().events);
    const teamIds = new Set<number>();
    for (const [teamId, interval] of game.intervals) {
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
    }
    for (const teamId of Array.from(this.robots.keys())) {
      if (!teamIds.has(teamId)) {
        await this.disconnect(teamId);
      }
    }
  }

  private async appendEvents(events: Partial<MatchEvent>[]) {
    if (events.length > 0) {
      await this.orm.em.transactional(async (em) => {
        const match = await this.getMatch(em);
        const game = GameState.fromEvents(match.toJSON().events);
        const mappedEvents = MatchModel.mapEvents(events, game);
        for (const event of mappedEvents) {
          match.events.add(em.create(MatchEventModel, event));
        }
        await em.persistAndFlush(match);
      });
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
    } catch {}
  }

  private async makeResponse(): Promise<ControlResponse> {
    const res: ControlResponse = {
      control: {
        matchId: this.matchId,
        timer: this.timer,
        robots: Array.from(this.robots.entries()).map(([teamId, robot]) => ({
          teamId,
        })),
      },
      match: null,
    };
    try {
      const match = (await this.getMatch()).toJSON() as Match;
      const game = GameState.fromEvents(match.events);
      // TODO: do not overwrite
      // FIXME: pause should not zero timer
      res.control.timer = _.merge(res.control.timer, game.getTimer());
      return { ...res, match };
    } catch {
      return res;
    }
  }

  async broadcast(clients?: Set<WebSocket> | WebSocket[]) {
    const res = await this.makeResponse();
    if (!clients) {
      clients = this.wsServer.clients;
    }
    const buf = JSON.stringify(res);
    clients.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(buf);
      }
    });
  }
}
