import * as React from 'react';
import { ButtonGroup, H2 } from '@blueprintjs/core';

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
  const edit = useAppSelector((state) => state.control.edit);
  const setEdit = (edit: boolean) => dispatch(controlSlice.actions.update({ edit }));
  return (
    <>
      <div className="container">
        <div className="column">
          <H2>Teams</H2>
          <TeamList edit={edit} />
        </div>
        <div className="column">
          <H2>Alliances</H2>
          <AllianceList edit={edit} />
        </div>
      </div>
      {(username || DEV_ENV) && (
        <ButtonGroup className="spacer">
          <EditButton edit={edit} setEdit={setEdit} />
          {edit && (
            <>
              <AddButton text="Add team" onClick={() => dispatch(addTeam())} />
              <AddButton text="Add alliance" onClick={() => dispatch(addAlliance())} />
              <ConfirmButton
                onClick={() => {
                  dispatch(saveTeams());
                  dispatch(saveAlliances());
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
