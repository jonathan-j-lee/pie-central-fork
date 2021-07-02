export const makeUpdateReducer = name => (state, action) => {
  state[name] = action.payload;
};

export const makeToggleReducer = name => state => {
  state[name] = !state[name];
};

export const makeAppendReducer = (name, low, high) => (state, action) => {
  const size = state[name].push(action.payload);
  if (size >= high) {
    state[name] = state[name].slice(-low);
  }
};
