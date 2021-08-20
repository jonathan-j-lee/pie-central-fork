import * as path from 'path';
import express from 'express';

const app = express();

app.use('/static', express.static(path.join(__dirname, 'static')));

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.listen(4040, () => {
  console.log('Listening');
});
