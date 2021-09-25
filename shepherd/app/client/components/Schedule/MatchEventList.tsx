import * as React from 'react';
import { HTMLSelect, InputGroup, NumericInput } from '@blueprintjs/core';

import { DeleteButton } from '../EntityButtons';
import {
  AllianceColorSelect,
  MatchEventTypeSelect,
  TeamSelect,
} from '../EntitySelects';
import EntityTable from '../EntityTable';
import { PLACEHOLDER } from '../Util';
import { useAppDispatch, useAppSelector } from '../../hooks';
import { updateEvent, removeEvent } from '../../store/matches';
import { selectors as teamSelectors } from '../../store/teams';
import {
  AllianceColor,
  GameState,
  Match,
  MatchEventType,
  displayAllianceColor,
  displaySummary,
  displayTeam,
  displayTime,
} from '../../../types';

const TYPES_WITH_VALUE = [
  MatchEventType.AUTO,
  MatchEventType.TELEOP,
  MatchEventType.ADD,
  MatchEventType.MULTIPLY,
  MatchEventType.EXTEND,
];

function Timestamp(props: { timestamp: number; earliestTimestamp: number }) {
  if (!props.timestamp) {
    return PLACEHOLDER;
  }
  const secondsElapsed = (props.timestamp - props.earliestTimestamp) / 1000;
  return <code>{`+${displayTime(secondsElapsed)}`}</code>;
}

export default function MatchEventList(props: { match: Match; edit: boolean }) {
  const dispatch = useAppDispatch();
  const teams = useAppSelector((state) => state.teams);
  const events = props.match.events.map((event) => ({
    ...event,
    teamData: event.team ? teamSelectors.selectById(teams, event.team) : undefined,
  }));
  const earliestTimestamp = Math.min(
    ...events.map((event) => event.timestamp).filter((timestamp) => timestamp)
  );
  const game = GameState.fromEvents(props.match.events);
  return (
    <EntityTable
      columns={[
        { field: 'timestamp', heading: 'Timestamp' },
        { field: 'alliance', heading: 'Alliance' },
        { field: 'teamData.name', heading: 'Team' },
        ...(props.edit
          ? [
              { field: 'type', heading: 'Type' },
              { field: 'value', heading: 'Value' },
            ]
          : [{ field: 'summary', heading: 'Summary' }]),
        { field: 'description', heading: 'Description' },
      ]}
      sortedBy="timestamp"
      entities={events}
      emptyMessage="No events"
      render={(event) => (
        <tr key={event.id}>
          <td>
            {props.edit ? (
              <NumericInput
                fill
                allowNumericCharactersOnly
                min={1}
                clampValueOnBlur
                minorStepSize={1}
                stepSize={1000}
                majorStepSize={10000}
                defaultValue={event.timestamp || ''}
                onValueChange={(timestamp) =>
                  dispatch(updateEvent(props.match, event.id, { timestamp }))
                }
              />
            ) : (
              <Timestamp
                timestamp={event.timestamp}
                earliestTimestamp={earliestTimestamp}
              />
            )}
          </td>
          <td className={`${event.alliance} ${props.edit ? '' : 'bg'}`}>
            {props.edit ? (
              <AllianceColorSelect
                value={event.alliance}
                setValue={(alliance) =>
                  dispatch(updateEvent(props.match, event.id, { alliance }))
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
                onSelect={(team) =>
                  dispatch(updateEvent(props.match, event.id, { team }))
                }
                {...(event.type === MatchEventType.JOIN ? {} : {
                  filter(team) {
                    switch (event.alliance) {
                      case AllianceColor.BLUE:
                        return game.blue.teams.includes(team.id);
                      case AllianceColor.GOLD:
                        return game.gold.teams.includes(team.id);
                      default:
                        return false;
                    }
                  },
                })}
              />
            ) : event.team ? (
              displayTeam(event.teamData)
            ) : (
              PLACEHOLDER
            )}
          </td>
          {props.edit ? (
            <>
              <td>
                <MatchEventTypeSelect
                  value={event.type}
                  setValue={(type) =>
                    dispatch(updateEvent(props.match, event.id, { type }))
                  }
                />
              </td>
              <td>
                {TYPES_WITH_VALUE.includes(event.type) ? (
                  <NumericInput
                    fill
                    allowNumericCharactersOnly
                    defaultValue={event.value ?? 0}
                    onValueChange={(value) =>
                      dispatch(updateEvent(props.match, event.id, { value }))
                    }
                  />
                ) : (
                  PLACEHOLDER
                )}
              </td>
            </>
          ) : (
            <td>{displaySummary(event, event.teamData)}</td>
          )}
          <td>
            {props.edit ? (
              <InputGroup
                placeholder="Enter a description"
                defaultValue={event.description ?? ''}
                onBlur={({ currentTarget: { value: description } }) =>
                  dispatch(updateEvent(props.match, event.id, { description }))
                }
              />
            ) : (
              event.description || PLACEHOLDER
            )}
          </td>
          {props.edit && (
            <td>
              <DeleteButton
                onClick={() => dispatch(removeEvent(props.match, event.id))}
              />
            </td>
          )}
        </tr>
      )}
    />
  );
}
