import * as React from 'react';
import {
  Button,
  Classes,
  Dialog,
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
  Tooltip,
} from '@blueprintjs/core';
import { IconNames } from '@blueprintjs/icons';
import { useAppDispatch, useAppSelector } from '../hooks';
import { EditorTheme, getThemeClass } from '../store/editor';
import { OutcomeButton, reportOutcome } from './Util';
import editor from '../store/editor';
import log from '../store/log';

const EditorSettings = () => {
  const editorSettings = useAppSelector(state => state.editor);
  const dispatch = useAppDispatch();
  return (
    <div>
      <RadioGroup
        label="Editor Theme"
        selectedValue={editorSettings.editorTheme}
        onChange={event => dispatch(editor.actions.setEditorTheme(event.currentTarget.value))}
        className={Classes.TEXT_LARGE}
      >
        <Radio value={EditorTheme.LIGHT}>
          <span><Icon icon={IconNames.FLASH} /> Light theme</span>
        </Radio>
        <Radio value={EditorTheme.DARK}>
          <span><Icon icon={IconNames.MOON} /> Dark theme</span>
        </Radio>
      </RadioGroup>
      <FormGroup label="Font Size" className={Classes.TEXT_LARGE}>
        <NumericInput
          value={editorSettings.fontSize}
          onValueChange={size => dispatch(editor.actions.setFontSize(size))}
          leftIcon={IconNames.ZOOM_IN}
          min={10}
          max={100}
          clampValueOnBlur
        />
      </FormGroup>
      <FormGroup label="Tab Size" className={Classes.TEXT_LARGE}>
        <NumericInput
          value={editorSettings.tabSize}
          onValueChange={size => dispatch(editor.actions.setTabSize(size))}
          leftIcon={IconNames.ZOOM_IN}
          min={1}
          max={32}
          clampValueOnBlur
        />
      </FormGroup>
      <FormGroup label="Syntax Theme" className={Classes.TEXT_LARGE}>
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
        onChange={() => dispatch(editor.actions.toggleSyntaxHighlighting())}
      />
      <Switch
        large
        checked={editorSettings.lineNumbers}
        label="Show line numbers"
        onChange={() => dispatch(editor.actions.toggleLineNumbers())}
      />
      <Switch
        large
        checked={editorSettings.longLineMarker}
        label="Show long line marker"
        onChange={() => dispatch(editor.actions.toggleLongLineMarker())}
      />
      <Switch
        large
        checked={editorSettings.highlightLine}
        label="Highlight current line"
        onChange={() => dispatch(editor.actions.toggleHighlightLine())}
      />
      <Switch
        large
        checked={editorSettings.wrapLines}
        label="Wrap long lines"
        onChange={() => dispatch(editor.actions.toggleWrapLines())}
      />
      <Switch
        large
        checked={editorSettings.basicAutocompletion}
        label="Enable basic autocompletion"
        onChange={() => dispatch(editor.actions.toggleBasicAutocompletion())}
      />
      <Switch
        large
        checked={editorSettings.liveAutocompletion}
        label="Enable live autocompletion"
        onChange={() => dispatch(editor.actions.toggleLiveAutocompletion())}
      />
      <Switch
        large
        checked={editorSettings.appendNewline}
        label="Append a newline character when saving"
        onChange={() => dispatch(editor.actions.toggleAppendNewline())}
      />
    </div>
  );
};

const RobotSettings = props => {
  const dispatch = useAppDispatch();
  const [address, setAddress] = React.useState('');
  return (
    <div>
      <FormGroup
        inline
        label="Hostname"
        labelInfo="(required)"
        helperText="Provide either an IP address or a domain name."
      >
        <InputGroup
          leftIcon={IconNames.IP_ADDRESS}
          placeholder="Example: 192.168.1.100"
          value={address}
          onChange={event => setAddress(event.currentTarget.value)}
        />
      </FormGroup>
      <FormGroup inline label="Log level" helperText="Set">
        <HTMLSelect>
          <option>Debug</option>
          <option>Info</option>
          <option>Warning</option>
          <option>Error</option>
          <option>Critical</option>
        </HTMLSelect>
      </FormGroup>
      <p>Some settings may not take effect until Runtime restarts!</p>
      <OutcomeButton
        icon={IconNames.CONFIRM}
        text="Confirm"
        intent={Intent.SUCCESS}
        onClick={() => reportOutcome(
          window.runtime.connect({}),
          'Robot settings confirmed.',
          'Failed to confirm settings. Are you connected to the robot?',
        )
          .finally(props.close)
        }
      />
    </div>
  );
};

const LogSettings = () => {
  const settings = useAppSelector(state => state.log);
  const dispatch = useAppDispatch();
  return (
    <div>
      <FormGroup
        inline
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
          value={settings.maxEvents}
          onValueChange={value => dispatch(log.actions.setMaxEvents(value))}
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
        onChange={() => dispatch(log.actions.toggleSystem())}
      />
      <Switch
        large
        checked={settings.showTimestamps}
        label="Show timestamps"
        onChange={() => dispatch(log.actions.toggleTimestamps())}
      />
      <Switch
        large
        checked={settings.showSeverity}
        label="Show event severity"
        onChange={() => dispatch(log.actions.toggleSeverity())}
      />
      <Switch
        large
        checked={settings.showTraceback}
        label="Show error tracebacks"
        onChange={() => dispatch(log.actions.toggleTraceback())}
      />
    </div>
  );
};

export default function Settings(props) {
  const editorTheme = useAppSelector(state => state.editor.editorTheme);
  const dispatch = useAppDispatch();
  return (
    <Dialog
      isOpen={props.isOpen}
      onClose={props.close}
      className={getThemeClass(editorTheme)}
      title="Settings"
    >
      <div className={Classes.DIALOG_BODY}>
        <Tabs defaultSelectedTabId="robot" large>
          <Tab id="robot" title="Robot" panel={<RobotSettings close={props.close} />} />
          <Tab id="editor" title="Editor" panel={<EditorSettings />} />
          <Tab id="console" title="Console" panel={<LogSettings />} />
        </Tabs>
      </div>
    </Dialog>
  );
};
