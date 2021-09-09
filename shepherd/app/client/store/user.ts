import { createAsyncThunk, createSlice } from '@reduxjs/toolkit';
import request from 'superagent';

interface LogInRequest {
  username: string;
  password: string;
}

export interface UserState {
  username: null | string;
  game: null | string;
}

export const logIn = createAsyncThunk<UserState, LogInRequest | undefined>(
  'user/logIn',
  async (payload, thunkAPI) => {
    if (payload) {
      await request.post('/login').send(payload);
    }
    const response = await request.get('/user');
    return response.body as UserState;
  }
);

export const logOut = createAsyncThunk('user/logOut', async (arg, thunkAPI) => {
  await request.post('/logout');
});

export default createSlice({
  name: 'user',
  initialState: {
    username: null,
    game: null,
  } as UserState,
  reducers: {},
  extraReducers: (builder) => {
    builder
      .addCase(logIn.fulfilled, (state, action) => ({ ...state, ...action.payload }))
      .addCase(logOut.fulfilled, (state) => {
        state.username = null;
      });
  },
});
