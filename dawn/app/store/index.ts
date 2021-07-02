import { configureStore } from '@reduxjs/toolkit';
import createSagaMiddleware from 'redux-saga';
import effects from './effects';

import editor from './editor';
import log from './log';
import peripherals from './peripherals';
import robot from './robot';

const sagaMiddleware = createSagaMiddleware();
const store = configureStore({
  reducer: {
    log: log.reducer,
    editor: editor.reducer,
    peripherals: peripherals.reducer,
    robot: robot.reducer,
  },
  middleware: [
    sagaMiddleware,
  ],
});

sagaMiddleware.run(effects);

window.runtime.handleSetup(event => {
  const { robot: { host } } = store.getState();
  window.runtime.connect({ host });
});

window.runtime.handleUpdate((event, err, [update]) =>
  store.dispatch(peripherals.actions.appendRobotUpdate(update)));

window.runtime.handleEvent((event, err, [logEvent]) => {
  store.dispatch(log.actions.append(logEvent));
  if (logEvent.level === 'error') {
    store.dispatch(robot.actions.setError());
  }
});

export default store;
export type RootState = ReturnType<typeof store.getState>;
export type AppDispatch = typeof store.dispatch;
