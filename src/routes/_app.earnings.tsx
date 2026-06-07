import { createFileRoute } from "@tanstack/react-router";
import { EarningsScreen } from "@/features/app/EarningsScreen";

export const Route = createFileRoute("/_app/earnings")({
  component: EarningsScreen,
});