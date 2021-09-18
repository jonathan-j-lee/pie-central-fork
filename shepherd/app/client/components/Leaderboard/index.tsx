import * as React from 'react';
import { ButtonGroup, H2, Switch } from '@blueprintjs/core';
import AllianceList from './AllianceList';
import TeamList from './TeamList';
import { AddButton, ConfirmButton, EditButton } from '../EntityButtons';
import { DEV_ENV } from '../Util';
import { useAppSelector, useAppDispatch } from '../../hooks';
import { add as addAlliance, save as saveAlliances } from '../../store/alliances';
import controlSlice from '../../store/control';
import { add as addTeam, save as saveTeams } from '../../store/teams';

export default function Leaderboard() {
  const dispatch = useAppDispatch();
  const username = useAppSelector((state) => state.user.username);
  const edit = useAppSelector((state) => state.control.editing);
  const setEdit = (editing: boolean) => dispatch(controlSlice.actions.update({ editing }));
  const [elimination, setElimination] = React.useState(true);
  return (
    <>
      <H2>Teams</H2>
      <TeamList edit={edit} elimination={elimination} />
      <Switch
        className="spacer"
        inline
        checked={elimination}
        onChange={() => setElimination(!elimination)}
        label="Include elimination matches in win/loss statistics"
      />
      <H2 className="spacer">Alliances</H2>
      <AllianceList edit={edit} />
      {(username || DEV_ENV) && (
        <ButtonGroup className="spacer">
          <EditButton edit={edit} setEdit={setEdit} />
          {edit && (
            <>
              <AddButton text="Add team" onClick={() => dispatch(addTeam())} />
              <AddButton text="Add alliance" onClick={() => dispatch(addAlliance())} />
              <ConfirmButton
                success="Saved team and alliance data."
                failure="Failed to save team and alliance data."
                onClick={async () => {
                  await Promise.all([
                    dispatch(saveTeams()).unwrap(),
                    dispatch(saveAlliances()).unwrap(),
                  ]);
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
