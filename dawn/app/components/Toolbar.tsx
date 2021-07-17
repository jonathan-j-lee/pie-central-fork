import * as React from 'react';
import {
    Alignment,
    Button,
    ButtonGroup,
    Classes,
    ControlGroup,
    Dialog,
    HTMLSelect,
    Intent,
    Popover,
    Menu,
    Navbar,
    Tag,
    useHotkeys,
} from '@blueprintjs/core';
import { IconNames } from '@blueprintjs/icons';
import { useAppDispatch, useAppSelector } from '../hooks';
import { reportOutcome } from './Util';
import editorSlice, { getThemeClass, save, lint, exit } from '../store/editor';
import { selectCommand } from '../store/keybindings';
import log from '../store/log';
import { restart, Mode } from '../store/robot';
import { exportSettings } from '../store';

const FileMenu = (props) => (
  <Menu>
    <Menu.Item
      icon={IconNames.DOCUMENT_SHARE}
      {...selectCommand(props.editor, props.keybindings.file, 'newFile')}
    />
    <Menu.Item
      icon={IconNames.DOCUMENT_OPEN}
      {...selectCommand(props.editor, props.keybindings.file, 'openFile')}
    />
    <Menu.Divider />
    <Menu.Item
      icon={IconNames.SAVED}
      {...selectCommand(props.editor, props.keybindings.file, 'saveFile')}
    />
    <Menu.Item
      icon={IconNames.SAVED}
      {...selectCommand(props.editor, props.keybindings.file, 'saveFileAs')}
    />
  </Menu>
);

const EditMenu = (props) => (
  <Menu>
    <Menu.Item
      icon={IconNames.CUT}
      {...selectCommand(props.editor, props.keybindings.edit, 'cutText')}
    />
    <Menu.Item
      icon={IconNames.DUPLICATE}
      {...selectCommand(props.editor, props.keybindings.edit, 'copyText')}
    />
    <Menu.Item
      icon={IconNames.CLIPBOARD}
      {...selectCommand(props.editor, props.keybindings.edit, 'pasteText')}
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

const LogMenu = (props) => {
  let icon, label;
  if (props.isOpen) {
    icon = IconNames.MENU_CLOSED;
    label = 'Close';
  } else {
    icon = IconNames.MENU_OPEN;
    label = 'Open';
  }
  return (
    <Menu>
      <Menu.Item
        icon={icon}
        {...selectCommand(props.editor, props.keybindings.log, 'toggleConsole')}
        text={label}
      />
      <Menu.Item
        icon={IconNames.DUPLICATE}
        {...selectCommand(props.editor, props.keybindings.log, 'copyConsole')}
      />
      <Menu.Item
        icon={IconNames.CLEAN}
        {...selectCommand(props.editor, props.keybindings.log, 'clearConsole')}
      />
    </Menu>
  );
};

const DebugMenu = (props) => (
  <Menu>
    <Menu.Item
      icon={IconNames.CODE}
      {...selectCommand(props.editor, props.keybindings.debug, 'lint')}
    />
    <Menu.Item
      icon={IconNames.RESET}
      {...selectCommand(props.editor, props.keybindings.debug, 'restart')}
    />
    <Menu.Item
      text="Motor check"
      icon={IconNames.COG}
    />
    <Menu.Item
      text="Statistics"
      icon={IconNames.TIMELINE_LINE_CHART}
    />
  </Menu>
);

function OverwriteDialog(props) {
  const dispatch = useAppDispatch();
  // TODO: select only necessary state
  const { editorTheme, filePath, prompt } = useAppSelector(state => state.editor);
  return (
    <Dialog
      isOpen={prompt}
      icon={IconNames.WARNING_SIGN}
      title="Unsaved Changes"
      transitionDuration={100}
      onClose={() => dispatch(editorSlice.actions.cancel())}
      className={getThemeClass(editorTheme)}
    >
      <div className={Classes.DIALOG_BODY}>
        <p>
          You have unsaved changes on your current file.
          What would you like to do with these changes?
        </p>
      </div>
      <div className={Classes.DIALOG_FOOTER}>
        <div className={Classes.DIALOG_FOOTER_ACTIONS}>
          <Button
            intent={Intent.DANGER}
            icon={IconNames.TRASH}
            text="Discard"
            onClick={() => dispatch(editorSlice.actions.confirm())}
          />
          <Button
            intent={Intent.PRIMARY}
            icon={IconNames.IMPORT}
            text="Save"
            onClick={() => dispatch(save({ filePath, editor: props.editor }))
              .unwrap()
              .then(() => dispatch(editorSlice.actions.confirm()))
            }
          />
        </div>
      </div>
    </Dialog>
  );
};

// TODO: ensure start/stop clears error flag
export default function Toolbar(props) {
  const dispatch = useAppDispatch();
  const [dirty, editorTheme] = useAppSelector(
    state => [state.editor.dirty, state.editor.editorTheme]);
  const keybindings = useAppSelector(state => state.keybindings);
  React.useEffect(() => {
    window.ipc.on('exit', (replyChannel) => dispatch(exit(replyChannel)));
    return () => window.ipc.removeListeners('exit');
  }, []);
  // TODO: ensure estop works
  // TODO: add loading to upload/download
  return (
    <Navbar>
      <OverwriteDialog editor={props.editor} />
      <Navbar.Group>
        <Navbar.Heading>Dawn</Navbar.Heading>
        <Navbar.Divider />
        <ButtonGroup>
          <Popover content={<FileMenu editor={props.editor} keybindings={keybindings} />}>
            <Button icon={IconNames.DOCUMENT} rightIcon={IconNames.CARET_DOWN} text="File" />
          </Popover>
          <Popover content={<EditMenu editor={props.editor} keybindings={keybindings} />}>
            <Button icon={IconNames.EDIT} rightIcon={IconNames.CARET_DOWN} text="Edit" />
          </Popover>
          <Button
            icon={IconNames.UPLOAD}
            {...selectCommand(props.editor, keybindings.robot, 'uploadFile')}
          />
          <Button
            icon={IconNames.DOWNLOAD}
            {...selectCommand(props.editor, keybindings.robot, 'downloadFile')}
          />
        </ButtonGroup>
        <Navbar.Divider />
        <ControlGroup>
          <HTMLSelect
            value={props.mode}
            onChange={event => props.setMode(event.currentTarget.value)}
          >
            <option value={Mode.AUTO}>Autonomous</option>
            <option value={Mode.TELEOP}>Teleop</option>
          </HTMLSelect>
          <Button
            icon={IconNames.PLAY}
            {...selectCommand(props.editor, keybindings.robot, 'start')}
          />
          <Button
            icon={IconNames.STOP}
            {...selectCommand(props.editor, keybindings.robot, 'stop')}
          />
          <Button
            icon={IconNames.FLAME}
            {...selectCommand(props.editor, keybindings.robot, 'estop')}
            intent={Intent.DANGER}
          />
        </ControlGroup>
        <Navbar.Divider />
        <ButtonGroup>
          <Popover content={
            <LogMenu isOpen={props.logOpen} editor={props.editor} keybindings={keybindings} />
          }>
            <Button icon={IconNames.CONSOLE} rightIcon={IconNames.CARET_DOWN} text="Console" />
          </Popover>
          <Popover content={<DebugMenu editor={props.editor} keybindings={keybindings} />}>
            <Button icon={IconNames.DASHBOARD} rightIcon={IconNames.CARET_DOWN} text="Debug" />
          </Popover>
          <Button icon={IconNames.SETTINGS} onClick={props.openSettings} text="Settings" />
          <Button icon={IconNames.HELP} text="Help" />
        </ButtonGroup>
      </Navbar.Group>
    </Navbar>
  );
};
