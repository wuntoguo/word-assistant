import 'dotenv/config';
import './db.js';
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
const schedulerEnabled =
  process.env.SCHEDULER_ENABLED === 'true' ||
  (process.env.NODE_ENV !== 'production' && process.env.SCHEDULER_ENABLED !== 'false');
if (schedulerEnabled) {
  setupScheduler();
} else {
  console.log('Scheduler disabled for this process (set SCHEDULER_ENABLED=true to enable).');
}

app.listen(Number(PORT), '0.0.0.0', () => {
  console.log(`Server running on http://0.0.0.0:${PORT}`);
});
