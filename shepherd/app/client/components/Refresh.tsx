import * as React from 'react';
import { Tag, Tooltip } from '@blueprintjs/core';
import { IconNames } from '@blueprintjs/icons';
import { useAppDispatch } from '../hooks';
import { init as initControl, refresh } from '../store/control';
import { displayTime } from '../../types';

export default function Refresh(props: { interval: number }) {
  const dispatch = useAppDispatch();
  const [timeRemaining, setTimeRemaining] = React.useState(props.interval);
  React.useEffect(() => {
    dispatch(initControl());
    let lastUpdate = 0;
    const intervalId = setInterval(() => {
      const nextUpdate = lastUpdate + props.interval;
      const now = Date.now();
      if (nextUpdate <= now) {
        dispatch(refresh());
        lastUpdate = now;
        setTimeRemaining(props.interval);
      } else {
        setTimeRemaining(nextUpdate - now);
      }
    }, 1000);
    return () => clearInterval(intervalId);
  }, [dispatch, props.interval, setTimeRemaining]);
  return (
    <Tooltip content={<span>Time until the next refresh.</span>}>
      <Tag className="refresh-tag" large icon={IconNames.REFRESH}>
        <code>{displayTime(timeRemaining / 1000, 0)}</code>
      </Tag>
    </Tooltip>
  );
}
