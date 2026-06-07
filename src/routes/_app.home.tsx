import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { getRole, subscribeRoleChange, type Role } from "@/lib/role";
import { RequesterHome } from "@/features/request/RequesterHome";
import { CoverHome } from "@/features/cover/CoverHome";

export const Route = createFileRoute("/_app/home")({
  component: HomeRouter,
});

export function HomeRouter() {
  // Role is synchronous session state; seed immediately to avoid a blank frame.
  const [role, setLocalRole] = useState<Role>(() => getRole());
  useEffect(() => subscribeRoleChange(() => setLocalRole(getRole())), []);
  return role === "cover" ? <CoverHome /> : <RequesterHome />;
}
