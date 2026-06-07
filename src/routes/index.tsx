import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { AnimatePresence } from "framer-motion";
import { useState } from "react";
import { SplashScreen } from "@/components/SplashScreen";
import { ensureAuthReady } from "@/lib/auth-ready";

export const Route = createFileRoute("/")({
  component: Entry,
});

function Entry() {
  const navigate = useNavigate();
  const [done, setDone] = useState(false);
  return (
    <AnimatePresence mode="wait">
      {!done ? (
        <SplashScreen
          key="splash"
          onDone={async () => {
            setDone(true);
            const auth = await ensureAuthReady();
            navigate({ to: auth.session?.user.email_confirmed_at ? "/home" : "/role" });
          }}
        />
      ) : null}
    </AnimatePresence>
  );
}
