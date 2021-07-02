import { all, delay, fork, put, select } from 'redux-saga/effects';
import { useAppDispatch, useAppSelector } from '../hooks';
import log from './log';
import robot from './robot';
import peripherals, { UPDATE_LWM, EXPIRY, getQueueFront, getQueueBack } from './peripherals';

function *updateGamepads() {
  while (true) {
    console.log('OK boomer!');
    yield delay(500);
  }
}

function *updateConnectionStatus() {
  while (true) {
    const robotUpdates = yield select(state => state.peripherals.robotUpdates);
    const front = getQueueFront(robotUpdates) || { timestamp: 0 };
    const back = getQueueBack(robotUpdates) || { timestamp: 0 };
    const now = Date.now();
    let updateRate;
    if (now - back.timestamp > 2*EXPIRY) {
      updateRate = 0;
    } else {
      const timeElapsed = now - front.timestamp;
      updateRate = 1000*Math.min(UPDATE_LWM, robotUpdates.length)/timeElapsed;
    }
    yield put(robot.actions.setUpdateRate(updateRate));
    yield delay(200);
  }
}

export default function *effects() {
  yield all([
    // fork(updateGamepads),
    fork(updateConnectionStatus),
  ]);
}
