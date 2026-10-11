import { execSync } from 'node:child_process';

/**
 * Applies pending migrations to a dedicated test database. Tests never touch dev/prod data:
 * each test file truncates the test database's tables via resetDb().
 */
export default function setup() {
  const url = process.env.TEST_DATABASE_URL ?? 'postgresql://ticket:ticket@localhost:5432/ticket_test?schema=public';
  if (!/test/i.test(url)) throw new Error(`Refusing to run tests against a non-test database: ${url}`);
  execSync('npx prisma migrate deploy', {
    stdio: 'pipe',
    env: { ...process.env, DATABASE_URL: url },
  });
}
