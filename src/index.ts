import type http from 'http';
import type net from 'net';
import { type Plugin, type ProxyOptions } from 'vite';

export interface ProxyRetryOptions {
  /**
   * how often to try the request (including the initial one)
   * @default 60
   */
  maxTries?: number;
  /**
   * initial delay (in milliseconds) before next attempt
   * @default 1000
   */
  delay?: number;
  /**
   * maximum delay (in milliseconds) before next attempt
   * @default 30000
   */
  maxDelay?: number;
  /**
   * whether to use exponential backoff after failed attempts
   * @default false
   */
  backoff?: boolean;
}

export interface ProxyRetryPluginOptions {
  defaultRetryOptions?: boolean | ProxyRetryOptions;
}

declare module 'vite' {
  export interface ProxyOptions {
    retry?: boolean | ProxyRetryOptions;
  }
}

export default function viteProxyRetryPlugin(pluginOptions?: ProxyRetryPluginOptions): Plugin {
  return {
    name: 'viteProxyRetryPlugin',

    config(config) {
      if (config.server?.proxy) {
        config.server.proxy = Object.fromEntries(
          Object.entries(config.server.proxy).map(([context, entryOptions]) => {
            if (typeof entryOptions === 'string') {
              entryOptions = { target: entryOptions, changeOrigin: true } as ProxyOptions;
            }

            const retry = entryOptions.retry ?? pluginOptions?.defaultRetryOptions;
            const { maxTries, delay, maxDelay, backoff } = resolveRetryOptions(retry);

            if (maxTries <= 1) {
              return [context, entryOptions];
            }

            const originalConfigure = entryOptions.configure;

            entryOptions.configure = (proxy, proxyOptions) => {
              const defaultErrorListener = proxy.listeners('error')[1] as
                | ((
                    error: Error,
                    request: http.IncomingMessage & {
                      attempt?: number;
                      currentDelay?: number;
                    },
                    response: http.ServerResponse | net.Socket,
                  ) => void)
                | undefined;

              if (defaultErrorListener) {
                proxy.removeListener('error', defaultErrorListener as () => void);
              }

              proxy.on(
                'error',
                (
                  error,
                  request: http.IncomingMessage & {
                    attempt?: number;
                    currentDelay?: number;
                  },
                  response: http.ServerResponse | net.Socket,
                ) => {
                  const attempt = request.attempt ?? 0;
                  const currentDelay = request.currentDelay ?? delay;

                  if (attempt + 1 < maxTries) {
                    request.attempt = attempt + 1;
                    request.currentDelay = Math.min(currentDelay * (backoff ? 2 : 1), maxDelay);

                    setTimeout(() => {
                      if ('req' in response) {
                        proxy.web(request, response, proxyOptions);
                      } else {
                        proxy.ws(request, response, proxyOptions);
                      }
                    }, currentDelay);

                    return;
                  }

                  defaultErrorListener?.(error, request, response);
                },
              );

              originalConfigure?.(proxy, proxyOptions);
            };

            return [context, entryOptions];
          }),
        );
      }
    },
  };
}

const defaultRetryOptions: Required<ProxyRetryOptions> = {
  maxTries: 60,
  delay: 1000,
  maxDelay: 30_000,
  backoff: false,
};

function resolveRetryOptions(options?: boolean | ProxyRetryOptions): Required<ProxyRetryOptions> {
  if (!options) {
    return {
      maxTries: 1,
      delay: 0,
      maxDelay: 0,
      backoff: false,
    };
  }

  if (options === true) {
    return defaultRetryOptions;
  }

  return {
    maxTries: options.maxTries ?? defaultRetryOptions.maxTries,
    delay: options.delay ?? defaultRetryOptions.delay,
    maxDelay: options.maxDelay ?? defaultRetryOptions.maxDelay,
    backoff: options.backoff ?? defaultRetryOptions.backoff,
  };
}
