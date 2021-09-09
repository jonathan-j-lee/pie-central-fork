import FieldControl from '../control';
import type { Express } from 'express';

export type GameSetupHook = (app: Express, fc: FieldControl) => void;
export default {} as { [gameId: string]: GameSetupHook };
