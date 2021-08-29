import * as React from 'react';
import { Button, MenuItem } from '@blueprintjs/core';
import { IconName, IconNames } from '@blueprintjs/icons';
import { Select } from '@blueprintjs/select';
import { Alliance } from '../store/alliances';
import { Team } from '../store/teams';

interface EntitySelectProps<T> {
  entity?: T;
  entities: T[];
  onSelect: (entity: T) => void;
  noResults?: string;
  placeholder?: string;
}

function makeSelect<T extends { id: number; name: string }>(icon?: IconName) {
  const SelectFactory = Select.ofType<T>();
  return (props: EntitySelectProps<T>) => (
    <SelectFactory
      items={props.entities.filter((entity) => entity.id >= 0)}
      itemPredicate={(query, entity) =>
        entity.name.toLowerCase().includes(query.toLowerCase())
      }
      itemRenderer={(entity, { handleClick }) => (
        <MenuItem key={entity.id} text={entity.name} onClick={handleClick} />
      )}
      onItemSelect={(entity) => props.onSelect(entity)}
      noResults={<MenuItem disabled text={props.noResults || 'No results.'} />}
    >
      <Button
        icon={icon}
        rightIcon={IconNames.CARET_DOWN}
        text={props.entity?.name || props.placeholder || '(None)'}
      />
    </SelectFactory>
  );
}

export const AllianceSelect = makeSelect<Alliance>(IconNames.PEOPLE);
export const TeamSelect = makeSelect<Team>();
