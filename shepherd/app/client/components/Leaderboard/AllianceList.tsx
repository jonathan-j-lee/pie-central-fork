import * as React from 'react';
import * as _ from 'lodash';
import { InputGroup } from '@blueprintjs/core';

import { DeleteButton } from '../EntityButtons';
import EntityTable from '../EntityTable';
import { PLACEHOLDER, TeamMembers } from '../Util';
import { useAppDispatch, useAlliances } from '../../hooks';
import alliancesSlice from '../../store/alliances';

export default function AllianceList(props: { edit: boolean }) {
  const dispatch = useAppDispatch();
  const alliances = useAlliances();
  // TODO: do not break team number from name
  return (
    <EntityTable
      columns={[
        { field: 'name', heading: 'Name' },
        { field: 'teams', heading: 'Teams' },
        { field: 'stats.wins', heading: 'Wins' },
        { field: 'stats.losses', heading: 'Losses' },
        { field: 'stats.ties', heading: 'Ties' },
        { field: 'stats.totalScore', heading: 'Total Score' },
      ]}
      entities={alliances}
      emptyMessage="No alliances"
      render={(alliance) => (
        <tr key={alliance.id}>
          <td>
            {props.edit ? (
              <InputGroup
                placeholder="Enter a name"
                defaultValue={alliance.name}
                onBlur={({ currentTarget: { value: name } }) => {
                  dispatch(alliancesSlice.actions.upsert({ ...alliance, name }));
                }}
              />
            ) : (
              alliance.name || PLACEHOLDER
            )}
          </td>
          <td><TeamMembers teams={alliance.teams} /></td>
          <td>{alliance.stats?.wins ?? '0'}</td>
          <td>{alliance.stats?.losses ?? '0'}</td>
          <td>{alliance.stats?.ties ?? '0'}</td>
          <td>{alliance.stats?.totalScore ?? '0'}</td>
          {props.edit && (
            <td>
              <DeleteButton
                onClick={() => dispatch(alliancesSlice.actions.remove(alliance.id))}
              />
            </td>
          )}
        </tr>
      )}
    />
  );
}
