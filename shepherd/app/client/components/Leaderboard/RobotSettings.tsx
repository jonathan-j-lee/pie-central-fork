import { Team } from '../../../types';
import { useAppDispatch } from '../../hooks';
import teamsSlice from '../../store/teams';
import {
  Button,
  Classes,
  Dialog,
  FormGroup,
  InputGroup,
  INumericInputProps,
  NumericInput,
} from '@blueprintjs/core';
import { IconNames } from '@blueprintjs/icons';
import * as React from 'react';

function PortInput(props: INumericInputProps & { id?: string }) {
  return (
    <NumericInput
      minorStepSize={null}
      min={1}
      max={65535}
      leftIcon={IconNames.FLOW_END}
      majorStepSize={10}
      clampValueOnBlur
      {...props}
    />
  );
}

export default function RobotSettings(props: { team: Team }) {
  const dispatch = useAppDispatch();
  const [show, setShow] = React.useState(false);
  return (
    <>
      <Button
        text="Settings"
        icon={IconNames.SETTINGS}
        onClick={() => setShow(!show)}
      />
      <Dialog
        isOpen={show}
        icon={IconNames.SETTINGS}
        title="Edit robot settings"
        onClose={() => setShow(false)}
      >
        <div className={Classes.DIALOG_BODY}>
          <FormGroup
            label="Hostname"
            labelFor="hostname"
            helperText="Either an IP address or a domain name for Shepherd to connect to."
          >
            <InputGroup
              id="hostname"
              placeholder="Example: 192.168.1.1"
              defaultValue={props.team.hostname}
              onBlur={({ currentTarget: { value: hostname } }) =>
                dispatch(teamsSlice.actions.upsert({ ...props.team, hostname }))
              }
            />
          </FormGroup>
          <FormGroup
            label="Remote call port"
            labelFor="call-port"
            helperText="Port that Shepherd should connect to for sending calls."
          >
            <PortInput
              id="call-port"
              defaultValue={props.team.callPort}
              onValueChange={(callPort) =>
                callPort > 0 &&
                dispatch(teamsSlice.actions.upsert({ ...props.team, callPort }))
              }
            />
          </FormGroup>
          <FormGroup
            label="Log publisher port"
            labelFor="log-port"
            helperText="Port that Shepherd should connect to for receiving logged events."
          >
            <PortInput
              id="log-port"
              defaultValue={props.team.logPort}
              onValueChange={(logPort) =>
                logPort > 0 &&
                dispatch(teamsSlice.actions.upsert({ ...props.team, logPort }))
              }
            />
          </FormGroup>
          <FormGroup
            label="Update port"
            labelFor="update-port"
            helperText="Port that Shepherd should bind to for receiving Smart Device updates."
          >
            <PortInput
              id="update-port"
              defaultValue={props.team.updatePort}
              onValueChange={(updatePort) =>
                updatePort > 0 &&
                dispatch(teamsSlice.actions.upsert({ ...props.team, updatePort }))
              }
            />
          </FormGroup>
          <FormGroup
            label="Multicast group"
            labelFor="multicast-group"
            helperText="IP multicast group Runtime uses to broadcast Smart Device updates."
          >
            <InputGroup
              id="multicast-group"
              placeholder="Example: 224.224.1.1"
              defaultValue={props.team.multicastGroup}
              onBlur={({ currentTarget: { value: multicastGroup } }) =>
                dispatch(teamsSlice.actions.upsert({ ...props.team, multicastGroup }))
              }
            />
          </FormGroup>
        </div>
        <div className={Classes.DIALOG_FOOTER}>
          <div className={Classes.DIALOG_FOOTER_ACTIONS}>
            <Button
              text="Close"
              icon={IconNames.CROSS}
              onClick={() => setShow(false)}
            />
          </div>
        </div>
      </Dialog>
    </>
  );
}
