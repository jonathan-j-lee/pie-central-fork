import * as React from 'react';

import { Collapse, Pre } from '@blueprintjs/core';

class Console extends React.Component {
  render() {
    return (
      <Collapse isOpen={true} className="console">
        <Pre>
        </Pre>
      </Collapse>
    );
  }
}

export default Console;
