import * as React from 'react';
import {
  Button,
  Callout,
  Classes,
  Collapse,
  Dialog,
  EditableText,
  H3,
  HTMLSelect,
  HTMLTable,
  FormGroup,
  Icon,
  InputGroup,
  Intent,
  NumericInput,
  Radio,
  RadioGroup,
  Slider,
  Switch,
  Tab,
  Tabs,
  TextArea,
  Tooltip,
} from '@blueprintjs/core';
import { useStore } from 'react-redux';
import { IconNames } from '@blueprintjs/icons';
import { useAppDispatch, useAppSelector } from '../hooks';
import { OutcomeButton, reportOutcome, DeviceName } from './Util';
import { selectSettings, importSettings, exportSettings } from '../store';
import editorSlice, { EditorTheme, getThemeClass } from '../store/editor';
import keybindingsSlice, { bind, generateHotkeys } from '../store/keybindings';
import log, { Level, LogOpenCondition } from '../store/log';
import robot, {
  BAUD_RATES,
  deviceNameSelectors,
  execTimeoutSelectors,
} from '../store/robot';

const EditorSettings = () => {
  const editorSettings = useAppSelector(state => state.editor);
  const dispatch = useAppDispatch();
  return (
    <div className={Classes.TEXT_LARGE}>
      <RadioGroup
        inline
        label="Editor Theme"
        selectedValue={editorSettings.editorTheme}
        onChange={(event) =>
          dispatch(editorSlice.actions.set({ editorTheme: event.currentTarget.value }))
        }
      >
        <Radio value={EditorTheme.LIGHT}>
          <span><Icon icon={IconNames.FLASH} /> Light theme</span>
        </Radio>
        <Radio value={EditorTheme.DARK}>
          <span><Icon icon={IconNames.MOON} /> Dark theme</span>
        </Radio>
      </RadioGroup>
      <FormGroup label="Font Size">
        <NumericInput
          value={editorSettings.fontSize}
          onValueChange={(size) =>
            dispatch(editorSlice.actions.set({ fontSize: size }))
          }
          leftIcon={IconNames.ZOOM_IN}
          min={10}
          max={100}
          minorStepSize={null}
          clampValueOnBlur
        />
      </FormGroup>
      <FormGroup label="Tab Size">
        <NumericInput
          value={editorSettings.tabSize}
          onValueChange={(size) => dispatch(editorSlice.actions.set({ tabSize: size }))}
          leftIcon={IconNames.ZOOM_IN}
          min={1}
          max={32}
          minorStepSize={null}
          clampValueOnBlur
        />
      </FormGroup>
      <FormGroup label="Syntax Theme" className="form-group">
        <HTMLSelect
          value={editorSettings.syntaxTheme}
          onChange={(event) =>
            dispatch(editorSlice.actions.set({ syntaxTheme: event.currentTarget.value }))
          }
        >
          <option value="monokai">Monokai</option>
          <option value="github">GitHub</option>
          <option value="tomorrow">Tomorrow</option>
          <option value="kuroir">Kuroir</option>
          <option value="twilight">Twilight</option>
          <option value="xcode">XCode</option>
          <option value="textmate">TextMate</option>
          <option value="solarized_dark">Solarized Dark</option>
          <option value="solarized_light">Solarized Light</option>
          <option value="terminal">Terminal</option>
        </HTMLSelect>
      </FormGroup>
      <FormGroup label="File Encoding" className="form-group">
        <HTMLSelect
          value={editorSettings.encoding}
          onChange={(event) =>
            dispatch(editorSlice.actions.set({ encoding: event.currentTarget.value }))
          }
        >
          <option value="ascii">ASCII</option>
          <option value="utf8">UTF-8</option>
          <option value="utf16le">UTF-16 LE</option>
          <option value="latin1">Latin-1</option>
        </HTMLSelect>
      </FormGroup>
      <Switch
        large
        checked={editorSettings.syntaxHighlighting}
        label="Enable syntax highlighting"
        onChange={() => dispatch(editorSlice.actions.toggle('syntaxHighlighting'))}
      />
      <Switch
        large
        checked={editorSettings.lineNumbers}
        label="Show line numbers"
        onChange={() => dispatch(editorSlice.actions.toggle('lineNumbers'))}
      />
      <Switch
        large
        checked={editorSettings.longLineMarker}
        label="Show long line marker"
        onChange={() => dispatch(editorSlice.actions.toggle('longLineMarker'))}
      />
      <Switch
        large
        checked={editorSettings.highlightLine}
        label="Highlight current line"
        onChange={() => dispatch(editorSlice.actions.toggle('highlightLine'))}
      />
      <Switch
        large
        checked={editorSettings.wrapLines}
        label="Wrap long lines"
        onChange={() => dispatch(editorSlice.actions.toggle('wrapLines'))}
      />
      <Switch
        large
        checked={editorSettings.basicAutocompletion}
        label="Enable basic autocompletion"
        onChange={() => dispatch(editorSlice.actions.toggle('basicAutocompletion'))}
      />
      <Switch
        large
        checked={editorSettings.liveAutocompletion}
        label="Enable live autocompletion"
        onChange={() => dispatch(editorSlice.actions.toggle('liveAutocompletion'))}
      />
      <Switch
        large
        checked={editorSettings.appendNewline}
        label="Ensure file ends with newline when saving"
        onChange={() => dispatch(editorSlice.actions.toggle('appendNewline'))}
      />
      <Switch
        large
        checked={editorSettings.trimWhitespace}
        label="Remove trailing whitespace from each line"
        onChange={() => dispatch(editorSlice.actions.toggle('trimWhitespace'))}
      />
    </div>
  );
};

const PasswordLockButton = (props) => (
  <Tooltip content={<span>{props.show ? 'Hide' : 'Show'} password</span>}>
    <Button
      icon={props.show ? IconNames.UNLOCK : IconNames.LOCK}
      intent={Intent.WARNING}
      minimal
      onClick={() => props.toggleShow()}
    />
  </Tooltip>
);

function AdministrationForm() {
  const dispatch = useAppDispatch();
  const remotePath = useAppSelector(state => state.robot.remotePath);
  const restartCommand = useAppSelector(state => state.robot.restartCommand);
  const updateCommand = useAppSelector(state => state.robot.updateCommand);
  return (
    <>
      <FormGroup
        className="sep"
        label="Student code path"
        labelInfo="(required)"
        helperText={`
          Provide a path on the remote machine where student code is located.
          Paths are relative to the user's home directory.
          Shell substitution is disabled.
        `}
      >
        <InputGroup
          className="monospace"
          spellCheck={false}
          leftIcon={IconNames.FOLDER_OPEN}
          placeholder="Example: ~/studentcode.py"
          defaultValue={remotePath}
          onBlur={(event) => dispatch(robot.actions.updateSettings({
            remotePath: event.currentTarget.value,
          }))}
        />
      </FormGroup>
      <FormGroup
        label="Restart command"
        labelInfo="(required)"
        helperText="Provide a shell command to run to restart Runtime."
      >
        <InputGroup
          className="monospace"
          spellCheck={false}
          leftIcon={IconNames.APPLICATION}
          placeholder="Example: systemctl restart runtime.service"
          defaultValue={restartCommand}
          onBlur={(event) => dispatch(robot.actions.updateSettings({
            restartCommand: event.currentTarget.value,
          }))}
        />
      </FormGroup>
      <FormGroup
        label="Update command"
        helperText="Provide a shell command to run to update Runtime."
      >
        <InputGroup
          className="monospace"
          spellCheck={false}
          leftIcon={IconNames.APPLICATION}
          defaultValue={updateCommand}
          onBlur={(event) => dispatch(robot.actions.updateSettings({
            updateCommand: event.currentTarget.value,
          }))}
        />
      </FormGroup>
    </>
  );
}

function CredentialsForm() {
  const dispatch = useAppDispatch();
  const credentials = useAppSelector(state => state.robot.credentials);
  const [showPassword, setShowPassword] = React.useState(false);
  return (
    <>
      <FormGroup
        label="User"
        labelInfo="(required)"
        helperText="Username used to log into the remote machine over SSH."
      >
        <InputGroup
          className="monospace"
          spellCheck={false}
          leftIcon={IconNames.USER}
          placeholder="Example: pioneers"
          defaultValue={credentials.username}
          onBlur={(event) => dispatch(robot.actions.updateSettings({
            credentials: { username: event.currentTarget.value },
          }))}
        />
      </FormGroup>
      <FormGroup
        label="Password"
        helperText="Password of the user."
      >
        <InputGroup
          className="monospace"
          spellCheck={false}
          leftIcon={IconNames.KEY}
          rightElement={<PasswordLockButton
            show={showPassword}
            toggleShow={() => setShowPassword(!showPassword)}
          />}
          type={showPassword ? 'text' : 'password'}
          defaultValue={credentials.password}
          onBlur={(event) => dispatch(robot.actions.updateSettings({
            credentials: { password: event.currentTarget.value },
          }))}
        />
      </FormGroup>
      <FormGroup
        label="RSA Private Key"
        helperText="Private key linked to an SSH-authorized public key."
      >
        <TextArea
          fill
          growVertically
          small
          spellCheck="false"
          className="monospace private-key"
          defaultValue={credentials.privateKey}
          placeholder={[
            '-----BEGIN RSA PRIVATE KEY-----',
            '...',
            '-----END RSA PRIVATE KEY-----',
          ].join('\n')}
          onBlur={(event) => dispatch(robot.actions.updateSettings({
            credentials: { privateKey: event.currentTarget.value },
          }))}
        />
      </FormGroup>
    </>
  );
}

function UpdatingSlider(props) {
  const [value, setValue] = React.useState(props.defaultValue);
  return <Slider className="slider" {...props} value={value} onChange={(value) => setValue(value)} />;
}

function EntityTable(props) {
  const render = props.render ?? ((row) => []);
  return (
    <>
      <HTMLTable striped className="dynamic-table">
        <thead>
          <tr>
            <td></td>
            {props.headings.map((heading, index) => <td key={index}>{heading}</td>)}
          </tr>
        </thead>
        <tbody>
          {props.rows.length > 0 ? props.rows.map((row, rowIndex) => <tr key={rowIndex}>
            <td>
              <Button
                minimal
                intent={Intent.DANGER}
                icon={IconNames.DELETE}
                onClick={() => props.removeRow(row)}
              />
            </td>
            {render(row).map((cell, cellIndex) =>
              <td key={cellIndex}>{cell}</td>
            )}
          </tr>) : <tr>
            <td colSpan={100} className="empty-row">{props.emptyMessage ?? 'No items'}</td>
          </tr>}
        </tbody>
      </HTMLTable>
      <Button
        className="sep"
        intent={Intent.SUCCESS}
        icon={IconNames.ADD}
        text={props.addLabel ?? "Add row"}
        onClick={() => props.addRow()}
      />
    </>
  );
}

function PerformanceForm() {
  const dispatch = useAppDispatch();
  const robotState = useAppSelector(state => state.robot);
  // FIXME: update permits duplicate ID
  return (
    <>
      <FormGroup
        label="Thread Pool Max Workers"
        helperText={`
          Each process uses a thread pool to perform blocking I/O or compute-bound
          tasks. This slider sets the maximum number of OS threads to spawn per process.
          Using too few workers will make Runtime unresponsive as the pool's task queue
          fills up.
        `}
      >
        <UpdatingSlider
          min={1}
          max={8}
          defaultValue={robotState.threadPoolWorkers}
          onRelease={(threadPoolWorkers) =>
            dispatch(robot.actions.updateSettings({ threadPoolWorkers }))
          }
        />
      </FormGroup>
      <FormGroup
        label="Service Workers"
        helperText={`
          Set the maximum number of requests each service can handle concurrently.
        `}
      >
        <UpdatingSlider
          min={1}
          max={8}
          defaultValue={robotState.serviceWorkers}
          onRelease={(serviceWorkers) =>
            dispatch(robot.actions.updateSettings({ serviceWorkers }))
          }
        />
      </FormGroup>
      <FormGroup
        label="Device update interval"
        labelInfo="(in seconds)"
        helperText="Duration between Smart Device updates from Runtime."
      >
        <UpdatingSlider
          min={0}
          max={0.25}
          stepSize={0.005}
          labelStepSize={0.05}
          defaultValue={robotState.updateInterval}
          onRelease={(value) => dispatch(robot.actions.updateSettings({
            updateInterval: value,
          }))}
        />
      </FormGroup>
      <FormGroup
        label="Device polling interval"
        labelInfo="(in seconds)"
        helperText="Duration between data writes by Runtime to Smart Devices."
      >
        <UpdatingSlider
          min={0}
          max={0.25}
          stepSize={0.005}
          labelStepSize={0.05}
          defaultValue={robotState.pollingInterval}
          onRelease={(value) => dispatch(robot.actions.updateSettings({
            pollingInterval: value,
          }))}
        />
      </FormGroup>
      <FormGroup
        label="Gamepad update interval"
        labelInfo="(in seconds)"
        helperText="Duration between Gamepad updates from Dawn."
      >
        <UpdatingSlider
          min={0}
          max={0.25}
          stepSize={0.005}
          labelStepSize={0.05}
          defaultValue={robotState.controlInterval}
          onRelease={(value) => dispatch(robot.actions.updateSettings({
            controlInterval: value,
          }))}
        />
      </FormGroup>
      <FormGroup
        label="Baud rate"
        helperText={`
          Smart Device Baud rate, which specifies how quickly data is communicated
          over USB serial.
        `}
      >
        <HTMLSelect
          value={robotState.baudRate}
          onChange={(event) => dispatch(robot.actions.updateSettings({
            baudRate: Number(event.currentTarget.value),
          }))}
        >
          {BAUD_RATES.map((rate, index) =>
            <option key={index} value={rate}>{rate}</option>)
          }
        </HTMLSelect>
      </FormGroup>
      <FormGroup
        label="Execution timeouts"
      >
        <EntityTable
          headings={['Function Name Pattern', 'Duration']}
          rows={execTimeoutSelectors.selectAll(robotState.execTimeouts)}
          addRow={() => dispatch(robot.actions.upsertExecTimeout({
            pattern: '',
            duration: 0.05,
          }))}
          removeRow={(timeout) => dispatch(robot.actions.removeExecTimeout(timeout.pattern))}
          render={(timeout) => [
            <EditableText
              alwaysRenderInput
              placeholder="Regular expression"
              maxLength={32}
              value={timeout.pattern}
              className="monospace"
              onChange={(pattern) => dispatch(robot.actions.updateExecTimeout({
                id: timeout.pattern,
                changes: { pattern },
              }))}
            />,
            <NumericInput
              min={0}
              max={30}
              minorStepSize={0.01}
              stepSize={0.05}
              majorStepSize={0.1}
              clampValueOnBlur
              leftIcon={IconNames.STOPWATCH}
              value={timeout.duration}
              onValueChange={(duration) => dispatch(robot.actions.updateExecTimeout({
                id: timeout.pattern,
                changes: { duration },
              }))}
            />,
          ]}
        />
      </FormGroup>
    </>
  );
}

function AddressingForm() {
  const dispatch = useAppDispatch();
  const robotState = useAppSelector(state => state.robot);
  const portConfigs = [
    {
      name: 'callPort',
      label: 'Remote call port',
      description: 'Port that Runtime should bind to for accepting remote calls.',
    },
    {
      name: 'logPort',
      label: 'Log publisher port',
      description: 'Port that Runtime should bind to for publishing logged events.',
    },
    {
      name: 'controlPort',
      label: 'Control port',
      description: 'Port that Runtime should bind to for receiving controller (gamepad) inputs',
    },
    {
      name: 'updatePort',
      label: 'Update port',
      description: 'Port that Runtime should connect to for publishing Smart Device updates.',
    },
    {
      name: 'vsdPort',
      label: 'VSD Port',
      description: 'Port that Runtime should bind to for serving Virtual Smart Devices (VSDs).',
    },
  ];
  return (
    <>
      <FormGroup
        label="Multicast Group"
        helperText="IP multicast group Runtime uses to broadcast Smart Device updates."
      >
        <InputGroup
          className="monospace"
          leftIcon={IconNames.IP_ADDRESS}
          placeholder="Example: 224.1.1.1"
          defaultValue={robotState.multicastGroup}
          onBlur={(event) => dispatch(robot.actions.updateSettings({
            multicastGroup: event.currentTarget.value,
          }))}
        />
      </FormGroup>
      {portConfigs.map((port, index) =>
        <FormGroup
          key={index}
          label={port.label}
          helperText={port.description}
        >
          <NumericInput
            clampValueOnBlur
            leftIcon={IconNames.FLOW_END}
            min={1}
            max={65535}
            minorStepSize={null}
            value={robotState.ports[port.name]}
            onValueChange={(value) => dispatch(robot.actions.updateSettings({
              ports: { [port.name]: value },
            }))}
          />
        </FormGroup>
      )}
    </>
  );
}

function MonitoringForm() {
  const dispatch = useAppDispatch();
  const robotState = useAppSelector(state => state.robot);
  return (
    <>
      <FormGroup
        label="Health Check Interval"
        helperText="The number of seconds between status reports sent by Runtime."
      >
        <NumericInput
          clampValueOnBlur
          leftIcon={IconNames.PULSE}
          min={10}
          max={300}
          minorStepSize={1}
          stepSize={5}
          majorStepSize={15}
          value={robotState.healthCheckInterval}
          onValueChange={(healthCheckInterval) =>
            dispatch(robot.actions.updateSettings({ healthCheckInterval }))
          }
        />
      </FormGroup>
      <FormGroup
        label="Log level"
        helperText="Minimum severity of messages Runtime should log."
        className="form-group"
      >
        <HTMLSelect
          value={robotState.logLevel}
          onChange={(event) => dispatch(robot.actions.updateSettings({
            logLevel: event.currentTarget.value,
          }))}
        >
          <option value={Level.DEBUG}>Debug</option>
          <option value={Level.INFO}>Info</option>
          <option value={Level.WARNING}>Warning</option>
          <option value={Level.ERROR}>Error</option>
          <option value={Level.CRITICAL}>Critical</option>
        </HTMLSelect>
      </FormGroup>
      <Switch
        large
        className="sep"
        checked={robotState.debug}
        label="Debug event loop and other resources"
        onChange={() => dispatch(robot.actions.toggle('debug'))}
      />
    </>
  );
}

// TODO: better validation
function RobotSettings() {
  const dispatch = useAppDispatch();
  const robotState = useAppSelector(state => state.robot);
  // FIXME: should dispatch on confirm, not on change
  return (
    <>
      <FormGroup
        label="Hostname"
        labelInfo="(required)"
        helperText="Provide either an IP address or a domain name."
      >
        <InputGroup
          id="ip-addr"
          className="monospace"
          leftIcon={IconNames.IP_ADDRESS}
          placeholder="Example: 192.168.1.100"
          defaultValue={robotState.host}
          onBlur={event => dispatch(robot.actions.updateSettings({
            host: event.currentTarget.value,
          }))}
        />
      </FormGroup>
      <FormGroup
        label="Update"
        helperText="Check for updates or upload a file containing the update."
      >
      </FormGroup>
      <FormGroup
        label="Device names"
        helperText="Provide human-readable aliases for Smart Device UIDs."
      >
        <EntityTable
          headings={['UID', 'Device Name']}
          rows={deviceNameSelectors.selectAll(robotState.deviceNames)}
          addRow={() => dispatch(robot.actions.upsertDeviceName({ alias: '', uid: '' }))}
          removeRow={(name) => dispatch(robot.actions.removeDeviceName(name.alias))}
          render={(name) => [
            <DeviceName
              value={name.alias}
              className="monospace"
              onChange={(alias) => dispatch(robot.actions.updateDeviceName({
                id: name.alias,
                changes: { alias },
              }))}
            />,
            <EditableText
              alwaysRenderInput
              placeholder="Assign a UID"
              maxLength={32}
              value={name.uid}
              className="monospace"
              onChange={(uid) => dispatch(robot.actions.updateDeviceName({
                id: name.alias,
                changes: { uid },
              }))}
            />
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
        <Tab id="administration" title="Administration" panel={<AdministrationForm />} />
        <Tab id="credentials" title="Credentials" panel={<CredentialsForm />} />
        <Tab id="performance" title="Performance" panel={<PerformanceForm />} />
        <Tab id="addressing" title="Addressing" panel={<AddressingForm />} />
        <Tab id="monitoring" title="Monitoring" panel={<MonitoringForm />} />
      </Tabs>
    </>
  );
}

const LogSettings = () => {
  const settings = useAppSelector(state => state.log);
  const dispatch = useAppDispatch();
  const [maxEvents, setMaxEvents] = React.useState(settings.maxEvents);
  return (
    <div className={Classes.TEXT_LARGE}>
      <FormGroup
        label="Max lines"
        helperText="Truncate the console output to this many lines."
      >
        <NumericInput
          clampValueOnBlur
          placeholder="Number of lines"
          min={0}
          max={1024}
          minorStepSize={null}
          value={maxEvents}
          onValueChange={value => setMaxEvents(value)}
          onBlur={() => dispatch(log.actions.truncate(maxEvents))}
        />
      </FormGroup>
      <FormGroup
        label="Open console automatically ..."
        className="form-group"
      >
        <HTMLSelect
          value={settings.openCondition}
          onChange={event => dispatch(log.actions.set({
            openCondition: event.currentTarget.value,
          }))}
        >
          <option value={LogOpenCondition.START}>On start</option>
          <option value={LogOpenCondition.ERROR}>On error</option>
          <option value={LogOpenCondition.NEVER}>Never</option>
        </HTMLSelect>
      </FormGroup>
      <Switch
        large
        checked={settings.showSystem}
        labelElement={
          <Tooltip
            className={Classes.TOOLTIP_INDICATOR}
            content={<p className="tooltip-content">
              If disabled, the console will only show the output of your print statements.
              If enabled, the console will also show messages generated by Runtime itself,
              which can help staff debug your robot.
            </p>}
          >
            Show system events
          </Tooltip>
        }
        onChange={() => dispatch(log.actions.toggle('showSystem'))}
      />
      <Switch
        large
        checked={settings.showTimestamps}
        label="Show timestamps"
        onChange={() => dispatch(log.actions.toggle('showTimestamps'))}
      />
      <Switch
        large
        checked={settings.showSeverity}
        label="Show event severity"
        onChange={() => dispatch(log.actions.toggle('showSeverity'))}
      />
      <Switch
        large
        checked={settings.showTraceback}
        labelElement={
          <Tooltip
            className={Classes.TOOLTIP_INDICATOR}
            content={<p className="tooltip-content">
              A Python traceback shows the functions and line numbers where an error occurred.
              Tracebacks are useful for debugging Runtime but can be difficult to read.
            </p>}
          >
            Show error tracebacks
          </Tooltip>
        }
        onChange={() => dispatch(log.actions.toggle('showTraceback'))}
      />
      <Switch
        large
        checked={settings.pinToBottom}
        labelElement={
          <Tooltip
            className={Classes.TOOLTIP_INDICATOR}
            content={<p className="tooltip-content">
              Follow the most recent events automatically without having to scroll.
            </p>}
          >
            Pin to bottom
          </Tooltip>
        }
        onChange={() => dispatch(log.actions.toggle('pinToBottom'))}
      />
    </div>
  );
};

/**
 *  Up-front validation is not ideal because it's hard to get right. However, we cannot
 *  catch errors from the ``useHotkeys`` hook when the user provides a bad keybinding.
 */
function KeybindingsSettings(props) {
  const dispatch = useAppDispatch();
  const keybindings = useAppSelector(state => state.keybindings);
  return (
    <>
      <p>
        Each shortcut should be a list of keys separated by the <kbd>+</kbd> character.
        For example: <code>Ctrl+Shift+Alt+Backspace</code>.
        An invalid keybinding will not trigger the desired action.
      </p>
      <p>You can view your keyboard shortcuts by pressing <kbd>?</kbd>.</p>
      <HTMLTable className="keybindings" striped>
        <thead>
          <tr>
            <th>Group</th>
            <th>Command</th>
            <th>Combination</th>
          </tr>
        </thead>
        <tbody>
          {generateHotkeys(keybindings, props.editor).map((hotkey, index) =>
            <tr key={index}>
              <td>{hotkey.group}</td>
              <td>{hotkey.label}</td>
              <td>
                <EditableText
                  className="keybinding"
                  defaultValue={hotkey.combo}
                  onConfirm={(combo) => reportOutcome(
                    dispatch(bind({
                      groupId: hotkey.groupId,
                      commandId: hotkey.commandId,
                      platform: props.editor.commands.platform,
                      combo,
                    })).unwrap(),
                    null,
                    `Invalid shortcut for "${hotkey.label}".`,
                  )}
                />
              </td>
            </tr>
          )}
        </tbody>
      </HTMLTable>
    </>
  );
}

export default function Settings(props) {
  const dispatch = useAppDispatch();
  const editorTheme = useAppSelector(state => state.editor.editorTheme);
  const store = useStore();
  const [oldSettings, setOldSettings] = React.useState({});
  const revert = () => {
    props.close();
    dispatch(importSettings(oldSettings)).unwrap();
  };
  return (
    <Dialog
      isOpen={props.isOpen}
      onOpened={() => setOldSettings(selectSettings(store.getState()))}
      onClose={revert}
      className={`settings ${getThemeClass(editorTheme)}`}
      title="Settings"
    >
      <div className={Classes.DIALOG_BODY}>
        <Tabs defaultSelectedTabId="robot" large>
          <Tab id="robot" title="Robot" panel={<RobotSettings />} />
          <Tab id="editor" title="Editor" panel={<EditorSettings />} />
          <Tab id="console" title="Console" panel={<LogSettings />} />
          <Tab
            id="keybindings"
            title="Keyboard Shortcuts"
            panel={<KeybindingsSettings editor={props.editor} />}
          />
        </Tabs>
      </div>
      <div className={Classes.DIALOG_FOOTER}>
        <div className={Classes.DIALOG_FOOTER_ACTIONS}>
          <Button
            icon={IconNames.RESET}
            text="Reset Defaults"
            intent={Intent.DANGER}
            onClick={revert}
          />
          <Button
            icon={IconNames.CROSS}
            text="Cancel"
            onClick={revert}
          />
          <OutcomeButton
            icon={IconNames.CONFIRM}
            text="Confirm"
            intent={Intent.SUCCESS}
            onClick={() => reportOutcome(
              dispatch(exportSettings())
                .finally(() => props.close()),
              'Successfully saved settings.',
              'Failed to save settings.',
            )}
          />
        </div>
      </div>
    </Dialog>
  );
};
