import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { AnimatePresence } from "framer-motion";
import { useEffect, useState } from "react";
import { SplashScreen } from "@/components/SplashScreen";
import { ensureAuthReady } from "@/lib/auth-ready";
import { isAdminHost } from "@/lib/admin-host";

export const Route = createFileRoute("/")({
  component: Entry,
});

function Entry() {
  const navigate = useNavigate();
  const [done, setDone] = useState(false);

  // Admin subdomain skips the consumer splash entirely.
  useEffect(() => {
    if (isAdminHost()) {
      void navigate({ to: "/admin", replace: true });
    }
  }, [navigate]);

  if (isAdminHost()) return null;

  return (
    <AnimatePresence mode="wait">
      {!done ? (
        <SplashScreen
          key="splash"
          onDone={async () => {
            const auth = await ensureAuthReady();
            navigate({ to: auth.session?.user.email_confirmed_at ? "/home" : "/role" });
            setDone(true);
          }}
        />
      ) : null}
    </AnimatePresence>
  );
}
