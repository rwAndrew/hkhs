// 密鑰比對用固定時間的方式，不因為前幾個字元對了就提早結束，
// 避免用回應時間一個字一個字猜出密鑰（timing attack）。
import { timingSafeEqual } from "node:crypto";

export function secretMatches(candidate) {
  const expected = process.env.IG_CRON_SECRET;
  if (!expected || typeof candidate !== "string") return false;
  const a = Buffer.from(candidate);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
