import * as React from 'react';
import {
    Alignment,
    Button,
    ButtonGroup,
    Classes,
    ControlGroup,
    Dialog,
    Divider,
    HTMLSelect,
    Intent,
    Popover,
    Menu,
    MenuItem,
    Navbar,
    Tag,
} from '@blueprintjs/core';
import { IconNames } from '@blueprintjs/icons';
import { useAppDispatch, useAppSelector } from '../hooks';
import { OutcomeButton, reportOutcome } from './Util';
import editor, { getThemeClass, create, open, save, download, upload } from '../store/editor';
import log from '../store/log';
import { exec, Mode } from '../store/robot';
import { exportSettings } from '../store';

const FileMenu = ({ filePath, openFile, newFile, saveFile }) => (
  <Menu>
    <MenuItem icon={IconNames.DOCUMENT_SHARE} text="New" onClick={() => newFile()} />
    <MenuItem icon={IconNames.DOCUMENT_OPEN} text="Open" onClick={() => openFile()} />
    <Divider />
    <MenuItem icon={IconNames.SAVED} text="Save" onClick={() => saveFile(filePath)} />
    <MenuItem icon={IconNames.SAVED} text="Save As ..." onClick={() => saveFile(null)} />
  </Menu>
);

function EditMenu(props) {
  const copy = () =>
    navigator.clipboard.writeText(props.editorRef.current.editor.getCopyText());
  return (
    <Menu>
      <MenuItem
        icon={IconNames.CUT}
        text="Cut"
        onClick={() => copy()
          .then(() => props.editorRef.current.editor.execCommand('cut'))
        }
      />
      <MenuItem icon={IconNames.DUPLICATE} text="Copy" onClick={() => copy()} />
      <MenuItem
        icon={IconNames.CLIPBOARD}
        text="Paste"
        onClick={() => navigator.clipboard.readText().then((text) => {
          const editor = props.editorRef.current.editor;
          editor.session.insert(editor.getCursorPosition(), text);
        })}
      />
      <Divider />
      <MenuItem
        icon={IconNames.UNDO}
        text="Undo"
        onClick={() => props.editorRef.current.editor.undo()}
      />
      <MenuItem
        icon={IconNames.REDO}
        text="Redo"
        onClick={() => props.editorRef.current.editor.redo()}
      />
      <Divider />
      <MenuItem
        icon={IconNames.SEARCH_TEXT}
        text="Find"
        onClick={() => props.editorRef.current.editor.execCommand('find')}
      />
    </Menu>
  );
}

const LogMenu = (props) => {
  const events = useAppSelector(state => state.log.events);
  const dispatch = useAppDispatch();
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
      <MenuItem text={label} icon={icon} onClick={props.toggle} />
      <MenuItem
        text="Copy"
        icon={IconNames.DUPLICATE}
        onClick={() => navigator.clipboard.writeText(
          events.map((event) => JSON.stringify(event)).join('\n'))
        }
      />
      <MenuItem
        text="Clear"
        icon={IconNames.CLEAN}
        onClick={() => dispatch(log.actions.clear())}
      />
    </Menu>
  );
};

// TODO: lint
const DebugMenu = () => {
  const dispatch = useAppDispatch();
  return (
    <Menu>
      <MenuItem
        text="Lint"
        icon={IconNames.CODE}
      />
      <MenuItem
        text="Restart Runtime"
        icon={IconNames.RESET}
        onClick={() => reportOutcome(
          dispatch(exec()).unwrap(),
          'Successfully restarted Runtime.',
          'Failed to restart Runtime. Are you connected to the robot?',
        )}
      />
      <MenuItem text="Motor check" icon={IconNames.COG} />
      <MenuItem text="Statistics" icon={IconNames.TIMELINE_LINE_CHART} />
    </Menu>
  );
};

function OverwriteDialog(props) {
  const { editorTheme, filePath } = useAppSelector(state => state.editor);
  const confirmOverwrite = () => Promise.resolve(props.overwrite.callback())
    .then(() => props.clearOverwrite());
  return (
    <Dialog
      isOpen={props.overwrite.callback}
      icon={IconNames.WARNING_SIGN}
      title="Unsaved Changes"
      transitionDuration={100}
      onClose={() => props.clearOverwrite()}
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
            onClick={() => confirmOverwrite()}
          />
          <Button
            intent={Intent.PRIMARY}
            icon={IconNames.IMPORT}
            text="Save"
            onClick={() => props.save(filePath).then(() => confirmOverwrite())}
          />
        </div>
      </div>
    </Dialog>
  );
};

export default function Toolbar(props) {
  const {
    dirty,
    editorTheme,
    filePath,
  } = useAppSelector(state => state.editor);
  const [mode, setMode] = React.useState(Mode.AUTO);
  const [overwrite, setOverwrite] = React.useState({ callback: null });
  const dispatch = useAppDispatch();
  const newFile = () => reportOutcome(
    dispatch(create({ editorRef: props.editorRef })).unwrap(),
    'Created a new file.',
    'Failed to create a new file.',
  );
  const openFile = () => reportOutcome(
    dispatch(open({ editorRef: props.editorRef }))
      .unwrap()
      .then(() => dispatch(exportSettings()).unwrap()),
    'Opened the selected file.',
    'Failed to open the selected file.',
  );
  const uploadFile = () => reportOutcome(
    dispatch(upload({ editorRef: props.editorRef })).unwrap(),
    'Uploaded student code to the robot.',
    'Failed to upload student code to the robot.',
  );
  const downloadFile = () => reportOutcome(
    dispatch(download({ editorRef: props.editorRef })).unwrap(),
    'Downloaded student code from the robot.',
    'Failed to download student code from the robot.',
  );
  const saveFile = (filePath) => reportOutcome(
    dispatch(save({ filePath, editorRef: props.editorRef }))
      .unwrap()
      .then(() => dispatch(exportSettings()).unwrap()),
    'Saved the current file.',
    'Failed to save the current file.',
  );
  React.useEffect(() => {
    window.ipc.on('exit', (replyChannel) => {
      const callback = () => window.ipc.send(replyChannel);
      if (dirty) {
        setOverwrite({ callback });
      } else {
        callback();
      }
    });
    return () => window.ipc.removeListeners('exit');
  }, [dirty]);
  // TODO: ensure estop works
  // TODO: add loading to upload/download
  return (
    <Navbar>
      <Navbar.Group>
        <Navbar.Heading>Dawn</Navbar.Heading>
        <Navbar.Divider />
        <ButtonGroup>
          <Popover content={
            <FileMenu
              filePath={filePath}
              newFile={() => dirty ? setOverwrite({ callback: newFile }) : newFile()}
              openFile={() => dirty ? setOverwrite({ callback: openFile }) : openFile()}
              saveFile={saveFile}
            />
          }>
            <Button icon={IconNames.DOCUMENT} rightIcon={IconNames.CARET_DOWN} text="File" />
          </Popover>
          <OverwriteDialog
            overwrite={overwrite}
            clearOverwrite={() => setOverwrite({ callback: null })}
            saveFile={saveFile}
          />
          <Popover content={<EditMenu />}>
            <Button icon={IconNames.EDIT} rightIcon={IconNames.CARET_DOWN} text="Edit" />
          </Popover>
          <Button
            icon={IconNames.UPLOAD}
            text="Upload"
            onClick={() => uploadFile()}
          />
          <Button
            icon={IconNames.DOWNLOAD}
            text="Download"
            onClick={() => dirty ?
              setOverwrite({ callback: downloadFile }) : downloadFile()}
          />
        </ButtonGroup>
        <Navbar.Divider />
        <ControlGroup>
          <HTMLSelect
            value={mode}
            onChange={event => setMode(Mode[event.currentTarget.value.toUpperCase()])}
          >
            <option value={Mode.AUTO}>Autonomous</option>
            <option value={Mode.TELEOP}>Teleop</option>
          </HTMLSelect>
          <OutcomeButton
            icon={IconNames.PLAY}
            text="Start"
            onClick={() => reportOutcome(
              window.ipc.invoke('request', 'executor-service', mode),
              'Successfully started robot.',
              'Failed to start robot.',
            )}
          />
          <OutcomeButton
            icon={IconNames.STOP}
            text="Stop"
            onClick={() => reportOutcome(
              window.ipc.invoke('request', 'executor-service', 'idle'),
              'Successfully idled robot.',
              'Failed to idle robot.',
            )}
          />
          <Button
            icon={IconNames.FLAME}
            text="Emergency"
            onClick={() => reportOutcome(
              Promise.resolve(window.ipc.send('notify', 'executor-service', 'estop')),
              'Successfully e-stopped robot.',
              'Failed to e-stop robot.',
            )}
            intent={Intent.DANGER}
          />
        </ControlGroup>
        <Navbar.Divider />
        <ButtonGroup>
          <Popover content={
            <LogMenu isOpen={props.logOpen} toggle={props.toggleLogOpen} />
          }>
            <Button icon={IconNames.CONSOLE} rightIcon={IconNames.CARET_DOWN} text="Console" />
          </Popover>
          <Popover content={<DebugMenu />}>
            <Button icon={IconNames.DASHBOARD} rightIcon={IconNames.CARET_DOWN} text="Debug" />
          </Popover>
          <Button icon={IconNames.SETTINGS} onClick={props.openSettings} text="Settings" />
          <Button icon={IconNames.HELP} text="Help" />
        </ButtonGroup>
      </Navbar.Group>
    </Navbar>
  );
};
