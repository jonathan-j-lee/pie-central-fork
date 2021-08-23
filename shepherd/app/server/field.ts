import { Match, MatchEvent } from './db';

export class FieldControl {
  match: Match | null;
  events: MatchEvent[];
}
