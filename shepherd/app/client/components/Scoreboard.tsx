import {
  AllianceColor,
  GameState,
  displayAllianceColor,
  displayTeam,
} from '../../types';
import { useAppSelector, useBracket, useCurrentMatch } from '../hooks';
import { selectors as allianceSelectors } from '../store/alliances';
import { selectors as teamSelectors } from '../store/teams';
import Timer from './Timer';
import { Card, H1, H2 } from '@blueprintjs/core';
import * as React from 'react';

interface AllianceCardProps {
  game: GameState;
  alliance: AllianceColor.BLUE | AllianceColor.GOLD;
  allianceId: number | null;
}

function AllianceCard(props: AllianceCardProps) {
  const alliances = useAppSelector((state) => state.alliances);
  const teams = useAppSelector((state) => state.teams);
  const alliance = props.allianceId
    ? allianceSelectors.selectById(alliances, props.allianceId)
    : undefined;
  return (
    <Card className={`${props.alliance} alliance`}>
      <H1>
        {displayAllianceColor(props.alliance)}: {props.game[props.alliance].score}
      </H1>
      {alliance && <H2>{alliance.name}</H2>}
      {props.game[props.alliance].teams.map((teamId) => (
        <H2 key={teamId}>{displayTeam(teamSelectors.selectById(teams, teamId))}</H2>
      ))}
    </Card>
  );
}

export default function Scoreboard() {
  const match = useCurrentMatch();
  const game = GameState.fromEvents(match?.events ?? []);
  const [, fixtures] = useBracket();
  const [fixture] = fixtures.filter((fixture) => fixture.id === match?.fixture);
  return (
    <div className="container">
      <AllianceCard
        game={game}
        alliance={AllianceColor.BLUE}
        allianceId={fixture?.blue?.winner ?? null}
      />
      <Timer />
      <AllianceCard
        game={game}
        alliance={AllianceColor.GOLD}
        allianceId={fixture?.gold?.winner ?? null}
      />
    </div>
  );
}
