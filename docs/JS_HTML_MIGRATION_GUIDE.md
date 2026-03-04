# HTML and JavaScript Migration Guide (C# Map Editor)

The goal is to recreate the C# Windows Forms application Map Editor in HTML5 and JavaScript. The best approach is to decouple the UI from the rendering logic and file parsing.

## Recommended Tech Stack
- **Parsing/Decryption**: Native JavaScript `ArrayBuffer`, `DataView`, and TypedArrays. Use `DecompressionStream` (built into modern browsers) for GZIP decompression.
- **Rendering Engine**: PixiJS or Phaser 3 (WebGL-accelerated rendering). The map editor renders hundreds/thousands of sprites. The standard HTML5 `<canvas>` API (2D context) might be too slow for an entire map, but a WebGL engine can handle it efficiently. PixiJS is highly recommended because you can create Custom Textures straight from raw `ArrayBuffer` data, avoiding the need to encode images to Base64 or Blob URLs.
- **UI**: React or Vue.js for managing tools, grid snap, brush size, layers toggles, and property inspectors.

## Workflow

### 1. File Uploading / Reading
In the browser, use the `<input type="file" multiple />` or drag-and-drop to accept the `.map` and `.lib` files.
Read the files using the `FileReader` API as `readAsArrayBuffer(file)`.

### 2. Loading the Map File
- Create a map parsing class based on `MapCode.cs`.
- Parse the magic bytes at the beginning of the `ArrayBuffer`.
- Write functions corresponding to `LoadMapType0`, `LoadMapType1`, etc., but utilizing a `DataView` with little-endian reading logic (`dataView.getInt16(offset, true)`).
- Populate a 2D array of `CellInfo` objects.

### 3. Parsing the `.lib` Files
- Replicate `MLibrary.cs`.
- When a `.lib` file is read, parse the header to obtain the `IndexList`.
- Do not immediately decompress all images! This will consume too much memory (as there are thousands of images). Instead, lazily decompress the images when the `CellInfo` of a map requires it, caching the result.
- Create an async `getImage(index)` function:
  1. Jump to `IndexList[index]`.
  2. Parse `width`, `height`, `X`, `Y`, `ShadowX`, `ShadowY`, etc.
  3. Extract `FBytes` portion of `ArrayBuffer`.
  4. Decompress using `DecompressionStream('gzip')`.
  5. Convert the raw decompressed RGBA buffer into a WebGL Texture or an `ImageBitmap`.
  6. Cache the resulting Texture/ImageBitmap in a `Map`.

### 4. Rendering the Map
- Setup a render loop (e.g., `requestAnimationFrame` or `app.ticker.add` in PixiJS).
- The map is rendered by iterating through `y` and `x` in the current camera viewport (not the entire map).
- Calculate the `CellWidth` (usually 48) and `CellHeight` (usually 32).
- The rendering order should follow layers in `Main.cs -> RenderEnviroment()`:
  - Background Layer
  - Middle Layer
  - Foreground Layer
  - Doors
  - Animations (Foreground, Middle, Background)
  - Object/Selection Highlighting
- Draw each texture at the coordinates `(x * CellWidth, y * CellHeight)` adjusted by the `X` and `Y` offset values parsed from the image inside the `.lib`.

### 5. Interaction
- Convert mouse coordinates to map coordinates (`MouseX / CellWidth` + `CameraScrollX`, `MouseY / CellHeight` + `CameraScrollY`).
- Highlight the current tile underneath the mouse using a semi-transparent rectangle.
- Handle click events to place down textures or select cells. Implement properties editor logic from `FrmSetDoor.cs`, `FrmSetAnimation.cs`, etc.