// demo.js
document.addEventListener('DOMContentLoaded', () => {
    const virtualContainer = document.getElementById('virtual-container');
    const mouseCoordsSpan = document.getElementById('mouse-coords');
    const elementsAtPointSpan = document.getElementById('elements-at-point');

    if (!virtualContainer || !mouseCoordsSpan || !elementsAtPointSpan) {
        console.error('Demo HTML elements not found!');
        return;
    }

    // 1. Initialize Virtualboy
    // Assuming virtualboy.bundle.js has loaded and Virtualboy is on the window
    if (!window.Virtualboy || typeof window.Virtualboy.init !== 'function') {
        console.error('Virtualboy library not loaded or init function not found!');
        elementsAtPointSpan.textContent = 'Error: Virtualboy library not loaded.';
        return;
    }
    const vb = window.Virtualboy.init(virtualContainer);

    // 2. Random Element Generation & Addition
    const numElements = 200;
    const elementBaseSize = 50; // Base size, will be varied

    for (let i = 0; i < numElements; i++) {
        const div = document.createElement('div');
        // The styling for '.virtual-item' in index.html will apply once they are rendered by Virtualboy.

        const width = Math.floor(Math.random() * 100) + elementBaseSize; // 50 to 149
        const height = Math.floor(Math.random() * 80) + (elementBaseSize / 2); // 25 to 104

        div.style.width = width + 'px';
        div.style.height = height + 'px';
        // Random background color
        const r = Math.floor(Math.random() * 200) + 55; // Avoid too dark/light
        const g = Math.floor(Math.random() * 200) + 55;
        const b = Math.floor(Math.random() * 200) + 55;
        div.style.backgroundColor = `rgb(${r},${g},${b})`;

        div.textContent = `Item ${i + 1}`;
        div.title = `Item ${i + 1} (${width}x${height})`; // Tooltip

        // Virtualboy's overridden appendChild will handle this
        virtualContainer.appendChild(div);
    }
    console.log(`Added ${numElements} virtual elements via appendChild.`);

    // 3. Mousemove Highlighting & Info Update
    let currentlyHighlightedElements = []; // Store references to currently highlighted DOM elements

    virtualContainer.addEventListener('mousemove', (event) => {
        // Get mouse position relative to the container element's content area (excluding border/padding if any)
        const rect = virtualContainer.getBoundingClientRect(); // Position of the container itself
        const xOnScreen = event.clientX - rect.left; // Mouse X relative to container's viewport top-left
        const yOnScreen = event.clientY - rect.top;  // Mouse Y relative to container's viewport top-left

        // Convert to virtual coordinates (coordinates within the scrollable content)
        const virtualX = xOnScreen + virtualContainer.scrollLeft;
        const virtualY = yOnScreen + virtualContainer.scrollTop;

        mouseCoordsSpan.textContent = `(x: ${virtualX}, y: ${virtualY})`;

        const elementsUnderMouse = vb.getElementsAt(virtualX, virtualY);

        // Remove highlight from previously highlighted elements
        currentlyHighlightedElements.forEach(el => {
            if (el) el.classList.remove('highlight');
        });
        currentlyHighlightedElements = []; // Reset the list

        // Highlight new elements
        if (elementsUnderMouse.length > 0) {
            elementsAtPointSpan.textContent = elementsUnderMouse.map(el => el.title || el.textContent.substring(0,20)).join(', ');
            elementsUnderMouse.forEach(el => {
                if (el) { // Ensure element is valid (it should be if returned by Virtualboy)
                    el.classList.add('highlight');
                    currentlyHighlightedElements.push(el);
                }
            });
        } else {
            elementsAtPointSpan.textContent = 'None';
        }
    });

    virtualContainer.addEventListener('mouseleave', () => {
        // Clear highlights when mouse leaves the container
        currentlyHighlightedElements.forEach(el => {
            if (el) el.classList.remove('highlight');
        });
        currentlyHighlightedElements = [];
        mouseCoordsSpan.textContent = '-';
        elementsAtPointSpan.textContent = '-';
    });

    console.log('Virtualboy demo initialized.');
});
