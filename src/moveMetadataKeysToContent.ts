export function moveMetadataKeysToContent(indicatorSet: {
  metadata: any;
  content: any;
}): void {
  const keysToMove = [
    'imageWidth',
    'imageHeight',
    'bitDepth',
    'colorType',
    'compression',
    'filter',
    'interlace',
    'fileType',
  ];

  keysToMove.forEach((key) => {
    if (indicatorSet.metadata.hasOwnProperty(key)) {
      indicatorSet.content[key] = indicatorSet.metadata[key];
      delete indicatorSet.metadata[key];
    }
  });
}