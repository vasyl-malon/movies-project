import 'reflect-metadata';
import { createApplication } from './bootstrap.js';
import { ConfigurationError, validateEnvironment } from './config.js';

async function bootstrap(): Promise<void> {
  const config = validateEnvironment(process.env);
  const app = await createApplication(config);
  app.enableShutdownHooks();
  await app.listen(config.port);
  console.info(`Movie Tracker API listening on port ${config.port}`);
}

bootstrap().catch((error: unknown) => {
  console.error(error instanceof ConfigurationError ? error.message : 'API startup failed.');
  process.exitCode = 1;
});
