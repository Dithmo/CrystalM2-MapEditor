# Custom `.lib` Image Library Specification

The custom image library `.lib` file is a container format holding multiple compressed RGBA images. These images make up tiles and objects in the Map Editor.

## Overall Format

### Header Information
- `LibVersion` (int32): The version of the library (needs to be >= 2).
- `Count` (int32): The number of images stored in the library.
- If `LibVersion >= 3`, there is an additional `frameSeek` (int32).
- `IndexList` (int32 array): An array of `Count` integers, where each integer specifies the absolute byte offset within the file where the data for that image begins.

### Image Format
Each image (`MImage`) data block contains:
- `Width` (int16): The width of the image.
- `Height` (int16): The height of the image.
- `X` (int16): Offset X position to draw the image.
- `Y` (int16): Offset Y position to draw the image.
- `ShadowX` (int16): Offset X position for the shadow.
- `ShadowY` (int16): Offset Y position for the shadow.
- `Shadow` (byte): Shadow intensity / flag.
  - *Note*: If `(Shadow >> 7) == 1`, this means there is a "Mask" layer (a secondary image for shadows or blending).
- `Length` (int32): The length of the compressed image data in bytes.
- `FBytes` (byte array of size `Length`): GZip compressed image data.

If `HasMask` is true (`(Shadow >> 7) == 1`), the following properties are added to the block:
- `MaskWidth` (int16)
- `MaskHeight` (int16)
- `MaskX` (int16)
- `MaskY` (int16)
- `MaskLength` (int32)
- `MaskFBytes` (byte array of size `MaskLength`): GZip compressed mask data.

### Decompression
The bytes (`FBytes` and `MaskFBytes`) are compressed using standard `GZipStream` in .NET.
Once decompressed, the resulting bytes represent `PixelFormat.Format32bppArgb` (Alpha, Red, Green, Blue interleaved).

## HTML/JS Implementation Strategy
When porting `.lib` reading to JavaScript:
1. Load `.lib` file as an `ArrayBuffer`.
2. Wrap in a `DataView` (little-endian) to read `LibVersion`, `Count`, and loop `Count` times to read `IndexList`.
3. Fetch an image by its `index`. Seek to `IndexList[index]`.
4. Read the `int16`/`int32`/`byte` fields sequentially.
5. Slice the `ArrayBuffer` from the current offset, length = `Length`.
6. Use the Web Streams API (`DecompressionStream('gzip')`) or a library like `pako.js` to decompress `FBytes`.
7. Once decompressed, you receive a flat `Uint8Array` of RGBA pixels.
8. Create a web `ImageData` object:
   ```javascript
   const imageData = new ImageData(new Uint8ClampedArray(decompressedBuffer), width, height);
   ```
9. Draw this `ImageData` onto an offscreen `<canvas>`, or convert it to a `Blob` URL or `ImageBitmap` to use in a generic WebGL rendering engine.