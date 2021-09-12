import * as React from 'react';
import { Button, HTMLTable } from '@blueprintjs/core';
import { IconNames } from '@blueprintjs/icons';
import * as _ from 'lodash';

interface EntityTableProps<T> {
  columns: { field: string; heading: string }[];
  entities: T[];
  render: (entity: T, index?: number) => React.ReactNode;
  headings?: React.ReactNode;
  sortedBy?: string;
  ascending?: boolean;
  emptyMessage?: string;
}

export default function EntityTable<T>(props: EntityTableProps<T>) {
  const [sortedBy, setSortedBy] = React.useState<string | null>(props.sortedBy ?? null);
  const [ascending, setAscending] = React.useState(props.ascending ?? true);
  let entities = _.sortBy(props.entities, sortedBy ? [sortedBy] : []);
  if (!ascending) {
    entities = _.reverse(entities);
  }
  const selectSortIcon = (field: string) => {
    if (field !== sortedBy) {
      return IconNames.DOUBLE_CARET_VERTICAL;
    } else if (ascending) {
      return IconNames.CARET_UP;
    } else {
      return IconNames.CARET_DOWN;
    }
  };
  return (
    <HTMLTable striped className="entity-table">
      <thead>
        {props.headings}
        <tr>
          {props.columns.map((column, index) => (
            <td key={index}>
              {column.heading}
              <Button
                minimal
                className="sort-button"
                icon={selectSortIcon(column.field)}
                onClick={() => {
                  if (column.field !== sortedBy) {
                    setSortedBy(column.field);
                    setAscending(true);
                  } else {
                    setAscending(!ascending);
                  }
                }}
              />
            </td>
          ))}
        </tr>
      </thead>
      <tbody>
        {entities.map((entity, index) => props.render(entity, index))}
        {entities.length === 0 && (
          <tr>
            <td colSpan={props.columns.length} className="empty-row">
              {props.emptyMessage || 'No entities'}
            </td>
          </tr>
        )}
      </tbody>
    </HTMLTable>
  );
}
