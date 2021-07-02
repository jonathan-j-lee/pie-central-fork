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
import editor, { getThemeClass } from '../store/editor';
import log from '../store/log';
import { Mode } from '../store/robot';

const FileMenu = ({ filePath, openFile, newFile, save }) => (
  <Menu>
    <MenuItem icon={IconNames.DOCUMENT_SHARE} text="New" onClick={newFile} />
    <MenuItem icon={IconNames.DOCUMENT_OPEN} text="Open" onClick={openFile} />
    <Divider />
    <MenuItem icon={IconNames.SAVED} text="Save" onClick={() => save(filePath)} />
    <MenuItem icon={IconNames.SAVED} text="Save As ..." onClick={() => save(null)} />
  </Menu>
);

const EditMenu = ({ editorRef }) => {
  const copy = () =>
    navigator.clipboard.writeText(editorRef.current.editor.getCopyText());
  return (
    <Menu>
      <MenuItem
        icon={IconNames.CUT}
        text="Cut"
        onClick={() => {
          copy();
          editorRef.current.editor.execCommand('cut');
        }}
      />
      <MenuItem
        icon={IconNames.DUPLICATE}
        text="Copy"
        onClick={copy}
      />
      <MenuItem
        icon={IconNames.CLIPBOARD}
        text="Paste"
        onClick={() => navigator.clipboard.readText()
          .then(text => {
            const editor = editorRef.current.editor;
            editor.session.insert(editor.getCursorPosition(), text);
          })
        }
      />
      <Divider />
      <MenuItem
        icon={IconNames.UNDO}
        text="Undo"
        onClick={() => editorRef.current.editor.undo()}
      />
      <MenuItem
        icon={IconNames.REDO}
        text="Redo"
        onClick={() => editorRef.current.editor.redo()}
      />
      <Divider />
      <MenuItem
        icon={IconNames.SEARCH_TEXT}
        text="Find"
        onClick={() => editorRef.current.editor.execCommand('find')}
      />
    </Menu>
  );
};

const LogMenu = (props) => {
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
      <MenuItem text="Copy" icon={IconNames.DUPLICATE} />
      <MenuItem
        text="Clear"
        icon={IconNames.CLEAN}
        onClick={() => dispatch(log.actions.clear())}
      />
    </Menu>
  );
};

const DebugMenu = () => (
  <Menu>
    <MenuItem text="Lint" icon={IconNames.CODE} />
    <MenuItem text="Restart Runtime" icon={IconNames.RESET} />
    <MenuItem text="Motor check" icon={IconNames.COG} />
    <MenuItem text="Statistics" icon={IconNames.TIMELINE_LINE_CHART} />
  </Menu>
);

export default function Toolbar(props) {
  const {
    dirty,
    editorTheme,
    encoding,
    filePath,
  } = useAppSelector(state => state.editor);
  const [mode, setMode] = React.useState(Mode.AUTO);
  const [overwrite, setOverwrite] = React.useState(null);
  const dispatch = useAppDispatch();
  const newFile = () => {
    props.editorRef.current.editor.setValue("");
    dispatch(editor.actions.newFile());
  };
  const openFile = () => window.file.open(encoding)
    .then(([filePath, contents]) => {
      props.editorRef.current.editor.setValue(contents);
      dispatch(editor.actions.openFile(filePath));
    })
    .catch(err => console.log(err));
  const save = filePath =>
    (filePath ? Promise.resolve(filePath) : window.file.savePrompt())
      .then(filePath => {
        dispatch(editor.actions.save(filePath));
        const contents = props.editorRef.current.editor.getValue();
        return window.file.save(filePath, contents, encoding);
      })
      .catch(err => console.log(err));
  const confirmOverwrite = () => {
    if (overwrite === 'new') {
      newFile();
    } else if (overwrite === 'open') {
      openFile();
    }
    setOverwrite(null);
  };
  // TODO: ensure estop works
  // TODO: warn when quitting with unsaved changes
  return (
    <Navbar>
      <Navbar.Group>
        <Navbar.Heading>Dawn</Navbar.Heading>
        <Navbar.Divider />
        <ButtonGroup>
          <Popover content={
            <FileMenu
              filePath={filePath}
              newFile={() => dirty ? setOverwrite('new') : newFile()}
              openFile={() => dirty ? setOverwrite('open') : openFile()}
              save={save}
            />
          }>
            <Button icon={IconNames.DOCUMENT} rightIcon={IconNames.CARET_DOWN}>
              File
            </Button>
          </Popover>
          <Dialog
            isOpen={overwrite}
            icon={IconNames.WARNING_SIGN}
            title="Unsaved Changes"
            transitionDuration={100}
            onClose={() => setOverwrite(null)}
            className={getThemeClass(editorTheme)}
          >
            <div className={Classes.DIALOG_BODY}>
              <p>
                You are trying to {overwrite === 'open' ? 'open' : 'create'} a new file,
                but you have unsaved changes on your current file.
                What would you like to do with these changes?
              </p>
            </div>
            <div className={Classes.DIALOG_FOOTER}>
              <div className={Classes.DIALOG_FOOTER_ACTIONS}>
                <Button
                  intent={Intent.DANGER}
                  icon={IconNames.TRASH}
                  text="Discard"
                  onClick={confirmOverwrite}
                />
                <Button
                  intent={Intent.PRIMARY}
                  icon={IconNames.IMPORT}
                  text="Save"
                  onClick={() => save(filePath).then(confirmOverwrite)}
                />
              </div>
            </div>
          </Dialog>
          <Popover content={<EditMenu editorRef={props.editorRef} />}>
            <Button icon={IconNames.EDIT} rightIcon={IconNames.CARET_DOWN}>
              Edit
            </Button>
          </Popover>
          <Button icon={IconNames.UPLOAD}>
            Upload
          </Button>
          <Button icon={IconNames.DOWNLOAD}>
            Download
          </Button>
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
              window.runtime.request('executor-service', mode),
              'Successfully started robot.',
              'Failed to start robot.',
            )}
          />
          <OutcomeButton
            icon={IconNames.STOP}
            text="Stop"
            onClick={() => reportOutcome(
              window.runtime.request('executor-service', 'idle'),
              'Successfully idled robot.',
              'Failed to idle robot.',
            )}
          />
          <Button
            icon={IconNames.FLAME}
            text="Emergency"
            onClick={() => reportOutcome(
              Promise.resolve(window.runtime.notify('executor-service', 'estop')),
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
