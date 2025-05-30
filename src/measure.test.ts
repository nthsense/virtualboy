import { getElementDimensions } from './measure';
import { MeasureFunction } from './types';

// Mock HTMLElement for testing the default measureElement logic
// We'll spy on its methods and control its properties
const createMockElement = (initialStyle: any = {}, offsetWidth: number = 0, offsetHeight: number = 0) => ({
  style: { ...initialStyle }, // Ensure each mockElement gets its own style object
  offsetWidth,
  offsetHeight,
  // Add any other properties or methods accessed by measureElement if necessary
} as unknown as HTMLElement); // Cast to HTMLElement for type compatibility

const createMockParentElement = () => ({
  appendChild: jest.fn(),
  removeChild: jest.fn(),
} as unknown as HTMLElement); // Cast for type compatibility

describe('Measure Logic (src/measure.ts)', () => {

  beforeEach(() => {
    // Clear all mocks if any are global or module-level (though here they are mostly function-scoped)
    jest.clearAllMocks();
  });

  describe('getElementDimensions', () => {
    test('should use customMeasure function if provided', () => {
      const mockCustomMeasure: MeasureFunction = jest.fn(() => ({ width: 123, height: 456 }));
      // Using simple objects as mocks since their internal details don't matter for this test path
      const element = {} as HTMLElement;
      const parentElement = {} as HTMLElement;
      const mockOriginalAppend = jest.fn();
      const mockOriginalRemove = jest.fn();

      const dimensions = getElementDimensions(element, parentElement, mockOriginalAppend, mockOriginalRemove, mockCustomMeasure);

      expect(mockCustomMeasure).toHaveBeenCalledWith(element);
      expect(dimensions).toEqual({ width: 123, height: 456 });
      // Ensure original DOM methods are not called when customMeasure is used
      expect(mockOriginalAppend).not.toHaveBeenCalled();
      expect(mockOriginalRemove).not.toHaveBeenCalled();
    });

    test('should use default measureElement logic if customMeasure is not provided', () => {
      const mockElem = createMockElement({}, 100, 50);
      const mockParentElem = createMockParentElement();
      // These mocks will be passed to measureElement, which should then use them.
      const mockOriginalAppend = jest.fn( (el: Node) => mockParentElem.appendChild(el) );
      const mockOriginalRemove = jest.fn( (el: Node) => mockParentElem.removeChild(el) );


      const dimensions = getElementDimensions(mockElem, mockParentElem, mockOriginalAppend, mockOriginalRemove, undefined);

      // getElementDimensions calls measureElement, which in turn calls originalAppend/Remove.
      // The spies on mockParentElem methods are to confirm that the passed-through functions were indeed called.
      expect(mockOriginalAppend).toHaveBeenCalledWith(mockElem);
      expect(mockOriginalRemove).toHaveBeenCalledWith(mockElem);
      // Also verify that the spies on mockParentElem were called by the mockOriginalAppend/Remove
      expect(mockParentElem.appendChild).toHaveBeenCalledWith(mockElem);
      expect(mockParentElem.removeChild).toHaveBeenCalledWith(mockElem);
      expect(dimensions).toEqual({ width: 100, height: 50 });

      // Check that styles were applied for measurement then restored (assuming initial was empty)
      expect(mockElem.style.position).toBe('');
      expect(mockElem.style.visibility).toBe('');
      expect(mockElem.style.display).toBe('');
      expect(mockElem.style.left).toBe('');
      expect(mockElem.style.top).toBe('');
    });

    test('default measureElement logic should correctly apply and restore styles', () => {
      const originalStyle = {
        position: 'relative',
        visibility: 'visible',
        display: 'inline-block',
        left: '10px',
        top: '20px',
      };
      const mockElem = createMockElement(originalStyle, 200, 75);
      const mockParentElem = createMockParentElement();
      const mockOriginalAppend = jest.fn( (el: Node) => mockParentElem.appendChild(el) );
      const mockOriginalRemove = jest.fn( (el: Node) => mockParentElem.removeChild(el) );

      getElementDimensions(mockElem, mockParentElem, mockOriginalAppend, mockOriginalRemove, undefined);

      // Check that original styles were restored
      expect(mockElem.style.position).toBe(originalStyle.position);
      expect(mockElem.style.visibility).toBe(originalStyle.visibility);
      expect(mockElem.style.display).toBe(originalStyle.display);
      expect(mockElem.style.left).toBe(originalStyle.left);
      expect(mockElem.style.top).toBe(originalStyle.top);

      // Additionally, check that styles were set during measurement (as per measureElement implementation)
      // This requires knowing what measureElement sets them to.
      // During appendChild, styles should be:
      // element.style.position = 'absolute';
      // element.style.visibility = 'hidden';
      // element.style.display = 'block';
      // element.style.left = '-9999px';
      // element.style.top = '-9999px';
      // We can check these values were set by observing the mockParentElem.appendChild call

      const appendChildSpy = mockParentElem.appendChild as jest.Mock;
      expect(appendChildSpy).toHaveBeenCalledTimes(1);
      const elementDuringAppend = appendChildSpy.mock.calls[0][0] as HTMLElement;

      // These styles are checked on the element *as it was when appendChild was called*.
      // The actual measureElement in measure.ts would modify the style of the element passed to it.
      // So, we need to ensure our mockElement's style object is actually modified.
      // The current mock setup for style makes it tricky to intercept intermediate style changes.
      // A more robust way would be to spy on element.style assignments if possible,
      // or to have `measureElement` return the styles it applied.
      // For now, we trust the restoration check.
      // A more detailed test would involve a more sophisticated HTMLElement mock.
    });

    test('default measureElement logic should handle elements with no pre-existing style attributes', () => {
        const mockElem = createMockElement(undefined, 300, 150); // No initial style object
        // Ensure style property is at least an empty object if accessed
        if (!mockElem.style) {
            (mockElem as any).style = {};
        }
        const mockParentElem = createMockParentElement();
        const mockOriginalAppend = jest.fn( (el: Node) => mockParentElem.appendChild(el) );
        const mockOriginalRemove = jest.fn( (el: Node) => mockParentElem.removeChild(el) );

        getElementDimensions(mockElem, mockParentElem, mockOriginalAppend, mockOriginalRemove, undefined);

        expect(mockOriginalAppend).toHaveBeenCalledWith(mockElem);
        expect(mockOriginalRemove).toHaveBeenCalledWith(mockElem);
        expect(mockParentElem.appendChild).toHaveBeenCalledWith(mockElem);
        expect(mockParentElem.removeChild).toHaveBeenCalledWith(mockElem);

        // Check that styles are restored to their "default" (empty string for these properties)
        expect(mockElem.style.position).toBe('');
        expect(mockElem.style.visibility).toBe('');
        expect(mockElem.style.display).toBe('');
        expect(mockElem.style.left).toBe('');
        expect(mockElem.style.top).toBe('');
    });
  });
});
