export function flattenObject(obj: any, prefix?: string, result: any = {}) {
  for (const key of Object.keys(obj)) {
    if (key === '@context') {
      result[key] = obj[key];
    } else {
      const newKey = prefix ? `${prefix}.${key}` : key;
      if (typeof obj[key] === 'object' && obj[key] !== null) {
        flattenObject(obj[key], newKey, result);
      } else {
        result[newKey] = obj[key];
      }
    }
  }
  return result;
}