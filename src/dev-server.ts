/**
 * Development server entry point.
 * Starts the backend API server on port 3000 for use with Vite proxy.
 */
import {createServer} from './server';

const PORT = 3000;

async function main() {
    const server = await createServer(PORT);
    const addr = server.address();
    const port = typeof addr === 'object' && addr ? addr.port : PORT;
    console.log(`[dev] Backend API server running on http://localhost:${port}`);
}

main().catch((err) => {
    console.error('[dev] Failed to start backend:', err.message);
    process.exit(1);
});
