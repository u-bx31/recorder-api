import { Router } from 'express';
import { getAudio } from '../controllers/yt-controller.js';

const router = Router();

router.get('/yt/:id', getAudio);

export default router;