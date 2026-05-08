---
version: alpha
name: PickleMatch VN
description: Mobile-first pickleball product UI that blends calm forest neutrals with high-energy electric highlights.
colors:
  background: "#F8FAF6"
  on-background: "#191C1B"
  surface: "#FFFFFF"
  surface-dim: "#D8DBD7"
  surface-bright: "#F8FAF6"
  surface-container-lowest: "#FFFFFF"
  surface-container-low: "#F2F4F1"
  surface-container: "#ECEEEB"
  surface-container-high: "#E7E9E5"
  surface-container-highest: "#E1E3E0"
  surface-variant: "#E1E3E0"
  on-surface: "#191C1B"
  on-surface-variant: "#404944"
  outline: "#707974"
  outline-variant: "#BFC9C3"
  primary: "#2B6954"
  on-primary: "#FFFFFF"
  primary-strong: "#064E3B"
  primary-base: "#003527"
  primary-container: "#064E3B"
  on-primary-container: "#80BEA6"
  secondary: "#4C6359"
  secondary-container: "#CCE6D9"
  on-secondary: "#FFFFFF"
  on-secondary-container: "#50685D"
  tertiary: "#00352E"
  tertiary-container: "#004E44"
  tertiary-fixed: "#96F3E1"
  tertiary-fixed-dim: "#7AD7C6"
  on-tertiary: "#FFFFFF"
  on-tertiary-container: "#65C2B1"
  error: "#BA1A1A"
  on-error: "#FFFFFF"
  error-container: "#FFDAD6"
  on-error-container: "#93000A"
  success: "#047857"
  success-container: "#DCFCE7"
  warning: "#B45309"
  warning-container: "#FEF3C7"
  info: "#475569"
  info-container: "#E2E8F0"
  danger: "#BE123C"
  danger-strong: "#E11D48"
  danger-container: "#FFE4E6"
  overlay: "#0A141E"
  electric-ring-lime: "#ADFF2F"
  electric-ring-cyan: "#06B6D4"
  electric-hero-dark: "#030817"
typography:
  display-xl:
    fontFamily: "Plus Jakarta Sans"
    fontSize: 44px
    fontWeight: 800
    lineHeight: 48px
    letterSpacing: -0.02em
  headline-xl:
    fontFamily: "Plus Jakarta Sans"
    fontSize: 34px
    fontWeight: 800
    lineHeight: 38px
    letterSpacing: -0.01em
  headline-lg:
    fontFamily: "Plus Jakarta Sans"
    fontSize: 28px
    fontWeight: 700
    lineHeight: 34px
  headline-md:
    fontFamily: "Plus Jakarta Sans"
    fontSize: 24px
    fontWeight: 800
    lineHeight: 32px
  title-lg:
    fontFamily: "Plus Jakarta Sans"
    fontSize: 20px
    fontWeight: 800
    lineHeight: 28px
  title-md:
    fontFamily: "Plus Jakarta Sans"
    fontSize: 18px
    fontWeight: 700
    lineHeight: 26px
  body-lg:
    fontFamily: "Plus Jakarta Sans"
    fontSize: 16px
    fontWeight: 400
    lineHeight: 24px
  body-md:
    fontFamily: "Plus Jakarta Sans"
    fontSize: 15px
    fontWeight: 400
    lineHeight: 22px
  body-sm:
    fontFamily: "Plus Jakarta Sans"
    fontSize: 14px
    fontWeight: 400
    lineHeight: 22px
  label-lg:
    fontFamily: "Plus Jakarta Sans"
    fontSize: 16px
    fontWeight: 700
    lineHeight: 20px
    letterSpacing: 0.02em
  label-md:
    fontFamily: "Plus Jakarta Sans"
    fontSize: 13px
    fontWeight: 700
    lineHeight: 18px
    letterSpacing: 0.04em
  label-sm:
    fontFamily: "Plus Jakarta Sans"
    fontSize: 11px
    fontWeight: 800
    lineHeight: 16px
    letterSpacing: 0.08em
rounded:
  xs: 10px
  sm: 12px
  md: 18px
  lg: 24px
  xl: 28px
  xxl: 32px
  hero: 34px
  pill: 9999px
spacing:
  xxs: 2px
  xs: 4px
  sm: 8px
  md: 12px
  lg: 16px
  xl: 20px
  xxl: 24px
  xxxl: 28px
  section: 32px
  screen-x: 20px
  card-pad: 20px
  chip-x: 12px
  chip-y: 8px
  button-x: 20px
  button-y: 14px
elevation:
  level-0:
    offsetY: 0px
    blur: 0px
    opacity: 0
    elevation: 0
  level-1:
    offsetY: 4px
    blur: 10px
    opacity: 0.04
    elevation: 2
  level-2:
    offsetY: 6px
    blur: 14px
    opacity: 0.06
    elevation: 3
  level-3:
    offsetY: 8px
    blur: 18px
    opacity: 0.08
    elevation: 4
  level-4:
    offsetY: 10px
    blur: 24px
    opacity: 0.16
    elevation: 8
shadows:
  card:
    color: "{colors.on-background}"
    offsetX: 0px
    offsetY: "{elevation.level-2.offsetY}"
    blur: "{elevation.level-2.blur}"
    opacity: "{elevation.level-2.opacity}"
  raised:
    color: "{colors.on-background}"
    offsetX: 0px
    offsetY: "{elevation.level-4.offsetY}"
    blur: "{elevation.level-4.blur}"
    opacity: "{elevation.level-4.opacity}"
motion:
  duration-fast: 180
  duration-base: 220
  duration-slow: 300
  press-active-opacity: 0.92
  press-soft-opacity: 0.88
  modal-transition: fade
  sheet-transition: slide
components:
  app-surface-card:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.on-surface}"
    rounded: "{rounded.xl}"
    padding: "{spacing.card-pad}"
  app-surface-card-muted:
    backgroundColor: "{colors.surface-container-low}"
    textColor: "{colors.on-surface}"
    rounded: "{rounded.xl}"
    padding: "{spacing.card-pad}"
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.on-primary}"
    typography: "{typography.label-lg}"
    rounded: "{rounded.pill}"
    height: 56px
    padding: "0 20px"
  button-secondary:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.primary-strong}"
    typography: "{typography.label-lg}"
    rounded: "{rounded.pill}"
    height: 56px
    padding: "0 20px"
  chip-default:
    backgroundColor: "{colors.surface-container}"
    textColor: "{colors.on-surface-variant}"
    typography: "{typography.label-sm}"
    rounded: "{rounded.pill}"
    padding: "8px 12px"
  chip-success:
    backgroundColor: "{colors.success-container}"
    textColor: "{colors.success}"
    typography: "{typography.label-sm}"
    rounded: "{rounded.pill}"
    padding: "8px 12px"
  input-field:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.on-surface}"
    typography: "{typography.body-md}"
    rounded: "{rounded.md}"
    height: 56px
    padding: "0 16px"
  tab-bar:
    backgroundColor: "{colors.background}"
    rounded: "{rounded.lg}"
    height: 68px
    padding: "12px 16px"
  fab-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.on-primary}"
    typography: "{typography.label-md}"
    rounded: "{rounded.pill}"
    padding: "20px 32px"
---

## Overview
PickleMatch VN is a performance-forward sports product with two coordinated moods: a calm, trustworthy day-to-day system for scheduling and coordination, and a high-energy "electric court" layer for onboarding and key conversion moments. The base UI should feel clean, grounded, and practical. Energy is introduced as controlled bursts through gradient accents, glowing rings, and bold uppercase labels rather than constant visual noise.

## Colors
The core palette is forest-led and tonal. Surfaces stay bright and soft (`background`, `surface-container-*`) while text and controls rely on dark green and slate neutrals for readability. Primary interaction color is green (`primary`) with strong contrast text (`on-primary`).

Semantic colors are explicit and should stay consistent:
- `success` and `success-container` for positive completion or safe confirmation.
- `warning` and `warning-container` for pending or time-sensitive work.
- `danger`, `danger-strong`, and `danger-container` for destructive or high-risk actions.
- `info` and `info-container` for neutral assistance.

Electric highlights (`electric-ring-lime`, `electric-ring-cyan`, `electric-hero-dark`) are reserved for hero treatments, onboarding storytelling, and login atmosphere. They should not replace the core green semantic system for everyday controls.

## Typography
Typography is a single-family system built on Plus Jakarta Sans with heavy reliance on weight contrast and casing.

Rules of use:
- Headline tiers (`display-xl`, `headline-*`) carry personality and should feel bold and assertive.
- Body tiers (`body-*`) stay readable and relaxed with generous line height.
- Label tiers (`label-*`) are often uppercase, tightly scoped, and letter-spaced for metadata, chips, and compact controls.
- Italicized extra-bold moments are reserved for brand signatures and hero moments only.

## Layout
Layout is mobile-first, card-based, and rhythm-driven.
- Use `screen-x` horizontal padding as the base page gutter.
- Separate major blocks using `section` spacing.
- Keep dense data inside rounded cards (`rounded.xl` or larger) with consistent internal padding (`card-pad`).
- Use pill chips and compact badges to reduce line length and improve scan speed.
- Maintain clear vertical rhythm through repeated 8/12/16/20/24 spacing intervals.

## Elevation & Depth
Depth is subtle and mostly practical. Most hierarchy is created through tonal layers, borders, and spacing before heavy shadows.

Guidance:
- Standard cards and list rows use `elevation.level-2` or lower.
- Floating and high-priority actions (such as primary FAB and hero CTA) may use `elevation.level-3` to `level-4`.
- Header and tab bars use soft, low-contrast shadows to separate from scroll content without looking detached.
- Avoid stacking multiple high-elevation surfaces in the same viewport.

## Shapes
The shape language is intentionally rounded and tactile.
- Default interactive surfaces use `md` to `xl` radii.
- Hero cards and major containers trend toward `xxl` and `hero` radii for a soft premium feel.
- Chips, avatar pills, and floating CTAs should use `pill`.
- Avoid sharp corners unless signaling a deliberate structural boundary.

## Components
Primary component intent:
- `button-primary`: strongest call-to-action; high contrast; full pill profile.
- `button-secondary`: low-emphasis action with bordered or light-surface treatment.
- `input-field`: neutral container, clear border, readable body type.
- `chip-*`: concise state communication and metadata grouping.
- `app-surface-card*`: reusable containment primitives for most content sections.
- `tab-bar` and `fab-primary`: persistent navigation and creation affordances with confident but controlled elevation.

Interaction behavior:
- Press feedback should rely on opacity shifts and short timing (`duration-fast`, `duration-base`).
- Use fade for centered overlays and slide for sheet-like entrances.
- Keep transitions quick and decisive; this product favors momentum over ornamental motion.

## Do's and Don'ts
- Do keep one dominant CTA per screen.
- Do use semantic containers for status messaging instead of ad-hoc tints.
- Do preserve generous rounding and spacing to maintain the friendly sports identity.
- Do reserve electric accents for hero and conversion moments.
- Do not turn every card into a glowing or gradient surface.
- Do not mix unrelated semantic colors in the same action cluster.
- Do not overuse heavy shadows when tonal contrast already establishes hierarchy.

