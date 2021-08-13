import * as React from 'react';
import { Button, Collapse, Icon, Intent, Pre, Tag } from '@blueprintjs/core';
import { IconName, IconNames } from '@blueprintjs/icons';
import Highlight from 'react-highlight';
import * as _ from 'lodash';
import { useAppDispatch, useAppSelector } from '../hooks';
import logSlice, { LogEvent as LogEventData, logEventSelectors } from '../store/log';
import settingsSlice, { SettingsState, EditorTheme, LogLevel } from '../store/settings';

const NOT_CONTEXT_FIELDS = ['timestamp', 'exception', 'event', 'level'];

const LogLevelTag = (props: { level: LogLevel }) => {
  let shortLevel = props.level.toLowerCase();
  let intent: Intent | undefined;
  let icon: IconName = IconNames.PULSE;
  switch (shortLevel) {
    case LogLevel.INFO:
      intent = Intent.PRIMARY;
      icon = IconNames.INFO_SIGN;
      break;
    case LogLevel.WARNING:
      shortLevel = 'warn'; // fall through
    case 'warn':
      intent = Intent.WARNING;
      icon = IconNames.WARNING_SIGN;
      break;
    case LogLevel.CRITICAL:
      shortLevel = 'crit'; // fall through
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

const ShowContextTag = (props: { event: LogEventData }) => {
  const dispatch = useAppDispatch();
  return (
    <Tag
      round
      interactive
      className="log-tag"
      icon={
        <Icon
          icon={props.event.showContext ? IconNames.CHEVRON_UP : IconNames.CHEVRON_DOWN}
          size={12}
        />
      }
      onClick={() =>
        dispatch(logSlice.actions.toggleContext(props.event.payload.timestamp))
      }
    >
      {props.event.showContext ? 'Hide' : 'Show'} Context
    </Tag>
  );
};

interface LogEventProps {
  settings: SettingsState['log'];
  event: LogEventData;
}

const LogEvent = ({ settings, event }: LogEventProps) => (
  <>
    {settings.showTimestamp && <span>[{event.payload.timestamp}] </span>}
    <span>{event.payload.event}</span>
    {settings.showLevel && <LogLevelTag level={event.payload.level} />}
    <ShowContextTag event={event} />
    {settings.showTraceback && event.payload.exception && (
      <>
        <br />
        {event.payload.exception.trim()}
      </>
    )}
    <br />
    {event.showContext && (
      <Highlight className="language-json log-context">
        {JSON.stringify(_.omit(event.payload, NOT_CONTEXT_FIELDS), null, 2)}
        <br />
      </Highlight>
    )}
  </>
);

export default function Log(props: { transitionDuration?: number }) {
  const dispatch = useAppDispatch();
  const editorTheme = useAppSelector((state) => state.settings.editor.editorTheme);
  const log = useAppSelector((state) => state.log);
  const settings = useAppSelector((state) => state.settings.log);
  const bottom = React.useRef<HTMLDivElement>(null);
  const timestamps = logEventSelectors.selectIds(log);
  React.useEffect(() => {
    for (const theme of Object.values(EditorTheme)) {
      const stylesheetId = `highlight-${theme}`;
      const stylesheet = document.getElementById(stylesheetId) as HTMLLinkElement;
      if (stylesheet) {
        stylesheet.disabled = true;
      }
    }
    const stylesheetId = `highlight-${editorTheme}`;
    const enabledStylesheet = document.getElementById(stylesheetId) as HTMLLinkElement;
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
    <Collapse
      isOpen={log.open}
      transitionDuration={props.transitionDuration}
      className="console-container"
    >
      <Pre className="console">
        {logEventSelectors
          .selectAll(log)
          .filter(({ payload }) => payload.student_code || settings.showSystem)
          .map((event, index) => (
            <LogEvent key={index} event={event} settings={settings} />
          ))}
        <div ref={bottom} />
      </Pre>
      <Button
        className="log-pin"
        intent={Intent.PRIMARY}
        icon={IconNames.AUTOMATIC_UPDATES}
        onClick={() =>
          dispatch(
            settingsSlice.actions.update({
              path: 'log.pinToBottom',
              value: !settings.pinToBottom,
            })
          )
        }
        active={settings.pinToBottom}
      />
    </Collapse>
  );
}
