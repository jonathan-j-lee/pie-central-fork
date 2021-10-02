import { useAppSelector, useAppDispatch } from '../../hooks';
import { add as addAlliance, save as saveAlliances } from '../../store/alliances';
import controlSlice from '../../store/control';
import { add as addTeam, save as saveTeams } from '../../store/teams';
import { AddButton, ConfirmButton, EditButton } from '../EntityButtons';
import Help from '../Help';
import { DEV_ENV } from '../Util';
import AllianceList from './AllianceList';
import TeamList from './TeamList';
import { ButtonGroup, H2, Switch } from '@blueprintjs/core';
import * as React from 'react';

function LeaderboardHelp(props: { transitionDuration?: number }) {
  return (
    <Help transitionDuration={props.transitionDuration}>
      <p>
        During the tournament, teams form and compete in alliances of two or three. The
        alliance statistics are only derived from elimination matches, not the
        qualification matches member teams participated in.
      </p>
      <p>
        The total score of a team or an alliance is the sum of all points awarded across
        all matches.
      </p>
    </Help>
  );
}

export default function Leaderboard(props: { transitionDuration?: number }) {
  const dispatch = useAppDispatch();
  const username = useAppSelector((state) => state.user.username);
  const edit = useAppSelector((state) => state.control.editing);
  const setEdit = (editing: boolean) =>
    dispatch(controlSlice.actions.update({ editing }));
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
        <LeaderboardHelp transitionDuration={props.transitionDuration} />
        {(username || DEV_ENV) && (
          <>
            <EditButton edit={edit} setEdit={setEdit} />
            {edit && (
              <>
                <AddButton text="Add team" onClick={() => dispatch(addTeam())} />
                <AddButton
                  text="Add alliance"
                  onClick={() => dispatch(addAlliance())}
                />
                <ConfirmButton
                  success="Saved team and alliance data."
                  failure="Failed to save team and alliance data."
                  onClick={async () => {
                    await Promise.all([
                      dispatch(saveTeams()).unwrap(),
                      dispatch(saveAlliances()).unwrap(),
                    ]);
                  }}
                  finalize={() => setEdit(false)}
                />
              </>
            )}
          </>
        )}
      </ButtonGroup>
    </>
  );
}
