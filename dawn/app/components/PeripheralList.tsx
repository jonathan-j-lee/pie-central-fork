import * as React from 'react';

import { Card, EditableText, Elevation, Icon } from '@blueprintjs/core';
import { IconNames } from '@blueprintjs/icons';

class PeripheralList extends React.Component {
  render() {
    return (
      <div className="peripherals">
        <Card elevation={Elevation.ONE}>
          <div className="dev-id">
            <span>Motor Controller</span>
            <code className="uid">309485009821345068724781055</code>
          </div>
          <span><Icon icon={IconNames.FEED} /> Motor</span>
          <EditableText placeholder="Assign a name" />
        </Card>
      </div>
    );
  }
}

export default PeripheralList;
