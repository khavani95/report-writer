/**
 * تطبیق نام میان فارسی و لاتین.
 * عضوی که با دکمه‌ی «نام تلگرام» ثبت می‌شود نامش لاتین است، ولی بقیه در
 * گروه او را فارسی صدا می‌زنند.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { namesMatch, findWorkerMatch } from "../src/lib/text-normalize";

const ROSTER = [
  ["Shayan Momen"],
  ["محمد خوانی"],
  ["محمد صادق خوانی"],
  ["آیدین نوری"],
];

test("همه‌ی شکل‌های نوشتنِ یک نام به یک عضو می‌رسند", () => {
  for (const form of [
    "شایان",
    "شایان مومن",
    "Shayan",
    "shayan momen",
    "SHAYAN",
    "مومن",
    "Momen",
  ]) {
    assert.equal(findWorkerMatch(form, ROSTER), 0, form);
  }
});

test("نامِ لاتینِ عضوِ فارسی هم پیدا می‌شود", () => {
  assert.equal(findWorkerMatch("idin noori", ROSTER), 3);
  assert.equal(findWorkerMatch("aydin", ROSTER), 3);
  assert.equal(findWorkerMatch("Mohammad Khavani", ROSTER), 1);
});

test("نام‌های متفاوت ادغام نمی‌شوند", () => {
  const pairs: Array<[string, string]> = [
    ["شایان", "صادق"],
    ["نوری", "مومن"],
    ["شایان", "محمد"],
    ["آیدین", "شایان"],
    ["رضا", "مهدی"],
    ["Shayan", "Sadegh"],
  ];
  for (const [a, b] of pairs) {
    assert.equal(namesMatch(a, b), false, `${a} / ${b}`);
  }
});

test("نامِ مبهم به کسی نسبت داده نمی‌شود", () => {
  // «محمد» هم به «محمد خوانی» می‌خورد هم به «محمد صادق خوانی»
  assert.equal(findWorkerMatch("محمد", ROSTER), -1);
});
