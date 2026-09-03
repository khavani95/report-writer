/**
 * فهرست منوی تلگرام و هندلرهای بات نباید از هم جدا بیفتند:
 * دستوری که در منو باشد ولی هندلر نداشته باشد، برای کاربر «کار نمی‌کند».
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { COMMANDS } from "../src/bot/text";

const source = readFileSync("src/bot/index.ts", "utf8");

test("هر دستوری که در منوی تلگرام هست، هندلر هم دارد", () => {
  for (const c of COMMANDS) {
    const single = new RegExp(`bot\\.command\\("${c.command}"`);
    const inList = new RegExp(`bot\\.command\\(\\[[^\\]]*"${c.command}"`);
    assert.ok(
      single.test(source) || inList.test(source),
      `دستور /${c.command} در منو هست ولی هندلر ندارد`,
    );
  }
});

test("نام دستورها با قواعد تلگرام می‌خواند", () => {
  for (const c of COMMANDS) {
    assert.match(c.command, /^[a-z0-9_]{1,32}$/, c.command);
    assert.ok(c.description.length >= 1 && c.description.length <= 256);
  }
  const names = COMMANDS.map((c) => c.command);
  assert.equal(new Set(names).size, names.length, "دستور تکراری");
});
