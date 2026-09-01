import { describe, expect, it } from "vitest";
import { normalizeRoomCodeInput } from "@/lib/poker/room-code";

describe("room-code input", () => {
  it.each([
    ["ABCD2345", "ABCD2345"],
    ["abcd2345", "ABCD2345"],
    ["  abcd 2345  ", "ABCD2345"],
    ["ABCD-2345", "ABCD2345"],
    ["ABCD‑2345", "ABCD2345"],
    ["https://pocket.example/table/ABCD2345", "ABCD2345"],
    ["http://localhost:3000/table/abcd-2345?invite=1#seat", "ABCD2345"],
    ["https://pocket.example/table/abcd%202345", "ABCD2345"],
  ])("normalizes %s", (input, expected) => {
    expect(normalizeRoomCodeInput(input)).toBe(expected);
  });

  it.each([
    "",
    "ABC2345",
    "ABCD23456",
    "ABCDO345",
    "ABCDI345",
    "javascript:ABCD2345",
    "ftp://pocket.example/table/ABCD2345",
    "https://pocket.example/rooms/ABCD2345",
    "https://pocket.example/table/ABCD2345/extra",
  ])("rejects %s", (input) => {
    expect(normalizeRoomCodeInput(input)).toBeNull();
  });
});
