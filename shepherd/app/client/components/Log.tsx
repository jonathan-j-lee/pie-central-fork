import * as React from 'react';
import {
  Button,
  ButtonGroup,
  ControlGroup,
  FormGroup,
  Icon,
  InputGroup,
  Intent,
  NumericInput,
  Position,
  Pre,
  Tag,
  TagInput,
  Tooltip,
} from '@blueprintjs/core';
import { IconName, IconNames } from '@blueprintjs/icons';
import Highlight from 'react-highlight';
import * as _ from 'lodash';
import { LogLevelSelect } from './EntitySelects';
import { OutcomeButton } from './Notification';
import { useAppDispatch, useAppSelector, useCurrentMatch } from '../hooks';
import logSlice, {
  LogEvent as LogEventData,
  selectors as logSelectors,
} from '../store/log';
import {
  GameState,
  LogLevel,
  Team,
  displayAllianceColor,
  displayLogFilter,
  displayTeam,
  parseLogFilter,
  getLogLevels,
} from '../../types';
import { save as saveSession } from '../store/session';

const NOT_CONTEXT_FIELDS = ['timestamp', 'exception', 'event', 'level'];

function LogSearch() {
  const dispatch = useAppDispatch();
  const filters = useAppSelector((state) => state.log.filters);
  return (
    <Tooltip
      className="log-search"
      position={Position.BOTTOM}
      content={
        <div className="tooltip-content">
          <p>
            You can filter events with the pattern <code>&lt;key&gt;:&lt;value&gt;</code>,
            where <code>key</code> is a property name and <code>value</code> is a JSON
            value to match.
            Prefixing the pattern with <code>!</code> will exclude events that do match.
            Press <kbd>Enter</kbd> to apply a filter.
          </p>
          <p>
            For example, <code>student_code:true !team:&#123;"number": 5&#125;</code> will
            show all events emitted by student code that are <em>not</em> from team 5's robot.
          </p>
        </div>
      }
    >
      <TagInput
        addOnBlur
        className="log-search-tags"
        leftIcon={IconNames.SEARCH}
        tagProps={{ minimal: true }}
        values={filters.map(filter => displayLogFilter(filter))}
        placeholder="Enter filters ..."
        inputProps={{ type: 'search' }}
        separator={/[\n\r]/}
        onChange={(nodes) => {
          const filters = [];
          for (const node of nodes) {
            if (_.isString(node)) {
              const filter = parseLogFilter(node);
              if (filter) {
                filters.push(filter);
              }
            }
          }
          dispatch(saveSession({ log: { filters } }));
        }}
      />
    </Tooltip>
  );
}

function MaxEventInput() {
  const dispatch = useAppDispatch();
  const maxEvents = useAppSelector((state) => state.log.maxEvents);
  const [value, setValue] = React.useState(maxEvents);
  React.useEffect(() => {
    if (value !== maxEvents) {
      setValue(maxEvents);
    }
  }, [maxEvents, setValue]);
  return (
    <NumericInput
      allowNumericCharactersOnly
      clampValueOnBlur
      placeholder="Number of lines"
      min={0}
      value={value}
      onValueChange={(value) => setValue(value)}
      onButtonClick={(value) =>
        dispatch(saveSession({ log: { maxEvents: value } }))
      }
      onBlur={({ currentTarget: { value } }) =>
        dispatch(saveSession({ log: { maxEvents: Number(value) } }))
      }
    />
  );
}

function LogControl({ events }: { events: LogEventData[] }) {
  const dispatch = useAppDispatch();
  const level = useAppSelector((state) => state.log.level);
  const pinToBottom = useAppSelector((state) => state.log.pinToBottom);
  return (
    <div className="control-bar log-control">
      <LogSearch />
      <ControlGroup>
        <MaxEventInput />
        <LogLevelSelect
          value={level}
          setValue={(level) => dispatch(saveSession({ log: { level } }))}
        />
      </ControlGroup>
      <ButtonGroup className="log-actions">
        <OutcomeButton
          text="Copy"
          icon={IconNames.DUPLICATE}
          onClick={async () => {
            const text = events
              .map((event) => JSON.stringify(event.payload))
              .join('\n');
            await navigator.clipboard.writeText(text);
          }}
          success="Copied log."
          failure="Failed to copy log."
        />
        <OutcomeButton
          text="Clear"
          icon={IconNames.CLEAN}
          onClick={async () => {
            dispatch(logSlice.actions.clear());
          }}
          success="Cleared log."
          failure="Failed to clear log."
        />
        <Button
          text="Tail"
          icon={IconNames.AUTOMATIC_UPDATES}
          active={pinToBottom}
          onClick={() => dispatch(saveSession({ log: { pinToBottom: !pinToBottom } }))}
        />
      </ButtonGroup>
    </div>
  );
}

function LogLevelTag(props: { level: LogLevel }) {
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
}

function ShowContextTag(props: { event: LogEventData }) {
  const dispatch = useAppDispatch();
  return (
    <Tag
      round
      minimal
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
}

function LogEvent(props: { event: LogEventData }) {
  const { alliance, team, level, event, timestamp, exception } = props.event.payload;
  return (
    <>
      <span>[{timestamp}] </span>
      <span>{event}</span>
      <LogLevelTag level={level} />
      <ShowContextTag event={props.event} />
      <Tag round minimal className="log-tag">{displayTeam(team)}</Tag>
      {alliance && (
        <Tag round minimal className={`log-tag ${alliance} bg`}>
          {displayAllianceColor(alliance)}
        </Tag>
      )}
      <br />
      {exception && (
        <>
          {exception.trim()}
          <br />
        </>
      )}
      {props.event.showContext && (
        <Highlight className="language-json log-context">
          {JSON.stringify(_.omit(props.event.payload, NOT_CONTEXT_FIELDS), null, 2)}
          <br />
        </Highlight>
      )}
    </>
  );
}

function useTail(timestamp: number) {
  const bottom = React.useRef<HTMLDivElement>(null);
  const pinToBottom = useAppSelector((state) => state.log.pinToBottom);
  React.useEffect(() => {
    if (pinToBottom) {
      bottom.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
    }
  }, [timestamp]);
  return bottom;
}

function useLogEvents() {
  const log = useAppSelector((state) => state.log);
  const levels = getLogLevels(log.level);
  const match = useCurrentMatch();
  const game = GameState.fromEvents(match?.events ?? []);
  return logSelectors
    .selectAll(log)
    .map((event) => ({
      ...event,
      payload: {
        ...event.payload,
        alliance: event.payload.team.id
          ? game.getAlliance(event.payload.team.id)
          : undefined,
      },
    }))
    .filter((event) => {
      if (levels.has(event.payload.level)) {
        for (const filter of log.filters) {
          const match = _.isMatch(event.payload, { [filter.key]: filter.value });
          if (filter.exclude && match || !filter.exclude && !match) {
            return false;
          }
        }
        return true;
      }
    });
}

export default function Log() {
  const events = useLogEvents();
  const bottom = useTail(Date.parse(events[events.length - 1]?.payload.timestamp));
  return (
    <>
      <LogControl events={events} />
      <Pre className="console">
        {events.map((event) => (
          <LogEvent key={event.payload.timestamp} event={event} />
        ))}
        <div ref={bottom} />
      </Pre>
    </>
  );
}
