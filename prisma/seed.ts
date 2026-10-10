import { prisma } from "../src/lib/prisma";
import { logger } from "../src/utils/logger";
async function userSeeder() {
  logger.info("Seeding users");
  for (const role of [{ id: 1, name: "Monk" }, { id: 2, name: "Donor" }]) {
    await prisma.role.upsert({ where: { id: role.id }, update: {}, create: role });
  }
  const password = await Bun.password.hash("password123");
  for (let i = 0; i < 5; i++) {
    const phone = `0912345678${i}`;
    await prisma.user.upsert({
      where: { phone },
      update: {},
      create: {
        phone,
        name: `testUser${i}`,
        password,
        email: `test${i}@gmail.com`,
        roleId: i % 2 === 0 ? 1 : 2,
      },
    });
  }
  logger.info("Seeding finished");
}
userSeeder()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
