import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  Link,
  createRootRouteWithContext,
  useRouter,
  HeadContent,
  Scripts,
} from "@tanstack/react-router";
import { useEffect } from "react";

import appCss from "../styles.css?url";
import { initLightMode } from "@/lib/theme";
import { clearRole } from "@/lib/role";
import { subscribeAuthState } from "@/lib/auth-ready";

function NotFoundComponent() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-6">
      <div className="text-center">
        <p className="text-sm text-muted-foreground">Nothing here.</p>
        <Link to="/" className="mt-4 inline-block text-sm font-medium underline underline-offset-4">
          Back to FlashLocum
        </Link>
      </div>
    </div>
  );
}

function ErrorComponent({ error, reset }: { error: Error; reset: () => void }) {
  console.error(error);
  const router = useRouter();
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-6">
      <div className="max-w-sm text-center">
        <p className="text-base font-medium">Something went off-network.</p>
        <p className="mt-1 text-sm text-muted-foreground">{error.message}</p>
        <button
          onClick={() => { router.invalidate(); reset(); }}
          className="mt-5 rounded-full bg-primary px-5 py-2 text-sm font-medium text-primary-foreground"
        >
          Try again
        </button>
      </div>
    </div>
  );
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1, viewport-fit=cover, maximum-scale=1" },
      { name: "theme-color", content: "#2a2a30" },
      { title: "FlashLocum" },
      { name: "description", content: "Realtime temporary medical coverage." },
    ],
    links: [{ rel: "stylesheet", href: appCss }],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: ErrorComponent,
});

function RootShell({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head><HeadContent /></head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

function RootComponent() {
  const { queryClient } = Route.useRouteContext();
  const router = useRouter();
  useEffect(() => { initLightMode(); }, []);
  useEffect(() => {
    let sawSignOut = false;
    return subscribeAuthState(({ event, session }) => {
      if (event === "SIGNED_OUT" && !session) {
        sawSignOut = true;
        void queryClient.cancelQueries().finally(() => {
          queryClient.clear();
          clearRole();
          void router.invalidate();
        });
        return;
      }
      if (event === "SIGNED_IN" && session && sawSignOut) {
        sawSignOut = false;
        void router.invalidate();
      }
    });
  }, [queryClient, router]);
  return (
    <QueryClientProvider client={queryClient}>
      <Outlet />
    </QueryClientProvider>
  );
}
