class MapReader {
    constructor(file) {
        this.file = file;
        this.width = 0;
        this.height = 0;
        this.cells = [];
        this.loadPromise = this.parse();
    }

    async parse() {
        const buffer = this.file.buffer || await this.file.arrayBuffer();
        const dv = new DataView(buffer);
        const bytes = new Uint8Array(buffer);

        if (bytes[2] === 0x43 && bytes[3] === 0x23) {
            this.loadMapType100(dv, bytes);
        } else if (bytes[0] === 0) {
            this.loadMapType5(dv, bytes);
        } else if (bytes[0] === 0x0F && bytes[5] === 0x53 && bytes[14] === 0x33) {
            this.loadMapType6(dv, bytes);
        } else if (bytes[0] === 0x15 && bytes[4] === 0x32 && bytes[6] === 0x41 && bytes[19] === 0x31) {
            this.loadMapType4(dv, bytes);
        } else if (bytes[0] === 0x0F && bytes[5] === 0x53 && bytes[14] === 0x32) {
            this.loadMapType0(dv, bytes);
        } else if (bytes[0] === 0x0F && bytes[5] === 0x53 && bytes[14] === 0x31) {
            this.loadMapType2(dv, bytes);
        } else if (bytes[0] === 0x0F && bytes[5] === 0x53 && bytes[14] === 0x30) {
            this.loadMapType3(dv, bytes);
        } else if (bytes[0] === 0x4D && bytes[1] === 0x69 && bytes[2] === 0x72 && bytes[3] === 0x32 && bytes[4] === 0x30 && bytes[5] === 0x30) {
            this.loadMapType7(dv, bytes);
        } else {
            console.error("Unknown Map Format");
        }

        console.log(`Parsed Map: ${this.width}x${this.height} (${this.cells.length} cells)`);
    }

    // Returns a Set of all unique library integer indexes used across all layers in this map
    getRequiredLibraryIndexes() {
        const required = new Set();
        for (let i = 0; i < this.cells.length; i++) {
            const cell = this.cells[i];
            if (!cell) continue;

            // Only add the index if the corresponding image value is > 0
            if (cell.backImage && (cell.backImage & 0x7FFF) > 0) required.add(cell.backIndex !== undefined ? cell.backIndex : 0);
            if (cell.middleImage && cell.middleImage > 0) required.add(cell.middleIndex !== undefined ? cell.middleIndex : 1);
            if (cell.frontImage && cell.frontImage > 0) {
                // Type 0 default frontIndex is often 2 if not explicitly set
                required.add((cell.frontIndex !== undefined && cell.frontIndex > 0) ? cell.frontIndex : 2);
            }
        }
        return required;
    }

    // Default Type 0 implementation
    loadMapType0(dv, bytes) {
        let offset = 0;
        this.width = dv.getInt16(offset, true); offset += 2;
        this.height = dv.getInt16(offset, true); offset += 50;

        for (let x = 0; x < this.width; x++) {
            for (let y = 0; y < this.height; y++) {
                const cell = { backIndex: 0, middleIndex: 1 };

                cell.backImage = dv.getUint16(offset, true); offset += 2;
                cell.middleImage = dv.getUint16(offset, true); offset += 2;
                cell.frontImage = dv.getUint16(offset, true); offset += 2;
                cell.doorIndex = dv.getUint8(offset++);
                cell.doorOffset = dv.getUint8(offset++);
                cell.frontAnimationFrame = dv.getUint8(offset++);
                cell.frontAnimationTick = dv.getUint8(offset++);
                cell.frontIndex = dv.getInt16(offset, true); offset += 2;
                cell.light = dv.getUint8(offset++);
                cell.unknown = dv.getUint8(offset++);

                if ((cell.backImage & 0x8000) !== 0) {
                    cell.backImage = (cell.backImage & 0x7FFF) | 0x20000000;
                }

                if (cell.light === 100 || cell.light === 101) {
                    cell.fishingCell = true;
                }

                this.cells[x * this.height + y] = cell;
            }
        }
    }

    // Type 100 implementation
    loadMapType100(dv, bytes) {
        let offset = 4;
        if (bytes[0] !== 1 || bytes[1] !== 0) return;

        this.width = dv.getInt16(offset, true); offset += 2;
        this.height = dv.getInt16(offset, true); offset += 2;

        for (let x = 0; x < this.width; x++) {
            for (let y = 0; y < this.height; y++) {
                const cell = {};

                cell.backIndex = dv.getInt16(offset, true); offset += 2;
                cell.backImage = dv.getUint32(offset, true); offset += 4;
                cell.middleIndex = dv.getInt16(offset, true); offset += 2;
                cell.middleImage = dv.getUint16(offset, true); offset += 2;
                cell.frontIndex = dv.getInt16(offset, true); offset += 2;
                cell.frontImage = dv.getUint16(offset, true); offset += 2;
                cell.doorIndex = dv.getUint8(offset++);
                cell.doorOffset = dv.getUint8(offset++);
                cell.frontAnimationFrame = dv.getUint8(offset++);
                cell.frontAnimationTick = dv.getUint8(offset++);
                cell.middleAnimationFrame = dv.getUint8(offset++);
                cell.middleAnimationTick = dv.getUint8(offset++);
                cell.tileAnimationImage = dv.getInt16(offset, true); offset += 2;
                cell.tileAnimationOffset = dv.getInt16(offset, true); offset += 2;
                cell.tileAnimationFrames = dv.getUint8(offset++);
                cell.light = dv.getUint8(offset++);

                if (cell.light === 100 || cell.light === 101) cell.fishingCell = true;

                this.cells[x * this.height + y] = cell;
            }
        }
    }

    // Add other map types as stubs or full implementations if needed...
    loadMapType5(dv, bytes) { /* wemade mir3 */ }
    loadMapType6(dv, bytes) { /* shanda mir3 */ }
    loadMapType4(dv, bytes) { /* wemade antihack */ }
    loadMapType2(dv, bytes) { /* wemade alt 1 */ }
    loadMapType3(dv, bytes) { /* wemade alt 2 */ }
    loadMapType7(dv, bytes) { /* mir200 */ }

    getCell(x, y) {
        if (x < 0 || y < 0 || x >= this.width || y >= this.height) return null;
        return this.cells[x * this.height + y];
    }

    // Exports the map back to the Type 100 format (C# format) which is easy to serialize
    save() {
        if (!this.width || !this.height) return null;

        // Calculate required buffer size
        // Header: 2 bytes magic + 2 bytes version (0) + 2 bytes width + 2 bytes height = 8 bytes
        // Each cell in Type 100 is: 2+4+2+2+2+2+1+1+1+1+1+1+2+2+1+1 = 26 bytes
        const numCells = this.width * this.height;
        const totalSize = 8 + (numCells * 26);
        const buffer = new ArrayBuffer(totalSize);
        const dv = new DataView(buffer);
        const bytes = new Uint8Array(buffer);

        // Write header
        bytes[0] = 1; // Magic/Version byte 1
        bytes[1] = 0; // Magic/Version byte 0
        bytes[2] = 0x43; // C
        bytes[3] = 0x23; // # (Though we write to 0 and 1 here, we checked 2 and 3 above - lets mimic C#)

        // Wait, C# code for Type 100 says:
        // offset = 4;
        // if ((Bytes[0]!= 1) || (Bytes[1] != 0)) return;
        // So Bytes[0]=1, Bytes[1]=0. And custom magic is at 2 and 3.

        dv.setInt16(4, this.width, true);
        dv.setInt16(6, this.height, true);

        let offset = 8;

        for (let x = 0; x < this.width; x++) {
            for (let y = 0; y < this.height; y++) {
                const cell = this.cells[x * this.height + y] || {};

                dv.setInt16(offset, cell.backIndex || 0, true); offset += 2;
                dv.setUint32(offset, cell.backImage || 0, true); offset += 4;
                dv.setInt16(offset, cell.middleIndex || 0, true); offset += 2;
                dv.setUint16(offset, cell.middleImage || 0, true); offset += 2;
                dv.setInt16(offset, cell.frontIndex || 0, true); offset += 2;
                dv.setUint16(offset, cell.frontImage || 0, true); offset += 2;
                dv.setUint8(offset++, cell.doorIndex || 0);
                dv.setUint8(offset++, cell.doorOffset || 0);
                dv.setUint8(offset++, cell.frontAnimationFrame || 0);
                dv.setUint8(offset++, cell.frontAnimationTick || 0);
                dv.setUint8(offset++, cell.middleAnimationFrame || 0);
                dv.setUint8(offset++, cell.middleAnimationTick || 0);
                dv.setInt16(offset, cell.tileAnimationImage || 0, true); offset += 2;
                dv.setInt16(offset, cell.tileAnimationOffset || 0, true); offset += 2;
                dv.setUint8(offset++, cell.tileAnimationFrames || 0);
                dv.setUint8(offset++, cell.light || 0);
            }
        }

        return buffer;
    }
}
