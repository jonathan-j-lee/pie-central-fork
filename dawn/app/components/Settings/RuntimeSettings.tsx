import * as React from 'react';
import * as _ from 'lodash';
import { Callout, EditableText, FormGroup, Intent, Tab, Tabs } from '@blueprintjs/core';
import { IconNames } from '@blueprintjs/icons';
import {
  EntityTable,
  NumericInput,
  PasswordInput,
  Select,
  Slider,
  Switch,
  TextArea,
  TextInput,
  validateNonempty,
} from './Forms';
import { useAppSelector } from '../../hooks';
import { LogLevel, BAUD_RATES } from '../../store/settings';

const AdminSettings = () => (
  <>
    <FormGroup
      label="Student code path"
      labelInfo="(required)"
      helperText={`
        The path on the remote machine where student code is located.
        Relative paths are with respect to the user's home directory.
        Shell substitution is disabled.
      `}
    >
      <TextInput
        monospace
        path="runtime.admin.remotePath"
        leftIcon={IconNames.FOLDER_OPEN}
        placeholder="Example: /path/to/studentcode.py"
        validate={validateNonempty}
      />
    </FormGroup>
    <FormGroup
      label="Restart command"
      labelInfo="(required)"
      helperText="A shell command executed to restart Runtime."
    >
      <TextInput
        monospace
        path="runtime.admin.restartCommand"
        leftIcon={IconNames.APPLICATION}
        placeholder="Example: systemctl restart runtime.service"
        validate={validateNonempty}
      />
    </FormGroup>
    <FormGroup
      label="Update command"
      labelInfo="(required)"
      helperText="A shell command executed to update Runtime."
    >
      <TextInput
        monospace
        path="runtime.admin.updateCommand"
        leftIcon={IconNames.APPLICATION}
        placeholder="Example: systemctl restart runtime-update.service"
        validate={validateNonempty}
      />
    </FormGroup>
    <FormGroup
      label="User"
      labelInfo="(required)"
      helperText="Username used to log into the remote machine over SSH."
    >
      <TextInput
        monospace
        path="runtime.credentials.username"
        placeholder="Example: pioneers"
        validate={validateNonempty}
      />
    </FormGroup>
    <FormGroup
      label="Password"
      helperText="Password of the user."
    >
      <PasswordInput monospace path="runtime.credentials.password" />
    </FormGroup>
    <FormGroup
      label="Private key"
      helperText="Private key linked to an SSH public key authorized by the user."
    >
      <TextArea
        small
        monospace
        className="private-key"
        path="runtime.credentials.privateKey"
        placeholder={[
          '-----BEGIN RSA PRIVATE KEY-----',
          '...',
          '-----END RSA PRIVATE KEY-----',
        ].join('\n')}
      />
    </FormGroup>
  </>
);

// TODO: try coding challenge
const PerformanceSettings = () => (
  <>
    <FormGroup
      label="Thread Pool Workers"
      helperText={`
        Each process uses a thread pool to perform blocking I/O or compute-bound
        tasks. This slider sets the maximum number of OS threads to spawn per process.
        Using too few workers will make Runtime unresponsive as the pool's task queue
        fills up.
      `}
    >
      <Slider min={1} max={8} path="runtime.perf.threadPoolWorkers" />
    </FormGroup>
    <FormGroup
      label="Service Workers"
      helperText="Set the maximum number of requests each service can handle concurrently."
    >
      <Slider min={1} max={8} path="runtime.perf.serviceWorkers" />
    </FormGroup>
    <FormGroup
      label="Device update interval"
      labelInfo="(in seconds)"
      helperText="Duration between Smart Device updates from Runtime."
    >
      <Slider
        min={0}
        max={0.25}
        stepSize={0.005}
        labelStepSize={0.05}
        path="runtime.perf.devUpdateInterval"
      />
    </FormGroup>
    <FormGroup
      label="Device polling interval"
      labelInfo="(in seconds)"
      helperText="Duration between data writes by Runtime to Smart Devices."
    >
      <Slider
        min={0}
        max={0.25}
        stepSize={0.005}
        labelStepSize={0.05}
        path="runtime.perf.devPollInterval"
      />
    </FormGroup>
    <FormGroup
      label="Gamepad update interval"
      labelInfo="(in seconds)"
      helperText="Duration between Gamepad updates from Dawn."
    >
      <Slider
        min={0}
        max={0.25}
        stepSize={0.005}
        labelStepSize={0.05}
        path="runtime.perf.controlInterval"
      />
    </FormGroup>
    <FormGroup
      label="Setup function timeout"
      labelInfo="(in seconds)"
      helperText={<span>
        Maximum duration <code>autonomous_setup</code> or <code>teleop_setup</code> should run for.
      </span>}
    >
      <Slider
        min={0}
        max={5}
        stepSize={0.05}
        labelStepSize={0.5}
        path="runtime.perf.setupTimeout"
      />
    </FormGroup>
    <FormGroup
      label="Main function interval"
      labelInfo="(in seconds)"
      helperText={<span>
        Duration between calls to <code>autonomous_main</code> or <code>teleop_main</code>.
      </span>}
    >
      <Slider
        min={0}
        max={0.25}
        stepSize={0.005}
        labelStepSize={0.05}
        path="runtime.perf.mainInterval"
      />
    </FormGroup>
    <FormGroup
      label="Baud rate"
      helperText="Smart Device Baud rate, which specifies how quickly data is communicated over USB serial."
    >
      <Select
        options={BAUD_RATES.map((baudRate) => ({ id: baudRate, display: baudRate }))}
        validate={async (value) => Number(value)}
        path="runtime.perf.baudRate"
      />
    </FormGroup>
  </>
);

const portInputOptions = {
  min: 1,
  max: 65535,
  leftIcon: IconNames.FLOW_END,
  majorStepSize: 10,
};

const AddressSettings = () => (
  <>
    <FormGroup
      label="Multicast group"
      helperText="IP multicast group Runtime uses to broadcast Smart Device updates."
    >
      <TextInput
        monospace
        leftIcon={IconNames.IP_ADDRESS}
        placeholder="Example: 224.1.1.1"
        path="runtime.addressing.multicastGroup"
        validate={validateNonempty}
      />
    </FormGroup>
    <FormGroup
      label="Remote call port"
      helperText="Port that Runtime should bind to for accepting calls."
    >
      <NumericInput {...portInputOptions} path="runtime.addressing.callPort" />
    </FormGroup>
    <FormGroup
      label="Log publisher port"
      helperText="Port that Runtime should bind to for publishing logged events."
    >
      <NumericInput {...portInputOptions} path="runtime.addressing.logPort" />
    </FormGroup>
    <FormGroup
      label="Control port"
      helperText="Port that Runtime should bind to for receiving controller (gamepad) inputs."
    >
      <NumericInput {...portInputOptions} path="runtime.addressing.controlPort" />
    </FormGroup>
    <FormGroup
      label="Update port"
      helperText="Port that Runtime should connect to for publishing Smart Device updates."
    >
      <NumericInput {...portInputOptions} path="runtime.addressing.updatePort" />
    </FormGroup>
    <FormGroup
      label="VSD port"
      helperText="Port that Runtime should bind to for serving Virtual Smart Devices (VSDs)."
    >
      <NumericInput {...portInputOptions} path="runtime.addressing.vsdPort" />
    </FormGroup>
  </>
);

const LOG_LEVELS = [
  { id: LogLevel.DEBUG, display: 'Debug' },
  { id: LogLevel.INFO, display: 'Info' },
  { id: LogLevel.WARNING, display: 'Warning' },
  { id: LogLevel.ERROR, display: 'Error' },
  { id: LogLevel.CRITICAL, display: 'Critical' },
];

const MonitoringSettings = () => (
  <>
    <FormGroup
      label="Health check interval"
      labelInfo="(in seconds)"
      helperText="Duration between status reports sent by Runtime."
    >
      <NumericInput
        leftIcon={IconNames.PULSE}
        min={10}
        max={300}
        minorStepSize={1}
        stepSize={5}
        majorStepSize={15}
        path="runtime.monitoring.healthCheckInterval"
      />
    </FormGroup>
    <FormGroup
      label="Log level"
      helperText="Minimum severity of messages Runtime should log."
    >
      <Select options={LOG_LEVELS} path="runtime.monitoring.logLevel" />
    </FormGroup>
    <Switch path="runtime.monitoring.debug" label="Enable debug mode" />
  </>
);

// TODO: better validation
// TODO: manual override of env vars
export default function RuntimeSettings(props) {
  const deviceNames = useAppSelector((state) => state.settings.runtime.deviceNames);
  return (
    <>
      <FormGroup
        label="Host"
        labelInfo="(required)"
        helperText="Either an IP address or a domain name for Dawn to connect to."
      >
        <TextInput
          id="ip-addr"
          monospace
          path="runtime.host"
          leftIcon={IconNames.IP_ADDRESS}
          placeholder="Example: 192.168.1.1"
          validate={validateNonempty}
        />
      </FormGroup>
      <FormGroup
        label="Update"
        helperText="Check for updates or upload a file containing the update."
      >
      </FormGroup>
      <FormGroup
        label="Device names"
        helperText="Human-readable names for Smart Devices."
      >
        <EntityTable
          path="runtime.deviceNames"
          headings={['Name', 'UID']}
          default={['', '']}
          render={([name, uid], update) => [
            <EditableText
              alwaysRenderInput
              className="monospace"
              maxLength={32}
              defaultValue={name}
              onConfirm={(value) => update([value, uid])}
              placeholder="Example: left-motor"
            />,
            <EditableText
              alwaysRenderInput
              className="monospace"
              maxLength={32}
              defaultValue={uid}
              onConfirm={(value) => update([name, value])}
              placeholder="Example: 56668397794435742564352"
            />,
          ]}
        />
      </FormGroup>
      <Callout intent={Intent.WARNING}>
        <p>
          Do not modify the advanced settings below unless you have checked with PiE staff!
          Modifying these settings is unlikely to solve common issues.
          Improperly configured settings may break some features or corrupt robot data.
        </p>
        <p>Some changes may not take effect until Runtime restarts!</p>
      </Callout>
      <Tabs vertical className="sep">
        <Tab id="admin" title="Administration" panel={<AdminSettings />} />
        <Tab id="perf" title="Performance" panel={<PerformanceSettings />} />
        <Tab id="address" title="Addresses" panel={<AddressSettings />} />
        <Tab id="monitoring" title="Monitoring" panel={<MonitoringSettings />} />
      </Tabs>
      <FormGroup
        label="Other Options"
        helperText="Other raw Runtime options passed through environment variables."
      >
        <EntityTable
          path="runtime.options"
          headings={['Option', 'Value']}
          default={['', '']}
          render={([option, value], update) => [
            <EditableText
              alwaysRenderInput
              className="monospace"
              maxLength={32}
              defaultValue={option}
              onConfirm={(text) => update([text, value])}
              placeholder="Example: log_level"
            />,
            <EditableText
              alwaysRenderInput
              className="monospace"
              maxLength={64}
              defaultValue={value}
              onConfirm={(text) => update([option, text])}
            />,
          ]}
        />
      </FormGroup>
    </>
  );
};
