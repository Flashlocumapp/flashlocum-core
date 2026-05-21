import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { AnimatePresence } from "framer-motion";
import { useState } from "react";
import { SplashScreen } from "@/components/SplashScreen";

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
          onDone={() => {
            setDone(true);
            navigate({ to: "/role" });
          }}
        />
      ) : null}
    </AnimatePresence>
  );
}
