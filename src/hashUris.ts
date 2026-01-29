/**
 * Produces a JSON object for a HashedURI.
 *
 * A HashedURI typically contains a URI, a hash (Uint8Array or Buffer), and the algorithm
 * This function returns a JSON-serializable object with the URI and the hash as a base64 string.
 *
 * @param {Object} hashedURI - The HashedURI object with 'uri' and 'hash' fields
 * @returns {Object} JSON object with 'uri' and 'hash' (base64)
 */
function hashedURIToJSON(hashedURI: { uri?: string; hash?: unknown; alg?: unknown }): { url: string | null; hash: string | null; alg?: unknown } {
  if (!hashedURI || typeof hashedURI !== 'object') return {
    url: '',
    hash: '',
    alg: ''
  };

  const { uri, hash, alg } = hashedURI;
  let hashBase64: string | null = null;

  if (hash instanceof Uint8Array || Buffer.isBuffer(hash)) {
    hashBase64 = Buffer.from(hash).toString('base64');
  } else if (Array.isArray(hash) && hash.every(n => typeof n === 'number')) {
    hashBase64 = Buffer.from(hash).toString('base64');
  }

  const result: { url: string | null; hash: string | null; alg?: unknown } = {
    url: uri || null,
    hash: hashBase64,
  };

  if (alg !== null) result.alg = alg;

  return result;
}

export function processHashedURIs(hashedURIs: unknown): Array<{ url: string | null; hash: string | null; alg?: unknown }> {
  if (!hashedURIs || !Array.isArray(hashedURIs)) return [];
  return hashedURIs.map((hashedURI: unknown) => hashedURIToJSON(hashedURI as { uri?: string; hash?: unknown; alg?: unknown }));
}

