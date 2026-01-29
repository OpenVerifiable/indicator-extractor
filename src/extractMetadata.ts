import exifr from 'exifr';

export interface Metadata {
  [key: string]: any;
}

export async function extractMetadata(fileBuffer: Buffer): Promise<Metadata> {
  try {
    const options = {
      xmp: true,
      jf: true,
      iptc: true,
      multiSegment: true,
      merge: false,
    };

    const tags = await exifr.parse(fileBuffer, options);

    const processedMetadata: Metadata = {};

    for (const key in tags) {
      if (tags[key] !== null && tags[key] !== undefined && tags[key] !== '') {
        const camelCaseKey = key
          .replace(/([a-z])([a-z0-9_.-]+)/g, (_, b) => b.toUpperCase())
          .replace(/^([a-z0-9_.-]+)/g, (a) => a.toLowerCase());

        processedMetadata[camelCaseKey] = tags[key];
      }
    }

    return processedMetadata;
  } catch (error: any) {
    return {
      extractedAt: new Date().toISOString(),
      source: 'exifr',
      error: `Failed to extract metadata: ${error.message}`,
    };
  }
}