import http from 'http';
import type net from 'net';
import { createLogger, type HttpProxy, type Plugin, type ProxyOptions } from 'vite';

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

// Change to `info` for development.
const logger = createLogger('warn', {
  prefix: '[viteProxyRetryPlugin]',
})

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

            // Vite will call this configure function first and only after that install its own
            // proxy middleware.
            entryOptions.configure = (proxy, proxyOptions) => {
              logger.info('calling wrapped configure', {
                timestamp: true,
              })

              let defaultErrorListener: HttpProxy.ErrorCallback;
              proxy.on(
                'error',
                (
                  error,
                  request: http.IncomingMessage & {
                    attempt?: number
                    currentDelay?: number
                  },
                  response: http.ServerResponse | net.Socket
                ) => {
                  // Request `error` and `aborted` event listeners get added on each `proxy.web` call.
                  const requestErrorListeners = request.listeners('error')
                  const requestAbortedListeners = request.listeners('aborted')
                  if (requestErrorListeners.length !== 1 || requestAbortedListeners.length !== 1) {
                    throw new Error('Multiple request error listeners found')
                  }
                  request.removeAllListeners('error')
                  request.removeAllListeners('aborted')

                  logger.info('Received node-http-proxy error', {
                    timestamp: true,
                  })
                  const attempt = request.attempt ?? 0
                  const currentDelay = request.currentDelay ?? delay

                  if (attempt + 1 < maxTries) {
                    request.attempt = attempt + 1
                    request.currentDelay = Math.min(currentDelay * (backoff ? 2 : 1), maxDelay)

                    setTimeout(() => {
                      if (
                        response.writableEnded ||
                        (response instanceof http.ServerResponse && response.headersSent)
                      ) {
                        // This may happen if removing the default error listener doesn't work (changes in Vite internals/etc)
                        logger.warn(
                          'Cannot retry request since sending response has already started. This may be caused by plugins conflicting with proxy changes or changes in Vite internals.',
                          {
                            timestamp: true,
                          }
                        )
                        return
                      }
                      if ('req' in response) {
                        proxy.web(request, response, proxyOptions)
                      } else {
                        proxy.ws(request, response, proxyOptions)
                      }
                    }, currentDelay)

                    return
                  } else {
                    logger.info('Max retries reached, calling default error listener', {
                      timestamp: true,
                    })
                    // Default error listener sends 500 error headers making proxy fail.
                    // Thus we only call it when max retries have been reached.
                    defaultErrorListener?.(error, request, response as http.ServerResponse)
                  }
                }
              )
              // Block next call to proxy.on("error") to not register Vite's own error listener which sends
              // 500 error headers making writing the actual response fail.
              const originalProxyOn = proxy.on.bind(proxy)
              const wrappedProxyOn = (eventType: string, listener: any) => {
                if (eventType === 'error') {
                  defaultErrorListener = listener as HttpProxy.ErrorCallback;
                  proxy.on = originalProxyOn
                  return proxy
                }
                return originalProxyOn(eventType, listener)
              }
              proxy.on = wrappedProxyOn

              originalConfigure?.(proxy, proxyOptions)
            }

            return [context, entryOptions]
          })
        )
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
