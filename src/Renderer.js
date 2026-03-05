class Renderer {
    constructor(containerId) {
        this.app = new PIXI.Application({
            resizeTo: document.getElementById(containerId),
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
        // Global animation tick counter
        this.animTick = 0;

        // Use ticker with delta for consistent animations
        this.app.ticker.add((delta) => {
            // Increase tick. In the real C# game, different layers run at different speeds.
            // We'll use a generic ~10 ticks per second pace.
            this.animTick += delta * 0.15;
            this.renderLoop();
        });

        // Setup Grid / Overlay graphics layer
        this.overlayGraphics = new PIXI.Graphics();
        this.stage.addChild(this.overlayGraphics);

        // Setup Hover Preview Sprite
        this.hoverPreviewSprite = new PIXI.Sprite();
        this.hoverPreviewSprite.alpha = 0.5;
        this.hoverPreviewSprite.visible = false;
        this.stage.addChild(this.hoverPreviewSprite);

        // Setup Hover Brush Grid
        this.hoverBrushGrid = new PIXI.Graphics();
        this.hoverBrushGrid.visible = false;
        this.stage.addChild(this.hoverBrushGrid);

        // Setup Selection Grid
        this.selectionGraphics = new PIXI.Graphics();
        this.stage.addChild(this.selectionGraphics);

        this.hoverWorldX = 0;
        this.hoverWorldY = 0;
        this.brushSize = 1;

        this.selectionBounds = null; // { x, y, w, h }
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
            } else {
                // Update hover preview coordinates
                this.hoverWorldX = (e.clientX / this.camera.zoom) + this.camera.x;
                this.hoverWorldY = (e.clientY / this.camera.zoom) + this.camera.y;

                // Trigger callback for selection drag
                if (this.onMapDrag) {
                    this.onMapDrag(this.hoverWorldX, this.hoverWorldY);
                }
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

        // Ensure overlay stays on top
        this.stage.addChild(this.overlayGraphics);
        this.overlayGraphics.clear();

        // Ensure hover preview stays on top
        this.stage.addChild(this.hoverPreviewSprite);
        this.stage.addChild(this.hoverBrushGrid);

        // Ensure selection stays on top
        this.stage.addChild(this.selectionGraphics);
        this.selectionGraphics.clear();
        if (this.selectionBounds) {
            this.selectionGraphics.lineStyle(2, 0x00FFFF, 1);
            this.selectionGraphics.beginFill(0x00FFFF, 0.2);
            this.selectionGraphics.drawRect(
                this.selectionBounds.x * this.CELL_WIDTH,
                this.selectionBounds.y * this.CELL_HEIGHT,
                this.selectionBounds.w * this.CELL_WIDTH,
                this.selectionBounds.h * this.CELL_HEIGHT
            );
            this.selectionGraphics.endFill();
        }

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
                        let imgIndex = (cell.backImage & 0x7FFF) - 1;

                        // Handle Background Tile Animations (Water/Lava etc)
                        if (cell.tileAnimationFrames && cell.tileAnimationFrames > 0 && (cell.tileAnimationImage & 0x7FFF) > 0) {
                            // Cycle through frames based on global tick
                            const currentFrameOffset = Math.floor(this.animTick) % cell.tileAnimationFrames;

                            // Try loading animated texture
                            const animImageIndex = (cell.tileAnimationImage & 0x7FFF) - 1 + currentFrameOffset;
                            const animMImage = this.getTexture(cell.backIndex !== undefined ? cell.backIndex : 0, animImageIndex);

                            if (animMImage && animMImage.texture) {
                                imgIndex = animImageIndex;
                            }
                        }

                        const mImage = this.getTexture(cell.backIndex !== undefined ? cell.backIndex : 0, imgIndex);

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
                    let imgIndex = cell.middleImage - 1;

                    // Handle Middle Animation
                    if (cell.middleAnimationFrame && cell.middleAnimationFrame > 0) {
                        const tickSpeed = cell.middleAnimationTick || 1;
                        const currentFrameOffset = Math.floor(this.animTick / tickSpeed) % cell.middleAnimationFrame;
                        imgIndex = imgIndex + currentFrameOffset;
                    }

                    const mImage = this.getTexture(cell.middleIndex !== undefined ? cell.middleIndex : 1, imgIndex);

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
                    let imgIndex = cell.frontImage - 1;
                    const libIndex = (cell.frontIndex !== undefined && cell.frontIndex > 0) ? cell.frontIndex : 2;

                    // Handle Front Animation (Torches, Fountains, etc)
                    if (cell.frontAnimationFrame && cell.frontAnimationFrame > 0) {
                        const tickSpeed = cell.frontAnimationTick || 1;
                        // For front animations, the base image is cell.frontImage, and it cycles through frontAnimationFrame frames
                        const currentFrameOffset = Math.floor(this.animTick / tickSpeed) % cell.frontAnimationFrame;
                        imgIndex = imgIndex + currentFrameOffset;
                    }

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

                // Overlay markers (Doors, Lights) and Grid
                if (this.layerConfig.grid) {
                    this.overlayGraphics.lineStyle(1, 0xFFFFFF, 0.2);
                    this.overlayGraphics.drawRect(drawX, drawY, this.CELL_WIDTH, this.CELL_HEIGHT);

                    if (cell.doorIndex > 0 || (cell.doorOffset > 0 && cell.doorOffset !== 0)) {
                        this.overlayGraphics.beginFill(0x00FF00, 0.5); // Green semi-transparent
                        this.overlayGraphics.drawRect(drawX, drawY, this.CELL_WIDTH/2, this.CELL_HEIGHT/2);
                        this.overlayGraphics.endFill();
                    }

                    if (cell.light > 0) {
                        this.overlayGraphics.beginFill(0xFFFF00, 0.5); // Yellow semi-transparent
                        this.overlayGraphics.drawRect(drawX + this.CELL_WIDTH/2, drawY + this.CELL_HEIGHT/2, this.CELL_WIDTH/2, this.CELL_HEIGHT/2);
                        this.overlayGraphics.endFill();
                    }
                }
            }
        }

        // Handle Hover Preview
        if (this.hoverLibIndex !== undefined && this.hoverImageIndex !== undefined
            && this.hoverLibIndex !== -1 && this.hoverImageIndex !== -1) {

            const cellX = Math.floor(this.hoverWorldX / this.CELL_WIDTH);
            const cellY = Math.floor(this.hoverWorldY / this.CELL_HEIGHT);

            const mImage = this.getTexture(this.hoverLibIndex, this.hoverImageIndex);

            if (mImage && mImage.texture) {
                this.hoverPreviewSprite.texture = mImage.texture;
                this.hoverPreviewSprite.visible = true;

                const drawX = cellX * this.CELL_WIDTH;
                const drawY = cellY * this.CELL_HEIGHT;

                if (this.hoverLayer === "back") {
                    this.hoverPreviewSprite.x = drawX;
                    this.hoverPreviewSprite.y = drawY;
                } else {
                    this.hoverPreviewSprite.x = drawX + mImage.x;
                    this.hoverPreviewSprite.y = drawY + mImage.y;
                }
            } else {
                this.hoverPreviewSprite.visible = false;
            }

            // Draw brush grid outline
            if (this.brushSize > 1) {
                this.hoverBrushGrid.visible = true;
                this.hoverBrushGrid.clear();
                this.hoverBrushGrid.lineStyle(2, 0xFFFF00, 0.8);
                this.hoverBrushGrid.drawRect(
                    cellX * this.CELL_WIDTH,
                    cellY * this.CELL_HEIGHT,
                    this.CELL_WIDTH * this.brushSize,
                    this.CELL_HEIGHT * this.brushSize
                );
            } else {
                this.hoverBrushGrid.visible = false;
            }

        } else {
            this.hoverPreviewSprite.visible = false;
            this.hoverBrushGrid.visible = false;
        }
    }
}
