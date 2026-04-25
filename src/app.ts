import express from 'express';
import yt from './routes/yt-route';

const app = express();

app.use(express.json());
app.use('/api', yt);

export default app;