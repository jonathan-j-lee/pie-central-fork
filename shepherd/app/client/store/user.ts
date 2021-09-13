import { createAsyncThunk, createSlice, isAnyOf, PayloadAction } from '@reduxjs/toolkit';
import request from 'superagent';
import type { RootState } from '.';

interface LogInRequest {
  username: string;
  password: string;
}

export interface UserState {
  username: null | string;
  darkTheme: boolean;
  game: null | string;
}

export const logIn = createAsyncThunk<void, LogInRequest | undefined>(
  'user/logIn',
  async (payload, thunkAPI) => {
    if (payload) {
      await request.post('/login').send(payload);
    }
    await thunkAPI.dispatch(fetch()).unwrap();
  }
);

export const logOut = createAsyncThunk('user/logOut', async (arg, thunkAPI) => {
  await request.post('/logout');
});

export const fetch = createAsyncThunk(
  'user/fetch',
  async (payload, thunkAPI) => {
    const response = await request.get('/user');
    return response.body as UserState;
  },
);

export const save = createAsyncThunk<void, Partial<UserState>, { state: RootState }>(
  'user/save',
  async (changes, thunkAPI) => {
    await request.put('/user').send(changes);
    await thunkAPI.dispatch(fetch()).unwrap();
  },
);

export default createSlice({
  name: 'user',
  initialState: {
    username: null,
    darkTheme: true,
    game: null,
  } as UserState,
  reducers: {},
  extraReducers: (builder) => {
    builder
      .addCase(logOut.fulfilled, (state) => {
        state.username = null;
      })
      .addMatcher(isAnyOf(fetch.fulfilled, save.pending),
        (state, action: PayloadAction<Partial<UserState>>) => ({ ...state, ...action.payload }));
  },
});
