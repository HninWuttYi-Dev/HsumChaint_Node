import { beforeEach, describe, expect, it, vi } from 'bun:test';
import type { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { env } from '@/config/env';
import { authMiddleware } from '@/middlewares/authMiddleWare';
import { AppError } from '@/utils/AppError';
import { generateAccessToken, type TokenPayload } from '@/utils/jwt';

describe('authMiddleware Unit Test', () => {
  let mockReq: { headers: Record<string, string>; user?: TokenPayload };
  let mockRes: Record<string, unknown>;
  let next: ReturnType<typeof vi.fn>;
  //Arrange: Set up the mock request, response, and next function before each test
  beforeEach(() => {
    mockReq = { headers: {} }; //simulates incoming request with empty headers
    mockRes = {}; //not used here because middleware uses next(error) to handle errors
    next = vi.fn(); //mock function to track calls to next()
  });
  it('preserves signed pre-migration Monk and Donor sessions', () => {
    for (const [userType, roleId] of [['Monk', 1], ['Donor', 2]] as const) {
      const token = jwt.sign({ userId: 1, userType }, env.JWT_ACCESS_TOKEN_SECRET);
      mockReq.headers.authorization = `Bearer ${token}`;
      authMiddleware(mockReq as unknown as Request, mockRes as unknown as Response, next as NextFunction);
      expect(mockReq.user).toMatchObject({ userId: 1, roleId });
    }
  });
  //Test case 1: No Authorization Header
  it('should throw 401 if Authorization header is missing', () => {
    authMiddleware(
      mockReq as unknown as Request,
      mockRes as unknown as Response,
      next as unknown as NextFunction
    );
    const error = next.mock.calls[0][0];
    expect(error).toBeInstanceOf(AppError);
    expect(error.statusCode).toBe(401);
    expect(error.message).toBe('Unauthorized');
  });
  //Test case 2: Invalid Format (No Bearer Token)
  it('should throw 401 of token format is not Bearer', () => {
    mockReq.headers.authorization = 'Basic validtoken';
    authMiddleware(
      mockReq as unknown as Request,
      mockRes as unknown as Response,
      next as unknown as NextFunction
    );
    const error = next.mock.calls[0][0];
    expect(error).toBeInstanceOf(AppError);
    expect(error.statusCode).toBe(401);
    expect(error.message).toBe('Unauthorized');
  });
  //Test case 3: Valid Token
  it('should attach user to req and call next() if token is valid', () => {
    const payload: TokenPayload = { userId: 1, roleId: 1 };
    const token = generateAccessToken(payload);
    mockReq.headers.authorization = `Bearer ${token}`;
    authMiddleware(
      mockReq as unknown as Request,
      mockRes as unknown as Response,
      next as unknown as NextFunction
    );
    expect(next).toHaveBeenCalledWith(); //next() should be called without arguments
    expect(mockReq.user).toMatchObject(payload); //req.user should be set to the decoded payload
  });
  //Test case  4: Invalid/ Expired Token
  it('should throw 401 if token is invalid or expired', () => {
    mockReq.headers.authorization = 'Bearer fake_token';
    authMiddleware(
      mockReq as unknown as Request,
      mockRes as unknown as Response,
      next as unknown as NextFunction
    );
    const error = next.mock.calls[0][0];
    expect(error).toBeInstanceOf(AppError);
    expect(error.statusCode).toBe(401);
    expect(error.message).toBe('Invalid or expired token');
  });
});
