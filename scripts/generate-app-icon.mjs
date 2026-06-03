// Builds proper SQUARE icon sources for @capacitor/assets from the card-fan logo.
// The previous assets/icon.png was a copy of the portrait splash image, which makes
// a distorted/tiny app icon. App icons must be square and opaque (iOS rejects alpha).
//
//   assets/icon.png            1024x1024 opaque: logo centered on brand-dark (#0f1419)
//   assets/icon-background.png 1024x1024 solid brand-dark (Android adaptive background)
//
// icon-foreground.png (transparent card fan) is kept as-is for the adaptive foreground.
// After running this, run: npx capacitor-assets generate

import sharp from 'sharp';

const SIZE = 1024;
const LOGO = Math.round(SIZE * 0.72); // leave breathing room around the mark
const OFFSET = Math.round((SIZE - LOGO) / 2);
const BRAND_DARK = { r: 15, g: 20, b: 25, alpha: 1 }; // #0f1419

const logo = await sharp('assets/icon-foreground.png')
  .resize(LOGO, LOGO, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
  .toBuffer();

async function opaqueIcon(outPath) {
  await sharp({ create: { width: SIZE, height: SIZE, channels: 4, background: BRAND_DARK } })
    .composite([{ input: logo, top: OFFSET, left: OFFSET }])
    .png()
    .toFile(outPath);
}

// Write the opaque, brand-dark icon to every source name capacitor-assets might pick
// for the iOS app icon, so it can't fall back to a transparent (white-flattened) one.
await opaqueIcon('assets/icon.png');
await opaqueIcon('assets/icon-only.png');
await opaqueIcon('assets/icon-dark.png');

// Solid brand-dark background for the Android adaptive icon.
await sharp({ create: { width: SIZE, height: SIZE, channels: 4, background: BRAND_DARK } })
  .png()
  .toFile('assets/icon-background.png');

console.log('Wrote opaque brand-dark icon.png / icon-only.png / icon-dark.png + icon-background.png');
