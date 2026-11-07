import React, {useMemo} from 'react';
import Svg, {Path, Rect} from 'react-native-svg';
import {encodeQr} from '../lib/qr/encode';

/** One path of 1x1 squares for every dark module, so a code draws as a single shape. */
export const qrPath = (modules: boolean[][], quiet: number): string => {
  let path = '';
  modules.forEach((row, y) =>
    row.forEach((dark, x) => {
      if (dark) path += `M${x + quiet} ${y + quiet}h1v1h-1z`;
    }),
  );
  return path;
};

/**
 * A QR code of `value`, dark on light whatever the theme, so phone cameras
 * read it from a TV across the room. Renders nothing when the text cannot be
 * encoded.
 */
const QrCode = ({value, size = 200, accessibilityLabel}: {value: string; size?: number; accessibilityLabel?: string}) => {
  const drawn = useMemo(() => {
    try {
      const qr = encodeQr(value);
      // The standard asks for a four-module light border.
      return {extent: qr.size + 8, path: qrPath(qr.modules, 4)};
    } catch {
      return undefined;
    }
  }, [value]);
  if (!drawn) return null;
  return (
    <Svg width={size} height={size} viewBox={`0 0 ${drawn.extent} ${drawn.extent}`} accessibilityLabel={accessibilityLabel}>
      <Rect x={0} y={0} width={drawn.extent} height={drawn.extent} fill="#ffffff" />
      <Path d={drawn.path} fill="#000000" />
    </Svg>
  );
};

export default QrCode;
