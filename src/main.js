document.addEventListener("DOMContentLoaded", () => {
    const statusEl = document.getElementById("status");
    function updateStatus(msg) {
        console.log(msg);
        statusEl.innerText = msg;
    }

    // Initialize Renderer
    const renderer = new Renderer("pixi-container");

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

    const selLib = document.getElementById("selLib");
    const selActiveLayer = document.getElementById("selActiveLayer");
    const paletteDiv = document.getElementById("palette");

    selActiveLayer.addEventListener("change", (e) => activePaintLayer = e.target.value);

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
            }
        }
    };

    document.getElementById("btnApplyProps").addEventListener("click", () => {
        if (!selectedMapCell) return;
        selectedMapCell.doorIndex = parseInt(document.getElementById("propDoorIndex").value) || 0;
        selectedMapCell.doorOffset = parseInt(document.getElementById("propDoorOffset").value) || 0;
        selectedMapCell.light = parseInt(document.getElementById("propLight").value) || 0;
        selectedMapCell.frontAnimationFrame = parseInt(document.getElementById("propFrontAnimFrame").value) || 0;
        selectedMapCell.frontAnimationTick = parseInt(document.getElementById("propFrontAnimTick").value) || 0;
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
