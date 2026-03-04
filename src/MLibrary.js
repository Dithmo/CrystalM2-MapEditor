class MLibrary {
    constructor(file) {
        this.file = file; // The browser File object
        this.name = file.name.split('.')[0]; // Used as key for map linking

        this.version = 0;
        this.count = 0;
        this.indexList = [];
        this.images = []; // cache array

        this.initialized = false;
        this.loadPromise = this.initialize();
    }

    async initialize() {
        // Read just the first few bytes to get version and count, and the index list
        const buffer = await this.file.arrayBuffer();
        const dataView = new DataView(buffer);
        let offset = 0;

        this.version = dataView.getInt32(offset, true);
        offset += 4;

        if (this.version < 2) {
            console.error(`Wrong lib version for ${this.name}: ${this.version}`);
            return;
        }

        this.count = dataView.getInt32(offset, true);
        offset += 4;

        if (this.version >= 3) {
            // frameSeek
            offset += 4;
        }

        this.indexList = new Int32Array(this.count);
        for (let i = 0; i < this.count; i++) {
            this.indexList[i] = dataView.getInt32(offset, true);
            offset += 4;
        }

        this.buffer = buffer; // Keep the full buffer in memory for fast sliced decompression
        this.dataView = dataView;
        this.initialized = true;
        console.log(`Initialized MLibrary: ${this.name} (${this.count} images)`);
    }

    // Fetches and decompresses an image at a specific index
    // Lazily cached to avoid OutOfMemory
    async getImage(index) {
        if (!this.initialized) await this.loadPromise;
        if (index < 0 || index >= this.count) return null;
        if (this.images[index]) {
             // Return cached or await if currently loading
             return this.images[index] instanceof Promise ? await this.images[index] : this.images[index];
        }

        const offset = this.indexList[index];
        if (offset === 0) {
            this.images[index] = { empty: true };
            return null; // Empty image
        }

        // Store promise to prevent duplicate loading requests
        this.images[index] = this._loadImage(index, offset);
        const result = await this.images[index];
        this.images[index] = result;
        return result;
    }

    async _loadImage(index, offset) {

        try {
            const mImage = this.parseImage(offset);
            if (!mImage || mImage.width < 2 || mImage.height < 2) {
                this.images[index] = { empty: true };
                return null;
            }

            // Decompress the gzip stream
            const decompressed = pako.inflate(mImage.fBytes);

            // decompressed bytes are ARGB (Alpha, Red, Green, Blue) from C#
            // PixiJS/WebGL expects RGBA
            const rgba = new Uint8Array(decompressed.length);
            for (let i = 0; i < decompressed.length; i += 4) {
                const a = decompressed[i+3];
                const r = decompressed[i+2];
                const g = decompressed[i+1];
                const b = decompressed[i];

                rgba[i] = r;
                rgba[i+1] = g;
                rgba[i+2] = b;
                rgba[i+3] = a;
            }

            // Create Pixi Texture from raw array
            const buffer = new PIXI.Buffer(rgba);
            const texture = PIXI.Texture.fromBuffer(rgba, mImage.width, mImage.height, {
                format: PIXI.FORMATS.RGBA,
                type: PIXI.TYPES.UNSIGNED_BYTE,
                alphaMode: PIXI.ALPHA_MODES.NPM // No Premultiplied Alpha
            });

            // Useful for HTML UI Palette representation without rendering in WebGL context
            const canvas = document.createElement("canvas");
            canvas.width = mImage.width;
            canvas.height = mImage.height;
            const ctx = canvas.getContext("2d");
            const imgData = new ImageData(new Uint8ClampedArray(rgba), mImage.width, mImage.height);
            ctx.putImageData(imgData, 0, 0);
            const base64Url = canvas.toDataURL("image/png");

            const result = {
                base64Url: base64Url,
                texture: texture,
                x: mImage.x,
                y: mImage.y,
                width: mImage.width,
                height: mImage.height,
                shadowX: mImage.shadowX,
                shadowY: mImage.shadowY,
                hasMask: mImage.hasMask
            };

            this.images[index] = result;
            return result;

        } catch(e) {
            console.error(`Failed to load image ${index} from ${this.name}`, e);
            this.images[index] = { empty: true };
            return null;
        }
    }

    parseImage(offset) {
        const dv = this.dataView;
        let p = offset;

        const width = dv.getInt16(p, true); p += 2;
        const height = dv.getInt16(p, true); p += 2;
        const x = dv.getInt16(p, true); p += 2;
        const y = dv.getInt16(p, true); p += 2;
        const shadowX = dv.getInt16(p, true); p += 2;
        const shadowY = dv.getInt16(p, true); p += 2;
        const shadow = dv.getUint8(p); p += 1;
        const length = dv.getInt32(p, true); p += 4;

        if (length === 0) return null;

        // Slice out the compressed bytes
        const fBytes = new Uint8Array(this.buffer, p, length);
        p += length;

        const hasMask = (shadow >> 7) === 1;

        // Ignoring masks for now to keep things simpler and faster
        // If hasMask is needed later, we parse mask width/height/bytes here

        return {
            width, height, x, y, shadowX, shadowY, shadow, length, fBytes, hasMask
        };
    }
}
