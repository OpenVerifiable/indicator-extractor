export function getSignatureAlgoName(algorithm: { coseIdentifier: number }): string {
  switch (algorithm.coseIdentifier) {
    case -7:
      return 'ES256';
    case -35:
      return 'ES384';
    case -36:
      return 'ES512';
    case -37:
      return 'PS256';
    case -38:
      return 'PS384';
    case -39:
      return 'PS512';
    case -8:
      return 'Ed25519';
    default:
      return 'Unknown';
  }
}