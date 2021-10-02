import {
  Alliance,
  AllianceColor,
  Fixture,
  LogLevel,
  Match,
  MatchEventType,
  Team,
  displayTeam,
} from '../../types';
import { useAppSelector, useBracket } from '../hooks';
import { selectors as allianceSelectors } from '../store/alliances';
import { selectors as matchSelectors } from '../store/matches';
import { selectors as teamSelectors } from '../store/teams';
import { Button, HTMLSelect, MenuItem } from '@blueprintjs/core';
import { IconName, IconNames } from '@blueprintjs/icons';
import { Select } from '@blueprintjs/select';
import * as React from 'react';

interface EntitySelectProps<T> {
  id: number | null;
  onSelect: (id: number | null) => void;
  filter?: (entity: T) => boolean;
  noResults?: string;
  placeholder?: string;
  disabled?: boolean;
}

function makeSelect<T extends { id: number }>(
  useEntities: (id: number | null) => [T | undefined, T[]],
  selectName: (entity?: T) => string,
  icon?: IconName
) {
  const SelectFactory = Select.ofType<T | null>();
  return function EntitySelect(props: EntitySelectProps<T>) {
    const [entity, entities] = useEntities(props.id);
    return (
      <SelectFactory
        disabled={props.disabled}
        items={([null] as (T | null)[]).concat(
          entities
            .filter((entity) => entity.id >= 0)
            .filter(props.filter ?? (() => true))
        )}
        itemPredicate={(query, entity) =>
          selectName(entity ?? undefined)
            .toLowerCase()
            .includes(query.toLowerCase())
        }
        itemRenderer={(entity, { handleClick }) => (
          <MenuItem
            key={entity?.id ?? null}
            text={entity ? selectName(entity) : '(None)'}
            onClick={handleClick}
          />
        )}
        onItemSelect={(entity) => props.onSelect(entity?.id ?? null)}
        noResults={<MenuItem disabled text={props.noResults || 'No results.'} />}
      >
        <Button
          disabled={props.disabled}
          icon={icon}
          rightIcon={IconNames.CARET_DOWN}
          text={selectName(entity) || props.placeholder || '(None)'}
        />
      </SelectFactory>
    );
  };
}

export const AllianceSelect = makeSelect<Alliance>(
  (id) => {
    const alliances = useAppSelector((state) => state.alliances);
    return [
      id ? allianceSelectors.selectById(alliances, id) : undefined,
      allianceSelectors.selectAll(alliances),
    ];
  },
  (alliance) => alliance?.name ?? '',
  IconNames.PEOPLE
);

export const FixtureSelect = makeSelect<Fixture>(
  (id) => {
    let [, fixtures] = useBracket();
    fixtures = fixtures.filter(
      (fixture) => fixture.blue?.winner || fixture.gold?.winner
    );
    const [fixture] = fixtures.filter((fixture) => fixture.id === id);
    return [fixture, fixtures];
  },
  (fixture) =>
    fixture
      ? `${fixture.blue?.winningAlliance?.name || '?'} vs. ${
          fixture.gold?.winningAlliance?.name || '?'
        }`
      : '',
  IconNames.MANY_TO_ONE
);

export const TeamSelect = makeSelect<Team>(
  (id) => {
    const teams = useAppSelector((state) => state.teams);
    return [
      id ? teamSelectors.selectById(teams, id) : undefined,
      teamSelectors.selectAll(teams),
    ];
  },
  (team) => (team ? displayTeam(team) : '')
);

export const MatchSelect = makeSelect<Match>(
  (id) => {
    const matches = useAppSelector((state) => state.matches);
    return [
      id ? matchSelectors.selectById(matches, id) : undefined,
      matchSelectors.selectAll(matches),
    ] as [Match | undefined, Match[]];
  },
  (match) => (match?.id !== undefined ? `Match ${match.id}` : '')
);

interface EnumSelectProps<T> {
  value: T;
  setValue: (alliance: T) => void;
  disabled?: boolean;
}

export function AllianceColorSelect(props: EnumSelectProps<AllianceColor>) {
  return (
    <HTMLSelect
      value={props.value}
      onChange={({ currentTarget: { value } }) =>
        props.setValue(value as AllianceColor)
      }
      disabled={props.disabled}
    >
      <option value={AllianceColor.NONE}>None</option>
      <option value={AllianceColor.BLUE}>Blue</option>
      <option value={AllianceColor.GOLD}>Gold</option>
    </HTMLSelect>
  );
}

export function MatchEventTypeSelect(props: EnumSelectProps<MatchEventType>) {
  return (
    <HTMLSelect
      value={props.value}
      onChange={({ currentTarget: { value } }) =>
        props.setValue(value as MatchEventType)
      }
      disabled={props.disabled}
    >
      <option value={MatchEventType.JOIN}>Join an alliance</option>
      <option value={MatchEventType.AUTO}>Start autonomous</option>
      <option value={MatchEventType.TELEOP}>Start tele-op</option>
      <option value={MatchEventType.IDLE}>Stop phase</option>
      <option value={MatchEventType.ESTOP}>E-stop</option>
      <option value={MatchEventType.ADD}>Add to score</option>
      <option value={MatchEventType.MULTIPLY}>Apply score multiplier</option>
      <option value={MatchEventType.EXTEND}>Extend match phase</option>
      <option value={MatchEventType.OTHER}>Other</option>
    </HTMLSelect>
  );
}

export function LogLevelSelect(props: EnumSelectProps<LogLevel>) {
  return (
    <HTMLSelect
      value={props.value}
      onChange={({ currentTarget: { value } }) => props.setValue(value as LogLevel)}
    >
      <option value={LogLevel.DEBUG}>Debug</option>
      <option value={LogLevel.INFO}>Info</option>
      <option value={LogLevel.WARNING}>Warning</option>
      <option value={LogLevel.ERROR}>Error</option>
      <option value={LogLevel.CRITICAL}>Critical</option>
    </HTMLSelect>
  );
}
