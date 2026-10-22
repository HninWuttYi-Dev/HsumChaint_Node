import { Router } from 'express';
import { z } from 'zod';
import { authMiddleware } from '@/middlewares/authMiddleWare';
import { validator } from '@/middlewares/validator';
import { successResponse } from '@/utils/response';
import { settingBody } from './user-setting.schema';
import { saveSetting } from './user-setting.service';

export const userSettingRouter = Router();
userSettingRouter.use(authMiddleware);
userSettingRouter.get('/me', async (req, res, next) => {
  try {
    return successResponse(res, await saveSetting(req.user.userId), 'User settings');
  } catch (error) {
    next(error);
  }
});
userSettingRouter.put('/me', validator(z.object({ body: settingBody })), async (req, res, next) => {
  try {
    return successResponse(
      res,
      await saveSetting(req.user.userId, settingBody.parse(req.body)),
      'Settings updated'
    );
  } catch (error) {
    next(error);
  }
});
