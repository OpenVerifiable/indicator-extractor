import { convertHashFields } from './convertHashFields.js';

/**
 * Processes C2PA assertions and converts them to a structured format.
 *
 * This function:
 * - Strips internal metadata (uuid, sourceBox, etc.)
 * - Converts binary hash fields to base64 strings
 * - Organizes assertions by label for easy access

 * @param {Object} assertions - Raw assertions object from C2PA manifest
 * @returns {Object} Processed assertions organized by label
 *
 * @private
 */

export function processAssertions(assertions: { assertions?: Array<{ uuid?: string; sourceBox?: unknown; componentType?: unknown; label?: string; content?: unknown; [key: string]: unknown }> }) {
    const assertionsObj: { [key: string]: unknown } = {};
    if (!assertions || !assertions.assertions) return assertionsObj;
    for (const assertion of assertions.assertions) {
        // Strip out internal metadata properties
        // eslint-disable-next-line no-unused-vars
        const { uuid, sourceBox, componentType, label, content, ...rest } = assertion;
        convertHashFields(rest);
        assertionsObj[assertion.label || 'unknown'] = rest;
    }
    return assertionsObj;
}
