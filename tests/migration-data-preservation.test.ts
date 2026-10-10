import { describe, expect, it } from 'bun:test';
import { readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { PrismaMariaDb } from '@prisma/adapter-mariadb';
import { createConnection } from 'mariadb';
import { PrismaClient } from 'prisma-client';

// Supply only a disposable MySQL server. This test creates its own database.
const serverUrl = process.env.MIGRATION_TEST_SERVER_URL;
describe.skipIf(!serverUrl)('existing-data schema upgrade', () => {
  it('preserves accounts, credentials, tokens, donors and donation relationships', async () => {
    if (!serverUrl) throw new Error('MIGRATION_TEST_SERVER_URL is required');
    const url = new URL(serverUrl);
    const database = `pr24_preservation_${crypto.randomUUID().replaceAll('-', '')}`;
    if (!/^pr24_preservation_[a-f0-9]{32}$/.test(database))
      throw new Error('Invalid test database name');
    const connection = await createConnection({
      host: url.hostname,
      port: Number(url.port || 3306),
      user: decodeURIComponent(url.username),
      password: decodeURIComponent(url.password),
      multipleStatements: true,
    });
    const migrations = resolve(import.meta.dir, '../prisma/migrations');
    try {
      await connection.query(`CREATE DATABASE \`${database}\``);
      await connection.query(`USE \`${database}\``);
      const names = (await readdir(migrations)).filter((name) => /^\d/.test(name)).sort();
      for (const name of names.filter((name) => name !== '20261010161744_init_new_schema')) {
        await connection.query(await Bun.file(resolve(migrations, name, 'migration.sql')).text());
      }

      await connection.query(
        `INSERT INTO users
        (id, phone, username, password, email, user_type, updated_at, contactPhone, avatar, fcm_token, is_deleted)
        VALUES (41, '09123456789', 'Existing Monk', 'existing-password-hash', 'monk@example.com',
          'Monk', NOW(3), ?, 'existing-avatar', 'existing-fcm', false),
          (73, '09987654321', 'Deleted Donor', 'donor-password-hash', NULL, 'Donor', NOW(3), NULL, NULL, NULL, true)`,
        ['1'.repeat(100)]
      );
      await connection.query(`INSERT INTO monk_profile (id, user_id, monastery_name, monastery_address)
        VALUES (11, 41, 'Existing Monastery', 'Existing Address')`);
      await connection.query(`INSERT INTO refresh_tokens (id, user_id, refresh_token, expires_at)
        VALUES (12, 41, 'existing-refresh-token', DATE_ADD(NOW(3), INTERVAL 1 DAY))`);
      await connection.query(`INSERT INTO password_reset_tokens (id, user_id, reset_token, expires_at)
        VALUES (13, 41, 'existing-reset-token', DATE_ADD(NOW(3), INTERVAL 1 DAY))`);
      await connection.query(`INSERT INTO donors (id, name, email, phone_no, updated_at)
        VALUES (41, 'Separate Donor Record', 'donor@example.com', '09123456789', NOW(3))`);
      await connection.query(`INSERT INTO donation_types (id, donation_type, duration, updated_at)
        VALUES (21, 'Lunch', 2, NOW(3))`);
      await connection.query(`INSERT INTO donation_lists
        (id, title, description, address, status, donation_due_date, recurrence, add_reminder, created_date, donation_type_id)
        VALUES (22, 'Existing Donation', 'Keep this description', 'Keep this address', 'Confirmed', NOW(3), 'Weekly', true, NOW(3), 21)`);
      await connection.query(`INSERT INTO donation_list_donors (id, donation_list_id, donor_id)
        VALUES (23, 22, 41)`);

      const tables = [
        'users',
        'monk_profile',
        'refresh_tokens',
        'password_reset_tokens',
        'donors',
        'donation_types',
        'donation_lists',
        'donation_list_donors',
      ];
      const before = new Map<string, Record<string, unknown>[]>();
      for (const table of tables)
        before.set(table, await connection.query(`SELECT * FROM \`${table}\` ORDER BY id`));

      await connection.query(
        await Bun.file(resolve(migrations, '20261010161744_init_new_schema/migration.sql')).text()
      );
      for (const table of tables) {
        const previous = before.get(table);
        if (!previous) throw new Error(`Missing snapshot for ${table}`);
        const expected = previous.map((row) => {
          if (table !== 'users') return { ...row };
          const { username, user_type, contactPhone, ...rest } = row;
          return {
            ...rest,
            name: username,
            role_id: user_type === 'Monk' ? 1 : 2,
            contact_phone: contactPhone,
          };
        });
        const after = await connection.query(`SELECT * FROM \`${table}\` ORDER BY id`);
        expect(Array.from(after, (row) => ({ ...row }))).toEqual(expected);
      }
      expect(await connection.query('SELECT id, name FROM Role ORDER BY id')).toMatchObject([
        { id: 1, name: 'Monk' },
        { id: 2, name: 'Donor' },
      ]);
      const client = new PrismaClient({
        adapter: new PrismaMariaDb({
          host: url.hostname,
          port: Number(url.port || 3306),
          user: decodeURIComponent(url.username),
          password: decodeURIComponent(url.password),
          database,
        }),
      });
      try {
        expect(
          await client.user.findUnique({ where: { id: 41 }, include: { monkProfile: true } })
        ).toMatchObject({
          name: 'Existing Monk',
          roleId: 1,
          password: 'existing-password-hash',
          monkProfile: { monasteryName: 'Existing Monastery' },
        });
        expect(await client.donor.findUnique({ where: { id: 41 } })).toMatchObject({
          name: 'Separate Donor Record',
          phoneNo: '09123456789',
        });
        expect(
          await client.donationList.findUnique({ where: { id: 22 }, include: { donors: true } })
        ).toMatchObject({ title: 'Existing Donation', donors: [{ donorId: 41 }] });
        expect(await client.refreshToken.findUnique({ where: { id: 12 } })).toMatchObject({
          userId: 41,
          refreshToken: 'existing-refresh-token',
        });
      } finally {
        await client.$disconnect();
      }
      await connection.query(`INSERT INTO users (phone, name, password, role_id, updated_at)
        VALUES ('09111111111', 'New Donor', 'new-password-hash', 2, NOW(3))`);
      const [newUser] = await connection.query("SELECT id FROM users WHERE phone = '09111111111'");
      expect(newUser.id).toBeGreaterThan(73);
      await connection.query(`INSERT INTO Monastery_Space (monastery_name, created_by_id)
        VALUES ('New Space', 41)`);
      const [space] = await connection.query('SELECT id FROM Monastery_Space');
      await connection.query(
        `INSERT INTO Donor_List (monastery_space_id, donor_id, donation_type_value, status_value)
        VALUES (?, 73, 1, 1)`,
        [space.id]
      );

      const drift = Bun.spawnSync(
        [
          'bun',
          'x',
          'prisma',
          'migrate',
          'diff',
          '--from-config-datasource',
          '--to-schema',
          'prisma/schema.prisma',
          '--exit-code',
        ],
        {
          cwd: resolve(import.meta.dir, '..'),
          env: { ...process.env, DATABASE_URL: `${serverUrl.replace(/\/$/, '')}/${database}` },
        }
      );
      if (drift.exitCode !== 0) throw new Error(drift.stdout.toString() + drift.stderr.toString());
      expect(drift.exitCode).toBe(0);
    } finally {
      // Only the unique test-owned database is removed.
      await connection.query(`DROP DATABASE IF EXISTS \`${database}\``);
      await connection.end();
    }
  }, 60_000);
});
