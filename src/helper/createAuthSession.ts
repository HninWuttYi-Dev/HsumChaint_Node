import type { Prisma } from 'prisma-client';
import { generateAccessToken, generateRefreshToken, type TokenPayload } from '@/utils/jwt';
import type { prisma } from '../lib/prisma';
/**
 * helper: generate a session(accessToken + refreshToken ) and stores refreshToken in database
 */
export const createAuthSession = async (
  tx: Prisma.TransactionClient | typeof prisma,
  userId: TokenPayload['userId'],
  roleId: TokenPayload['roleId']
) => {
  const accessToken = generateAccessToken({ userId, roleId });
  const refreshToken = generateRefreshToken({ userId, roleId });
  await tx.refreshToken.create({
    data: {
      userId,
      refreshToken,
      expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    },
  });
  return { accessToken, refreshToken };
};
