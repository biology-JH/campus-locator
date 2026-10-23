import { describe, expect, it } from "vitest";
import { hasAdminRole } from "./admin-access";

describe("hasAdminRole", () => {
  it("grants access only to the exact admin role", () => {
    expect(hasAdminRole("admin")).toBe(true);
    expect(hasAdminRole("user")).toBe(false);
    expect(hasAdminRole("Admin")).toBe(false);
    expect(hasAdminRole(null)).toBe(false);
    expect(hasAdminRole(undefined)).toBe(false);
  });
});
