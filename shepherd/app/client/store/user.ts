import { User, Session } from '../../types';
import { fetch as fetchSession, save as saveSession } from './session';
import { createAsyncThunk, createSlice, PayloadAction } from '@reduxjs/toolkit';
import * as _ from 'lodash';
import request from 'superagent';

interface LogInRequest {
  username: string;
  password: string;
}

export const logIn = createAsyncThunk<void, LogInRequest | undefined>(
  'user/logIn',
  async (payload, thunkAPI) => {
    if (payload) {
      await request.post('/login').send(payload);
    }
    await thunkAPI.dispatch(fetchSession()).unwrap();
  }
);

export const logOut = createAsyncThunk('user/logOut', async () => {
  await request.post('/logout');
});

export default createSlice({
  name: 'user',
  initialState: {
    username: null,
    darkTheme: true,
    game: null,
  } as User,
  reducers: {},
  extraReducers(builder) {
    builder
      .addCase(logOut.fulfilled, (state) => {
        state.username = null;
      })
      .addCase(saveSession.pending, (state, action) => ({
        ...state,
        ...action.meta.arg.user,
      }))
      .addCase(fetchSession.fulfilled, (state, action: PayloadAction<Session>) =>
        _.merge({}, state, action.payload.user)
      );
  },
});
