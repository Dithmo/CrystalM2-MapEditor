# Map File Format Specification

The C# map editor parses different map formats based on "magic bytes" at the beginning of the file.

## Map Header Analysis
The file format relies on reading byte headers (or checking sizes) to determine what format the file is in, and parses the 2D grid of map cells accordingly.

### Recognized Formats
- **Custom C# Format**: bytes 0 and 1 are 0x43 ('C') and 0x23 ('#') respectively (Type 100).
- **Wemade Mir3**: First byte is 0 (Type 5).
- **Shanda Mir3**: Starts with `(C) SNDA, MIR3.` -> bytes 0=0x0F, 5=0x53, 14=0x33 (Type 6).
- **Wemade AntiHack**: Starts with `Mir2 AntiHack` -> bytes 0=0x15, 4=0x32, 6=0x41, 19=0x31 (Type 4).
- **Wemade Mir2 (Normal)**: First byte 0x0F, byte 5=0x53, byte 14=0x32 (Type 0).
- **Wemade Mir2 (Alternate)**: First byte 0x0F, byte 5=0x53, byte 14=0x31 (Type 2).
- **Wemade Mir2 (Other Alternate)**: First byte 0x0F, byte 5=0x53, byte 14=0x30 (Type 3).
- **Wemade 2010 Format**: `Mir200` format (Type 7).

## The Grid Structure
Once the width and height are read from the header, the map parses a `Width` x `Height` grid. Each element in the grid is a `CellInfo`.

### CellInfo Properties
Each tile in the map has the following structure (though not all properties are stored in every format):
- `BackIndex` (short): The library index for the background image (e.g., Tiles).
- `BackImage` (int/short): The image index within the specified background library.
- `MiddleIndex` (short): The library index for the middle image (e.g., SmTiles).
- `MiddleImage` (short): The image index within the middle library.
- `FrontIndex` (short): The library index for the foreground object (e.g., Objects).
- `FrontImage` (short): The image index within the foreground library.
- `DoorIndex` (byte): Door information.
- `DoorOffset` (byte): Door offset.
- `FrontAnimationFrame` / `FrontAnimationTick` (byte): Foreground animation details.
- `MiddleAnimationFrame` / `MiddleAnimationTick` (byte): Middle animation details.
- `TileAnimationImage` / `TileAnimationOffset` / `TileAnimationFrames` (short/short/byte): Background animations.
- `Light` (byte): Light radius/intensity.
- `Unknown` (byte)
- `FishingCell` (bool): Usually derived if `Light` is 100 or 101.

## HTML/JS Implementation Strategy
When migrating to JavaScript:
1. Load the map file as an `ArrayBuffer`.
2. Use a `DataView` or typed arrays (`Uint8Array`, `Int16Array`, `Int32Array`) to read the bytes in little-endian order.
3. Check the magic bytes first to select the correct parsing function.
4. Read `width` and `height`, instantiate a 2D array or 1D array of `width * height` holding plain JS objects containing `CellInfo` data.
5. Store bits from images such as `MapCells[x, y].BackImage & 0x7FFF` to remove flags. Note that sometimes `BackImage` contains blending flags like `0x20000000` which must be masked out and used to change rendering alpha.
