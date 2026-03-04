document.addEventListener("DOMContentLoaded", () => {
    const statusEl = document.getElementById("status");
    function updateStatus(msg) {
        console.log(msg);
        statusEl.innerText = msg;
    }

    // Initialize Renderer
    const renderer = new Renderer("pixi-container");

    // Minimap Setup
    const minimapCanvas = document.getElementById("minimap-canvas");
    const minimapCtx = minimapCanvas.getContext("2d");
    let mapImgData = null;

    function generateMinimap(mapReader) {
        if (!mapReader || !mapReader.width || !mapReader.height) return;

        // Scale map to fit into 200x200
        const scale = Math.min(200 / mapReader.width, 200 / mapReader.height);
        minimapCanvas.width = mapReader.width * scale;
        minimapCanvas.height = mapReader.height * scale;

        minimapCtx.fillStyle = "#000";
        minimapCtx.fillRect(0, 0, minimapCanvas.width, minimapCanvas.height);

        const id = minimapCtx.createImageData(mapReader.width, mapReader.height);
        const data = id.data;

        for (let y = 0; y < mapReader.height; y++) {
            for (let x = 0; x < mapReader.width; x++) {
                const cell = mapReader.getCell(x, y);
                const i = (y * mapReader.width + x) * 4;

                if (cell && cell.backImage && (cell.backImage & 0x7FFF) > 0) {
                    // Has land -> greenish
                    data[i] = 50;
                    data[i+1] = 150;
                    data[i+2] = 50;
                    data[i+3] = 255;
                } else {
                    // Empty/water -> black/dark blue
                    data[i] = 10;
                    data[i+1] = 10;
                    data[i+2] = 30;
                    data[i+3] = 255;
                }
            }
        }

        // Use an offscreen canvas to scale the ImageData onto the visible minimap canvas
        const off = document.createElement("canvas");
        off.width = mapReader.width;
        off.height = mapReader.height;
        off.getContext("2d").putImageData(id, 0, 0);

        minimapCtx.drawImage(off, 0, 0, minimapCanvas.width, minimapCanvas.height);
        mapImgData = minimapCtx.getImageData(0, 0, minimapCanvas.width, minimapCanvas.height);
    }

    function updateMinimapPixel(x, y, cell) {
        if (!mapImgData || !renderer.map) return;
        const i = (y * renderer.map.width + x) * 4;

        if (cell && cell.backImage && (cell.backImage & 0x7FFF) > 0) {
            // Has land -> greenish
            mapImgData.data[i] = 50;
            mapImgData.data[i+1] = 150;
            mapImgData.data[i+2] = 50;
            mapImgData.data[i+3] = 255;
        } else {
            // Empty/water -> black/dark blue
            mapImgData.data[i] = 10;
            mapImgData.data[i+1] = 10;
            mapImgData.data[i+2] = 30;
            mapImgData.data[i+3] = 255;
        }
    }

    // Handle Minimap viewport rectangle drawing
    renderer.app.ticker.add(() => {
        if (!renderer.map || !mapImgData) return;

        // Restore background

        // Use an offscreen canvas to scale the updated mapImgData onto the visible minimap canvas
        const off = document.createElement("canvas");
        off.width = renderer.map.width;
        off.height = renderer.map.height;
        off.getContext("2d").putImageData(mapImgData, 0, 0);

        minimapCtx.drawImage(off, 0, 0, minimapCanvas.width, minimapCanvas.height);

        const scaleX = minimapCanvas.width / (renderer.map.width * renderer.CELL_WIDTH);
        const scaleY = minimapCanvas.height / (renderer.map.height * renderer.CELL_HEIGHT);

        const viewX = renderer.camera.x * scaleX;
        const viewY = renderer.camera.y * scaleY;
        const viewW = (renderer.app.screen.width / renderer.camera.zoom) * scaleX;
        const viewH = (renderer.app.screen.height / renderer.camera.zoom) * scaleY;

        minimapCtx.strokeStyle = "red";
        minimapCtx.lineWidth = 1;
        minimapCtx.strokeRect(viewX, viewY, viewW, viewH);
    });

    // Handle clicking minimap to pan
    minimapCanvas.addEventListener("mousedown", (e) => {
        if (!renderer.map) return;

        const rect = minimapCanvas.getBoundingClientRect();
        const clickX = e.clientX - rect.left;
        const clickY = e.clientY - rect.top;

        const worldX = (clickX / minimapCanvas.width) * (renderer.map.width * renderer.CELL_WIDTH);
        const worldY = (clickY / minimapCanvas.height) * (renderer.map.height * renderer.CELL_HEIGHT);

        // Center camera
        renderer.camera.x = worldX - (renderer.app.screen.width / renderer.camera.zoom / 2);
        renderer.camera.y = worldY - (renderer.app.screen.height / renderer.camera.zoom / 2);
    });

    // UI event listeners for layers
    const chkBack = document.getElementById("chkBack");
    const chkMidd = document.getElementById("chkMidd");
    const chkFront = document.getElementById("chkFront");
    const chkGrid = document.getElementById("chkGrid");

    function updateLayers() {
        renderer.setLayers({
            back: chkBack.checked,
            middle: chkMidd.checked,
            front: chkFront.checked,
            grid: chkGrid.checked
        });
    }

    chkBack.addEventListener("change", updateLayers);
    chkMidd.addEventListener("change", updateLayers);
    chkFront.addEventListener("change", updateLayers);
    chkGrid.addEventListener("change", updateLayers);

    // Map loader
    document.getElementById("fileMap").addEventListener("change", async (e) => {
        if (!e.target.files.length) return;
        const file = e.target.files[0];

        updateStatus(`Loading map: ${file.name}...`);
        try {
            const mapReader = new MapReader(file);
            await mapReader.loadPromise;

            renderer.loadMap(mapReader);
            generateMinimap(mapReader);
            updateStatus(`Map loaded: ${mapReader.width}x${mapReader.height}`);
        } catch (err) {
            updateStatus(`Failed to load map: ${err.message}`);
        }
    });

    // Palette Selection State
    let selectedLibIndex = -1;
    let selectedImageIndex = -1;
    let activePaintLayer = "back";
    let selectedMapCell = null;

    // Undo/Redo System
    const undoStack = [];
    const redoStack = [];

    function recordEdit(cellX, cellY, oldCellData, newCellData) {
        undoStack.push({
            x: cellX, y: cellY,
            oldData: Object.assign({}, oldCellData),
            newData: Object.assign({}, newCellData)
        });
        // Clear redo when a new action occurs
        redoStack.length = 0;
        if (undoStack.length > 50) undoStack.shift(); // limit history
    }

    function applyEdit(editData) {
        if (!renderer.map) return;
        const cell = renderer.map.getCell(editData.x, editData.y);
        if (!cell) return;
        Object.assign(cell, editData.data);
        updateMinimapPixel(editData.x, editData.y, cell);
    }

    window.addEventListener("keydown", (e) => {
        if (e.ctrlKey && e.key === 'z') {
            e.preventDefault();
            const edit = undoStack.pop();
            if (edit) {
                applyEdit({x: edit.x, y: edit.y, data: edit.oldData});
                redoStack.push(edit);
                updateStatus(`Undo map edit at ${edit.x}, ${edit.y}`);
            }
        } else if (e.ctrlKey && e.key === 'y') {
            e.preventDefault();
            const edit = redoStack.pop();
            if (edit) {
                applyEdit({x: edit.x, y: edit.y, data: edit.newData});
                undoStack.push(edit);
                updateStatus(`Redo map edit at ${edit.x}, ${edit.y}`);
            }
        }
    });

    const selLib = document.getElementById("selLib");
    const selActiveLayer = document.getElementById("selActiveLayer");
    const paletteDiv = document.getElementById("palette");

    selActiveLayer.addEventListener("change", (e) => {
        activePaintLayer = e.target.value;
        renderer.hoverLayer = activePaintLayer;
    });

    // Lib loader
    document.getElementById("fileLibs").addEventListener("change", async (e) => {
        if (!e.target.files.length) return;

        updateStatus(`Loading ${e.target.files.length} library files...`);

        let loadedCount = 0;
        for (const file of e.target.files) {
            try {
                const lib = new MLibrary(file);
                await lib.loadPromise;

                // Map the library to its specific index based on name
                let index = -1;
                const name = lib.name.toLowerCase();

                if (name === "tiles") index = 0;
                else if (name === "smtiles") index = 1;
                else if (name === "objects") index = 2;
                else if (name.startsWith("objects")) {
                    const num = parseInt(name.replace("objects", ""));
                    if (!isNaN(num)) index = num; // Adjust based on index list logic in C#
                } else if (name.startsWith("tiles")) {
                    const num = parseInt(name.replace("tiles", ""));
                    if (!isNaN(num)) index = 100 + num - 1;
                }

                // Fallback, store by index starting from 200 if unknown
                if (index === -1) {
                    index = 200 + loadedCount;
                }

                renderer.addLib(index, lib);
                loadedCount++;

                const option = document.createElement("option");
                option.value = index;
                option.innerText = `[${index}] ${lib.name}`;
                selLib.appendChild(option);

                updateStatus(`Loaded lib: ${file.name} (Index ${index})`);
            } catch (err) {
                console.error("Lib load failed", file.name, err);
            }
        }
        updateStatus(`Finished loading ${loadedCount} libraries.`);
    });

    document.getElementById("btnLoadPalette").addEventListener("click", async () => {
        const libIndex = parseInt(selLib.value);
        if (libIndex === -1) return;

        const lib = renderer.libs[libIndex];
        if (!lib) return;

        paletteDiv.innerHTML = "Loading... (This might take a moment depending on lib size)";

        // Load first 100 images for preview to avoid hanging browser
        // A real app would use pagination or virtualization
        const maxPreview = Math.min(lib.count, 200);

        // Wait for next frame to render UI loading text
        await new Promise(r => setTimeout(r, 50));

        let html = "";
        const promises = [];
        for (let i = 0; i < maxPreview; i++) {
            promises.push(lib.getImage(i));
        }

        const images = await Promise.all(promises);

        paletteDiv.innerHTML = "";
        images.forEach((img, i) => {
            if (!img || img.empty) return;
            const item = document.createElement("div");
            item.className = "palette-item";
            item.title = `Image Index: ${i}`;
            item.dataset.index = i;

            const imgTag = document.createElement("img");
            imgTag.src = img.base64Url;
            item.appendChild(imgTag);

            item.addEventListener("click", () => {
                document.querySelectorAll(".palette-item").forEach(el => el.classList.remove("selected"));
                item.classList.add("selected");
                selectedLibIndex = libIndex;
                selectedImageIndex = i;

                // Update renderer hover state
                renderer.hoverLibIndex = selectedLibIndex;
                renderer.hoverImageIndex = selectedImageIndex;
                renderer.hoverLayer = activePaintLayer;
            });

            paletteDiv.appendChild(item);
        });
    });

    // Map Cell Editing Interaction
    renderer.app.view.addEventListener('contextmenu', e => e.preventDefault()); // prevent right click menu

    // Bind interaction from Renderer to Controller
    renderer.onCellClicked = (cellX, cellY, isRightClick) => {
        if (!renderer.map) return;
        const cell = renderer.map.getCell(cellX, cellY);
        if (!cell) return;

        if (isRightClick) {
            // Select cell for property editing
            selectedMapCell = cell;
            document.getElementById("cellPropInfo").innerText = `Cell (${cellX}, ${cellY})`;
            document.getElementById("propDoorIndex").value = cell.doorIndex || 0;
            document.getElementById("propDoorOffset").value = cell.doorOffset || 0;
            document.getElementById("propLight").value = cell.light || 0;
            document.getElementById("propFrontAnimFrame").value = cell.frontAnimationFrame || 0;
            document.getElementById("propFrontAnimTick").value = cell.frontAnimationTick || 0;
        } else {
            // Left click - Paint
            if (selectedLibIndex !== -1 && selectedImageIndex !== -1) {
                const oldData = Object.assign({}, cell);
                if (activePaintLayer === "back") {
                    cell.backIndex = selectedLibIndex;
                    cell.backImage = selectedImageIndex + 1; // +1 based on C#
                } else if (activePaintLayer === "middle") {
                    cell.middleIndex = selectedLibIndex;
                    cell.middleImage = selectedImageIndex + 1;
                } else if (activePaintLayer === "front") {
                    cell.frontIndex = selectedLibIndex;
                    cell.frontImage = selectedImageIndex + 1;
                }
                recordEdit(cellX, cellY, oldData, cell);
                updateMinimapPixel(cellX, cellY, cell);
            }
        }
    };

    document.getElementById("btnApplyProps").addEventListener("click", () => {
        if (!selectedMapCell) return;

        // Find cell coordinates for undo recording
        let cx = -1, cy = -1;
        for (let x = 0; x < renderer.map.width; x++) {
            for (let y = 0; y < renderer.map.height; y++) {
                if (renderer.map.getCell(x, y) === selectedMapCell) {
                    cx = x; cy = y; break;
                }
            }
            if (cx !== -1) break;
        }

        const oldData = Object.assign({}, selectedMapCell);

        selectedMapCell.doorIndex = parseInt(document.getElementById("propDoorIndex").value) || 0;
        selectedMapCell.doorOffset = parseInt(document.getElementById("propDoorOffset").value) || 0;
        selectedMapCell.light = parseInt(document.getElementById("propLight").value) || 0;
        selectedMapCell.frontAnimationFrame = parseInt(document.getElementById("propFrontAnimFrame").value) || 0;
        selectedMapCell.frontAnimationTick = parseInt(document.getElementById("propFrontAnimTick").value) || 0;

        recordEdit(cx, cy, oldData, selectedMapCell);
    });

    // Map Exporting
    document.getElementById("btnSaveMap").addEventListener("click", () => {
        if (!renderer.map) {
            alert("No map loaded.");
            return;
        }
        const buffer = renderer.map.save();
        if (!buffer) return;

        const blob = new Blob([buffer], { type: "application/octet-stream" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = "edited_map.map";
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    });

});
