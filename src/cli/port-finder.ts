import net from 'net';

export interface PortFinderOptions {
  preferredPort?: number;
  rangeStart?: number;
  rangeEnd?: number;
}

export interface PortFinderResult {
  port: number;
  isPreferred: boolean;
}

function isPortAvailable(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once('error', () => resolve(false));
    server.once('listening', () => {
      server.close(() => resolve(true));
    });
    server.listen(port, '127.0.0.1');
  });
}

export async function findAvailablePort(
  options: PortFinderOptions = {}
): Promise<PortFinderResult> {
  const { preferredPort, rangeStart = 3000, rangeEnd = 9000 } = options;

  // Try preferred port first
  if (preferredPort && preferredPort >= 1024 && preferredPort <= 65535) {
    if (await isPortAvailable(preferredPort)) {
      return { port: preferredPort, isPreferred: true };
    }
  }

  // Scan range for available port
  for (let port = rangeStart; port <= rangeEnd; port++) {
    if (await isPortAvailable(port)) {
      return { port, isPreferred: false };
    }
  }

  throw new Error(
    `No available port found in range ${rangeStart}-${rangeEnd}. Please check for port conflicts.`
  );
}
