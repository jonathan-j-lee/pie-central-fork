import { createSlice } from '@reduxjs/toolkit';
import { makeAppendReducer } from './util';

export const UPDATE_LWM = 50;
export const UPDATE_HWM = 100;
export const EXPIRY = 5000;

const addTimestamp = action => ({
  ...action,
  payload: { timestamp: Date.now(), devices: action.payload },
});
const appendRobotUpdate = makeAppendReducer('robotUpdates', UPDATE_LWM, UPDATE_HWM);
const appendGamepadUpdate = makeAppendReducer('gamepadUpdates', UPDATE_LWM, UPDATE_HWM);

export default createSlice({
  name: 'peripherals',
  initialState: {
    robotUpdates: [],
    gamepadUpdates: [],
  },
  reducers: {
    appendRobotUpdate: (state, action) =>
      appendRobotUpdate(state, addTimestamp(action)),
    appendGamepadUpdate: (state, action) =>
      appendGamepadUpdate(state, addTimestamp(action)),
  },
});

export function getQueueFront(queue) {
  return queue.length <= UPDATE_LWM ? queue[0] : queue[queue.length - UPDATE_LWM];
}

export function getQueueBack(queue) {
  return queue[queue.length - 1];
}
