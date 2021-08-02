import * as React from 'react';
import { FormGroup } from '@blueprintjs/core';
import { IconNames } from '@blueprintjs/icons';
import { NumericInput, Select, Switch } from './Forms';
import { LogOpenCondition } from '../../store/settings';

const LOG_OPEN_CONDITIONS = [
  { id: LogOpenCondition.START, display: 'On Start' },
  { id: LogOpenCondition.ERROR, display: 'On Error' },
  { id: LogOpenCondition.NEVER, display: 'Never' },
];

// TODO: add log level filtering
export default function LogSettings(props) {
  return (
    <>
      <FormGroup
        label="Max lines"
        labelFor="max-lines"
        helperText="The number of lines to truncate the console output to."
      >
        <NumericInput
          id="max-lines"
          path="log.maxEvents"
          min={0}
          max={1000}
          majorStepSize={20}
        />
      </FormGroup>
      <FormGroup label="Open console automatically ..." labelFor="open-condition">
        <Select
          id="open-condition"
          path="log.openCondition"
          options={LOG_OPEN_CONDITIONS}
        />
      </FormGroup>
      <FormGroup label="Visibility Options">
        <Switch
          path="log.showSystem"
          label="Show system events"
          tooltip={`
            If disabled, the console will only show the output of your print statements.
            If enabled, the console will also show messages generated by Runtime itself,
            which can help staff debug your robot.
          `}
        />
        <Switch path="log.showTimestamp" label="Show event timestamps" />
        <Switch path="log.showLevel" label="Show event severity" />
        <Switch
          path="log.showTraceback"
          label="Show event tracebacks"
          tooltip={`
            A Python traceback identifies the functions and line numbers where an error occurred.
            Tracebacks are useful for debugging Runtime but can be difficult to read.
          `}
        />
        <Switch
          path="log.pinToBottom"
          label="Pin to bottom"
          tooltip="Follow the most recent events without needing to scroll manually."
        />
      </FormGroup>
    </>
  );
}
