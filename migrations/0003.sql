CREATE TABLE deliveries (
 team TEXT NOT NULL, event_id TEXT NOT NULL, channel TEXT NOT NULL,
 aliases TEXT NOT NULL CHECK(json_valid(aliases)), thread TEXT NOT NULL,
 status TEXT NOT NULL CHECK(status IN ('queued','preparing','sending','done','failed','uncertain')),
 attempt INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL,
 touched_at INTEGER NOT NULL, due_at INTEGER NOT NULL, error TEXT,
 PRIMARY KEY(team,event_id)
);
CREATE INDEX delivery_due ON deliveries(team,status,due_at);
CREATE INDEX delivery_lease ON deliveries(team,status,touched_at);
