import { createFileRoute } from "@tanstack/react-router";
import { AccountScreen } from "@/features/app/AccountScreen";

export const Route = createFileRoute("/_app/account")({
  component: AccountScreen,
});