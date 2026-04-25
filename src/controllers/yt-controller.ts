import { Request, Response } from 'express';

export const getYt = (req: Request, res: Response): void => {
  res.status(200).json({
    message: 'YT content',
  });
};