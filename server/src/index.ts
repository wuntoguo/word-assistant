import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { setupOnlineRoutes } from './online/index.js';
import { setupScheduler } from './offline/index.js';

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors({
  origin: process.env.APP_URL || 'http://localhost:5173',
  credentials: true,
}));
app.use(express.json({ limit: '5mb' }));

setupOnlineRoutes(app);
setupScheduler();

app.listen(Number(PORT), '0.0.0.0', () => {
  console.log(`Server running on http://0.0.0.0:${PORT}`);
});
