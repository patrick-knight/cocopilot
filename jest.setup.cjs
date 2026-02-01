// Polyfill TextEncoder/TextDecoder for react-router-dom v7+ which uses them at import time.
// Node 18 has them as globals, but some Jest environments don't expose them.
const { TextEncoder, TextDecoder } = require('node:util');
if (typeof globalThis.TextEncoder === 'undefined') {
  globalThis.TextEncoder = TextEncoder;
}
if (typeof globalThis.TextDecoder === 'undefined') {
  globalThis.TextDecoder = TextDecoder;
}
