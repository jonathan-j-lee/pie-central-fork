import * as React from 'react';
import {
  Button,
  Callout,
  Classes,
  Collapse,
  Dialog,
  H4,
  HTMLSelect,
  FormGroup,
  Icon,
  InputGroup,
  Intent,
  NumericInput,
  Radio,
  RadioGroup,
  Switch,
  Tab,
  Tabs,
  TextArea,
  Tooltip,
} from '@blueprintjs/core';
import { IconNames } from '@blueprintjs/icons';
import { useAppDispatch, useAppSelector } from '../hooks';
import { EditorTheme, getThemeClass } from '../store/editor';
import { OutcomeButton, reportOutcome } from './Util';
import { selectSettings, importSettings } from '../store';
import editor from '../store/editor';
import log from '../store/log';
import robot from '../store/robot';

// FIXME: reduce spurious redux actions (onChange -> onBlur)

const EditorSettings = () => {
  const editorSettings = useAppSelector(state => state.editor);
  const dispatch = useAppDispatch();
  return (
    <div className={Classes.TEXT_LARGE}>
      <RadioGroup
        inline
        label="Editor Theme"
        selectedValue={editorSettings.editorTheme}
        onChange={event => dispatch(editor.actions.setEditorTheme(event.currentTarget.value))}
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
          onValueChange={size => dispatch(editor.actions.setFontSize(size))}
          leftIcon={IconNames.ZOOM_IN}
          min={10}
          max={100}
          clampValueOnBlur
        />
      </FormGroup>
      <FormGroup label="Tab Size">
        <NumericInput
          value={editorSettings.tabSize}
          onValueChange={size => dispatch(editor.actions.setTabSize(size))}
          leftIcon={IconNames.ZOOM_IN}
          min={1}
          max={32}
          clampValueOnBlur
        />
      </FormGroup>
      <FormGroup label="Syntax Theme">
        <HTMLSelect
          value={editorSettings.syntaxTheme}
          onChange={event => dispatch(editor.actions.setSyntaxTheme(event.currentTarget.value))}
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
      <Switch
        large
        checked={editorSettings.syntaxHighlighting}
        label="Enable syntax highlighting"
        onChange={() => dispatch(editor.actions.toggle('syntaxHighlighting'))}
      />
      <Switch
        large
        checked={editorSettings.lineNumbers}
        label="Show line numbers"
        onChange={() => dispatch(editor.actions.toggle('lineNumbers'))}
      />
      <Switch
        large
        checked={editorSettings.longLineMarker}
        label="Show long line marker"
        onChange={() => dispatch(editor.actions.toggle('longLineMarker'))}
      />
      <Switch
        large
        checked={editorSettings.highlightLine}
        label="Highlight current line"
        onChange={() => dispatch(editor.actions.toggle('highlightLine'))}
      />
      <Switch
        large
        checked={editorSettings.wrapLines}
        label="Wrap long lines"
        onChange={() => dispatch(editor.actions.toggle('wrapLines'))}
      />
      <Switch
        large
        checked={editorSettings.basicAutocompletion}
        label="Enable basic autocompletion"
        onChange={() => dispatch(editor.actions.toggle('basicAutocompletion'))}
      />
      <Switch
        large
        checked={editorSettings.liveAutocompletion}
        label="Enable live autocompletion"
        onChange={() => dispatch(editor.actions.toggle('liveAutocompletion'))}
      />
      <Switch
        large
        checked={editorSettings.appendNewline}
        label="Append a newline character when saving"
        onChange={() => dispatch(editor.actions.toggle('appendNewline'))}
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

const AdvancedRuntimeSettings = (props) => {
  const dispatch = useAppDispatch();
  const robotState = useAppSelector(state => state.robot);
  const [showPassword, setShowPassword] = React.useState(false);
  return (
    <Collapse isOpen={props.isOpen}>
      <Callout intent={Intent.WARNING} className="sep">
        <p>
          Do not modify the advanced settings unless you know exactly what you are doing!
          Improperly configured settings may break some features or corrupt robot data.
        </p>
        <p>
          Modifying these settings is unlikely to solve common issues.
          We recommend checking with PiE staff before doing so.
        </p>
      </Callout>
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
          leftIcon={IconNames.FOLDER_OPEN}
          placeholder="Example: ~/studentcode.py"
          defaultValue={robotState.remotePath}
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
          leftIcon={IconNames.APPLICATION}
          placeholder="Example: systemctl restart runtime.service"
          defaultValue={robotState.restartCommand}
          onBlur={(event) => dispatch(robot.actions.updateSettings({
            restartCommand: event.currentTarget.value,
          }))}
        />
      </FormGroup>
      <H4>Credentials</H4>
      <FormGroup
        label="User"
        labelInfo="(required)"
        helperText="Username"
      >
        <InputGroup
          className="monospace"
          leftIcon={IconNames.USER}
          placeholder="Example: pioneers"
          defaultValue={robotState.credentials.username}
          onBlur={(event) => dispatch(robot.actions.updateSettings({
            credentials: { username: event.currentTarget.value },
          }))}
        />
      </FormGroup>
      <FormGroup
        label="Password"
        labelInfo=""
        helperText=""
      >
        <InputGroup
          className="monospace"
          leftIcon={IconNames.USER}
          rightElement={<PasswordLockButton
            show={showPassword}
            toggleShow={() => setShowPassword(!showPassword)}
          />}
          type={showPassword ? 'text' : 'password'}
          defaultValue={robotState.credentials.password}
          onBlur={(event) => dispatch(robot.actions.updateSettings({
            credentials: { password: event.currentTarget.value },
          }))}
        />
      </FormGroup>
      <FormGroup
        label="RSA Private Key"
        labelInfo=""
        helperText=""
      >
        <TextArea
          fill
          growVertically
          small
          spellCheck="false"
          className="monospace private-key"
          defaultValue={robotState.credentials.privateKey}
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
    </Collapse>
  );
};

const RobotSettings = () => {
  const dispatch = useAppDispatch();
  const { host } = useAppSelector(state => state.robot);
  const [showAdvanced, setShowAdvanced] = React.useState(false);
  return (
    <div>
      <FormGroup
        label="Hostname"
        labelInfo="(required)"
        helperText="Provide either an IP address or a domain name."
      >
        <InputGroup
          className="monospace"
          leftIcon={IconNames.IP_ADDRESS}
          placeholder="Example: 192.168.1.100"
          defaultValue={host}
          onChange={event => dispatch(robot.actions.updateSettings({
            host: event.currentTarget.value,
          }))}
        />
      </FormGroup>
      <FormGroup label="Log level" helperText="Set">
        <HTMLSelect>
          <option>Debug</option>
          <option>Info</option>
          <option>Warning</option>
          <option>Error</option>
          <option>Critical</option>
        </HTMLSelect>
      </FormGroup>
      <Button
        onClick={() => setShowAdvanced(!showAdvanced)}
        icon={showAdvanced ? IconNames.CHEVRON_UP : IconNames.CHEVRON_DOWN}
        text={`${showAdvanced ? 'Hide' : 'Show'} Advanced Settings`}
      />
      <AdvancedRuntimeSettings isOpen={showAdvanced} />
      <Callout intent={Intent.WARNING} className="sep">
        <p>Some changes may not take effect until Runtime restarts!</p>
      </Callout>
    </div>
  );
};

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
          stepSize={1}
          value={maxEvents}
          onValueChange={value => setMaxEvents(value)}
          onBlur={() => dispatch(log.actions.truncate(maxEvents))}
        />
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
        label="Show error tracebacks"
        onChange={() => dispatch(log.actions.toggle('showTraceback'))}
      />
    </div>
  );
};

export default function Settings(props) {
  const editorTheme = useAppSelector(state => state.editor.editorTheme);
  const dispatch = useAppDispatch();
  const settings = useAppSelector(selectSettings);
  const [oldSettings, setOldSettings] = React.useState({});
  const revert = () => {
    props.close();
    reportOutcome(
      dispatch(importSettings(oldSettings)).unwrap(),
      'Successfully reverted settings.',
      'Failed to revert settings.',
    );
  };
  return (
    <Dialog
      isOpen={props.isOpen}
      onOpened={() => setOldSettings(settings)}
      onClose={revert}
      className={`settings ${getThemeClass(editorTheme)}`}
      title="Settings"
    >
      <div className={Classes.DIALOG_BODY}>
        <Tabs defaultSelectedTabId="robot" large>
          <Tab id="robot" title="Robot" panel={<RobotSettings />} />
          <Tab id="editor" title="Editor" panel={<EditorSettings />} />
          <Tab id="console" title="Console" panel={<LogSettings />} />
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
              window.ipc.invoke('save-settings', settings)
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
