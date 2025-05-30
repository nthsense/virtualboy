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
    el.scrollTop = 0;
    el.scrollLeft = 0;
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
