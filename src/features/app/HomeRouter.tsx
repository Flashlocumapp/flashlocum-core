import { useEffect, useState } from "react";
import { getRole, subscribeRoleChange, type Role } from "@/lib/role";
import { RequesterHome } from "@/features/request/RequesterHome";
import { CoverHome } from "@/features/cover/CoverHome";

export function HomeRouter({ active = true }: { active?: boolean }) {
  // Role is synchronous session state; seed immediately to avoid a blank frame.
  const [role, setLocalRole] = useState<Role | null>(() => getRole());
  useEffect(() => subscribeRoleChange(() => setLocalRole(getRole())), []);
  if (!role) return null;
  return role === "cover" ? <CoverHome active={active} /> : <RequesterHome active={active} />;
}
