import jwt from 'jsonwebtoken';
import { env } from '@/config/env';
export interface TokenPayload {
  userId: number;
  roleId: number;
}
export const generateAccessToken = (payload: TokenPayload): string => {
  return jwt.sign(payload, env.JWT_ACCESS_TOKEN_SECRET, {
    expiresIn: env.JWT_ACCESS_TOKEN_EXPIRES_IN as jwt.SignOptions['expiresIn'],
  });
};
export const generateRefreshToken = (payload: TokenPayload): string => {
  return jwt.sign(payload, env.JWT_REFRESH_TOKEN_SECRET, {
    expiresIn: env.JWT_REFRESH_TOKEN_EXPIRES_IN as jwt.SignOptions['expiresIn'],
  });
};
