import { AllianceColor } from '../../../types';
import { useAppDispatch, useCurrentMatch } from '../../hooks';
import { connectTeam } from '../../store/control';
import { AllianceColorSelect, TeamSelect } from '../EntitySelects';
import { OutcomeButton } from '../Notification';
import { ControlGroup, FormGroup, Intent, InputGroup } from '@blueprintjs/core';
import { IconNames } from '@blueprintjs/icons';
import * as React from 'react';

export default function TeamAdder() {
  const dispatch = useAppDispatch();
  const match = useCurrentMatch();
  const [alliance, setAlliance] = React.useState(AllianceColor.NONE);
  const [teamId, setTeamId] = React.useState<number | null>(null);
  const [hostname, setHostname] = React.useState('');
  return (
    <FormGroup
      label="Add teams"
      helperText="Assign a team to an alliance. Optionally, you may change the hostname of a team's robot."
    >
      <ControlGroup>
        <AllianceColorSelect
          disabled={!match}
          value={alliance}
          setValue={setAlliance}
        />
        <TeamSelect disabled={!match} id={teamId} onSelect={setTeamId} />
        <InputGroup
          disabled={!match}
          placeholder="Example: 192.168.1.1"
          onBlur={({ currentTarget: { value } }) => setHostname(value)}
        />
        <OutcomeButton
          text="Add team"
          icon={IconNames.ADD}
          intent={Intent.SUCCESS}
          disabled={!match || teamId === null}
          onClick={async () => {
            if (teamId) {
              await dispatch(connectTeam({ alliance, teamId, hostname })).unwrap();
            }
          }}
          success="Added team to match."
          failure="Failed to add team to match."
        />
      </ControlGroup>
    </FormGroup>
  );
}
