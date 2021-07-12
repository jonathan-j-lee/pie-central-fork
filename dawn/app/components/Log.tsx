import * as React from 'react';
import { Collapse, Intent, Pre, Tag } from '@blueprintjs/core';
import * as _ from 'lodash';
import { useAppSelector } from '../hooks';

const notContext = new Set(['timestamp', 'exception', 'event', 'level']);

const renderContext = event => {
  // TODO: make collapsible
  return (
    <span className="log-context">
      {_.toPairs(event)
        .filter(([key, value]) => !notContext.has(key))
        .sort(([key1], [key2]) => key1.localeCompare(key2))
        .map(([key, value], index) => (
          <span className="context-entry" key={index}>{key}={value}</span>
        ))
      }
    </span>
  );
};

const renderLevel = level => {
  let shortLevel = level;
  let intent = null;
  switch (level) {
    case 'INFO':
      intent = Intent.PRIMARY;
      break;
    case 'WARNING':
      shortLevel = 'WARN';
    case 'WARN':
      intent = Intent.WARNING;
      break;
    case 'CRITICAL':
      shortLevel = 'CRIT';
    case 'CRIT':
    case 'ERROR':
      intent = Intent.DANGER;
      break;
  }
  return (
    <Tag round intent={intent} className="log-severity">{shortLevel}</Tag>
  );
};

export default function Log(props) {
  const log = useAppSelector(state => state.log);
  return (
    <Collapse isOpen={props.isOpen} className="console">
      <Pre>
        {log.events.slice(-log.maxEvents)
          .filter(event => event.student_code || log.showSystem)
          .map((event, index) => (
            <span key={index}>
              {log.showTimestamps && <span>[{event.timestamp}] </span>}
              <span>{event.event}</span>
              {log.showSeverity && renderLevel(event.level.toUpperCase())}
              {renderContext(event)}
              <br />
            </span>
          ))
        }
      </Pre>
    </Collapse>
  );
};
