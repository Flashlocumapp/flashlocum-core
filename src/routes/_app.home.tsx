import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { getRole, type Role } from "@/lib/role";
import { RequesterHome } from "@/features/request/RequesterHome";
import { CoverHome } from "@/features/cover/CoverHome";

export const Route = createFileRoute("/_app/home")({
  component: HomeRouter,
});

function HomeRouter() {
  // Role lives in localStorage; read on the client only.
  const [role, setLocalRole] = useState<Role | null>(null);
  useEffect(() => setLocalRole(getRole()), []);

  if (!role) return <div className="h-full w-full bg-background" />;
  return role === "cover" ? <CoverHome /> : <RequesterHome />;
}
