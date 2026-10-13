/**
 * The companies ADCode works with, shown under the hero recording.
 *
 * One row per partner. A partner's logo is their own file, never a drawing of one: until
 * the file is in `public/partners/`, the strip shows the name alone, which is honest and
 * still links them. To add a logo, put the file there (SVG or PNG, cropped tight to the mark)
 * and set `logo` below; add `logoDark` when the mark needs a light version for dark mode.
 */

export interface PartnerLogo {
  /** Under /partners/, so every logo the site shows is a file committed here. */
  readonly src: `/partners/${string}`;
  readonly width: number;
  readonly height: number;
}

export interface Partner {
  /** As the partner writes it. */
  readonly name: string;
  readonly href: `https://${string}`;
  /** What they do for ADCode, in a few words. */
  readonly role: string;
  readonly logo?: PartnerLogo;
  /** The same mark for dark backgrounds, when the default would disappear on one. */
  readonly logoDark?: PartnerLogo;
  /** The logo spells the name, so the printed name is kept for screen readers only. */
  readonly wordmark?: boolean;
}

export const PARTNERS: readonly Partner[] = [
  {
    name: "Tagflow AI",
    href: "https://tagflow-ai.com",
    role: "Free coding models, built into ADCode",
    // Their mark, lifted off its blue tile in ADCode text colours for each theme.
    logo: { src: "/partners/tagflow-light.png", width: 192, height: 192 },
    logoDark: { src: "/partners/tagflow-dark.png", width: 192, height: 192 },
  },
  {
    name: "Heabsy",
    href: "https://heabsy.com",
    role: "Free open models in ADCode: Qwen, GLM and MiMo",
    // Their wordmark, lifted off its navy ground in ADCode text colours for each theme.
    logo: { src: "/partners/heabsy-light.png", width: 176, height: 39 },
    logoDark: { src: "/partners/heabsy-dark.png", width: 176, height: 39 },
    wordmark: true,
  },
  {
    name: "Bluethenics",
    href: "https://bluethenics.com",
    role: "The software studio behind ADCode",
  },
];
