import { createFileRoute } from "@tanstack/react-router";
import { HomeRouter } from "@/features/app/HomeRouter";

export const Route = createFileRoute("/_app/home")({
  component: HomeRouter,
});