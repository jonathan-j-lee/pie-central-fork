import * as React from 'react';
import { Link } from 'react-router-dom';
import { Icon } from '@blueprintjs/core';
import { IconName, IconNames } from '@blueprintjs/icons';
import * as _ from 'lodash';

import { DeleteButton } from '../EntityButtons';
import { FixtureSelect } from '../EntitySelects';
import EntityTable from '../EntityTable';
import { PLACEHOLDER, TeamMembers } from '../Util';
import { useAppDispatch, useAppSelector, useMatches } from '../../hooks';
import matchesSlice from '../../store/matches';

interface ScoreProps {
  allyScore: number;
  opponentScore: number;
  current: boolean;
  started: boolean;
  className?: string;
}

function Score(props: ScoreProps) {
  let status: 'win' | 'loss' | 'tie' = 'tie';
  let icon: IconName | null = null;
  if (props.allyScore < props.opponentScore) {
    status = 'loss';
  } else if (props.allyScore > props.opponentScore) {
    status = 'win';
    icon = IconNames.TICK_CIRCLE;
  } else {
    icon = IconNames.BAN_CIRCLE;
  }
  const past = !props.current && props.started;
  const future = !props.current && !past;
  return (
    <td className={`score ${props.className ?? ''} ${!future && status} ${props.current ? 'current' : ''}`}>
      {past && <Icon icon={icon} className="score-icon" />}
      {future ? PLACEHOLDER : props.allyScore}
    </td>
  );
}

export default function MatchList(props: { edit: boolean }) {
  const dispatch = useAppDispatch();
  const currentMatch = useAppSelector((state) => state.control.matchId);
  const matches = useMatches();
  return (
    <EntityTable
      columns={[
        { field: 'id', heading: 'Number' },
        { field: 'fixtureData.blue.winningAlliance.name', heading: 'Alliance' },
        { field: 'blueTeams', heading: 'Teams' }, // TODO: fix sorting
        { field: 'blueScore', heading: 'Score' },
        { field: 'fixtureData.gold.winningAlliance.name', heading: 'Alliance' },
        { field: 'goldTeams', heading: 'Teams' },
        { field: 'goldScore', heading: 'Score' },
        { field: 'fixture', heading: 'Elimination Round' },
      ]}
      entities={matches}
      emptyMessage="No matches"
      headings={
        <tr>
          <td />
          <td colSpan={3} className="alliance-heading">Blue</td>
          <td colSpan={3} className="alliance-heading">Gold</td>
        </tr>
      }
      render={(match) => (
        <tr key={match.id}>
          <td>
            {(match.id ?? -1) >= 0 ? (
              <Link to={`/schedule?match=${match.id}`}>{`Match ${match.id}`}</Link>
            ) : (
              PLACEHOLDER
            )}
          </td>
          <td>{match.fixtureData?.blue?.winningAlliance?.name ?? PLACEHOLDER}</td>
          <td><TeamMembers teams={match.blueTeams} /></td>
          <Score
            allyScore={match.blueScore}
            opponentScore={match.goldScore}
            current={match.id === currentMatch}
            started={match.game.started}
            className="blue"
          />
          <td>{match.fixtureData?.gold?.winningAlliance?.name ?? PLACEHOLDER}</td>
          <td><TeamMembers teams={match.goldTeams} /></td>
          <Score
            allyScore={match.goldScore}
            opponentScore={match.blueScore}
            current={match.id === currentMatch}
            started={match.game.started}
            className="gold"
          />
          <td>
            {props.edit ? (
              <FixtureSelect
                id={match.fixture}
                onSelect={(fixture) =>
                  dispatch(
                    matchesSlice.actions.upsert({ ..._.omit(match, 'game'), fixture })
                  )
                }
              />
            ) : (
              match.fixtureData?.blue || match.fixtureData?.gold
                ? `${match.fixtureData?.blue?.winningAlliance?.name || '?'} vs. ${match.fixtureData?.gold?.winningAlliance?.name || '?'}`
                : PLACEHOLDER
            )}
          </td>
          {props.edit && (
            <td>
              <DeleteButton
                onClick={() => dispatch(matchesSlice.actions.remove(match.id))}
              />
            </td>
          )}
        </tr>
      )}
    />
  );
}
