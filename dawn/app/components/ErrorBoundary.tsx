import * as React from 'react';
import { Button, H1, H2, Intent, Pre } from '@blueprintjs/core';

import store from '../store';

export default class ErrorBoundary extends React.Component<{}, { err: null | Error }> {
  constructor(props) {
    super(props);
    this.state = { err: null };
  }

  static getDerivedStateFromError(err) {
    return { err };
  }

  render() {
    if (this.state.err) {
      return (
        <div className="error-boundary">
          <H1>Dawn Crashed</H1>
          <p>
            Dawn did not handle an unexpected error and cannot recover. If you can read
            this message, it is likely that Dawn has an unidentified bug.
          </p>
          <p>
            Copy the diagnostic information below into a text file and file an issue
            with the developers. Try to remember what sequence of actions you performed
            to produce this error.
          </p>
          <Button
            text="Quit"
            intent={Intent.DANGER}
            className="quit"
            onClick={() => window.ipc.send('quit')}
          />
          <H2>Stack Trace</H2>
          <Pre>{this.state.err.stack}</Pre>
          <H2>Redux State Tree</H2>
          <Pre>{JSON.stringify(store.getState(), null, 2)}</Pre>
        </div>
      );
    }
    return this.props.children;
  }
}
