// Polyfill browser globals that may be absent in older Node.js versions (< 16)
if (typeof globalThis.btoa === 'undefined') {
    globalThis.btoa = (str) => Buffer.from(str, 'binary').toString('base64');
    globalThis.atob = (b64) => Buffer.from(b64, 'base64').toString('binary');
}
