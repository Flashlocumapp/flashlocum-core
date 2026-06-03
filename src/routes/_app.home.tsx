import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { getRole, type Role } from "@/lib/role";
import { RequesterHome } from "@/features/request/RequesterHome";
import { CoverHome } from "@/features/cover/CoverHome";

export const Route = createFileRoute("/_app/home")({
  component: HomeRouter,
});

function HomeRouter() {
  // Role is synchronous session state; seed immediately to avoid a blank frame.
  const [role] = useState<Role>(() => getRole());
  return role === "cover" ? <CoverHome /> : <RequesterHome />;
}
