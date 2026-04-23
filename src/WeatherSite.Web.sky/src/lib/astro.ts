/**
 * Approximate sunrise / sunset / solar-noon for a given lat/long/date.
 *
 * Adapted from NOAA Solar Calculator (general Meeus approximations), accurate
 * to within ±1 minute for most mid-latitude locations — fine for a UI glyph.
 */

const rad = (deg: number) => (deg * Math.PI) / 180;
const deg = (rads: number) => (rads * 180) / Math.PI;

function julianDay(date: Date): number {
  const year = date.getUTCFullYear();
  let month = date.getUTCMonth() + 1;
  const day =
    date.getUTCDate() +
    (date.getUTCHours() + (date.getUTCMinutes() + date.getUTCSeconds() / 60) / 60) / 24;

  let y = year;
  if (month <= 2) {
    y -= 1;
    month += 12;
  }
  const a = Math.floor(y / 100);
  const b = 2 - a + Math.floor(a / 4);
  return (
    Math.floor(365.25 * (y + 4716)) +
    Math.floor(30.6001 * (month + 1)) +
    day +
    b -
    1524.5
  );
}

export interface SolarTimes {
  sunriseUtc: Date | null;
  sunsetUtc: Date | null;
  solarNoonUtc: Date | null;
  /** 0 at midnight, 0.5 at solar noon, 1 at next midnight. */
  fraction: number;
  /** True when sun is currently above the horizon. */
  isDay: boolean;
}

export function solarTimes(latitude: number, longitude: number, when: Date = new Date()): SolarTimes {
  // Use noon UTC of target local day so we get correct sunrise/sunset for the day the user is in
  const target = new Date(Date.UTC(when.getUTCFullYear(), when.getUTCMonth(), when.getUTCDate(), 12));
  const jd = julianDay(target);
  const t = (jd - 2451545.0) / 36525.0;

  const meanLong = (280.46646 + t * (36000.76983 + t * 0.0003032)) % 360;
  const meanAnom = 357.52911 + t * (35999.05029 - 0.0001537 * t);
  const eccent = 0.016708634 - t * (0.000042037 + 0.0000001267 * t);

  const sunEqOfCenter =
    Math.sin(rad(meanAnom)) *
      (1.914602 - t * (0.004817 + 0.000014 * t)) +
    Math.sin(rad(2 * meanAnom)) * (0.019993 - 0.000101 * t) +
    Math.sin(rad(3 * meanAnom)) * 0.000289;

  const sunTrueLong = meanLong + sunEqOfCenter;
  const sunAppLong = sunTrueLong - 0.00569 - 0.00478 * Math.sin(rad(125.04 - 1934.136 * t));

  const meanObliq =
    23 +
    (26 + (21.448 - t * (46.815 + t * (0.00059 - t * 0.001813))) / 60) / 60;
  const obliqCorr = meanObliq + 0.00256 * Math.cos(rad(125.04 - 1934.136 * t));

  const sunDecl = deg(Math.asin(Math.sin(rad(obliqCorr)) * Math.sin(rad(sunAppLong))));

  const varY = Math.tan(rad(obliqCorr / 2)) ** 2;
  const eqOfTime =
    4 *
    deg(
      varY * Math.sin(2 * rad(meanLong)) -
        2 * eccent * Math.sin(rad(meanAnom)) +
        4 * eccent * varY * Math.sin(rad(meanAnom)) * Math.cos(2 * rad(meanLong)) -
        0.5 * varY * varY * Math.sin(4 * rad(meanLong)) -
        1.25 * eccent * eccent * Math.sin(2 * rad(meanAnom))
    );

  const hourAngleCosine =
    (Math.cos(rad(90.833)) / (Math.cos(rad(latitude)) * Math.cos(rad(sunDecl))) -
      Math.tan(rad(latitude)) * Math.tan(rad(sunDecl)));

  let sunriseUtc: Date | null = null;
  let sunsetUtc: Date | null = null;
  let solarNoonUtc: Date | null = null;

  const solarNoonMinutesUtc = 720 - 4 * longitude - eqOfTime;
  solarNoonUtc = minutesToDate(target, solarNoonMinutesUtc);

  if (Math.abs(hourAngleCosine) <= 1) {
    const hourAngle = deg(Math.acos(hourAngleCosine));
    sunriseUtc = minutesToDate(target, solarNoonMinutesUtc - hourAngle * 4);
    sunsetUtc = minutesToDate(target, solarNoonMinutesUtc + hourAngle * 4);
  }

  const isDay =
    sunriseUtc != null && sunsetUtc != null && when >= sunriseUtc && when <= sunsetUtc;

  let fraction = 0;
  if (sunriseUtc && sunsetUtc) {
    const dayLen = sunsetUtc.getTime() - sunriseUtc.getTime();
    if (dayLen > 0) {
      fraction = clamp((when.getTime() - sunriseUtc.getTime()) / dayLen, 0, 1);
    }
  }

  return { sunriseUtc, sunsetUtc, solarNoonUtc, fraction, isDay };
}

function minutesToDate(baseUtcDay: Date, minutes: number): Date {
  const date = new Date(baseUtcDay);
  date.setUTCHours(0, 0, 0, 0);
  return new Date(date.getTime() + minutes * 60 * 1000);
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
