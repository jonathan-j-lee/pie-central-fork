import { createAsyncThunk, createSlice } from '@reduxjs/toolkit';
import request from 'superagent';

interface LogInRequest {
  username: string;
  password: string;
}

interface LogInResponse {
  username: string;
}

export const logIn = createAsyncThunk<LogInResponse, LogInRequest | undefined>(
  'user/logIn',
  async (payload, thunkAPI) => {
    let response;
    if (payload) {
      response = await request.post('/login')
        .send(payload);
    } else {
      response = await request.get('/user');
    }
    return response.body as LogInResponse;
  },
);

export const logOut = createAsyncThunk(
  'user/logOut',
  async (arg, thunkAPI) => {
    await request.post('/logout');
  },
);

export interface UserState {
  username: null | string;
};

export default createSlice({
  name: 'user',
  initialState: {
    username: null,
  } as UserState,
  reducers: {
  },
  extraReducers: (builder) => {
    builder
      .addCase(logIn.fulfilled, (state, action) => {
        state.username = action.payload.username;
      })
      .addCase(logOut.fulfilled, (state) => {
        state.username = null;
      });
  },
});
