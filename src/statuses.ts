export function getResultCodeValue(
  statusCodes: { code: string }[],
  whichCode: string
): string | null {
  const found = statusCodes.find((oneCode: any) => {
    return oneCode.code.includes(whichCode);
  });
  return found ? found.code : null;
}

export function getAssertionStatus(statusCodes: { code: string , url: string}[]): any {
  const codes: Record<string, string> = {};
  statusCodes.forEach((oneCode) => {
    if (oneCode.code.includes('assertion')) {
      const urlParts = oneCode.url.split('/');
      const lastPart = urlParts[urlParts.length - 5];
      codes[lastPart] = oneCode.code;
    }
  });
  return codes;
}