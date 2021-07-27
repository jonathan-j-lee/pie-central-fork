import * as React from 'react';
import { Button, Collapse, Icon, Intent, Pre, Tag } from '@blueprintjs/core';
import { IconName, IconNames } from '@blueprintjs/icons';
import Highlight from 'react-highlight';
import * as _ from 'lodash';
import { useAppDispatch, useAppSelector } from '../hooks';
import logSlice, { copy, logEventSelectors } from '../store/log';
import settingsSlice, { EditorTheme, LogLevel } from '../store/settings';

const NOT_CONTEXT_FIELDS = ['timestamp', 'exception', 'event', 'level'];

const LogLevelTag = (props) => {
  let shortLevel = props.level.toLowerCase();
  let intent = null;
  let icon: IconName = IconNames.PULSE;
  switch (shortLevel) {
    case LogLevel.INFO:
      intent = Intent.PRIMARY;
      icon = IconNames.INFO_SIGN;
      break;
    case LogLevel.WARNING:
      shortLevel = 'warn';
    case 'warn':
      intent = Intent.WARNING;
      icon = IconNames.WARNING_SIGN;
      break;
    case LogLevel.CRITICAL:
      shortLevel = 'crit';
    case 'crit':
    case LogLevel.ERROR:
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
      {shortLevel.toUpperCase()}
    </Tag>
  );
};

export default function Log(props) {
  const dispatch = useAppDispatch();
  const editorTheme = useAppSelector((state) => state.settings.editor.editorTheme);
  const log = useAppSelector((state) => state.log);
  const settings = useAppSelector((state) => state.settings.log);
  const bottom = React.useRef();
  const timestamps = logEventSelectors.selectIds(log);
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
    if (settings.pinToBottom) {
      bottom.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
    }
  }, [timestamps[timestamps.length - 1]]);
  return (
    <Collapse isOpen={log.open} className="console-container">
      <Pre className="console">
        {logEventSelectors.selectAll(log)
          .filter(({ payload }) => payload.student_code || settings.showSystem)
          .map(({ id, payload, showContext }, index) => (
            <span key={index}>
              {settings.showTimestamp && <span>[{payload.timestamp}] </span>}
              <span>{payload.event}</span>
              {settings.showLevel && <LogLevelTag level={payload.level} />}
              <Tag
                round
                className="log-tag"
                interactive
                icon={<Icon
                  icon={showContext ? IconNames.CHEVRON_UP : IconNames.CHEVRON_DOWN}
                  size={12}
                />}
                onClick={() => dispatch(logSlice.actions.toggleContext(id))}
              >
                {showContext ? 'Hide' : 'Show'} Context
              </Tag>
              {settings.showTraceback && payload.exception && <>
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
        onClick={() => dispatch(settingsSlice.actions.update({
          log: { pinToBottom: !settings.pinToBottom },
        }))}
        active={settings.pinToBottom}
      />
    </Collapse>
  );
};
