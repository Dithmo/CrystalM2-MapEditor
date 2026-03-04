class Renderer {
    constructor(containerId) {
        this.app = new PIXI.Application({
            resizeTo: window,
            backgroundColor: 0x111111,
            autoDensity: true,
            resolution: window.devicePixelRatio || 1,
        });
        document.getElementById(containerId).appendChild(this.app.view);

        this.stage = new PIXI.Container();
        this.app.stage.addChild(this.stage);

        this.camera = {
            x: 0, y: 0, zoom: 1
        };

        this.isDragging = false;
        this.dragStart = { x: 0, y: 0 };
        this.cameraStart = { x: 0, y: 0 };

        this.map = null;
        this.libs = {}; // mapping index/name to MLibrary

        this.CELL_WIDTH = 48;
        this.CELL_HEIGHT = 32;

        this.spritePool = [];
        this.activeSprites = [];
        this.layerConfig = {
            back: true,
            middle: true,
            front: true,
            grid: false
        };

        this.setupInteraction();
        this.app.ticker.add(() => this.renderLoop());
    }

    getSprite() {
        if (this.spritePool.length > 0) {
            const s = this.spritePool.pop();
            s.visible = true;
            this.stage.addChild(s);
            return s;
        }
        const s = new PIXI.Sprite();
        this.stage.addChild(s);
        return s;
    }

    releaseSprites() {
        for (const s of this.activeSprites) {
            s.visible = false;
            this.stage.removeChild(s);
            this.spritePool.push(s);
        }
        this.activeSprites = [];
    }

    setupInteraction() {
        this.app.view.addEventListener('mousedown', (e) => {
            // Right click or Middle click for drag panning
            if (e.button === 2 || e.button === 1) {
                this.isDragging = true;
                this.dragStart.x = e.clientX;
                this.dragStart.y = e.clientY;
                this.cameraStart.x = this.camera.x;
                this.cameraStart.y = this.camera.y;
            } else if (e.button === 0) {
                // Left click for painting
                this.handleMapClick(e.clientX, e.clientY, false);
            }
        });

        window.addEventListener('mouseup', (e) => {
            if (e.button === 2 || e.button === 1) {
                this.isDragging = false;
            }
        });

        // Disable default context menu
        this.app.view.addEventListener('contextmenu', e => {
            e.preventDefault();
            this.handleMapClick(e.clientX, e.clientY, true); // right click edit properties
        });

        window.addEventListener('mousemove', (e) => {
            if (this.isDragging) {
                const dx = (e.clientX - this.dragStart.x) / this.camera.zoom;
                const dy = (e.clientY - this.dragStart.y) / this.camera.zoom;
                this.camera.x = this.cameraStart.x - dx;
                this.camera.y = this.cameraStart.y - dy;
            }
        });

        this.app.view.addEventListener('wheel', (e) => {
            const zoomFactor = 1.1;
            const oldZoom = this.camera.zoom;

            if (e.deltaY < 0) this.camera.zoom *= zoomFactor;
            else this.camera.zoom /= zoomFactor;

            // Clamp zoom
            this.camera.zoom = Math.max(0.1, Math.min(this.camera.zoom, 5));

            // Adjust camera position to zoom towards mouse cursor
            const mouseX = e.clientX;
            const mouseY = e.clientY;

            this.camera.x = (mouseX / oldZoom + this.camera.x) - (mouseX / this.camera.zoom);
            this.camera.y = (mouseY / oldZoom + this.camera.y) - (mouseY / this.camera.zoom);
        });
    }

    handleMapClick(clientX, clientY, isRightClick) {
        if (!this.map) return;

        // Convert screen coordinates to world coordinates
        const worldX = (clientX / this.camera.zoom) + this.camera.x;
        const worldY = (clientY / this.camera.zoom) + this.camera.y;

        const cellX = Math.floor(worldX / this.CELL_WIDTH);
        const cellY = Math.floor(worldY / this.CELL_HEIGHT);

        if (this.onCellClicked) {
            this.onCellClicked(cellX, cellY, isRightClick);
        }
    }

    loadMap(map) {
        this.map = map;
        this.camera.x = 0;
        this.camera.y = 0;
        this.camera.zoom = 1;
    }

    addLib(index, lib) {
        this.libs[index] = lib;
        // In the C# version, libs have hardcoded indexes.
        // We will just try matching by name or explicit index passing.
    }

    setLayers(config) {
        Object.assign(this.layerConfig, config);
    }

    // Helper to request images asynchronously but not stall the render loop
    getTexture(libIndex, imgIndex) {
        const lib = this.libs[libIndex];
        if (!lib) return null;

        const mImage = lib.images[imgIndex];
        if (mImage) {
            return mImage.empty ? null : mImage;
        }

        // Trigger lazy load
        lib.getImage(imgIndex).then(() => {
            // It will be ready next frame
        });

        return null; // Return null for now
    }

    renderLoop() {
        if (!this.map) return;

        // Release all sprites back to the pool
        this.releaseSprites();

        this.stage.scale.set(this.camera.zoom);
        this.stage.position.set(-this.camera.x * this.camera.zoom, -this.camera.y * this.camera.zoom);

        // Frustum culling: calculate visible grid cells
        const viewX = this.camera.x;
        const viewY = this.camera.y;
        const viewW = this.app.screen.width / this.camera.zoom;
        const viewH = this.app.screen.height / this.camera.zoom;

        const startX = Math.max(0, Math.floor(viewX / this.CELL_WIDTH) - 20); // Add padding for large sprites
        const startY = Math.max(0, Math.floor(viewY / this.CELL_HEIGHT) - 20);
        const endX = Math.min(this.map.width, Math.ceil((viewX + viewW) / this.CELL_WIDTH) + 20);
        const endY = Math.min(this.map.height, Math.ceil((viewY + viewH) / this.CELL_HEIGHT) + 20);

        // Render Background layer first
        if (this.layerConfig.back) {
            for (let y = startY; y < endY; y++) {
                for (let x = startX; x < endX; x++) {
                    const cell = this.map.getCell(x, y);
                    if (!cell) continue;

                    if (cell.backImage && (cell.backImage & 0x7FFF) > 0) {
                        const imgIndex = (cell.backImage & 0x7FFF) - 1;
                        const mImage = this.getTexture(cell.backIndex || 0, imgIndex);

                        if (mImage && mImage.texture) {
                            const sprite = this.getSprite();
                            sprite.texture = mImage.texture;
                            sprite.x = x * this.CELL_WIDTH;
                            sprite.y = y * this.CELL_HEIGHT;

                            if ((cell.backImage & 0x20000000) !== 0) {
                                sprite.blendMode = PIXI.BLEND_MODES.ADD;
                                sprite.alpha = 0.5;
                            } else {
                                sprite.blendMode = PIXI.BLEND_MODES.NORMAL;
                                sprite.alpha = 1.0;
                            }
                            this.activeSprites.push(sprite);
                        }
                    }
                }
            }
        }

        // Render Middle and Front layers, properly Z-sorted by Y axis (Isometric sort style)
        for (let y = startY; y < endY; y++) {
            for (let x = startX; x < endX; x++) {
                const cell = this.map.getCell(x, y);
                if (!cell) continue;

                const drawX = x * this.CELL_WIDTH;
                const drawY = y * this.CELL_HEIGHT;

                // Middle
                if (this.layerConfig.middle && cell.middleImage && cell.middleImage > 0) {
                    const imgIndex = cell.middleImage - 1;
                    const mImage = this.getTexture(cell.middleIndex || 1, imgIndex);

                    if (mImage && mImage.texture) {
                        const sprite = this.getSprite();
                        sprite.texture = mImage.texture;
                        sprite.x = drawX + mImage.x;
                        sprite.y = drawY + mImage.y;
                        sprite.blendMode = PIXI.BLEND_MODES.NORMAL;
                        sprite.alpha = 1.0;
                        this.activeSprites.push(sprite);
                    }
                }

                // Front (Objects)
                if (this.layerConfig.front && cell.frontImage && cell.frontImage > 0) {
                    const imgIndex = cell.frontImage - 1;
                    const libIndex = cell.frontIndex > 0 ? cell.frontIndex : 2;

                    const mImage = this.getTexture(libIndex, imgIndex);

                    if (mImage && mImage.texture) {
                        const sprite = this.getSprite();
                        sprite.texture = mImage.texture;
                        sprite.x = drawX + mImage.x;
                        sprite.y = drawY + mImage.y;
                        sprite.blendMode = PIXI.BLEND_MODES.NORMAL;
                        sprite.alpha = 1.0;
                        this.activeSprites.push(sprite);
                    }
                }
            }
        }
    }
}
