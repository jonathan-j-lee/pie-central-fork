import * as React from 'react';
import { Link } from 'react-router-dom';
import { Icon } from '@blueprintjs/core';
import { IconName, IconNames } from '@blueprintjs/icons';

import { DeleteButton } from '../EntityButtons';
import { FixtureSelect } from '../EntitySelects';
import EntityTable from '../EntityTable';
import { PLACEHOLDER, TeamMembers } from '../Util';
import { useAppDispatch, useAppSelector, useMatches } from '../../hooks';
import matchesSlice from '../../store/matches';

interface ScoreProps {
  allyScore: number;
  opponentScore: number;
  current?: boolean;
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
  const future = !props.current && props.allyScore === 0 && props.opponentScore === 0;
  const past = !props.current && !future;
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
        { field: 'blueAlliance.name', heading: 'Alliance' },
        { field: 'blueTeams', heading: 'Teams' },
        { field: 'blueScore', heading: 'Score' },
        { field: 'goldAlliance.name', heading: 'Alliance' },
        { field: 'goldTeams', heading: 'Teams' },
        { field: 'goldScore', heading: 'Score' },
        ...(props.edit ? [
          { field: 'fixture', heading: 'Fixture' },
        ] : []),
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
          <td>{match.blueAlliance?.name ?? PLACEHOLDER}</td>
          <td><TeamMembers teams={match.blueTeams} /></td>
          <Score
            allyScore={match.blueScore}
            opponentScore={match.goldScore}
            current={match.id === currentMatch}
            className="blue"
          />
          <td>{match.goldAlliance?.name ?? PLACEHOLDER}</td>
          <td><TeamMembers teams={match.goldTeams} /></td>
          <Score
            allyScore={match.goldScore}
            opponentScore={match.blueScore}
            current={match.id === currentMatch}
            className="gold"
          />
          {props.edit && (
            <>
              <td>
                <FixtureSelect
                  id={match.fixture}
                  onSelect={({ id: fixture }) =>
                    dispatch(matchesSlice.actions.upsert({ ...match, fixture }))
                  }
                />
              </td>
              <td>
                <DeleteButton
                  onClick={() => dispatch(matchesSlice.actions.remove(match.id))}
                />
              </td>
            </>
          )}
        </tr>
      )}
    />
  );
}
