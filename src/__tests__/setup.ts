import { ReadableStream, TransformStream, WritableStream } from 'stream/web';
import { webcrypto } from 'crypto';

if (!globalThis.ReadableStream) {
  Object.assign(globalThis, {
    ReadableStream,
    TransformStream,
    WritableStream,
  });
}

if (!globalThis.crypto) {
  Object.assign(globalThis, {
    crypto: webcrypto,
  });
}

if (!AbortSignal.prototype.throwIfAborted) {
  AbortSignal.prototype.throwIfAborted = function throwIfAborted() {
    if (this.aborted) {
      throw this.reason;
    }
  };
}
