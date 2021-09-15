import * as React from 'react';
import * as ReactDOM from 'react-dom';
import { Provider } from 'react-redux';

import styles from './assets/custom.scss';
import App from './components/App';
import ErrorBoundary from './components/ErrorBoundary';
import store from './store';

styles.use();

ReactDOM.render(
  <Provider store={store}>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </Provider>,
  document.getElementById('content')
);
