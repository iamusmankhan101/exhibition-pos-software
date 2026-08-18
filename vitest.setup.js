/**
 * Web Crypto is a browser global, and `auth.js` uses it directly because that
 * is what it will have at runtime. Vitest runs tests in a VM context that does
 * not forward `crypto` on Node 18, so it is bridged here rather than weakening
 * the module with a fallback it would never take in a browser.
 */

import { webcrypto } from 'node:crypto'

if (!globalThis.crypto) globalThis.crypto = webcrypto
