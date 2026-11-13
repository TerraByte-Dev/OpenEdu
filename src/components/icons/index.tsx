// UI icons for OpenEdu.
//
// These are Nucleo icons (https://nucleoapp.com), Nucleo UI outline set (18px grid; a few 12px-grid
// variants for icons drawn at 8-10px, and one fill glyph), used under
// TerraByte Solutions LLC's Nucleo licence. They are NOT covered by this repository's MIT licence and
// may not be redistributed on their own (outside OpenEdu) or extracted into another icon set. Only the
// icons the app uses live here; the licence caps a public repo at 100. Count: 42.
// Add an icon by converting its Nucleo SVG by hand into this file; never commit the pack or a copy script.
//
// Every glyph draws in currentColor (Nucleo's primary and secondary colours both), so the icon takes the
// text colour of its parent. Decorative (aria-hidden) unless a title is given.
import type { JSX, ReactNode } from "react";

export interface IconProps {
  /** Rendered width and height in px. Nucleo draws on an 18px grid. */
  size?: number;
  className?: string;
  /** Accessible name. Without one the icon is aria-hidden. */
  title?: string;
}

export type IconComponent = (props: IconProps) => JSX.Element;

function icon(name: string, body: ReactNode, grid = 18): IconComponent {
  const Icon = ({ size = 18, className, title }: IconProps) => (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${grid} ${grid}`}
      className={className}
      aria-hidden={title ? undefined : true}
      role={title ? "img" : undefined}
    >
      {title && <title>{title}</title>}
      {body}
    </svg>
  );
  Icon.displayName = name;
  return Icon;
}

// arrows/18px_arrow-left.svg
export const IconArrowLeft = icon("IconArrowLeft", <><line x1="2.75" y1="9" x2="15.25" y2="9" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" /><polyline points="7 13.25 2.75 9 7 4.75" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" /></>);

// arrows/18px_arrow-right.svg
export const IconArrowRight = icon("IconArrowRight", <><line x1="15.25" y1="9" x2="2.75" y2="9" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" /><polyline points="11 4.75 15.25 9 11 13.25" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" /></>);

// school-education/18px_book-2.svg
export const IconBook2 = icon("IconBook2", <><line x1="5.75" y1="1.75" x2="5.75" y2="12.75" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" /><path d="M2.75,14.5V3.75c0-1.105,.895-2,2-2H15.25V12.75" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" /><path d="M5.25,16.25h-.75c-.966,0-1.75-.783-1.75-1.75s.784-1.75,1.75-1.75H15.25c-.641,.844-.734,2.547,0,3.5H5.25Z" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" /><line x1="8.75" y1="5.25" x2="12.25" y2="5.25" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" /><line x1="8.75" y1="8.25" x2="12.25" y2="8.25" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" /></>);

// arrows/18px_chevron-down.svg
export const IconChevronDown = icon("IconChevronDown", <><polyline points="15.25 6.5 9 12.75 2.75 6.5" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" /></>);

// arrows/18px_chevron-left.svg
export const IconChevronLeft = icon("IconChevronLeft", <><polyline points="11.5 15.25 5.25 9 11.5 2.75" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" /></>);

// arrows/18px_chevron-right.svg
export const IconChevronRight = icon("IconChevronRight", <><polyline points="6.5 2.75 12.75 9 6.5 15.25" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" /></>);

// ui-layout/18px_circle-info.svg
export const IconCircleInfo = icon("IconCircleInfo", <><path d="M9 16.25C13.004 16.25 16.25 13.004 16.25 9C16.25 4.996 13.004 1.75 9 1.75C4.996 1.75 1.75 4.996 1.75 9C1.75 13.004 4.996 16.25 9 16.25Z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" fill="none" /><path d="M9 12.75V9.25C9 8.9739 8.7761 8.75 8.5 8.75H7.75" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" fill="none" /><path d="M9 6.75C8.448 6.75 8 6.301 8 5.75C8 5.199 8.448 4.75 9 4.75C9.552 4.75 10 5.199 10 5.75C10 6.301 9.552 6.75 9 6.75Z" fill="currentColor" /></>);

// ui-layout/18px_circle-warning.svg
export const IconCircleWarning = icon("IconCircleWarning", <><path d="M9 16.25C13.0041 16.25 16.25 13.004 16.25 9C16.25 4.996 13.0041 1.75 9 1.75C4.9959 1.75 1.75 4.996 1.75 9C1.75 13.004 4.9959 16.25 9 16.25Z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" fill="none" /><path d="M9 5.431V9.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" fill="none" /><path d="M9 13.417C8.448 13.417 8 12.968 8 12.417C8 11.866 8.448 11.417 9 11.417C9.552 11.417 10 11.866 10 12.417C10 12.968 9.552 13.417 9 13.417Z" fill="currentColor" /></>);

// time/18px_clock.svg
export const IconClock = icon("IconClock", <><circle cx="9" cy="9" r="7.25" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" /><polyline points="9 4.75 9 9 12.25 11.25" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" /></>);

// design-development/18px_database.svg
export const IconDatabase = icon("IconDatabase", <><ellipse cx="9" cy="4.25" rx="6.25" ry="2.25" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" /><path d="M2.75,4.25V13.75c0,1.243,2.798,2.25,6.25,2.25s6.25-1.007,6.25-2.25V4.25" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" /><path d="M2.75,9c0,1.243,2.798,2.25,6.25,2.25s6.25-1.007,6.25-2.25" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" /></>);

// arrows/18px_square-arrow-up-right.svg
export const IconSquareArrowUpRight = icon("IconSquareArrowUpRight", <><rect x="2.75" y="2.75" width="12.5" height="12.5" rx="2" ry="2" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" /><polyline points="8.25 6.25 11.75 6.25 11.75 9.75" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" /><line x1="11.75" y1="6.25" x2="6.25" y2="11.75" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" /></>);

// files/18px_file.svg
export const IconFile = icon("IconFile", <><path d="M15.16,6.25h-3.41c-.552,0-1-.448-1-1V1.852" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" /><path d="M2.75,14.25V3.75c0-1.105,.895-2,2-2h5.586c.265,0,.52,.105,.707,.293l3.914,3.914c.188,.188,.293,.442,.293,.707v7.586c0,1.105-.895,2-2,2H4.75c-1.105,0-2-.895-2-2Z" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" /></>);

// files/18px_folder-plus.svg
export const IconFolderPlus = icon("IconFolderPlus", <><path d="M2.25 8.75V4.75C2.25 3.645 3.145 2.75 4.25 2.75H6.201C6.808 2.75 7.381 3.02499 7.761 3.49799L8.364 4.25H13.75C14.855 4.25 15.75 5.145 15.75 6.25V9.09399" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" fill="none" /><path d="M14.75 12.25V17.25" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" fill="none" /><path d="M15.75 9.42221V8.75C15.75 7.646 14.855 6.75 13.75 6.75H4.25C3.145 6.75 2.25 7.646 2.25 8.75V13.25C2.25 14.354 3.145 15.25 4.25 15.25H9.2919" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" fill="none" /><path d="M17.25 14.75H12.25" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" fill="none" /></>);

// ui-layout/18px_gear.svg
export const IconGear = icon("IconGear", <><path d="M9 11.2495C10.2426 11.2495 11.25 10.2422 11.25 8.99951C11.25 7.75687 10.2426 6.74951 9 6.74951C7.75736 6.74951 6.75 7.75687 6.75 8.99951C6.75 10.2422 7.75736 11.2495 9 11.2495Z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" fill="none" /><path d="M16.25 9.35449V8.6445C16.25 8.1345 15.867 7.70651 15.36 7.65051L14.266 7.5285L13.763 6.31451L14.451 5.45551C14.769 5.05751 14.738 4.4845 14.377 4.1235L13.875 3.62149C13.515 3.26149 12.941 3.22949 12.543 3.54749L11.684 4.2355L10.47 3.73251L10.348 2.63849C10.292 2.13249 9.86405 1.7485 9.35405 1.7485H8.64405C8.13405 1.7485 7.70605 2.13149 7.65005 2.63849L7.52805 3.73251L6.31404 4.2355L5.45505 3.54849C5.05705 3.23049 4.48405 3.2615 4.12305 3.6225L3.62104 4.12451C3.26104 4.48451 3.22905 5.05851 3.54705 5.45651L4.23505 6.31549L3.73204 7.52951L2.63805 7.65149C2.13205 7.70749 1.74805 8.13551 1.74805 8.64551V9.3555C1.74805 9.8655 2.13105 10.2935 2.63805 10.3495L3.73204 10.4715L4.23505 11.6855L3.54805 12.5445C3.23005 12.9425 3.26105 13.5165 3.62205 13.8765L4.12405 14.3785C4.48405 14.7385 5.05805 14.7705 5.45605 14.4525L6.31504 13.7645L7.52905 14.2675L7.65105 15.3615C7.70705 15.8675 8.13505 16.2515 8.64505 16.2515H9.35505C9.86505 16.2515 10.293 15.8685 10.349 15.3615L10.471 14.2675L11.685 13.7645L12.544 14.4525C12.942 14.7705 13.515 14.7395 13.876 14.3785L14.378 13.8765C14.738 13.5165 14.77 12.9425 14.452 12.5445L13.765 11.6855L14.268 10.4715L15.362 10.3495C15.868 10.2935 16.252 9.8655 16.252 9.3555L16.25 9.35449Z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" fill="none" /></>);

// business-finance/18px_globe.svg
export const IconGlobe = icon("IconGlobe", <><ellipse cx="9" cy="9" rx="7.25" ry="3" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" /><ellipse cx="9" cy="9" rx="3" ry="7.25" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" /><circle cx="9" cy="9" r="7.25" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" /></>);

// ui-layout/18px_eye.svg
export const IconEye = icon("IconEye", <><path d="M9 11.75C10.5188 11.75 11.75 10.5188 11.75 9C11.75 7.48122 10.5188 6.25 9 6.25C7.48122 6.25 6.25 7.48122 6.25 9C6.25 10.5188 7.48122 11.75 9 11.75Z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" fill="none" /><path d="M15.9557 7.88669C16.3481 8.57939 16.3481 9.42049 15.9557 10.1132C15.0087 11.7849 12.7944 14.4999 9 14.4999C5.2056 14.4999 2.9912 11.7849 2.0443 10.1132C1.6519 9.42049 1.6519 8.57939 2.0443 7.88669C2.9913 6.21499 5.2056 3.5 9 3.5C12.7944 3.5 15.0088 6.21499 15.9557 7.88669Z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" fill="none" /></>);

// ui-layout/18px_eye-slash.svg
export const IconEyeSlash = icon("IconEyeSlash", <><path d="M4.8077 13.1923C3.4687 12.267 2.56488 11.0325 2.04418 10.1133C1.65178 9.42061 1.65178 8.57951 2.04418 7.88681C2.99118 6.21511 5.2055 3.50009 8.9999 3.50009C10.708 3.50009 12.0959 4.0503 13.1921 4.8078" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" fill="none" /><path d="M15.327 6.9151C15.578 7.2579 15.7869 7.58889 15.9556 7.88669C16.348 8.57939 16.348 9.42049 15.9556 10.1132C15.0086 11.7849 12.7943 14.4999 8.99994 14.4999C8.59234 14.4999 8.20304 14.4686 7.83154 14.4106" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" fill="none" /><path d="M7.05551 10.9446C6.55781 10.4469 6.25 9.7594 6.25 9C6.25 7.4812 7.4812 6.25 9 6.25C9.7594 6.25 10.4469 6.55779 10.9445 7.05539" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" fill="none" /><path d="M2 16L16 2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" fill="none" /></>);

// filtering-sorting/18px_magnifier.svg
export const IconMagnifier = icon("IconMagnifier", <><path d="M15.75 15.75L11.6386 11.6386" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" fill="none" /><path d="M7.75 13.25C10.7875 13.25 13.25 10.7875 13.25 7.75C13.25 4.7125 10.7875 2.25 7.75 2.25C4.7125 2.25 2.25 4.7125 2.25 7.75C2.25 10.7875 4.7125 13.25 7.75 13.25Z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" fill="none" /></>);

// sound-music/18px_media-play.svg
export const IconMediaPlay = icon("IconMediaPlay", <><path d="M5.245,2.878l9.492,5.256c.685,.379,.685,1.353,0,1.732L5.245,15.122c-.669,.371-1.495-.108-1.495-.866V3.744c0-.758,.825-1.237,1.495-.866Z" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" /></>);

// fill/sound-music/18px_media-stop.svg
export const IconMediaStop = icon("IconMediaStop", <><rect x="2" y="2" width="14" height="14" rx="2.75" ry="2.75" fill="currentColor" /></>);

// technology-devices/18px_microchip.svg
export const IconMicrochip = icon("IconMicrochip", <><rect x="3.75" y="3.75" width="10.5" height="10.5" rx="2" ry="2" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" /><rect x="6.75" y="6.75" width="4.5" height="4.5" transform="translate(0 18) rotate(-90)" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" /><line x1="9" y1="1.75" x2="9" y2="3.75" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" /><line x1="5.75" y1="1.75" x2="5.75" y2="3.75" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" /><line x1="12.25" y1="1.75" x2="12.25" y2="3.75" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" /><line x1="16.25" y1="9" x2="14.25" y2="9" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" /><line x1="16.25" y1="5.75" x2="14.25" y2="5.75" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" /><line x1="16.25" y1="12.25" x2="14.25" y2="12.25" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" /><line x1="9" y1="16.25" x2="9" y2="14.25" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" /><line x1="12.25" y1="16.25" x2="12.25" y2="14.25" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" /><line x1="5.75" y1="16.25" x2="5.75" y2="14.25" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" /><line x1="1.75" y1="9" x2="3.75" y2="9" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" /><line x1="1.75" y1="12.25" x2="3.75" y2="12.25" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" /><line x1="1.75" y1="5.75" x2="3.75" y2="5.75" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" /></>);

// weather/18px_moon.svg
export const IconMoon = icon("IconMoon", <><path d="M13,11.75c-3.452,0-6.25-2.798-6.25-6.25,0-1.352,.433-2.599,1.162-3.622-3.364,.628-5.912,3.575-5.912,7.122,0,4.004,3.246,7.25,7.25,7.25,3.372,0,6.198-2.306,7.009-5.424-.95,.583-2.063,.924-3.259,.924Z" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" /></>);

// technology-devices/18px_nodes.svg
export const IconNodes = icon("IconNodes", <><path d="M10.998 3.82599C12.8602 4.45429 14.3295 5.93581 14.9409 7.80551" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" fill="none" /><path d="M2.87101 10.981C2.48391 9.05459 3.0321 7.041 4.3456 5.5766" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" fill="none" /><path d="M13.131 14.443C11.655 15.743 9.63592 16.2743 7.70972 15.8675" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" fill="none" /><path d="M9 5.75C10.105 5.75 11 4.855 11 3.75C11 2.645 10.105 1.75 9 1.75C7.895 1.75 7 2.645 7 3.75C7 4.855 7.895 5.75 9 5.75Z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" fill="none" /><path d="M3.80402 14.75C4.90902 14.75 5.80402 13.855 5.80402 12.75C5.80402 11.645 4.90902 10.75 3.80402 10.75C2.69902 10.75 1.80402 11.645 1.80402 12.75C1.80402 13.855 2.69902 14.75 3.80402 14.75Z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" fill="none" /><path d="M14.196 14.75C15.301 14.75 16.196 13.855 16.196 12.75C16.196 11.645 15.301 10.75 14.196 10.75C13.091 10.75 12.196 11.645 12.196 12.75C12.196 13.855 13.091 14.75 14.196 14.75Z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" fill="none" /></>);

// school-education/18px_palette-2.svg
export const IconPalette = icon("IconPalette", <><path d="m8.3034,16.217c-3.7776-.3601-6.7098-3.619-6.5469-7.5271.157-3.7659,3.3501-6.8755,7.1188-6.9388,4.0612-.0683,7.3747,3.2034,7.3747,7.2489h0c0,1.5188-1.2312,2.75-2.75,2.75h-2.963c-1.0336,0-1.6928,1.1036-1.2027,2.0137l.2374.4409c.2597.4823.2062,1.0732-.1361,1.501h0c-.2736.342-.6962.553-1.1322.5115Z" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" /><circle cx="9" cy="5" r="1" fill="currentColor" strokeWidth="0" /><circle cx="6.1716" cy="6.1716" r="1" fill="currentColor" strokeWidth="0" /><circle cx="11.8284" cy="6.1716" r="1" fill="currentColor" strokeWidth="0" /><circle cx="5" cy="9" r="1" fill="currentColor" strokeWidth="0" /></>);

// communication/18px_paper-plane.svg
export const IconPaperPlane = icon("IconPaperPlane", <><path d="M5.75,10.022v4.246c0,.409,.464,.645,.794,.404l.74-.539" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" /><line x1="15.58" y1="2.569" x2="5.75" y2="10.022" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" /><path d="M2.883,6.935L15.182,2.542c.363-.13,.73,.183,.66,.562l-2.196,11.86c-.067,.363-.492,.531-.789,.311L2.754,7.807c-.322-.238-.248-.738,.129-.873Z" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" /></>);

// school-education/18px_pencil.svg
export const IconPencil = icon("IconPencil", <><path d="M13.953 7.57799L15.062 6.46898C15.648 5.88298 15.648 4.93298 15.062 4.34798L13.653 2.93898C13.067 2.35298 12.117 2.35298 11.532 2.93898L10.423 4.04799L13.953 7.57799Z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" fill="none" /><path d="M8.6544 5.81461L4.147 10.322C3.897 10.572 3.718 10.884 3.627 11.226L2.5 15.499L6.773 14.372C7.115 14.282 7.427 14.102 7.677 13.852L12.1844 9.3446" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" fill="none" /><path d="M10.4044 7.56461L6.26501 11.704" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" fill="none" /></>);

// ui-layout/18px_plus.svg
export const IconPlus = icon("IconPlus", <><line x1="9" y1="3.25" x2="9" y2="14.75" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" /><line x1="3.25" y1="9" x2="14.75" y2="9" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" /></>);

// security/18px_shield.svg
export const IconShield = icon("IconShield", <><path d="M9.305,1.848l5.25,1.68c.414,.133,.695,.518,.695,.952v6.52c0,3.03-4.684,4.748-5.942,5.155-.203,.066-.413,.066-.616,0-1.258-.407-5.942-2.125-5.942-5.155V4.48c0-.435,.281-.82,.695-.952l5.25-1.68c.198-.063,.411-.063,.61,0Z" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" /></>);

// ui-layout/18px_sidebar-right.svg
export const IconSidebarRight = icon("IconSidebarRight", <><line x1="11.75" y1="2.75" x2="11.75" y2="15.25" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" /><rect x="1.75" y="2.75" width="14.5" height="12.5" rx="2" ry="2" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" /></>);

// charts/18px_square-chart-line.svg
export const IconSquareChartLine = icon("IconSquareChartLine", <><rect x="2.75" y="2.75" width="12.5" height="12.5" rx="2" ry="2" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" /><path d="M12.75,7.75l-2.146,2.146c-.195,.195-.512,.195-.707,0l-1.793-1.793c-.195-.195-.512-.195-.707,0l-2.146,2.146" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" /></>);

// bookmarks-favorites/18px_star.svg
export const IconStar = icon("IconStar", <><polygon points="9 1.75 11.24 6.289 16.25 7.017 12.625 10.551 13.481 15.54 9 13.185 4.519 15.54 5.375 10.551 1.75 7.017 6.76 6.289 9 1.75" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" /></>);

// weather/18px_sun.svg
export const IconSun = icon("IconSun", <><line x1="9" y1="1.25" x2="9" y2="2.25" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" /><line x1="14.48" y1="3.52" x2="13.773" y2="4.227" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" /><line x1="16.75" y1="9" x2="15.75" y2="9" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" /><line x1="14.48" y1="14.48" x2="13.773" y2="13.773" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" /><line x1="9" y1="16.75" x2="9" y2="15.75" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" /><line x1="3.52" y1="14.48" x2="4.227" y2="13.773" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" /><line x1="1.25" y1="9" x2="2.25" y2="9" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" /><line x1="3.52" y1="3.52" x2="4.227" y2="4.227" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" /><circle cx="9" cy="9" r="4.25" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" /></>);

// ui-layout/18px_trash.svg
export const IconTrash = icon("IconTrash", <><path d="M13.6977 7.75L13.35 14.35C13.294 15.4201 12.416 16.25 11.353 16.25H6.64804C5.58404 16.25 4.70703 15.42 4.65103 14.35L4.30334 7.75" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" fill="none" /><path d="M2.75 4.75H15.25" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" fill="none" /><path d="M6.75 4.75V2.75C6.75 2.2 7.198 1.75 7.75 1.75H10.25C10.802 1.75 11.25 2.2 11.25 2.75V4.75" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" fill="none" /></>);

// arrows/18px_upload-4.svg
export const IconUpload4 = icon("IconUpload4", <><path d="M15.25,11.75v1.5c0,1.105-.895,2-2,2H4.75c-1.105,0-2-.895-2-2v-1.5" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" /><polyline points="12.5 6.25 9 2.75 5.5 6.25" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" /><line x1="9" y1="2.75" x2="9" y2="10.25" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" /></>);

// users/18px_user.svg
export const IconUser = icon("IconUser", <><circle cx="9" cy="4.5" r="2.75" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" /><path d="M13.762,15.516c.86-.271,1.312-1.221,.947-2.045-.97-2.191-3.159-3.721-5.709-3.721s-4.739,1.53-5.709,3.721c-.365,.825,.087,1.774,.947,2.045,1.225,.386,2.846,.734,4.762,.734s3.537-.348,4.762-.734Z" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" /></>);

// sound-music/18px_volume-up.svg
export const IconVolumeUp = icon("IconVolumeUp", <><path d="M5,5.75H2.25c-.828,0-1.5,.672-1.5,1.5v3.5c0,.828,.672,1.5,1.5,1.5h2.75l5.48,3.508c.333,.213,.77-.026,.77-.421V2.664c0-.395-.437-.634-.77-.421l-5.48,3.508Z" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" /><path d="M13.914,7.586c.781,.781,.781,2.047,0,2.828" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" /><path d="M15.859,5.641c1.855,1.855,1.855,4.863,0,6.718" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" /></>);

// ui-layout/18px_xmark.svg
export const IconXmark = icon("IconXmark", <><line x1="14" y1="4" x2="4" y2="14" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" /><line x1="4" y1="4" x2="14" y2="14" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" /></>);

// Small sizes. Nucleo's stroke is 1.5 on its grid, so an 18px-grid icon drawn at 8-10px gets a hairline;
// the 12px-grid set keeps the line weight. Use these below 12px.

// ui-layout/12px_check.svg
export const IconCheck12 = icon("IconCheck12", <><path d="m1.76,7.004l2.25,3L10.24,1.746" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" /></>, 12);

// ui-layout/12px_xmark.svg
export const IconXmark12 = icon("IconXmark12", <><line x1="2.25" y1="9.75" x2="9.75" y2="2.25" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" /><line x1="9.75" y1="9.75" x2="2.25" y2="2.25" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" /></>, 12);

// ui-layout/12px_plus.svg
export const IconPlus12 = icon("IconPlus12", <><line x1="10.75" y1="6" x2="1.25" y2="6" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" /><line x1="6" y1="10.75" x2="6" y2="1.25" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" /></>, 12);

// ui-layout/12px_alert-question.svg
export const IconQuestion12 = icon("IconQuestion12", <><circle cx="6" cy="10.5" r="1" fill="currentColor" strokeWidth="0" /><path d="m3.929,3.277c.316-1.206,1.3-1.83,2.401-1.773,1.087.056,2.099.654,2.052,2.041-.066,1.972-2.277,1.612-2.382,3.955" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" /></>, 12);

// arrows/12px_chevron-right.svg
export const IconChevronRight12 = icon("IconChevronRight12", <><polyline points="4.25 10.25 8.5 6 4.25 1.75" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" /></>, 12);
