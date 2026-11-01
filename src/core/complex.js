'use strict';
/*
 * Complex arithmetic in rectangular form, with polar helpers.
 *
 * Protection work is quoted in polar (magnitude ∠ angle) but sums and
 * differences only behave in rectangular, so everything is stored as {re, im}
 * and converted at the edges. Angles are degrees throughout -- radians never
 * appear in a relay setting, and converting once at the boundary is less
 * error-prone than converting at every call site.
 */

const D2R = Math.PI / 180;
const R2D = 180 / Math.PI;

const rect = (re, im) => ({ re, im });

/** Build from magnitude and angle in degrees. */
function polar(magnitude, degrees) {
  return { re: magnitude * Math.cos(degrees * D2R), im: magnitude * Math.sin(degrees * D2R) };
}

const add = (a, b) => ({ re: a.re + b.re, im: a.im + b.im });
const sub = (a, b) => ({ re: a.re - b.re, im: a.im - b.im });
const mul = (a, b) => ({ re: a.re * b.re - a.im * b.im, im: a.re * b.im + a.im * b.re });
const scale = (a, k) => ({ re: a.re * k, im: a.im * k });
const neg = (a) => ({ re: -a.re, im: -a.im });
const conj = (a) => ({ re: a.re, im: -a.im });

function div(a, b) {
  const d = b.re * b.re + b.im * b.im;
  if (d === 0) throw new RangeError('division by a zero phasor');
  return { re: (a.re * b.re + a.im * b.im) / d, im: (a.im * b.re - a.re * b.im) / d };
}

const abs = (a) => Math.hypot(a.re, a.im);

/** Angle in degrees, normalised to (-180, 180]. */
function arg(a) {
  let d = Math.atan2(a.im, a.re) * R2D;
  if (d <= -180) d += 360;
  if (d > 180) d -= 360;
  return d;
}

/** Angle in degrees, normalised to [0, 360). */
function arg360(a) {
  const d = arg(a);
  return d < 0 ? d + 360 : d;
}

/**
 * Smallest signed difference between two angles, in degrees.
 * Used wherever a tolerance band wraps past 180 degrees -- the alpha plane
 * region is centred on 180, so naive subtraction gets the wrong answer there.
 */
function angleDiff(a, b) {
  return ((a - b + 540) % 360) - 180;
}

const isZero = (a, eps = 1e-12) => abs(a) < eps;

const ZERO = rect(0, 0);
const ONE = rect(1, 0);

module.exports = {
  D2R, R2D, ZERO, ONE,
  rect, polar, add, sub, mul, div, scale, neg, conj,
  abs, arg, arg360, angleDiff, isZero
};
