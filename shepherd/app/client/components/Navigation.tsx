import * as React from 'react';
import { useHistory, useLocation } from 'react-router-dom';
import { Button, Icon, IconName, Navbar, Tab, Tabs } from '@blueprintjs/core';
import { IconNames } from '@blueprintjs/icons';

const Title = (props: { icon: IconName, title: string }) => (
  <>
    <Icon icon={props.icon} /> {props.title}
  </>
);

export default function Navigation() {
  const history = useHistory();
  const location = useLocation();
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
          <Tab id="/game" title={<Title icon={IconNames.FLAG} title="Game" />} />
          <Tab
            id="/dashboard"
            title={<Title icon={IconNames.DASHBOARD} title="Dashboard" />}
          />
        </Tabs>
      </Navbar.Group>
    </Navbar>
  );
}
