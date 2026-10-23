export function hasAdminRole(role: string | null | undefined): role is "admin" {
  return role === "admin";
}
