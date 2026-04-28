import { Router } from 'express';
import { getAudio } from '../controllers/yt-controller';

const router = Router();

router.get('/yt/:id', getAudio);

export default router;