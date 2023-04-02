Adds a retry option to Vite's dev server proxy. This is useful when you're developing against a backend that takes a while to start up.

## Usage

Enable retry with default options:

```ts
import { defineConfig } from "vite";
import vitePluginProxyRetry from "vite-plugin-proxy-retry";

export default defineConfig({
  plugins: [vitePluginProxyRetry()],

  server: {
    proxy: {
      "/api": {
        target: "http://localhost:8099",
        ws: true,
        retry: true,
      },
    },
  },
});
```

Specify options per proxy target:

```ts
import { defineConfig } from "vite";
import vitePluginProxyRetry from "vite-plugin-proxy-retry";

export default defineConfig({
  plugins: [vitePluginProxyRetry()],

  server: {
    proxy: {
      "/api": {
        target: "http://localhost:8099",
        ws: true,
        retry: {
          maxTries: 60,
          delay: 1000,
          maxDelay: 30_000,
          backoff: false,
        },
      },
    },
  },
});
```

Specify options globally:

```ts
import { defineConfig } from "vite";
import vitePluginProxyRetry from "vite-plugin-proxy-retry";

export default defineConfig({
  plugins: [
    vitePluginProxyRetry({
      maxTries: 60,
      delay: 1000,
      maxDelay: 30_000,
      backoff: false,
    }),
  ],

  server: {
    proxy: {
      "/api": {
        target: "http://localhost:8099",
        ws: true,
      },
    },
  },
});
```
