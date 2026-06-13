import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import {
  adminSupportSearch,
  adminSendPushFn,
  type SupportSearchHit,
} from "@/lib/admin.functions";
import { AdminPageHeader, Chip, Empty } from "@/lib/admin-ui";
import { toast } from "@/lib/feedback";

export const Route = createFileRoute("/_admin/admin/support")({
  ssr: false,
  component: SupportPage,
});

function SupportPage() {
  const search = useServerFn(adminSupportSearch);
  const sendPush = useServerFn(adminSendPushFn);

  const [q, setQ] = useState("");
  const [hits, setHits] = useState<SupportSearchHit[] | null>(null);
  const [selectedUser, setSelectedUser] = useState<{ id: string; name: string } | null>(null);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");

  const searchMut = useMutation({
    mutationFn: async (qq: string) => search({ data: { q: qq } }),
    onSuccess: (data) => setHits(data),
    onError: (e: Error) => toast.error(e.message),
  });

  const pushMut = useMutation({
    mutationFn: async (input: { userId: string; title: string; body: string }) =>
      sendPush({ data: input }),
    onSuccess: () => {
      toast.success("Push sent");
      setTitle("");
      setBody("");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="mx-auto max-w-[1300px] space-y-6 p-6">
      <AdminPageHeader
        title="Support Tools"
        subtitle="Resolve user issues from a single pane of glass."
      />

      <section
        className="rounded-2xl p-4"
        style={{ background: "var(--color-surface-elevated)" }}
      >
        <h2 className="mb-3 text-[13px] font-semibold uppercase tracking-wider text-muted-foreground">
          Universal search
        </h2>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (q.trim().length >= 2) searchMut.mutate(q.trim());
          }}
          className="flex gap-2"
        >
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Name, phone, MDCN, hospital, area, payment reference, user UUID…"
            className="h-10 flex-1 rounded-full bg-secondary px-4 text-[13px] outline-none"
          />
          <button
            type="submit"
            disabled={searchMut.isPending || q.trim().length < 2}
            className="h-10 rounded-full bg-primary px-5 text-[12.5px] font-medium text-primary-foreground disabled:opacity-60"
          >
            {searchMut.isPending ? "Searching…" : "Search"}
          </button>
        </form>

        <div className="mt-4">
          {hits == null ? (
            <p className="text-[12.5px] text-muted-foreground">
              Search across users and shifts. Pick a user to send them a push notification.
            </p>
          ) : hits.length === 0 ? (
            <Empty>No matches.</Empty>
          ) : (
            <div className="divide-y">
              {hits.map((h) => (
                <button
                  key={`${h.kind}:${h.id}`}
                  onClick={() => {
                    if (h.kind === "user") setSelectedUser({ id: h.id, name: h.title });
                  }}
                  className="flex w-full items-center justify-between py-2.5 text-left hover:opacity-80"
                  disabled={h.kind !== "user"}
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <Chip color={h.kind === "user" ? "var(--color-primary)" : "var(--color-muted-foreground)"}>
                        {h.kind}
                      </Chip>
                      <span className="truncate text-[13px] font-medium">{h.title}</span>
                    </div>
                    {h.subtitle && (
                      <div className="mt-0.5 truncate text-[12px] text-muted-foreground">
                        {h.subtitle}
                      </div>
                    )}
                  </div>
                  <div className="ml-3 shrink-0 text-[11.5px] text-muted-foreground">{h.meta}</div>
                </button>
              ))}
            </div>
          )}
        </div>
      </section>

      <section
        className="rounded-2xl p-4"
        style={{ background: "var(--color-surface-elevated)" }}
      >
        <h2 className="mb-3 text-[13px] font-semibold uppercase tracking-wider text-muted-foreground">
          Send push notification
        </h2>
        {!selectedUser ? (
          <Empty>Search for a user above, then click their row to target a push.</Empty>
        ) : (
          <div className="space-y-3">
            <div className="flex items-center justify-between rounded-xl bg-secondary px-3 py-2">
              <div className="min-w-0">
                <div className="truncate text-[13px] font-medium">{selectedUser.name}</div>
                <div className="truncate font-mono text-[10.5px] text-muted-foreground">
                  {selectedUser.id}
                </div>
              </div>
              <button
                onClick={() => setSelectedUser(null)}
                className="text-[12px] text-muted-foreground hover:underline"
              >
                Clear
              </button>
            </div>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              maxLength={80}
              placeholder="Title (max 80)"
              className="h-10 w-full rounded-xl bg-secondary px-3 text-[13px] outline-none"
            />
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              maxLength={240}
              placeholder="Body (max 240)"
              rows={3}
              className="w-full rounded-xl bg-secondary px-3 py-2 text-[13px] outline-none"
            />
            <div className="flex items-center justify-between">
              <span className="text-[11px] text-muted-foreground">
                Goes to every registered device for this user. {body.length}/240
              </span>
              <button
                onClick={() =>
                  pushMut.mutate({ userId: selectedUser.id, title: title.trim(), body: body.trim() })
                }
                disabled={pushMut.isPending || !title.trim() || !body.trim()}
                className="h-10 rounded-full bg-primary px-5 text-[12.5px] font-medium text-primary-foreground disabled:opacity-60"
              >
                {pushMut.isPending ? "Sending…" : "Send push"}
              </button>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
