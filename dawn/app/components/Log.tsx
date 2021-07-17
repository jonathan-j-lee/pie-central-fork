import * as React from 'react';
import { Button, Collapse, Icon, Intent, Pre, Tag } from '@blueprintjs/core';
import { IconName, IconNames } from '@blueprintjs/icons';
import Highlight from 'react-highlight';
import * as _ from 'lodash';
import { useAppDispatch, useAppSelector } from '../hooks';
import { EditorTheme } from '../store/editor';
import logSlice, { copy } from '../store/log';
import { addCommands, reportOutcome } from './Util';

const NOT_CONTEXT_FIELDS = ['timestamp', 'exception', 'event', 'level'];

const renderLevel = (level) => {
  let shortLevel = level;
  let intent = null;
  let icon: IconName = IconNames.PULSE;
  switch (level) {
    case 'INFO':
      intent = Intent.PRIMARY;
      icon = IconNames.INFO_SIGN;
      break;
    case 'WARNING':
      shortLevel = 'WARN';
    case 'WARN':
      intent = Intent.WARNING;
      icon = IconNames.WARNING_SIGN;
      break;
    case 'CRITICAL':
      shortLevel = 'CRIT';
    case 'CRIT':
    case 'ERROR':
      intent = Intent.DANGER;
      icon = IconNames.ERROR;
      break;
  }
  return (
    <Tag
      round
      icon={<Icon icon={icon} size={12} />}
      intent={intent}
      className="log-tag"
    >
      {shortLevel}
    </Tag>
  );
};

export default function Log(props) {
  const dispatch = useAppDispatch();
  const editorTheme = useAppSelector(state => state.editor.editorTheme);
  const log = useAppSelector(state => state.log);
  const keybindings = useAppSelector(state => state.keybindings.log);
  const bottom = React.useRef();
  React.useEffect(() => {
    for (const theme in EditorTheme) {
      const stylesheet = document.getElementById(`highlight-${EditorTheme[theme]}`) as HTMLLinkElement;
      if (stylesheet) {
        stylesheet.disabled = true;
      }
    }
    const enabledStylesheet = document.getElementById(`highlight-${editorTheme}`) as HTMLLinkElement;
    if (enabledStylesheet) {
      enabledStylesheet.disabled = false;
    }
  }, [editorTheme]);
  React.useEffect(() => {
    if (log.pinToBottom) {
      bottom.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
    }
  }, [log.events]);
  React.useEffect(() => addCommands(props.editor?.commands, [
    {
      name: 'toggleConsole',
      group: 'Console',
      bindKey: keybindings.commands.toggleConsole,
      exec: () => props.toggleOpen(),
    },
    {
      name: 'copyConsole',
      group: 'Console',
      bindKey: keybindings.commands.copyConsole,
      exec: () => reportOutcome(
        dispatch(copy()).unwrap(),
        'Copied console output.',
        'Failed to copy console output.',
      ),
    },
    {
      name: 'clearConsole',
      group: 'Console',
      bindKey: keybindings.commands.clearConsole,
      exec: () => dispatch(logSlice.actions.clear()),
    },
  ]), [dispatch, props.toggleOpen, keybindings]);
  return (
    <Collapse isOpen={props.isOpen} className="console-container">
      <Pre className="console">
        {log.timeline
          .map((timestamp) => log.events[timestamp])
          .filter(({ payload }) => payload.student_code || log.showSystem)
          .map(({ payload, showContext }, index) => (
            <span key={index}>
              {log.showTimestamps && <span>[{payload.timestamp}] </span>}
              <span>{payload.event}</span>
              {log.showSeverity && renderLevel(payload.level.toUpperCase())}
              <Tag
                round
                className="log-tag"
                interactive
                icon={<Icon
                  icon={showContext ? IconNames.CHEVRON_UP : IconNames.CHEVRON_DOWN}
                  size={12}
                />}
                onClick={() => dispatch(logSlice.actions.toggleContext(payload.timestamp))}
              >
                {showContext ? 'Hide' : 'Show'} Context
              </Tag>
              {log.showTraceback && payload.exception && <>
                <br />
                {payload.exception.trim()}
              </>}
              <br />
              {showContext && <Highlight className="language-json log-context">
                {JSON.stringify(_.omit(payload, NOT_CONTEXT_FIELDS), null, 2)}<br />
              </Highlight>}
            </span>
          ))
        }
        <div ref={bottom} />
      </Pre>
      <Button
        className="log-pin"
        intent={Intent.PRIMARY}
        icon={IconNames.AUTOMATIC_UPDATES}
        onClick={() => dispatch(logSlice.actions.toggle('pinToBottom'))}
        active={log.pinToBottom}
      />
    </Collapse>
  );
};
