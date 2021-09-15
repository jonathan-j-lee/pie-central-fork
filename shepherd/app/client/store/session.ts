import { createAsyncThunk } from '@reduxjs/toolkit';
import request from 'superagent';
import type { RootState } from '.';
import { Session } from '../../types';

export const fetch = createAsyncThunk<Session>(
  'session/fetch',
  async (arg, thunkAPI) => {
    const response = await request.get('/session');
    return response.body;
  },
);

export const save = createAsyncThunk<void, Session>(
  'session/save',
  async (session, thunkAPI) => {
    await request.put('/session').send(session);
    await thunkAPI.dispatch(fetch()).unwrap();
  },
);
