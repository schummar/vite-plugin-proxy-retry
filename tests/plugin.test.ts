import http from 'node:http';
import type { ViteDevServer } from 'vite';
import { createServer } from 'vite';
import { describe, expect, test } from 'vitest';
import viteProxyRetryPlugin from '../src/index';

describe('the vite-plugin-proxy-retry plugin allows retrying proxied requests', () => {
  test('without the plugin, proxied requests fail when upstream is down', async () => {
    let server: ViteDevServer | undefined;

    try {
      server = await createServer({
        // any valid user config options, plus `mode` and `configFile`
        configFile: false,
        root: __dirname,
        server: {
          port: 1337,
          proxy: {
            '/ping': {
              target: 'http://localhost:1338',
              retry: {
                maxTries: 2,
                delay: 300,
              },
            },
          },
        },
        logLevel: 'silent',
      });
      await server.listen();

      const start = performance.now();
      const response = await fetch('http://localhost:1337/ping');
      const took = performance.now() - start;

      expect(response.status).toBe(500);
      expect(took).toBeLessThan(100);
    } finally {
      await server?.close();
    }
  });

  test('with the plugin, proxied requests fail after the defined number of retries', async () => {
    let server: ViteDevServer | undefined;

    try {
      server = await createServer({
        // any valid user config options, plus `mode` and `configFile`
        configFile: false,
        root: __dirname,
        plugins: [viteProxyRetryPlugin()],
        server: {
          port: 1337,
          proxy: {
            '/ping': {
              target: 'http://localhost:1338',
              retry: {
                maxTries: 2,
                delay: 300,
              },
            },
          },
        },
        logLevel: 'silent',
      });
      await server.listen();

      const start = performance.now();
      const response = await fetch('http://localhost:1337/ping');
      const took = performance.now() - start;

      expect(response.status).toBe(500);
      expect(took).toBeGreaterThan(300);
    } finally {
      await server?.close();
    }
  });

  test('with the plugin, proxied requests succeed when upstream comes back up', async () => {
    let server: ViteDevServer | undefined;
    let pingServer: http.Server | undefined;

    try {
      server = await createServer({
        // any valid user config options, plus `mode` and `configFile`
        configFile: false,
        root: __dirname,
        plugins: [viteProxyRetryPlugin()],
        server: {
          port: 1337,
          proxy: {
            '/ping': {
              target: 'http://localhost:1338',
              retry: {
                maxTries: 2,
                delay: 300,
              },
            },
          },
        },
        logLevel: 'silent',
      });
      await server.listen();

      pingServer = http.createServer((_request, response) => {
        response.writeHead(200, { 'Content-Type': 'text/plain' });
        response.end('pong');
      });
      setTimeout(() => pingServer?.listen(1338), 150);

      const start = performance.now();
      const response = await fetch('http://localhost:1337/ping');
      const took = performance.now() - start;

      expect(response.status).toBe(200);
      expect(took).toBeGreaterThan(300);
    } finally {
      await server?.close();
      pingServer?.close();
    }
  });
});
