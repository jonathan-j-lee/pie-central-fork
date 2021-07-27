import * as React from 'react';
import Joyride, { ACTIONS, EVENTS, STATUS } from 'react-joyride';
import { Colors } from '@blueprintjs/core';
import logSlice from '../store/log';
import { EditorTheme } from '../store/settings';
import { useAppDispatch, useAppSelector } from '../hooks';

export const TOUR_IDLE_STEP = -1;
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

function handleTransition(transition, { dispatch, openSettings, closeSettings }) {
  const nextStep = TOUR_STEPS[transition.index + 1] ?? { target: null };
  let delay = 0;
  if (nextStep.target === '#ip-addr') {
    openSettings();
    delay = 200;
  } else if (nextStep.target === '.console') {
    dispatch(logSlice.actions.open());
    delay = 200;
  }
  if (transition.step?.target === '#ip-addr') {
    closeSettings();
  } else if (transition.step?.target === '.console') {
    dispatch(logSlice.actions.close());
  }
  if ([transition.step?.target, nextStep.target].includes('#file-menu')) {
    document.getElementById('file-btn').click();
    delay = 200;
  }
  if ([transition.step?.target, nextStep.target].includes('#log-menu')) {
    document.getElementById('log-btn').click();
    delay = 200;
  }
  return delay;
}

export default function Tour(props) {
  const dispatch = useAppDispatch();
  const editorTheme = useAppSelector(state => state.settings.editor.editorTheme);
  const textColor = editorTheme === EditorTheme.DARK ? Colors.LIGHT_GRAY5 : Colors.DARK_GRAY1;
  const backgroundColor = editorTheme === EditorTheme.DARK ? Colors.DARK_GRAY5 : Colors.LIGHT_GRAY4;
  return <Joyride
    showSkipButton
    showProgress
    scrollToFirstStep
    continuous
    run={props.stepIndex >= 0}
    stepIndex={props.stepIndex}
    steps={TOUR_STEPS}
    locale={{
      back: 'Previous',
      next: 'Next',
      close: 'Close',
      last: 'End Tour',
      skip: 'Skip Tour',
    }}
    callback={(transition) => {
      if (([STATUS.FINISHED, STATUS.SKIPPED] as string[]).includes(transition.status)) {
        props.setStepIndex(TOUR_IDLE_STEP);
      } else if (props.stepIndex === transition.index &&
          ([EVENTS.STEP_AFTER, EVENTS.TARGET_NOT_FOUND] as string[]).includes(transition.type)) {
        const delay = handleTransition(transition, { dispatch, ...props });
        const change = transition.action === ACTIONS.PREV ? -1 : 1;
        setTimeout(() => props.setStepIndex(props.stepIndex + change), delay);
      }
    }}
    styles={{
      options: {
        arrowColor: backgroundColor,
        backgroundColor,
        textColor,
        primaryColor: Colors.BLUE3,
      },
    }}
  />;
}
