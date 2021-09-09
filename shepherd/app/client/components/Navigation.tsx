import * as React from 'react';
import { useHistory, useLocation } from 'react-router-dom';
import {
  Alignment,
  Button,
  Icon,
  IconName,
  Navbar,
  Tab,
  Tabs,
} from '@blueprintjs/core';
import { IconNames } from '@blueprintjs/icons';
import LogIn from './LogIn';
import Refresh from './Refresh';
import { DEV_ENV } from './Util';
import { useAppSelector } from '../store';

const Title = (props: { icon: IconName; title: string }) => (
  <>
    <Icon icon={props.icon} /> {props.title}
  </>
);

export default function Navigation() {
  const history = useHistory();
  const location = useLocation();
  const username = useAppSelector((state) => state.user.username);
  const game = useAppSelector((state) => state.user.game);
  return (
    <Navbar id="navbar-tabs">
      <Navbar.Group>
        <Navbar.Heading>Shepherd</Navbar.Heading>
        <Navbar.Divider />
        <Tabs
          large
          selectedTabId={location.pathname}
          onChange={(page: string) => history.push(page)}
        >
          <Tab
            id="/scoreboard"
            title={<Title icon={IconNames.TIME} title="Scoreboard" />}
          />
          <Tab
            id="/schedule"
            title={<Title icon={IconNames.CALENDAR} title="Schedule" />}
          />
          <Tab
            id="/leaderboard"
            title={<Title icon={IconNames.CROWN} title="Leaderboard" />}
          />
          {game && (
            <Tab id="/game" title={<Title icon={IconNames.FLAG} title="Game" />} />
          )}
          {(username || DEV_ENV) && (
            <Tab
              id="/dashboard"
              title={<Title icon={IconNames.DASHBOARD} title="Dashboard" />}
            />
          )}
        </Tabs>
      </Navbar.Group>
      <Navbar.Group align={Alignment.RIGHT}>
        <LogIn />
        <Refresh interval={60 * 1000} />
      </Navbar.Group>
    </Navbar>
  );
}
