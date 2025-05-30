import { Virtualboy } from './virtualboy'; // Adjust path as needed
import { VirtualElement, Rect } from './types';

// Mock requestAnimationFrame
(global as any).requestAnimationFrame = jest.fn((cb: FrameRequestCallback) => { cb(0); return 0; });
// Mock cancelAnimationFrame if needed, though not directly used by the logic we're testing initially
// global.cancelAnimationFrame = jest.fn();

// Basic HTMLElement mock
const mockElement = (id: string, initialHeight = 100, initialWidth = 100) => {
    const el = document.createElement('div') as any; // Use 'any' for easier mocking
    el.id = id;
    el.style = {
        position: '', visibility: '', display: '', left: '', top: '',
        height: `${initialHeight}px`, width: `${initialWidth}px`
    };
    el.offsetHeight = initialHeight;
    el.offsetWidth = initialWidth;

    // Mock methods that might be called on elements by Virtualboy
    el.appendChild = jest.fn();
    el.removeChild = jest.fn();
    el.insertBefore = jest.fn();
    el.getBoundingClientRect = jest.fn(() => ({
        x: 0, y: 0, width: initialWidth, height: initialHeight, top: 0, left: 0, right: initialWidth, bottom: initialHeight, toJSON: () => {}
    }));
    return el as HTMLElement;
};

// Mock for the parent element
const mockParentElement = () => {
    const el = mockElement('parent-virtualboy', 800, 600) as any; // Type as any for easier mocking
    el.scrollTop = 0; // Default to 0
    el.scrollLeft = 0; // Default to 0
    el.clientHeight = 600;
    el.clientWidth = 800;
    el.children = []; // To somewhat simulate children for discoverInitialElements
    el.addEventListener = jest.fn();
    el.removeEventListener = jest.fn();

    // Store original DOM methods as Virtualboy expects these on the instance
    // For the mock, we'll just use jest.fn() for these originals,
    // as Virtualboy calls them via .call(this.parentElement, ...)
    // So, the mock parent itself needs to provide these as if they were the browser's originals.
    el.originalAppendChild = jest.fn((child) => {
        (el.children as HTMLElement[]).push(child); // Simulate append
        return child;
    });
    el.originalInsertBefore = jest.fn((child, ref) => {
        (el.children as HTMLElement[]).push(child); // Simulate insert
        return child;
    });
    el.originalRemoveChild = jest.fn((child) => {
        el.children = (el.children as HTMLElement[]).filter(c => c !== child); // Simulate remove
        return child;
    });

    // Mock methods that Virtualboy overrides
    // These are initially copies of the "original" ones for the mock,
    // then Virtualboy will override them on its instance of parentElement.
    el.appendChild = jest.fn((child) => {
        (el.children as HTMLElement[]).push(child);
        return child;
    });
    el.insertBefore = jest.fn((child, ref) => {
        (el.children as HTMLElement[]).push(child);
        return child;
    });
    el.removeChild = jest.fn((child) => {
        el.children = (el.children as HTMLElement[]).filter(c => c !== child);
        return child;
    });

    return el as HTMLElement;
};

describe('Virtualboy Scrolling Logic', () => {
    let parentElement: any;
    let virtualboy: Virtualboy;
    let sizerElement: HTMLElement;

    beforeEach(() => {
        parentElement = mockParentElement();

        const actualCreateElement = document.createElement;
        jest.spyOn(document, 'createElement').mockImplementation((tagName: string) => {
            if (tagName === 'div') {
                // This will be the sizer element
                sizerElement = mockElement('virtualboy-sizer', 0, 0);
                // Virtualboy expects originalAppendChild to be callable on parentElement
                // to append the sizer. Our mockParentElement.originalAppendChild handles this.
                return sizerElement;
            }
            return actualCreateElement.call(document, tagName);
        });

        virtualboy = new Virtualboy(parentElement);

        (document.createElement as jest.Mock).mockRestore();

        // Ensure the sizer created during Virtualboy construction is the one we captured
        // and is accessible for manipulation in tests.
        (virtualboy as any).sizerElement = sizerElement;

    });

    afterEach(() => {
        if (virtualboy) {
            virtualboy.destroy();
        }
        jest.clearAllMocks();
    });

    test('should calculate virtualScrollTop using percentage when totalVirtualHeight exceeds MAX_SCROLL_HEIGHT', () => {
        const numElements = 2000;
        const elementHeight = 100;
        (virtualboy as any).totalVirtualHeight = numElements * elementHeight;
        (virtualboy as any).totalVirtualWidth = 800;

        // Simulate sizer being updated to MAX_SCROLL_HEIGHT by updateSizer
        // (virtualboy as any).updateSizer(); // This would internally use Virtualboy.MAX_SCROLL_HEIGHT
        // Or directly set sizer style height for test isolation:
        if ((virtualboy as any).sizerElement) {
            (virtualboy as any).sizerElement.style.height = `${Virtualboy['MAX_SCROLL_HEIGHT']}px`;
        } else {
            throw new Error("Sizer element not found in Virtualboy instance for test.");
        }

        parentElement.clientHeight = 600; // As mocked
        const maxScrollTopForSizer = Virtualboy['MAX_SCROLL_HEIGHT'] - parentElement.clientHeight;

        // Test case 1: Scrolled to 50% of the sizer
        parentElement.scrollTop = maxScrollTopForSizer / 2;

        (virtualboy as any).handleScroll();

        const expectedMaxVirtualScrollTop = (virtualboy as any).totalVirtualHeight - parentElement.clientHeight;
        const expectedVirtualScrollTop = 0.5 * expectedMaxVirtualScrollTop;

        expect((virtualboy as any).virtualScrollTop).toBeCloseTo(expectedVirtualScrollTop);

        // Test case 2: Scrolled to the bottom of the sizer
        parentElement.scrollTop = maxScrollTopForSizer;
        (virtualboy as any).handleScroll();
        expect((virtualboy as any).virtualScrollTop).toBeCloseTo(expectedMaxVirtualScrollTop);

        // Test case 3: Scrolled to the top of the sizer
        parentElement.scrollTop = 0;
        (virtualboy as any).handleScroll();
        expect((virtualboy as any).virtualScrollTop).toBeCloseTo(0);
    });

    test('should use direct scrollTop when totalVirtualHeight is within MAX_SCROLL_HEIGHT', () => {
        (virtualboy as any).totalVirtualHeight = 5000;
        (virtualboy as any).totalVirtualWidth = 800;

        // Simulate sizer being updated
        // (virtualboy as any).updateSizer(); // This would use totalVirtualHeight for sizer
        // Or directly set sizer style height:
        if ((virtualboy as any).sizerElement) {
            (virtualboy as any).sizerElement.style.height = `${(virtualboy as any).totalVirtualHeight}px`;
        } else {
            throw new Error("Sizer element not found for test.");
        }

        parentElement.scrollTop = 1000;
        (virtualboy as any).handleScroll();
        expect((virtualboy as any).virtualScrollTop).toBe(1000);
    });

    // TODO: Add similar tests for horizontal scrolling (virtualScrollLeft) - DONE
    // TODO: Add tests for remeasure scroll restoration - DONE (Vertical)
    // TODO: Add tests for updateSizer capping - DONE
});

describe('Virtualboy Scrolling Logic (Horizontal)', () => {
    let parentElement: any;
    let virtualboy: Virtualboy;
    let sizerElement: HTMLElement;

    beforeEach(() => {
        parentElement = mockParentElement();
        const actualCreateElement = document.createElement;
        jest.spyOn(document, 'createElement').mockImplementation((tagName: string) => {
            if (tagName === 'div') {
                sizerElement = mockElement('virtualboy-sizer', 0, 0);
                return sizerElement;
            }
            return actualCreateElement.call(document, tagName);
        });
        virtualboy = new Virtualboy(parentElement);
        (document.createElement as jest.Mock).mockRestore();
        (virtualboy as any).sizerElement = sizerElement;
    });

    afterEach(() => {
        if (virtualboy) {
            virtualboy.destroy();
        }
        jest.clearAllMocks();
    });

    test('should calculate virtualScrollLeft using percentage when totalVirtualWidth exceeds MAX_SCROLL_WIDTH', () => {
        const numElements = 2000;
        const elementWidth = 100;
        (virtualboy as any).totalVirtualWidth = numElements * elementWidth;
        (virtualboy as any).totalVirtualHeight = 600;

        if ((virtualboy as any).sizerElement) {
            (virtualboy as any).sizerElement.style.width = `${Virtualboy['MAX_SCROLL_WIDTH']}px`;
        } else {
            throw new Error("Sizer element not found in Virtualboy instance for test.");
        }

        parentElement.clientWidth = 800; // As mocked
        const maxScrollLeftForSizer = Virtualboy['MAX_SCROLL_WIDTH'] - parentElement.clientWidth;

        // Test case 1: Scrolled to 50% of the sizer
        parentElement.scrollLeft = maxScrollLeftForSizer / 2;
        (virtualboy as any).handleScroll();
        const expectedMaxVirtualScrollLeft = (virtualboy as any).totalVirtualWidth - parentElement.clientWidth;
        const expectedVirtualScrollLeft = 0.5 * expectedMaxVirtualScrollLeft;
        expect((virtualboy as any).virtualScrollLeft).toBeCloseTo(expectedVirtualScrollLeft);

        // Test case 2: Scrolled to the bottom of the sizer
        parentElement.scrollLeft = maxScrollLeftForSizer;
        (virtualboy as any).handleScroll();
        expect((virtualboy as any).virtualScrollLeft).toBeCloseTo(expectedMaxVirtualScrollLeft);

        // Test case 3: Scrolled to the top of the sizer
        parentElement.scrollLeft = 0;
        (virtualboy as any).handleScroll();
        expect((virtualboy as any).virtualScrollLeft).toBeCloseTo(0);
    });

    test('should use direct scrollLeft when totalVirtualWidth is within MAX_SCROLL_WIDTH', () => {
        (virtualboy as any).totalVirtualWidth = 5000;
        (virtualboy as any).totalVirtualHeight = 600;

        if ((virtualboy as any).sizerElement) {
            (virtualboy as any).sizerElement.style.width = `${(virtualboy as any).totalVirtualWidth}px`;
        } else {
            throw new Error("Sizer element not found for test.");
        }

        parentElement.scrollLeft = 1000;
        (virtualboy as any).handleScroll();
        expect((virtualboy as any).virtualScrollLeft).toBe(1000);
    });
});

describe('Virtualboy updateSizer Logic', () => {
    let parentElement: any;
    let virtualboy: Virtualboy;
    let sizerElement: HTMLElement;

    beforeEach(() => {
        parentElement = mockParentElement();
        const actualCreateElement = document.createElement;
        jest.spyOn(document, 'createElement').mockImplementation((tagName: string) => {
            if (tagName === 'div') {
                sizerElement = mockElement('virtualboy-sizer', 0, 0);
                return sizerElement;
            }
            return actualCreateElement.call(document, tagName);
        });
        virtualboy = new Virtualboy(parentElement);
        (document.createElement as jest.Mock).mockRestore();
        (virtualboy as any).sizerElement = sizerElement;
    });

    afterEach(() => {
        if (virtualboy) {
            virtualboy.destroy();
        }
        jest.clearAllMocks();
    });

    test('should cap sizer dimensions when total virtual dimensions exceed MAX values', () => {
        (virtualboy as any).totalVirtualHeight = Virtualboy['MAX_SCROLL_HEIGHT'] * 2;
        (virtualboy as any).totalVirtualWidth = Virtualboy['MAX_SCROLL_WIDTH'] * 2;

        (virtualboy as any).updateSizer();

        expect((virtualboy as any).sizerElement.style.height).toBe(`${Virtualboy['MAX_SCROLL_HEIGHT']}px`);
        expect((virtualboy as any).sizerElement.style.width).toBe(`${Virtualboy['MAX_SCROLL_WIDTH']}px`);
    });

    test('should use total virtual dimensions when they are within MAX values', () => {
        const testHeight = Virtualboy['MAX_SCROLL_HEIGHT'] / 2;
        const testWidth = Virtualboy['MAX_SCROLL_WIDTH'] / 2;
        (virtualboy as any).totalVirtualHeight = testHeight;
        (virtualboy as any).totalVirtualWidth = testWidth;

        (virtualboy as any).updateSizer();

        expect((virtualboy as any).sizerElement.style.height).toBe(`${testHeight}px`);
        expect((virtualboy as any).sizerElement.style.width).toBe(`${testWidth}px`);
    });
});

describe('Virtualboy remeasure Logic', () => {
    let parentElement: any;
    let virtualboy: Virtualboy;
    let sizerElement: HTMLElement;

    beforeEach(() => {
        parentElement = mockParentElement();
        const actualCreateElement = document.createElement;
        jest.spyOn(document, 'createElement').mockImplementation((tagName: string) => {
            if (tagName === 'div') {
                sizerElement = mockElement('virtualboy-sizer', 0, 0);
                return sizerElement;
            }
            return actualCreateElement.call(document, tagName);
        });
        virtualboy = new Virtualboy(parentElement);
        (document.createElement as jest.Mock).mockRestore();
        (virtualboy as any).sizerElement = sizerElement;
         // Ensure elements map exists for remeasure to iterate, even if empty
        (virtualboy as any).elements = new Map();
    });

    afterEach(() => {
        if (virtualboy) {
            virtualboy.destroy();
        }
        jest.clearAllMocks();
    });

    test('should correctly restore scroll position during remeasure when percentage scrolling is active (vertical)', () => {
        const initialTotalVirtualHeight = 2 * Virtualboy['MAX_SCROLL_HEIGHT'];
        (virtualboy as any).totalVirtualHeight = initialTotalVirtualHeight;
        // updateSizer is called inside remeasure, but we can call it to set initial sizer state
        (virtualboy as any).updateSizer();

        const parentClientHeight = parentElement.clientHeight; // 600
        const maxVirtualScrollableHeight = initialTotalVirtualHeight - parentClientHeight;
        // Intend to restore to 50% of virtual scroll height
        const intendedSavedVirtualScrollTop = maxVirtualScrollableHeight / 2;
        (virtualboy as any).virtualScrollTop = intendedSavedVirtualScrollTop;

        // Calculate what parentElement.scrollTop would have been for this virtualScrollTop
        // This is the scroll percentage of the virtual content, applied to the sizer's scrollable range.
        let initialScrollPercentage = 0;
        if (maxVirtualScrollableHeight > 0) {
            initialScrollPercentage = intendedSavedVirtualScrollTop / maxVirtualScrollableHeight;
        }
        initialScrollPercentage = Math.max(0, Math.min(1, initialScrollPercentage));

        const sizerScrollableHeight = Virtualboy['MAX_SCROLL_HEIGHT'] - parentClientHeight;
        parentElement.scrollTop = initialScrollPercentage * (sizerScrollableHeight > 0 ? sizerScrollableHeight : 0);

        // For this test, assume totalVirtualHeight does not change during remeasure itself,
        // as no elements are actually being remeasured that would alter it.
        // (virtualboy as any).elements is an empty Map, so the loop in remeasure won't change totalVirtualHeight.

        (virtualboy as any).remeasure();

        // Assertion 1: parentElement.scrollTop should be restored based on the saved virtual percentage
        // applied to the current sizer's scrollable range.
        // Since totalVirtualHeight is unchanged, sizer cap remains, sizerScrollableHeight is the same.
        const expectedParentScrollTop = initialScrollPercentage * (sizerScrollableHeight > 0 ? sizerScrollableHeight : 0);
        expect(parentElement.scrollTop).toBeCloseTo(expectedParentScrollTop);

        // Assertion 2: virtualScrollTop should be restored to its original saved value (or very close)
        // This is because totalVirtualHeight hasn't changed, and parentElement.scrollTop has been set to match the original percentage.
        expect((virtualboy as any).virtualScrollTop).toBeCloseTo(intendedSavedVirtualScrollTop);
    });
});

describe('Virtualboy updateVisibleElements - Relative Positioning', () => {
    let parentElement: any;
    let virtualboy: Virtualboy;
    let sizerElement: HTMLElement; // Though not directly used in these tests, setup might create it
    let mockQueryRangeFn: jest.Mock;

    beforeEach(() => {
        parentElement = mockParentElement();
        (global as any).requestAnimationFrame = jest.fn((cb: FrameRequestCallback) => { cb(0); return 0; });

        // Setup mock KDTree
        mockQueryRangeFn = jest.fn();

        // Correctly get the KDTree class for spying on its prototype
        // Assuming KDTree is exported as a class from './kdTree'
        // If './kdTree' exports { KDTree: class KDTreeImpl }, then this is fine.
        // If it's a default export, syntax would differ. Given Virtualboy news it up, it's likely a named export.
        const kdTreeModule = jest.requireActual('./kdTree');
        const OriginalKDTree = kdTreeModule.KDTree;

        // Spy on the queryRange method of KDTree instances
        // This spy will affect all instances of KDTree created after this point,
        // which is what we want if Virtualboy instantiates KDTree internally.
        jest.spyOn(OriginalKDTree.prototype, 'queryRange').mockImplementation(mockQueryRangeFn);

        // Mock document.createElement for sizer, similar to other describe blocks
        const actualCreateElement = document.createElement;
        jest.spyOn(document, 'createElement').mockImplementation((tagName: string) => {
            if (tagName === 'div') {
                // This will be the sizer element. Capture it if needed, or just return a mock.
                sizerElement = mockElement('virtualboy-sizer-for-uve', 0, 0);
                return sizerElement;
            }
            return actualCreateElement.call(document, tagName);
        });

        virtualboy = new Virtualboy(parentElement);

        // Restore original document.createElement immediately after Virtualboy constructor
        // to avoid interfering with other element creations in tests if any.
        (document.createElement as jest.Mock).mockRestore();

        // It's possible Virtualboy's KDTree instance is created in its constructor.
        // The spyOn prototype should ideally catch this.
        // If direct assignment was ever needed (e.g. (virtualboy as any).kdTree.queryRange = mockQueryRangeFn),
        // it would go here, but prototype spy is cleaner.
    });

    afterEach(() => {
        if (virtualboy) {
            virtualboy.destroy();
        }
        jest.restoreAllMocks(); // Restores original implementations of spied methods
        jest.clearAllMocks();   // Clears call counts etc. for all mocks
    });

    test('should position element correctly, compensating for virtual scroll (parent scroll 0)', () => {
        (virtualboy as any).virtualScrollTop = 200;
        (virtualboy as any).virtualScrollLeft = 30;
        // parentElement.scrollTop and scrollLeft are 0 by default from mockParentElement

        const mockElem = mockElement('el1');
        const veData: VirtualElement = {
            id: 'el1', element: mockElem,
            rect: { x: 40, y: 250, width: 10, height: 10 },
            isVisible: false, originalDisplay: 'block'
        };
        mockQueryRangeFn.mockReturnValue([veData]);

        const appendedElements: HTMLElement[] = [];
        parentElement.originalAppendChild = jest.fn((node: Node) => {
            if (node.nodeType === Node.DOCUMENT_FRAGMENT_NODE) {
                Array.from(node.childNodes).forEach(child => {
                    if (child.nodeType === Node.ELEMENT_NODE) {
                        appendedElements.push(child as HTMLElement);
                    }
                });
            } else if (node.nodeType === Node.ELEMENT_NODE) {
                appendedElements.push(node as HTMLElement);
            }
            return node;
        });

        (virtualboy as any).updateVisibleElements();

        expect(appendedElements.length).toBe(1);
        const renderedElement = appendedElements[0];
        // Expected: (rect.y - virtualScrollTop) + parentElement.scrollTop
        // Expected: (250 - 200) + 0 = 50
        expect(renderedElement.style.top).toBe(`${50}px`);
        // Expected: (rect.x - virtualScrollLeft) + parentElement.scrollLeft
        // Expected: (40 - 30) + 0 = 10
        expect(renderedElement.style.left).toBe(`${10}px`);
        expect(veData.isVisible).toBe(true);
        expect((virtualboy as any).currentlyVisibleElements.has('el1')).toBe(true);
    });

    test('should position elements reflecting parent scroll when aligned with virtual viewport', () => {
        (virtualboy as any).virtualScrollTop = 300;
        (virtualboy as any).virtualScrollLeft = 70;
        parentElement.scrollTop = 10; // Non-zero parent scroll
        parentElement.scrollLeft = 5;  // Non-zero parent scroll

        const mockElem = mockElement('el2');
        const veData: VirtualElement = {
            id: 'el2', element: mockElem,
            rect: { x: 70, y: 300, width: 10, height: 10 }, // Aligned with virtual scroll
            isVisible: false, originalDisplay: 'block'
        };
        mockQueryRangeFn.mockReturnValue([veData]);

        const appendedElements: HTMLElement[] = [];
        parentElement.originalAppendChild = jest.fn((node: Node) => {
             if (node.nodeType === Node.DOCUMENT_FRAGMENT_NODE && node.childNodes.length > 0) {
                appendedElements.push(node.childNodes[0] as HTMLElement);
            } else if (node.nodeType === Node.ELEMENT_NODE) {
                appendedElements.push(node as HTMLElement);
            }
            return node;
        });

        (virtualboy as any).updateVisibleElements();

        expect(appendedElements.length).toBe(1);
        const renderedElement = appendedElements[0];
        // Expected: (rect.y - virtualScrollTop) + parentElement.scrollTop
        // Expected: (300 - 300) + 10 = 10
        expect(renderedElement.style.top).toBe('10px');
        // Expected: (rect.x - virtualScrollLeft) + parentElement.scrollLeft
        // Expected: (70 - 70) + 5 = 5
        expect(renderedElement.style.left).toBe('5px');
        expect(veData.isVisible).toBe(true);
        expect((virtualboy as any).currentlyVisibleElements.has('el2')).toBe(true);
    });

    test('should apply parent scroll offset correctly when element is not aligned with virtual viewport', () => {
        (virtualboy as any).virtualScrollTop = 100;  // virtual viewport scrolled down by 100
        (virtualboy as any).virtualScrollLeft = 50; // virtual viewport scrolled right by 50
        parentElement.scrollTop = 20;               // parent element scrolled down by 20
        parentElement.scrollLeft = 10;              // parent element scrolled right by 10

        const mockElem = mockElement('el3');
        const veData: VirtualElement = {
            id: 'el3', element: mockElem,
            rect: { x: 150, y: 250, width: 20, height: 20 }, // Element's absolute virtual position
            isVisible: false, originalDisplay: 'block'
        };
        mockQueryRangeFn.mockReturnValue([veData]);

        const appendedElements: HTMLElement[] = [];
        parentElement.originalAppendChild = jest.fn((node: Node) => {
             if (node.nodeType === Node.DOCUMENT_FRAGMENT_NODE && node.childNodes.length > 0) {
                appendedElements.push(node.childNodes[0] as HTMLElement);
            } else if (node.nodeType === Node.ELEMENT_NODE) {
                appendedElements.push(node as HTMLElement);
            }
            return node;
        });

        (virtualboy as any).updateVisibleElements();

        expect(appendedElements.length).toBe(1);
        const renderedElement = appendedElements[0];
        // Expected top: (rect.y - virtualScrollTop) + parentElement.scrollTop
        // (250 - 100) + 20 = 150 + 20 = 170
        expect(renderedElement.style.top).toBe('170px');
        // Expected left: (rect.x - virtualScrollLeft) + parentElement.scrollLeft
        // (150 - 50) + 10 = 100 + 10 = 110
        expect(renderedElement.style.left).toBe('110px');
        expect(veData.isVisible).toBe(true);
        expect((virtualboy as any).currentlyVisibleElements.has('el3')).toBe(true);
    });
});

describe('Virtualboy Parent Element Positioning', () => {
    let parentElement: HTMLElement; // Use HTMLElement for parentElement type

    beforeEach(() => {
        parentElement = document.createElement('div');
        // Append to body so getComputedStyle works more reliably in jsdom
        document.body.appendChild(parentElement);
        // Ensure mocks from other describe blocks don't interfere if run in same file.
        // jest.clearAllMocks() might be needed if there are global mocks from other tests.
        // For this suite, we are not using spies/mocks heavily on Virtualboy internals,
        // but rather observing DOM properties and specific internal fields.
    });

    afterEach(() => {
        if (parentElement.parentNode) {
            parentElement.parentNode.removeChild(parentElement);
        }
        // jest.clearAllMocks(); // If using mocks that need clearing per test
    });

    test('should set parent position to "relative" and store original if parent is initially "static"', () => {
        // JSDOM default for a new div's computed position is 'static'.
        // We can also explicitly set parentElement.style.position = '' to ensure no inline style.
        parentElement.style.position = ''; // Ensure no inline style that might make it non-static

        // Mock document.createElement for sizer to allow Virtualboy instantiation
        const actualCreateElement = document.createElement;
        const sizerMock = mockElement('sizer-pos-test1'); // Assuming mockElement helper
        jest.spyOn(document, 'createElement').mockImplementation((tagName: string) => {
            if (tagName.toLowerCase() === 'div') return sizerMock;
            return actualCreateElement.call(document, tagName);
        });

        const virtualboy = new Virtualboy(parentElement);

        expect(parentElement.style.position).toBe('relative');
        // originalParentPosition should store the inline style, which was empty string.
        expect((virtualboy as any).originalParentPosition).toBe('');

        virtualboy.destroy();
        // Restoring an empty string to style.position effectively removes the inline 'relative'.
        // The computed style would then revert to 'static'.
        expect(parentElement.style.position).toBe('');

        (document.createElement as jest.Mock).mockRestore(); // Clean up spy
    });

    test('should NOT change parent position if parent is initially "relative"', () => {
        parentElement.style.position = 'relative';
        const initialInlinePosition = parentElement.style.position;

        const actualCreateElement = document.createElement;
        const sizerMock = mockElement('sizer-pos-test2');
        jest.spyOn(document, 'createElement').mockImplementation((tagName: string) => {
            if (tagName.toLowerCase() === 'div') return sizerMock;
            return actualCreateElement.call(document, tagName);
        });

        const virtualboy = new Virtualboy(parentElement);

        expect(parentElement.style.position).toBe('relative'); // Should remain unchanged
        expect((virtualboy as any).originalParentPosition).toBeUndefined(); // Should not have been stored

        virtualboy.destroy();
        expect(parentElement.style.position).toBe(initialInlinePosition); // Should still be the initial 'relative'

        (document.createElement as jest.Mock).mockRestore();
    });

    test('should NOT change parent position if parent is initially "absolute" (already non-static)', () => {
        parentElement.style.position = 'absolute';
        const initialInlinePosition = parentElement.style.position;

        const actualCreateElement = document.createElement;
        const sizerMock = mockElement('sizer-pos-test3');
        jest.spyOn(document, 'createElement').mockImplementation((tagName: string) => {
            if (tagName.toLowerCase() === 'div') return sizerMock;
            return actualCreateElement.call(document, tagName);
        });

        const virtualboy = new Virtualboy(parentElement);

        expect(parentElement.style.position).toBe('absolute'); // Should remain unchanged
        expect((virtualboy as any).originalParentPosition).toBeUndefined();

        virtualboy.destroy();
        expect(parentElement.style.position).toBe(initialInlinePosition);

        (document.createElement as jest.Mock).mockRestore();
    });

    test('should restore an explicitly set original inline style if parent was "static" but had one', () => {
        // This test is very similar to the first one, as setting style.position = ''
        // results in computed 'static' and originalParentPosition storing ''.
        // If parentElement.style.position was, for example, 'static !important',
        // originalParentPosition would store 'static !important'.
        // For this test, we'll stick to the common case of no inline style resulting in 'static'.
        parentElement.style.position = '';

        const actualCreateElement = document.createElement;
        const sizerMock = mockElement('sizer-pos-test4');
        jest.spyOn(document, 'createElement').mockImplementation((tagName: string) => {
            if (tagName.toLowerCase() === 'div') return sizerMock;
            return actualCreateElement.call(document, tagName);
        });

        const virtualboy = new Virtualboy(parentElement);
        expect(parentElement.style.position).toBe('relative');
        expect((virtualboy as any).originalParentPosition).toBe('');

        virtualboy.destroy();
        expect(parentElement.style.position).toBe('');

        (document.createElement as jest.Mock).mockRestore();
    });
});
