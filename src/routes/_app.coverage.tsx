import { createFileRoute } from "@tanstack/react-router";
import { CoverageScreen } from "@/features/app/CoverageScreen";

export const Route = createFileRoute("/_app/coverage")({
  component: CoverageScreen,
});