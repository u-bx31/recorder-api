import { Router } from 'express';
import { getYt } from '../controllers/yt-controller';

const router = Router();

router.get('/yt', getYt);

export default router;