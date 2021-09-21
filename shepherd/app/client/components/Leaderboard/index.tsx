import * as React from 'react';
import { ButtonGroup, H2, Switch } from '@blueprintjs/core';
import AllianceList from './AllianceList';
import TeamList from './TeamList';
import Help from '../Help';
import { AddButton, ConfirmButton, EditButton } from '../EntityButtons';
import { DEV_ENV } from '../Util';
import { useAppSelector, useAppDispatch } from '../../hooks';
import { add as addAlliance, save as saveAlliances } from '../../store/alliances';
import controlSlice from '../../store/control';
import { add as addTeam, save as saveTeams } from '../../store/teams';

function LeaderboardHelp() {
  return (
    <Help>
      <p>
        During the tournament, teams form and compete in alliances of two or three.
        The alliance statistics are only derived from elimination matches, not the
        qualification matches member teams participated in.
      </p>
      <p>
        A team or alliance's total score is the sum of all points awarded across all
        matches.
      </p>
    </Help>
  );
}

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
      <ButtonGroup className="spacer">
        <LeaderboardHelp />
        {(username || DEV_ENV) && (
          <>
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
          </>
        )}
      </ButtonGroup>
    </>
  );
}
