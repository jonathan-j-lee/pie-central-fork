import * as React from 'react';

import {
    Alignment,
    Button,
    ButtonGroup,
    Intent,
    Popover,
    PopoverInteractionKind,
    Menu,
    MenuItem,
    Navbar,
    Tag,
} from '@blueprintjs/core';
import { IconNames } from '@blueprintjs/icons';

// const HoverPopover = ({ ...props }) =>

const DebugMenu = () => (
  <Menu>
    <MenuItem text="Lint" icon={IconNames.CODE} />
  </Menu>
);

class Toolbar extends React.Component {
  render() {
    return (
      <Navbar>
        <Navbar.Group>
          <Navbar.Heading>Dawn</Navbar.Heading>
          <Navbar.Divider />
          <ButtonGroup>
            <Button icon={IconNames.UPLOAD}>
              Upload
            </Button>
            <Button icon={IconNames.DOWNLOAD}>
              Download
            </Button>
          </ButtonGroup>
          <Navbar.Divider />
          <ButtonGroup>
            <Button icon={IconNames.STOP}>
              Stop
            </Button>
            <Button icon={IconNames.FLAME} intent={Intent.DANGER}>
              Emergency
            </Button>
          </ButtonGroup>
          <Navbar.Divider />
        </Navbar.Group>
        <Navbar.Group align={Alignment.RIGHT}>
          <Navbar.Heading>
            <Tag icon={IconNames.DRIVE_TIME} large>Teleop</Tag>
            <Tag icon={IconNames.FLAG} large>Blue</Tag>
          </Navbar.Heading>
        </Navbar.Group>
      </Navbar>
    );
  }
}

export default Toolbar;
