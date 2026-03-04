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
                updateStatus(`Loaded lib: ${file.name} (Index ${index})`);
            } catch (err) {
                console.error("Lib load failed", file.name, err);
            }
        }
        updateStatus(`Finished loading ${loadedCount} libraries.`);
    });
});
