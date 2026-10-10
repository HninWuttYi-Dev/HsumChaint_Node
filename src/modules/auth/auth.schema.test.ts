import { describe, expect, it } from 'bun:test';
import { registerSchema } from './auth.schema';

describe('public registration roles', () => {
  const body = { name: 'Test Donor', phone: '09123456789', password: 'Password123!' };

  it('accepts donors', () => {
    expect(registerSchema.safeParse({ body: { ...body, roleId: 2 } }).success).toBe(true);
  });

  it('accepts monks with monastery information', () => {
    expect(
      registerSchema.safeParse({
        body: {
          ...body,
          roleId: 1,
          monasteryName: 'Test',
          monasteryAddress: 'Yangon',
        },
      }).success
    ).toBe(true);
  });

  it('rejects arbitrary and non-integer role IDs', () => {
    for (const roleId of [0, 3, -1, 1.5]) {
      expect(registerSchema.safeParse({ body: { ...body, roleId } }).success).toBe(false);
    }
  });
});
