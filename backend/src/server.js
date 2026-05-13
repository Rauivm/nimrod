// server.js
import { build } from './app.js';

async function start() {
  try {
    const app = await build({
      logger: true,        // mude para false se quiser menos log
    });

    await app.listen({
      port: process.env.PORT || 3000,
      host: '127.0.0.1'     // ← Essencial para Cloudflared
    });

    console.log('🚀 Nimrod rodando em http://127.0.0.1:3000');
  } catch (err) {
    console.error('❌ Erro ao iniciar o servidor:', err);
    process.exit(1);
  }
}

start();