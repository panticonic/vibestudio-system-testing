/**
 * The VT screen model the host and these tests share; it lives in
 * `@vibestudio/shared` because the terminal device driver reads the same
 * screens from the host side.
 */
export { VtScreen, type VtScreenOptions } from "@vibestudio/shared/vtScreen";
