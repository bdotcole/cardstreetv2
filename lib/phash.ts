import sharp from 'sharp';

export async function computeDHash(imageBuffer: Buffer): Promise<Buffer> {
  const raw = await sharp(imageBuffer)
    .greyscale()
    .resize(9, 8, { fit: 'fill' })
    .raw()
    .toBuffer();
  const hash = Buffer.alloc(8);
  for (let row = 0; row < 8; row++) {
    let byte = 0;
    for (let col = 0; col < 8; col++) {
      const left = raw[row * 9 + col];
      const right = raw[row * 9 + col + 1];
      if (left > right) byte |= 1 << (7 - col);
    }
    hash[row] = byte;
  }
  return hash;
}

export function base64ToBuffer(b64: string): Buffer {
  const stripped = b64.replace(/^data:image\/\w+;base64,/, '');
  return Buffer.from(stripped, 'base64');
}

export function bufferToPostgresBytea(buf: Buffer): string {
  return '\\x' + buf.toString('hex');
}
