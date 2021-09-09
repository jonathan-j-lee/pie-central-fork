import * as React from 'react';
import { Link, useLocation } from 'react-router-dom';
import {
  Button,
  ButtonGroup,
  H2,
  HTMLSelect,
  HTMLTable,
  Icon,
  InputGroup,
  NumericInput,
  TextArea,
} from '@blueprintjs/core';
import { IconName, IconNames } from '@blueprintjs/icons';
import { EntityState } from '@reduxjs/toolkit';
import * as _ from 'lodash';

import EntityTable from './EntityTable';
import { AddButton, ConfirmButton, DeleteButton, EditButton } from './EntityButtons';
import {
  select,
  AllianceColorSelect,
  AllianceSelect,
  TeamSelect,
} from './EntitySelects';
import { PLACEHOLDER, DEV_ENV, TeamMembers } from './Util';
import {
  AllianceColor,
  GameState,
  Match,
  MatchEvent,
  MatchEventType,
  Team,
  displayAllianceColor,
  displayTeam,
  displayTime,
  displaySummary,
} from '../../types';

import { useAppDispatch, useAppSelector } from '../store';
import * as allianceUtils from '../store/alliances';
import matchesSlice, * as matchUtils from '../store/matches';
import * as teamUtils from '../store/teams';

const TYPES_WITH_VALUE = [
  MatchEventType.AUTO,
  MatchEventType.TELEOP,
  MatchEventType.ADD,
  MatchEventType.MULTIPLY,
  MatchEventType.EXTEND,
];

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
    <td className={`score ${!future && status} ${props.className}`}>
      <div className={props.current ? 'current' : ''}>
        {past && <Icon icon={icon} className="score-icon" />}
        {future ? PLACEHOLDER : props.allyScore}
      </div>
    </td>
  );
}

function MatchList(props: { edit: boolean }) {
  const dispatch = useAppDispatch();
  const currentMatch = useAppSelector((state) => state.control.matchId);
  const matchesState = useAppSelector((state) => state.matches);
  const matches = matchUtils.selectors.selectAll(matchesState).map((match) => {
    const game = GameState.fromEvents(match.events);
    return {
      ...match,
      blueScore: game.blue.score,
      goldScore: game.gold.score,
    };
  });
  const teamsState = useAppSelector((state) => state.teams);
  const alliancesState = useAppSelector((state) => state.alliances);
  return (
    <EntityTable
      columns={[
        { field: 'id', heading: 'Number' },
        { field: 'blueAlliance', heading: 'Alliance' },
        { field: 'blueTeams', heading: 'Teams' },
        { field: 'blueScore', heading: 'Score' },
        { field: 'goldAlliance', heading: 'Alliance' },
        { field: 'goldTeams', heading: 'Teams' },
        { field: 'goldScore', heading: 'Score' },
      ]}
      entities={matches}
      emptyMessage="No matches"
      headings={
        <tr>
          <td />
          <td colSpan={3} className="alliance-heading">
            Blue
          </td>
          <td colSpan={3} className="alliance-heading">
            Gold
          </td>
        </tr>
      }
      render={(match) => {
        const game = GameState.fromEvents(match.events);
        const getTeams = (alliance: AllianceColor.BLUE | AllianceColor.GOLD) =>
          (alliance === AllianceColor.BLUE ? game.blue : game.gold).teams
            .map((id) => select(teamUtils.selectors, teamsState, id))
            .filter((team) => team) as Team[];
        return (
          <tr key={match.id}>
            <td>
              {(match.id ?? -1) >= 0 ? (
                <Link to={`/schedule?match=${match.id}`}>{`Match ${match.id}`}</Link>
              ) : (
                PLACEHOLDER
              )}
            </td>
            <td>
              {props.edit ? (
                <AllianceSelect
                  id={match.blueAlliance}
                  onSelect={({ id: blueAlliance }) =>
                    dispatch(matchesSlice.actions.upsert({ ...match, blueAlliance }))
                  }
                />
              ) : (
                select(allianceUtils.selectors, alliancesState, match.blueAlliance)
                  ?.name || PLACEHOLDER
              )}
            </td>
            <td>
              <TeamMembers teams={getTeams(AllianceColor.BLUE)} />
            </td>
            <Score
              allyScore={match.blueScore}
              opponentScore={match.goldScore}
              current={match.id === currentMatch}
              className="blue"
            />
            <td>
              {props.edit ? (
                <AllianceSelect
                  id={match.goldAlliance}
                  onSelect={({ id: goldAlliance }) =>
                    dispatch(matchesSlice.actions.upsert({ ...match, goldAlliance }))
                  }
                />
              ) : (
                select(allianceUtils.selectors, alliancesState, match.goldAlliance)
                  ?.name || PLACEHOLDER
              )}
            </td>
            <td>
              <TeamMembers teams={getTeams(AllianceColor.GOLD)} />
            </td>
            <Score
              allyScore={match.goldScore}
              opponentScore={match.blueScore}
              current={match.id === currentMatch}
              className="gold"
            />
            {props.edit && (
              <td>
                <DeleteButton
                  onClick={() => dispatch(matchesSlice.actions.remove(match.id))}
                />
              </td>
            )}
          </tr>
        );
      }}
    />
  );
}

function MatchEventList(props: { match: Match; edit: boolean }) {
  const dispatch = useAppDispatch();
  const teamsState = useAppSelector((state) => state.teams);
  const earliestTimestamp = Math.min(
    ...props.match.events
      .filter((event) => event.timestamp)
      .map((event) => Number(event.timestamp))
  );
  return (
    <EntityTable
      columns={[
        { field: 'timestamp', heading: 'Timestamp' },
        { field: 'alliance', heading: 'Alliance' },
        { field: 'team', heading: 'Team' },
        ...(props.edit
          ? [
              { field: 'type', heading: 'Type' },
              { field: 'value', heading: 'Value' },
            ]
          : [{ field: 'summary', heading: 'Summary' }]),
        { field: 'description', heading: 'Description' },
      ]}
      sortedBy="timestamp"
      entities={props.match.events}
      emptyMessage="No events"
      render={(event) => {
        const team = select(teamUtils.selectors, teamsState, event.team);
        return (
          <tr key={event.id}>
            <td>
              {props.edit ? (
                <NumericInput
                  fill
                  allowNumericCharactersOnly
                  min={0}
                  clampValueOnBlur
                  minorStepSize={1}
                  stepSize={1000}
                  majorStepSize={10000}
                  defaultValue={event.timestamp || ''}
                  onValueChange={(timestamp) =>
                    dispatch(
                      matchUtils.updateEvent(props.match, event.id, { timestamp })
                    )
                  }
                />
              ) : (
                <code>
                  {!event.timestamp
                    ? PLACEHOLDER
                    : `+${displayTime(
                        (Number(event.timestamp) - earliestTimestamp) / 1000
                      )}`}
                </code>
              )}
            </td>
            <td className={`${event.alliance} ${props.edit ? '' : 'bg'}`}>
              {props.edit ? (
                <AllianceColorSelect
                  alliance={event.alliance}
                  setAlliance={(alliance) =>
                    dispatch(
                      matchUtils.updateEvent(props.match, event.id, { alliance })
                    )
                  }
                />
              ) : event.alliance === AllianceColor.NONE ? (
                PLACEHOLDER
              ) : (
                displayAllianceColor(event.alliance)
              )}
            </td>
            <td>
              {props.edit ? (
                <TeamSelect
                  id={event.team}
                  onSelect={({ id: team }) =>
                    dispatch(matchUtils.updateEvent(props.match, event.id, { team }))
                  }
                />
              ) : team ? (
                displayTeam(team)
              ) : (
                PLACEHOLDER
              )}
            </td>
            {props.edit ? (
              <>
                <td>
                  <HTMLSelect
                    value={event.type}
                    onChange={({ currentTarget: { value } }) =>
                      dispatch(
                        matchUtils.updateEvent(props.match, event.id, {
                          type: value as MatchEventType,
                        })
                      )
                    }
                  >
                    <option value={MatchEventType.JOIN}>Join an alliance</option>
                    <option value={MatchEventType.AUTO}>Start autonomous</option>
                    <option value={MatchEventType.TELEOP}>Start tele-op</option>
                    <option value={MatchEventType.IDLE}>Stop phase</option>
                    <option value={MatchEventType.ADD}>Add to score</option>
                    <option value={MatchEventType.MULTIPLY}>
                      Apply score multiplier
                    </option>
                    <option value={MatchEventType.EXTEND}>Extend match phase</option>
                    <option value={MatchEventType.OTHER}>Other</option>
                  </HTMLSelect>
                </td>
                <td>
                  {TYPES_WITH_VALUE.includes(event.type) ? (
                    <NumericInput
                      fill
                      allowNumericCharactersOnly
                      clampValueOnBlur
                      defaultValue={event.value ?? 0}
                      onValueChange={(value) =>
                        dispatch(
                          matchUtils.updateEvent(props.match, event.id, { value })
                        )
                      }
                    />
                  ) : (
                    PLACEHOLDER
                  )}
                </td>
              </>
            ) : (
              <td>{displaySummary(event, team)}</td>
            )}
            <td>
              {props.edit ? (
                <InputGroup
                  placeholder="Enter a description"
                  defaultValue={event.description ?? ''}
                  onBlur={({ currentTarget: { value } }) =>
                    dispatch(
                      matchUtils.updateEvent(props.match, event.id, {
                        description: value as string,
                      })
                    )
                  }
                />
              ) : (
                event.description || PLACEHOLDER
              )}
            </td>
            {props.edit && (
              <td>
                <DeleteButton
                  onClick={() =>
                    dispatch(matchUtils.removeEvent(props.match, event.id))
                  }
                />
              </td>
            )}
          </tr>
        );
      }}
    />
  );
}

function useQuery() {
  return new URLSearchParams(useLocation().search);
}

export default function Schedule() {
  const dispatch = useAppDispatch();
  const matchesState = useAppSelector((state) => state.matches);
  const username = useAppSelector((state) => state.user.username);
  const [edit, setEdit] = React.useState(false);
  const query = useQuery();
  // TODO: redirect if does not exist
  // TODO: add visualization (cumulative score, timeline)
  // TODO: add tournament bracket visualization
  const matchId = query.get('match') ? Number(query.get('match')) : null;
  const match = select(matchUtils.selectors, matchesState, matchId);
  return (
    <>
      <H2>Matches</H2>
      <MatchList edit={edit} />
      {match && (
        <>
          <H2 className="spacer">Events for Match {matchId ?? PLACEHOLDER}</H2>
          <MatchEventList match={match} edit={edit} />
        </>
      )}
      {(username || DEV_ENV) && (
        <ButtonGroup className="spacer">
          <EditButton edit={edit} setEdit={setEdit} />
          {edit && (
            <>
              <AddButton text="Add match" onClick={() => dispatch(matchUtils.add())} />
              {match && (
                <AddButton
                  text="Add event"
                  onClick={() => dispatch(matchUtils.addEvent(match))}
                />
              )}
              <ConfirmButton
                onClick={() => {
                  dispatch(matchUtils.save());
                  setEdit(false);
                }}
              />
            </>
          )}
        </ButtonGroup>
      )}
    </>
  );
}
