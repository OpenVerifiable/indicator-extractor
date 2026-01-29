/**
 * Recursively converts Uint8Array hash fields to base64 strings.
 * This makes the data JSON-serializable and human-readable.
 *
 * @param {Object} obj - Object to process for hash field conversion
 *
 * @private
 */
export function convertHashFields(obj: unknown) {
  if (isObject(obj)) {
    Object.keys(obj).forEach(key => {
      if (key === 'hash') {
        processHashField(obj, key);
      } else {
        convertHashFields(obj[key]);
      }
    });
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object';
}

function processHashField(obj: Record<string, unknown>, key: string) {
  if (obj[key] instanceof Uint8Array) {
    obj[key] = Buffer.from(obj[key]).toString('base64');
  } else if (Array.isArray(obj[key]) && obj[key].every(n => typeof n === 'number')) {
    obj[key] = Buffer.from(obj[key]).toString('base64');
  }
}
