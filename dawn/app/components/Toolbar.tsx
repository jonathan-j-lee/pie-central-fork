import * as React from 'react';
import Joyride, { ACTIONS, EVENTS, STATUS } from 'react-joyride';
import {
    Alignment,
    Button,
    ButtonGroup,
    Classes,
    Colors,
    ControlGroup,
    Dialog,
    H3,
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
import editorSlice, { EditorTheme, getThemeClass, save, lint, exit } from '../store/editor';
import { selectCommand } from '../store/keybindings';
import log from '../store/log';
import { restart, Mode } from '../store/robot';

const TOUR_STEPS = [
  {
    title: 'Welcome',
    content: <p>Let's look at the features of Dawn you'll probably use most often.</p>,
    placement: 'center' as const,
    target: 'body',
  },
  {
    title: 'Text Editor',
    content: <p>Write your code in this text editor.</p>,
    target: '#ace-editor',
  },
  {
    title: 'File Menu',
    content: <p>Use this menu to open and save your code.</p>,
    target: '#file-menu',
  },
  {
    title: 'Uploading Code',
    content: <p>
      When you are ready to run your code, click this button to upload the editor's
      contents to the robot.
    </p>,
    target: '#upload-btn',
  },
  {
    title: 'Start Running Code',
    content: <p>Press this button to run the code you uploaded.</p>,
    target: '#start-btn'
  },
  {
    title: 'Stop Running Code',
    content: <p>Press this button to stop running your code.</p>,
    target: '#stop-btn'
  },
  {
    title: 'Emergency Stop',
    content: <p>
      Press this button when the robot is operating unsafely.
      E-Stop, or emergency stop, will freeze all motors and then halt Runtime.
      The robot will become inoperable until you cycle its power supply.
    </p>,
    target: '#estop-btn'
  },
  {
    title: 'Console',
    content: <p>Use this menu to open and close the console.</p>,
    target: '#log-menu',
  },
  {
    title: 'Console',
    content: <p>
      This console contains messages emitted by the robot, including the output of your
      print statements.
    </p>,
    target: '.console',
  },
  {
    title: 'Settings',
    content: <p>Click this button to configure the editor and your robot.</p>,
    target: '#settings-btn',
  },
  {
    title: 'IP Address',
    content: <p>
      To connect to your robot, enter its IP address address in this field.
      An IP address takes the form of four integer separated by periods, such as: <code>192.168.1.1</code>
    </p>,
    target: '#ip-addr',
  },
  // TODO: show how to update the robot
  {
    title: 'Connection Status',
    content: <p>
      The status of your connection to the robot is shown here in real time.
    </p>,
    target: '#robot-status'
  },
  {
    title: 'Device Status',
    content: <p>All connected Smart Devices and gamepads will be shown here.</p>,
    target: '.peripheral-list',
  },
  {
    title: 'Keyboard Shortcuts',
    content: <p>Press <kbd>?</kbd> to see a list of Dawn's keyboard shortcuts.</p>,
    placement: 'center' as const,
    target: 'body',
  },
];

const FileMenu = (props) => (
  <Menu id="file-menu">
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
    <Menu id="log-menu">
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

const HelpMenu = (props) => (
  <Menu>
    <Menu.Item icon={IconNames.MAP_MARKER} text="Tour" onClick={() => props.startTour()} />
    <Menu.Item icon={IconNames.MANUAL} text="API Docs" />
    <Menu.Item icon={IconNames.LAB_TEST} text="About" onClick={() => props.showAbout()} />
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

function AboutDialog(props) {
  const editorTheme = useAppSelector(state => state.editor.editorTheme);
  return (
    <Dialog
      isOpen={props.isOpen}
      icon={IconNames.INFO_SIGN}
      title="About"
      transitionDuration={100}
      onClose={() => props.hideAbout()}
      className={getThemeClass(editorTheme)}
    >
      <div className={Classes.DIALOG_BODY}>
        <H3>Dawn</H3>
        <p>Package info: <code>{DAWN_PKG_INFO.name} {DAWN_PKG_INFO.version}</code></p>
        <p>Build timestamp: <code>{DAWN_PKG_INFO.buildTimestamp}</code></p>
        <p>{DAWN_PKG_INFO.description}</p>
        <p>Licensed under {DAWN_PKG_INFO.license} by {DAWN_PKG_INFO.author}.</p>
      </div>
    </Dialog>
  );
}

export default function Toolbar(props) {
  const dispatch = useAppDispatch();
  const dirty = useAppSelector(state => state.editor.dirty);
  const editorTheme = useAppSelector(state => state.editor.editorTheme);
  const keybindings = useAppSelector(state => state.keybindings);
  React.useEffect(() => {
    window.ipc.on('exit', (replyChannel) => dispatch(exit(replyChannel)));
    return () => window.ipc.removeListeners('exit');
  }, []);
  const [tourStep, setTourStep] = React.useState(-1);
  const [showAbout, setShowAbout] = React.useState(false);
  // TODO: ensure start/stop clears error flag
  // TODO: ensure estop works
  // TODO: add loading to upload/download
  const textColor = editorTheme === EditorTheme.DARK ? Colors.LIGHT_GRAY5 : Colors.DARK_GRAY1;
  const backgroundColor = editorTheme === EditorTheme.DARK ? Colors.DARK_GRAY5 : Colors.LIGHT_GRAY4;
  return (
    <Navbar>
      <OverwriteDialog editor={props.editor} />
      <Joyride
        showSkipButton
        showProgress
        scrollToFirstStep
        continuous
        run={tourStep >= 0}
        stepIndex={tourStep}
        callback={(data) => {
          if (([STATUS.FINISHED, STATUS.SKIPPED] as string[]).includes(data.status)) {
            setTourStep(-1);
          } else if (tourStep === data.index
              && ([EVENTS.STEP_AFTER, EVENTS.TARGET_NOT_FOUND] as string[]).includes(data.type)) {
            const nextStep = TOUR_STEPS[data.index + 1] || { target: null };
            let delay = 0;
            if (nextStep.target === '#ip-addr') {
              props.openSettings();
              delay = 200;
            } else if (nextStep.target === '.console') {
              props.openLog();
              delay = 200;
            }
            if (data.step?.target === '#ip-addr') {
              props.closeSettings();
            } else if (data.step?.target === '.console') {
              props.closeLog();
            }
            if ([data.step?.target, nextStep.target].includes('#file-menu')) {
              document.getElementById('file-btn').click();
              delay = 200;
            }
            if ([data.step?.target, nextStep.target].includes('#log-menu')) {
              document.getElementById('log-btn').click();
              delay = 200;
            }
            setTimeout(() =>
              setTourStep(tourStep + (data.action === ACTIONS.PREV ? -1 : 1)), delay);
          }
        }}
        steps={TOUR_STEPS}
        locale={{
          back: 'Previous',
          close: 'Close',
          last: 'End Tour',
          next: 'Next',
          skip: 'Skip Tour',
        }}
        styles={{
          options: {
            arrowColor: backgroundColor,
            backgroundColor,
            textColor,
            primaryColor: Colors.BLUE3,
          },
        }}
      />
      <AboutDialog isOpen={showAbout} hideAbout={() => setShowAbout(false)} />
      <Navbar.Group>
        <Navbar.Heading>Dawn</Navbar.Heading>
        <Navbar.Divider />
        <ButtonGroup>
          <Popover content={<FileMenu editor={props.editor} keybindings={keybindings} />}>
            <Button id="file-btn" icon={IconNames.DOCUMENT} rightIcon={IconNames.CARET_DOWN} text="File" />
          </Popover>
          <Popover content={<EditMenu editor={props.editor} keybindings={keybindings} />}>
            <Button icon={IconNames.EDIT} rightIcon={IconNames.CARET_DOWN} text="Edit" />
          </Popover>
          <Button
            id="upload-btn"
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
            id="mode-menu"
            value={props.mode}
            onChange={event => props.setMode(event.currentTarget.value)}
          >
            <option value={Mode.AUTO}>Autonomous</option>
            <option value={Mode.TELEOP}>Teleop</option>
          </HTMLSelect>
          <Button
            id="start-btn"
            icon={IconNames.PLAY}
            {...selectCommand(props.editor, keybindings.robot, 'start')}
          />
          <Button
            id="stop-btn"
            icon={IconNames.STOP}
            {...selectCommand(props.editor, keybindings.robot, 'stop')}
          />
          <Button
            id="estop-btn"
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
            <Button id="log-btn" icon={IconNames.CONSOLE} rightIcon={IconNames.CARET_DOWN} text="Console" />
          </Popover>
          <Popover content={<DebugMenu editor={props.editor} keybindings={keybindings} />}>
            <Button icon={IconNames.DASHBOARD} rightIcon={IconNames.CARET_DOWN} text="Debug" />
          </Popover>
          <Button id="settings-btn" icon={IconNames.SETTINGS} onClick={props.openSettings} text="Settings" />
          <Popover content={
            <HelpMenu
              showAbout={() => setShowAbout(true)}
              startTour={() => setTourStep(0)}
            />
          }>
            <Button icon={IconNames.HELP} text="Help" />
          </Popover>
        </ButtonGroup>
      </Navbar.Group>
    </Navbar>
  );
};
