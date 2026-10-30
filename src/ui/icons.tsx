/** Inline SVG icons: 16 px, currentColor, decorative (aria-hidden); label the button instead. */
import type { JSX } from "preact";

type P = { size?: number; class?: string };

function svg(paths: JSX.Element, { size = 16, class: cls }: P = {}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      stroke-width="1.5"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
      focusable="false"
      class={cls}
    >
      {paths}
    </svg>
  );
}

export const IconSearch = (p?: P) =>
  svg(
    <>
      <circle cx="7" cy="7" r="4.25" />
      <path d="M10.25 10.25 13.5 13.5" />
    </>,
    p,
  );
export const IconSidePanel = (p?: P) =>
  svg(
    <>
      <rect x="2" y="2.75" width="12" height="10.5" rx="1.5" />
      <path d="M10 2.75v10.5" />
    </>,
    p,
  );
export const IconSettings = (p?: P) =>
  svg(
    <>
      <circle cx="8" cy="8" r="2" />
      <path d="M8 1.75v1.5M8 12.75v1.5M14.25 8h-1.5M3.25 8h-1.5M12.4 3.6l-1.06 1.06M4.66 11.34 3.6 12.4M12.4 12.4l-1.06-1.06M4.66 4.66 3.6 3.6" />
    </>,
    p,
  );
export const IconPlus = (p?: P) => svg(<path d="M8 3v10M3 8h10" />, p);
export const IconMore = (p?: P) =>
  svg(
    <>
      <circle cx="3.5" cy="8" r=".9" fill="currentColor" />
      <circle cx="8" cy="8" r=".9" fill="currentColor" />
      <circle cx="12.5" cy="8" r=".9" fill="currentColor" />
    </>,
    p,
  );
export const IconClose = (p?: P) => svg(<path d="M4 4l8 8M12 4l-8 8" />, p);
export const IconPark = (p?: P) => svg(<path d="M8 2.5v7M5 6.75 8 9.75l3-3M3 11.5v2h10v-2" />, p);
export const IconChevronDown = (p?: P) => svg(<path d="M4.5 6.25 8 9.75l3.5-3.5" />, p);
export const IconChevronRight = (p?: P) => svg(<path d="M6.25 4.5 9.75 8l-3.5 3.5" />, p);
export const IconPin = (p?: P) =>
  svg(<path d="M9.5 2.5l4 4-2.25.75-2.5 2.5-.25 2.75L4 8l2.75-.25 2.5-2.5zM6 10l-3.5 3.5" />, p);
export const IconSleep = (p?: P) => svg(<path d="M3 5h4L3 10h4M9 3h4l-4 4.5h4" />, p);
export const IconWarning = (p?: P) =>
  svg(
    <>
      <path d="M8 2.25 14.25 13.5H1.75z" />
      <path d="M8 6.5v3M8 11.6v.1" />
    </>,
    p,
  );
export const IconWindow = (p?: P) =>
  svg(
    <>
      <rect x="2" y="3" width="12" height="10" rx="1.5" />
      <path d="M2 6h12" />
    </>,
    p,
  );
export const IconGlobe = (p?: P) =>
  svg(
    <>
      <circle cx="8" cy="8" r="5.75" />
      <path d="M2.25 8h11.5M8 2.25c1.75 1.75 1.75 9.75 0 11.5M8 2.25c-1.75 1.75-1.75 9.75 0 11.5" />
    </>,
    p,
  );
export const IconTrash = (p?: P) =>
  svg(<path d="M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.5 9h6l.5-9" />, p);
export const IconRestore = (p?: P) => svg(<path d="M3 8a5 5 0 1 0 1.5-3.55M3 2.75V5h2.25" />, p);
export const IconDownload = (p?: P) =>
  svg(<path d="M8 2.5v8M4.75 7.5 8 10.75l3.25-3.25M3 13.5h10" />, p);
export const IconGrid = (p?: P) =>
  svg(
    <>
      <rect x="2.5" y="2.5" width="4.5" height="4.5" rx="1" />
      <rect x="9" y="2.5" width="4.5" height="4.5" rx="1" />
      <rect x="2.5" y="9" width="4.5" height="4.5" rx="1" />
      <rect x="9" y="9" width="4.5" height="4.5" rx="1" />
    </>,
    p,
  );
export const IconDupes = (p?: P) =>
  svg(
    <>
      <rect x="5.5" y="5.5" width="8" height="8" rx="1.5" />
      <path d="M10.5 3.5v-.25A.75.75 0 0 0 9.75 2.5h-6.5a.75.75 0 0 0-.75.75v6.5c0 .41.34.75.75.75h.25" />
    </>,
    p,
  );
export const IconCheck = (p?: P) => svg(<path d="M3.5 8.5 6.5 11.5 12.5 4.5" />, p);
export const IconLink = (p?: P) =>
  svg(
    <path d="M7 9a2.5 2.5 0 0 0 3.5 0l2-2A2.5 2.5 0 0 0 9 3.5l-.75.75M9 7a2.5 2.5 0 0 0-3.5 0l-2 2A2.5 2.5 0 0 0 7 12.5l.75-.75" />,
    p,
  );

/** Simple geometric mark: a folder-like tab on a rounded square ("tab habitat"). */
export const Logo = ({ size = 16 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 16 16" aria-hidden="true" focusable="false">
    <rect x="1" y="4" width="14" height="11" rx="2.5" fill="var(--accent)" />
    <path d="M1 6.5V3.5A1.5 1.5 0 0 1 2.5 2h4l1.5 2.5" fill="var(--accent)" />
    <rect x="4" y="7.5" width="8" height="1.6" rx=".8" fill="var(--accent-fg)" />
    <rect x="7.2" y="7.5" width="1.6" height="5" rx=".8" fill="var(--accent-fg)" />
  </svg>
);
