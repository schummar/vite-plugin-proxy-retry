import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import  http from 'node:http'
import viteProxyRetryPlugin from '../dist/index.js'
const __dirname = fileURLToPath(new URL('.', import.meta.url));

const events = []
const event = (message) => {
  events.push(message)
  console.log(message)
}
const expectedEvents = [
  'Vite server listening on port 1337',
  'Sending request to localhost:1337/ping before proxy is up',
  'Sending request to localhost:1337/ping when ping server is starting!',
  'Starting ping server!',
  'Ping server listening!',
  'Proxy responded with 200!'
]

const server = await createServer({
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
          delay: 300
        }
      }
    },
  },
  logLevel: 'silent'
});
await server.listen();
event('Vite server listening on port 1337')

// Assert that calling localhost:1337/ping will now return 500 since the server is not running
event('Sending request to localhost:1337/ping before proxy is up')
const resProxyNotAvailable = await fetch('http://localhost:1337/ping')
if (resProxyNotAvailable.status !== 500) {
  throw new Error('Proxy did not return 500')
}

// Now start the server
const pingServer = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('pong');
});
pingServer.on('listening', () => {
  event('Ping server listening!')
})
setTimeout(async () => {
  event('Starting ping server!')
  pingServer.listen(1338);
}, 150)
event('Sending request to localhost:1337/ping when ping server is starting!')
const resProxyAvailable = await fetch('http://localhost:1337/ping')
if (resProxyAvailable.status !== 200) {
  throw new Error('Proxy did not return 200')
}
event('Proxy responded with 200!')

pingServer.close()
await server.close()

// Check that the events were called in the correct order
if (events.length !== expectedEvents.length) {
  throw new Error('Expected events were not called in the correct order')
}
expectedEvents.forEach((event, index) => {
  if (events[index] !== event) {
    throw new Error(`Expected event ${event} at index ${index} but got ${events[index]}`)
  }
})

console.log('All events were called in the correct order! Retrying proxy is working :)')
