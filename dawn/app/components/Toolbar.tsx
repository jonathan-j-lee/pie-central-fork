import { useAppSelector } from '../hooks';
import { Mode } from '../store/runtime';
import { SettingsState } from '../store/settings';
import { COMMANDS } from './Settings/KeybindingSettings';
import Tour, { TOUR_IDLE_STEP } from './Tour';
import { platform } from './Util';
import {
  Button,
  ButtonGroup,
  Classes,
  ControlGroup,
  Dialog,
  H3,
  HTMLSelect,
  IconName,
  Intent,
  Popover,
  Menu,
  Navbar,
} from '@blueprintjs/core';
import { IconNames } from '@blueprintjs/icons';
import { Ace } from 'ace-builds/ace';
import * as React from 'react';

interface DawnPackageInfo {
  name: string;
  version: string;
  description: string;
  author: string;
  license: string;
  buildTimestamp: number;
}

declare const DAWN_PKG_INFO: DawnPackageInfo;

type Keybindings = SettingsState['keybindings'];

const selectCommand = (
  editor: Ace.Editor | undefined,
  keybindings: Keybindings,
  name: string
) => {
  const { label } = COMMANDS.find(({ command }) => command === name) ?? {};
  const keybinding = keybindings[name] ?? {};
  return {
    text: label,
    label: keybinding[platform].replace(/\s*[+-]\s*/g, () => ` + `),
    onClick: () => editor?.execCommand(name),
  };
};

interface MenuProps {
  editor?: Ace.Editor;
  keybindings: Keybindings;
}

const FileMenu = (props: MenuProps) => (
  <Menu id="file-menu">
    <Menu.Item
      icon={IconNames.DOCUMENT_SHARE}
      {...selectCommand(props.editor, props.keybindings, 'newFile')}
    />
    <Menu.Item
      icon={IconNames.DOCUMENT_OPEN}
      {...selectCommand(props.editor, props.keybindings, 'openFile')}
    />
    <Menu.Divider />
    <Menu.Item
      icon={IconNames.SAVED}
      {...selectCommand(props.editor, props.keybindings, 'saveFile')}
    />
    <Menu.Item
      icon={IconNames.SAVED}
      {...selectCommand(props.editor, props.keybindings, 'saveFileAs')}
    />
  </Menu>
);

const EditMenu = (props: MenuProps) => (
  <Menu>
    <Menu.Item
      icon={IconNames.CUT}
      {...selectCommand(props.editor, props.keybindings, 'cutText')}
    />
    <Menu.Item
      icon={IconNames.DUPLICATE}
      {...selectCommand(props.editor, props.keybindings, 'copyText')}
    />
    <Menu.Item
      icon={IconNames.CLIPBOARD}
      {...selectCommand(props.editor, props.keybindings, 'pasteText')}
    />
    <Menu.Divider />
    <Menu.Item
      icon={IconNames.UNDO}
      text="Undo"
      onClick={() => props.editor?.execCommand('undo')}
    />
    <Menu.Item
      icon={IconNames.REDO}
      text="Redo"
      onClick={() => props.editor?.execCommand('redo')}
    />
    <Menu.Divider />
    <Menu.Item
      icon={IconNames.SEARCH_TEXT}
      text="Find"
      onClick={() => props.editor?.execCommand('find')}
    />
    <Menu.Item
      icon={IconNames.EXCHANGE}
      text="Replace"
      onClick={() => props.editor?.execCommand('replace')}
    />
  </Menu>
);

const LogMenu = (props: MenuProps) => {
  const isOpen = useAppSelector((state) => state.log.open);
  let icon: IconName;
  let label;
  if (isOpen) {
    icon = IconNames.MENU_CLOSED;
    label = 'Close';
  } else {
    icon = IconNames.MENU_OPEN;
    label = 'Open';
  }
  return (
    <Menu id="log-menu">
      <Menu.Item
        icon={icon}
        {...selectCommand(props.editor, props.keybindings, 'toggleConsole')}
        text={label}
      />
      <Menu.Item
        icon={IconNames.DUPLICATE}
        {...selectCommand(props.editor, props.keybindings, 'copyConsole')}
      />
      <Menu.Item
        icon={IconNames.CLEAN}
        {...selectCommand(props.editor, props.keybindings, 'clearConsole')}
      />
    </Menu>
  );
};

const DebugMenu = (props: MenuProps) => (
  <Menu>
    <Menu.Item
      icon={IconNames.CODE}
      {...selectCommand(props.editor, props.keybindings, 'lint')}
    />
    <Menu.Item
      icon={IconNames.RESET}
      {...selectCommand(props.editor, props.keybindings, 'restart')}
    />
    <Menu.Item text="Motor check" icon={IconNames.COG} />
    <Menu.Item text="Statistics" icon={IconNames.TIMELINE_LINE_CHART} />
  </Menu>
);

interface HelpMenuProps {
  startTour: () => void;
  showAbout: () => void;
}

const HelpMenu = (props: HelpMenuProps) => (
  <Menu>
    <Menu.Item
      icon={IconNames.MAP_MARKER}
      text="Tour"
      onClick={() => props.startTour()}
    />
    <Menu.Item icon={IconNames.MANUAL} text="API Docs" />
    <Menu.Item
      icon={IconNames.LAB_TEST}
      text="About"
      onClick={() => props.showAbout()}
    />
  </Menu>
);

interface AboutDialogProps {
  isOpen: boolean;
  hide: () => void;
  transitionDuration?: number;
}

function AboutDialog(props: AboutDialogProps) {
  return (
    <Dialog
      isOpen={props.isOpen}
      icon={IconNames.INFO_SIGN}
      title="About"
      transitionDuration={props.transitionDuration}
      onClose={() => props.hide()}
      portalContainer={document.getElementById('app') ?? undefined}
    >
      <div className={Classes.DIALOG_BODY}>
        <H3>Dawn</H3>
        <p>
          Package info:{' '}
          <code>
            {DAWN_PKG_INFO.name} {DAWN_PKG_INFO.version}
          </code>
        </p>
        <p>
          Build timestamp: <code>{DAWN_PKG_INFO.buildTimestamp}</code>
        </p>
        <p>{DAWN_PKG_INFO.description}</p>
        <p>
          Licensed under {DAWN_PKG_INFO.license} by {DAWN_PKG_INFO.author}.
        </p>
      </div>
    </Dialog>
  );
}

interface ToolbarProps {
  editor?: Ace.Editor;
  openSettings: () => void;
  closeSettings: () => void;
  mode: Mode;
  setMode: (mode: Mode) => void;
  transitionDuration?: number;
}

export default function Toolbar(props: ToolbarProps) {
  const keybindings = useAppSelector((state) => state.settings.keybindings);
  const [stepIndex, setStepIndex] = React.useState(TOUR_IDLE_STEP);
  const [showAbout, setShowAbout] = React.useState(false);
  // TODO: ensure start/stop clears error flag
  // TODO: ensure estop works
  // TODO: add loading to upload/download
  return (
    <Navbar>
      <Tour {...props} stepIndex={stepIndex} setStepIndex={setStepIndex} />
      <AboutDialog isOpen={showAbout} hide={() => setShowAbout(false)} />
      <Navbar.Group>
        <Navbar.Heading>Dawn</Navbar.Heading>
        <Navbar.Divider />
        <ButtonGroup>
          <Popover
            content={<FileMenu editor={props.editor} keybindings={keybindings} />}
            transitionDuration={props.transitionDuration}
          >
            <Button
              id="file-btn"
              icon={IconNames.DOCUMENT}
              rightIcon={IconNames.CARET_DOWN}
              text="File"
            />
          </Popover>
          <Popover
            content={<EditMenu editor={props.editor} keybindings={keybindings} />}
            transitionDuration={props.transitionDuration}
          >
            <Button
              icon={IconNames.EDIT}
              rightIcon={IconNames.CARET_DOWN}
              text="Edit"
            />
          </Popover>
          <Button
            id="upload-btn"
            icon={IconNames.UPLOAD}
            {...selectCommand(props.editor, keybindings, 'uploadFile')}
          />
          <Button
            icon={IconNames.DOWNLOAD}
            {...selectCommand(props.editor, keybindings, 'downloadFile')}
          />
        </ButtonGroup>
        <Navbar.Divider />
        <ControlGroup>
          <HTMLSelect
            id="mode-menu"
            value={props.mode}
            onChange={(event) => props.setMode(event.currentTarget.value as Mode)}
          >
            <option value={Mode.AUTO}>Autonomous</option>
            <option value={Mode.TELEOP}>Teleop</option>
          </HTMLSelect>
          <Button
            id="start-btn"
            icon={IconNames.PLAY}
            {...selectCommand(props.editor, keybindings, 'start')}
          />
          <Button
            id="stop-btn"
            icon={IconNames.STOP}
            {...selectCommand(props.editor, keybindings, 'stop')}
          />
          <Button
            id="estop-btn"
            icon={IconNames.FLAME}
            {...selectCommand(props.editor, keybindings, 'estop')}
            intent={Intent.DANGER}
          />
        </ControlGroup>
        <Navbar.Divider />
        <ButtonGroup>
          <Popover
            content={<LogMenu editor={props.editor} keybindings={keybindings} />}
            transitionDuration={props.transitionDuration}
          >
            <Button
              id="log-btn"
              icon={IconNames.CONSOLE}
              rightIcon={IconNames.CARET_DOWN}
              text="Console"
            />
          </Popover>
          <Popover
            content={<DebugMenu editor={props.editor} keybindings={keybindings} />}
            transitionDuration={props.transitionDuration}
          >
            <Button
              icon={IconNames.DASHBOARD}
              rightIcon={IconNames.CARET_DOWN}
              text="Debug"
            />
          </Popover>
          <Button
            id="settings-btn"
            icon={IconNames.SETTINGS}
            onClick={props.openSettings}
            text="Settings"
          />
          <Popover
            content={
              <HelpMenu
                showAbout={() => setShowAbout(true)}
                startTour={() => setStepIndex(0)}
              />
            }
            transitionDuration={props.transitionDuration}
          >
            <Button icon={IconNames.HELP} text="Help" />
          </Popover>
        </ButtonGroup>
      </Navbar.Group>
    </Navbar>
  );
}
