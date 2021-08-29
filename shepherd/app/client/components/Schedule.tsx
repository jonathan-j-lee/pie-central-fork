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
import { AllianceSelect, TeamSelect } from './EntitySelects';
import { PLACEHOLDER, DEV_ENV, displayTeam, displayTime, TeamMembers } from './Util';

import { useAppDispatch, useAppSelector } from '../store';
import * as allianceUtils from '../store/alliances';
import matchesSlice, * as matchUtils from '../store/matches';
import { AllianceColor, Match, MatchEvent, MatchEventType } from '../store/matches';
import * as teamUtils from '../store/teams';

const TYPES_WITH_VALUE = [
  MatchEventType.ADD,
  MatchEventType.MULTIPLY,
  MatchEventType.EXTEND,
];

function getScore(events: MatchEvent[], alliance: AllianceColor) {
  let score = 0;
  let multiplier = 1;
  for (const event of events) {
    if (event.alliance !== alliance) {
      continue;
    }
    if (event.type === MatchEventType.ADD) {
      const value = event.value ?? 0;
      score += value < 0 ? value : multiplier * value;
    } else if (event.type === MatchEventType.MULTIPLY) {
      multiplier = event.value ?? 1;
    }
  }
  return score;
}

interface ScoreProps {
  allyScore: number;
  opponentScore: number;
  className?: string;
}

function Score(props: ScoreProps) {
  // TODO: display current match
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
  return (
    <td className={`${status} ${props.className}`}>
      <Icon icon={icon} className="score-icon" /> {props.allyScore}
    </td>
  );
}

function getTeams(
  events: MatchEvent[],
  alliance: AllianceColor,
  teamsState: EntityState<teamUtils.Team>
) {
  return events
    .filter(
      (event) => event.type === MatchEventType.JOIN && event.alliance === alliance
    )
    .map((event) =>
      event.team ? teamUtils.selectors.selectById(teamsState, event.team) : null
    )
    .filter((team) => team) as teamUtils.Team[];
}

function MatchList(props: { edit: boolean }) {
  const dispatch = useAppDispatch();
  const matchesState = useAppSelector((state) => state.matches);
  const matches = matchUtils.selectors.selectAll(matchesState).map((match) => ({
    ...match,
    blueScore: getScore(match.events, AllianceColor.BLUE),
    goldScore: getScore(match.events, AllianceColor.GOLD),
  }));
  const teamsState = useAppSelector((state) => state.teams);
  const alliancesState = useAppSelector((state) => state.alliances);
  const alliances = allianceUtils.selectors.selectAll(alliancesState);
  const getAlliance = (id?: number) =>
    id ? allianceUtils.selectors.selectById(alliancesState, id) : undefined;
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
        const blueAlliance = getAlliance(match.blueAlliance);
        const goldAlliance = getAlliance(match.goldAlliance);
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
                  entity={blueAlliance}
                  entities={alliances}
                  onSelect={({ id: blueAlliance }) =>
                    dispatch(matchesSlice.actions.upsert({ ...match, blueAlliance }))
                  }
                />
              ) : (
                blueAlliance?.name || PLACEHOLDER
              )}
            </td>
            <td>
              <TeamMembers
                teams={getTeams(match.events, AllianceColor.BLUE, teamsState)}
              />
            </td>
            <Score
              allyScore={match.blueScore}
              opponentScore={match.goldScore}
              className="blue"
            />
            <td>
              {props.edit ? (
                <AllianceSelect
                  entity={goldAlliance}
                  entities={alliances}
                  onSelect={({ id: goldAlliance }) =>
                    dispatch(matchesSlice.actions.upsert({ ...match, goldAlliance }))
                  }
                />
              ) : (
                goldAlliance?.name || PLACEHOLDER
              )}
            </td>
            <td>
              <TeamMembers
                teams={getTeams(match.events, AllianceColor.GOLD, teamsState)}
              />
            </td>
            <Score
              allyScore={match.goldScore}
              opponentScore={match.blueScore}
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

function getAllianceColor(color: AllianceColor) {
  switch (color) {
    case AllianceColor.BLUE:
      return 'Blue';
    case AllianceColor.GOLD:
      return 'Gold';
    default:
      return '?';
  }
}

function displaySummary(event: MatchEvent, team?: teamUtils.Team) {
  const alliance = getAllianceColor(event.alliance);
  const value = event.value ?? 0;
  switch (event.type) {
    case MatchEventType.JOIN:
      return `${displayTeam(team)} joined the ${alliance} alliance.`;
    case MatchEventType.START_AUTO:
      return `Started the autonomous phase for the ${alliance} alliance.`;
    case MatchEventType.STOP_AUTO:
      return `Stopped the autonomous phase for the ${alliance} alliance.`;
    case MatchEventType.START_TELEOP:
      return 'Started the tele-op phase for the ${alliance} alliance.';
    case MatchEventType.STOP_TELEOP:
      return 'Stopped the tele-op phase for the ${alliance} alliance.';
    case MatchEventType.ADD:
      if (value >= 0) {
        return `The ${alliance} alliance scored ${value} points (without multipliers).`;
      } else {
        return `The ${alliance} alliance lost ${-value} points`;
      }
    case MatchEventType.MULTIPLY:
      return `The ${alliance} alliance got a ${value}x score multiplier.`;
    case MatchEventType.EXTEND:
      const duration = displayTime(value, 0);
      return `The ${alliance} alliance extended the current phase by ${duration}.`;
    default:
      return `An event occurred for the ${alliance} alliance.`;
  }
}

function MatchEventList(props: { match: Match; edit: boolean }) {
  const dispatch = useAppDispatch();
  const teamsState = useAppSelector((state) => state.teams);
  const teams = teamUtils.selectors.selectAll(teamsState);
  const earliestTimestamp = Math.min(
    ...props.match.events.map((event) => Number(event.timestamp))
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
      render={(event) => {
        const team =
          event.team !== null
            ? teamUtils.selectors.selectById(teamsState, event.team)
            : undefined;
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
                  defaultValue={Number(event.timestamp)}
                  onValueChange={(timestamp) =>
                    dispatch(
                      matchUtils.updateEvent(props.match, event.id, {
                        timestamp: timestamp.toString(),
                      })
                    )
                  }
                />
              ) : (
                <code>
                  {`+${displayTime((Number(event.timestamp) - earliestTimestamp) / 1000)}`}
                </code>
              )}
            </td>
            <td className={`${event.alliance} ${props.edit ? '' : 'bg'}`}>
              {props.edit ? (
                <HTMLSelect
                  value={event.alliance}
                  onChange={({ currentTarget: { value } }) =>
                    dispatch(
                      matchUtils.updateEvent(props.match, event.id, {
                        alliance: value as AllianceColor,
                      })
                    )
                  }
                >
                  <option value={AllianceColor.NONE}>None</option>
                  <option value={AllianceColor.BLUE}>Blue</option>
                  <option value={AllianceColor.GOLD}>Gold</option>
                </HTMLSelect>
              ) : event.alliance === AllianceColor.NONE ? (
                PLACEHOLDER
              ) : (
                getAllianceColor(event.alliance)
              )}
            </td>
            <td>
              {props.edit ? (
                <TeamSelect
                  entity={team}
                  entities={teams}
                  onSelect={({ id: team }) =>
                    dispatch(matchUtils.updateEvent(props.match, event.id, { team }))
                  }
                />
              ) : (
                displayTeam(team)
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
                    <option value={MatchEventType.START_AUTO}>Start autonomous</option>
                    <option value={MatchEventType.STOP_AUTO}>Stop autonomous</option>
                    <option value={MatchEventType.START_TELEOP}>Start tele-op</option>
                    <option value={MatchEventType.STOP_TELEOP}>Stop tele-op</option>
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
  const match =
    matchId !== null && !isNaN(matchId)
      ? matchUtils.selectors.selectById(matchesState, matchId)
      : undefined;
  return (
    <>
      <H2>Matches</H2>
      <MatchList edit={edit} />
      {match && (
        <>
          <H2>Match Events</H2>
          <MatchEventList match={match} edit={edit} />
        </>
      )}
      {(username || DEV_ENV) && (
        <ButtonGroup className="edit-button-group">
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
