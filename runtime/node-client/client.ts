import * as crypto from 'crypto';
import * as dgram from 'dgram';
import * as util from 'util';
import * as cbor from 'cbor';
import * as zmq from 'zeromq';

const REQUEST = 0;
const RESPONSE = 1;
const NOTIFICATION = 2;

const decode = util.promisify(cbor.decodeFirst);

/** Client socket options. */
export interface ClientOptions {
  /** The hostname of the remote machine. */
  host: string;
  /** The port that accepts remote calls (router frontend). */
  callPort: number;
  /** The port that publishes log events (log frontend). */
  logPort: number;
  /** Log levels to subscribe to. */
  logLevels: Array<string>;
  /** The port that accepts control inputs. */
  controlPort: number;
  /** The port that Smart Device updates are published to. */
  updatePort: number;
  /** IP multicast time-to-live option. */
  multicastTTL: number;
  /** IP multicast group for receiving Smart Device updates. */
  multicastGroup: string;
}

/** Gamepad parameters. */
export interface Gamepad {
  /** Left joystick x-position. */
  lx?: number;
  /** Left joystick y-position. */
  ly?: number;
  /** Right joystick x-position. */
  rx?: number;
  /** Right joystick y-position. */
  ry?: number;
  /** Button bitmap */
  btn?: number;
}

type Callback = (err: Error | null, result: any) => void;

/** A client of a Runtime instance (robot). */
class Client {
  callSocket: zmq.Dealer;
  logSocket: zmq.Subscriber;
  controlTransmitter: dgram.Socket;
  updateReceiver: dgram.Socket;

  constructor() {
    this.callSocket = new zmq.Dealer();
    this.logSocket = new zmq.Subscriber();
    const dgramOptions: dgram.SocketOptions = { type: 'udp4', reuseAddr: true };
    this.controlTransmitter = dgram.createSocket(dgramOptions);
    this.updateReceiver = dgram.createSocket(dgramOptions);
  }

  dispatch(callback: Callback, msg: Buffer) {
    decode(msg)
      .then(([_msgType, _method, payload]) => callback(null, payload))
      .catch(err => callback(err, null));
  }

  async recvEvent(callback: Callback) {
    while (true) {
      try {
        let [_topic, msg] = await this.logSocket.receive();
        this.dispatch(callback, msg);
      } catch (err) {
        callback(err, null);
      }
    }
  }

  /** Initialize the sockets needed to communicate with Runtime.
   *  @param onUpdate - Callback called when a Smart Device update arrives.
   *  @param onEvent - Callback called when a log event arrives.
   *  @param options - Socket options.
   */
  async open(onUpdate: Callback = () => null, onEvent: Callback = () => null, options = {}) {
    let opts: ClientOptions = {
      host: 'localhost',
      callPort: 6000,
      logPort: 6001,
      logLevels: [''],
      controlPort: 6002,
      updatePort: 6003,
      multicastTTL: 1,
      multicastGroup: '224.1.1.1',
      ...options,
    };

    this.callSocket.connect(`tcp://${opts.host}:${opts.callPort}`);
    this.logSocket.connect(`tcp://${opts.host}:${opts.logPort}`);
    for (const level of opts.logLevels) {
      this.logSocket.subscribe(level);
    }
    this.recvEvent(onEvent);

    await new Promise((resolve, reject) =>
      this.controlTransmitter.connect(opts.controlPort, opts.host, () => resolve(null)));
    this.updateReceiver.on('listening', () => {
      let address = this.updateReceiver.address();
      this.updateReceiver.setBroadcast(true);
      this.updateReceiver.setMulticastTTL(opts.multicastTTL);
      this.updateReceiver.addMembership(opts.multicastGroup);
    });
    this.updateReceiver.on('message', msg => this.dispatch(onUpdate, msg));
    this.updateReceiver.bind(opts.updatePort);
  }

  /** Terminate all sockets. Only call after calling {@linkcode open}. */
  close() {
    this.callSocket.close();
    this.logSocket.close();
    this.controlTransmitter.close();
    this.updateReceiver.close();
  }

  /** Issue a remote call and wait for the result.
   *  @param address - ZMQ identity of the destination process.
   *  @param method - Remote method name.
   *  @param args - Positional arguments for the remote method.
   *  @returns The remote method's return value.
   */
  async sendCall(address: string, method: string, ...args: any) {
    let msgId = crypto.randomBytes(4).readUInt32BE();
    let request = cbor.encode([REQUEST, msgId, method, args]);
    await this.callSocket.send([Buffer.from(address), request]);
    let [_address, response] = await this.callSocket.receive();
    return await decode(response)
      .then(([msgType, msgIdReturned, err, result]) => {
        if (msgType !== RESPONSE) {
          throw new Error(`expected a response, got: ${msgType}`);
        } else if (msgIdReturned !== msgId) {
          throw new Error(`bad message ID: expected ${msgId}, got ${msgIdReturned}`);
        } else if (err) {
          throw new Error(err.toString());
        }
        return result;
      });
  }

  /** Send a control input (gamepad) update to Runtime.
   *  @param gamepads - A map from gamepad indices (as strings) to gamepad parameters.
   */
  async sendControl(gamepads: Map<string, Gamepad>) {
    let request = cbor.encode([NOTIFICATION, 'update_gamepads', [gamepads]]);
    await new Promise((resolve, reject) =>
      this.controlTransmitter.send(request, err => {
        if (err) {
          reject(err);
        } else {
          resolve(null);
        }
      })
    );
  }
}

export default Client;
