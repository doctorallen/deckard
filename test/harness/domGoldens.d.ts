/** Where test:dom keeps the goldens. */
export const GOLDENS: string;

/**
 * Parses each DOM golden and hands its body to `visit`, one at a time.
 * @param visit Called with the golden's name, `<surface>` or `<surface>+zen`, and its parsed body element.
 * @returns How many goldens were read.
 */
export function readGoldens(visit: (name: string, body: HTMLElement) => void): number;
