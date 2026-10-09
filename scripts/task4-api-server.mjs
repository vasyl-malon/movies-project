import { createApplication } from '../apps/api/dist/bootstrap.js';
import { validateEnvironment } from '../apps/api/dist/config.js';
const config = validateEnvironment(process.env);
const app = await createApplication(config);
app.enableShutdownHooks();
await app.listen(config.port, '127.0.0.1');
console.info('Isolated API listening on loopback');
