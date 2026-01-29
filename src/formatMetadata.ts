import { flattenObject } from "./flattenObject.js"; 
import type { Metadata } from "./extractMetadata.js";

export function formatMetadata(metadata: Metadata): void {
    const flattened = flattenObject(metadata);

    Object.keys(metadata).forEach(key => delete metadata[key]);

    metadata['@context'] = {
        "xmp": 'http://ns.adobe.com/xap/1.0/',
        "xmpMM": 'http://ns.adobe.com/xap/1.0/mm/',
        "plus": 'http://ns.adobe.com/xap/1.0/plus/',
        'exif': 'http://ns.adobe.com/exif/1.0/',
        'exifEX': 'http://cipa.jp/exif/2.32/',
        'tiff': 'http://ns.adobe.com/tiff/1.0/',
        'Iptc4xmpCore': 'http://iptc.org/std/Iptc4xmpCore/1.0/xmlns/',
        'Iptc4xmpExt': 'http://iptc.org/std/Iptc4xmpExt/2008-02-29/',
    };

    Object.assign(metadata, flattened);
}